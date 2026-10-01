// Cloud sync between this device's local data and the signed-in account (Firestore).
//
// Layout (all under users/{uid}, readable/writable only by that user — see firestore.rules):
//   users/{uid}                      settings, settingsUpdatedAt, activeTaskId, activeUpdatedAt,
//                                    statsClearedAt, createdAt
//   users/{uid}/tasks/{taskId}       one task (or a tombstone { id, deleted: true, updatedAt })
//   users/{uid}/sessions/{YYYY-MM}   { items: [session, ...] } — the focus log, one doc per month
//   users/{uid}/state/timer          { snap, savedAt, deviceId } — the running timer
//
// Local storage stays the app's source of truth; this module mirrors it both ways:
//   sign-in → pull everything, merge with this device, push what the server lacks
//   local edit → push the change (debounced for settings)
//   remote edit → apply locally, flagged so it isn't pushed back (no echo loops)
// Google Calendar data and tokens are never uploaded.
import { bus } from '../core/bus.js';
import { load, save } from '../core/storage.js';
import { getSettings, applyRemoteSettings } from '../core/settings.js';
import * as Tasks from '../features/tasks.js';
import * as Stats from '../features/stats.js';
import { timer } from '../timer/engine.js';
import { mergeTasks, mergeSessions, groupByMonth, monthKey, stableJson, timerSignature, plain, cloudSettings, withLocalCalendars, cloudSnapshot, cloudSession } from './merge.js';

const state = { status: 'off', lastSyncedAt: 0, error: null };
let ctx = null; // { db, F, uid }
let applying = 0;
let pending = 0;
let generation = 0; // bumped by stopSync, so writes from an earlier session don't skew `pending`
let slowTimer = 0;
let settingsTimer = 0;
const SLOW_MS = 15000; // no answer from the server for this long → say so instead of "Syncing…"
const unsubs = [];
const last = { tasks: new Map(), activeId: null, activeAt: 0, settingsAt: 0, settingsJson: '', timerSig: '' };

const deviceId = (() => {
  let id = load('cloud.device', null);
  if (!id) {
    id = `d_${Math.random().toString(36).slice(2, 10)}`;
    save('cloud.device', id);
  }
  return id;
})();

/* ---------- status ---------- */

function setStatus(status, error = null) {
  state.status = status;
  state.error = error;
  bus.emit('sync:status', { ...state });
}

export function getSyncState() {
  return { ...state };
}

function idleStatus() {
  if (!ctx) return;
  setStatus(navigator.onLine ? 'synced' : 'offline');
}

// While the server hasn't answered for a while, show that instead of an endless "Syncing…".
function watchSlow() {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => {
    if (ctx && pending > 0 && state.status === 'syncing') {
      console.warn('[aura] the sync server hasn’t answered for 15 s (blocked by a network filter or extension?)');
      setStatus('waiting');
    }
  }, SLOW_MS);
}

// Every write goes through here: shows "Syncing…" until the server confirms.
function track(promise) {
  const gen = generation;
  pending++;
  if (state.status !== 'error' && state.status !== 'waiting') setStatus(navigator.onLine ? 'syncing' : 'offline');
  if (pending === 1) watchSlow();
  promise
    .then(() => {
      state.lastSyncedAt = Date.now();
    })
    .catch((err) => {
      console.warn('[aura] sync write failed', err);
      if (ctx && gen === generation) setStatus('error', describe(err));
    })
    .finally(() => {
      if (gen !== generation) return;
      pending--;
      if (pending === 0) clearTimeout(slowTimer);
      if (pending === 0 && ctx && state.status !== 'error') idleStatus();
    });
  return promise;
}

export function describe(err) {
  const code = err?.code || '';
  if (code === 'permission-denied') return 'The sync database refused access. Its security rules may not be published yet.';
  if (code === 'unavailable') return 'Can’t reach the sync service right now. Changes are saved and will sync later.';
  if (code === 'resource-exhausted') return 'The sync service is over its daily free limit. It resets tomorrow.';
  return err?.message || 'Sync failed.';
}

/* ---------- helpers ---------- */

const withApplying = (fn) => {
  applying++;
  try {
    return fn();
  } finally {
    applying--;
  }
};

const syncableSettings = () => cloudSettings(getSettings());
// Calendar selections aren't uploaded, so each device keeps its own.
const applySettings = (remote) => applyRemoteSettings(withLocalCalendars(remote, getSettings()));
const activeIdNow = () => Tasks.getActiveTask()?.id ?? null;
const localTimerChangedAt = () => Number(load('timer', null)?.changedAt) || 0;

function refs() {
  const { db, F, uid } = ctx;
  return {
    user: F.doc(db, 'users', uid),
    tasks: F.collection(db, 'users', uid, 'tasks'),
    task: (id) => F.doc(db, 'users', uid, 'tasks', id),
    sessions: F.collection(db, 'users', uid, 'sessions'),
    month: (m) => F.doc(db, 'users', uid, 'sessions', m),
    timer: F.doc(db, 'users', uid, 'state', 'timer'),
  };
}

// Batched writes, committed every 400 operations (Firestore allows 500 per batch).
function batcher() {
  const { db, F } = ctx;
  let batch = F.writeBatch(db);
  let n = 0;
  const done = [];
  const flush = () => {
    if (n) done.push(batch.commit());
    batch = F.writeBatch(db);
    n = 0;
  };
  return {
    set(ref, data, opts) {
      if (opts) batch.set(ref, data, opts);
      else batch.set(ref, data);
      if (++n >= 400) flush();
    },
    delete(ref) {
      batch.delete(ref);
      if (++n >= 400) flush();
    },
    commit() {
      flush();
      return Promise.all(done);
    },
  };
}

function rememberTasks() {
  last.tasks = new Map(Tasks.getTasks().map((t) => [t.id, stableJson(t)]));
  last.activeId = activeIdNow();
}

/* ---------- start / stop ---------- */

/** Merges this device with the account, then keeps both in sync until stopSync(). */
export async function startSync({ db, F, uid }) {
  stopSync();
  ctx = { db, F, uid };
  const gen = generation;
  setStatus('syncing');
  const R = refs();
  let user;
  let taskDocs;
  let sessionDocs;
  let timerDoc;
  const slow = setTimeout(() => {
    if (ctx && gen === generation && state.status === 'syncing') {
      console.warn('[aura] still waiting for the sync server after 15 s');
      setStatus('waiting');
    }
  }, SLOW_MS);
  try {
    const [u, t, s, tm] = await Promise.all([F.getDoc(R.user), F.getDocs(R.tasks), F.getDocs(R.sessions), F.getDoc(R.timer)]);
    user = u.exists() ? u.data() : null;
    taskDocs = t.docs.map((d) => d.data());
    sessionDocs = s.docs.map((d) => d.data());
    timerDoc = tm.exists() ? tm.data() : null;
  } catch (err) {
    console.warn('[aura] could not load account data', err);
    if (ctx?.uid === uid && gen === generation) setStatus('error', describe(err));
    throw err;
  } finally {
    clearTimeout(slow);
  }
  if (ctx?.uid !== uid || gen !== generation) return; // signed out (or restarted) while loading

  try {
    await mergeAndAttach({ F, R, gen, user, taskDocs, sessionDocs, timerDoc });
  } catch (err) {
    // Anything unexpected here must show up in the card, not leave it on "Syncing…".
    console.error('[aura] sync could not start', err);
    if (gen === generation) setStatus('error', describe(err));
    throw err;
  }
}

async function mergeAndAttach({ F, R, gen, user, taskDocs, sessionDocs, timerDoc }) {
  const B = batcher();
  const now = Date.now();
  const userPatch = {};
  if (!user) userPatch.createdAt = now;

  // 1. "Reset statistics": the account's reset time applies here. A reset this device made before
  //    signing in only cleared its own log, so it isn't pushed (it would hide your other devices' history).
  const clearedAt = Number(user?.statsClearedAt) || 0;
  withApplying(() => Stats.adoptClearedAt(clearedAt));

  // 2. Tasks: newest edit wins per task; this device's tasks join the account.
  const merged = mergeTasks(Tasks.getTasks(), taskDocs);
  for (const t of merged.toPush) B.set(R.task(t.id), plain(t));
  // Deletion markers only need to outlive devices that haven't synced yet; prune after 60 days.
  for (const r of taskDocs) {
    if (r.deleted && now - (Number(r.updatedAt) || 0) > 60 * 864e5) B.delete(R.task(r.id));
  }
  const remoteActiveAt = Number(user?.activeUpdatedAt) || 0;
  const activeId = remoteActiveAt ? user.activeTaskId ?? null : activeIdNow();
  withApplying(() => Tasks.applyRemote({ tasks: merged.live, activeId }));
  if (remoteActiveAt) last.activeAt = remoteActiveAt;
  else {
    last.activeAt = now;
    userPatch.activeTaskId = activeIdNow();
    userPatch.activeUpdatedAt = now;
  }

  // 3. Sessions: union of both logs.
  const remoteSessions = sessionDocs.flatMap((d) => (Array.isArray(d.items) ? d.items : []));
  const sessions = mergeSessions(Stats.getSessions(), remoteSessions, clearedAt);
  withApplying(() => Stats.mergeRemote(remoteSessions));
  for (const [m, items] of groupByMonth(sessions.toPush)) {
    B.set(R.month(m), { items: F.arrayUnion(...items.map(cloudSession)), updatedAt: now }, { merge: true });
  }

  // 4. Settings: once the account has settings, they win (they follow you to new devices).
  if (user?.settings && user.settingsUpdatedAt) {
    last.settingsAt = Number(user.settingsUpdatedAt) || 0;
    withApplying(() => applySettings(user.settings));
  } else {
    last.settingsAt = now;
    userPatch.settings = syncableSettings();
    userPatch.settingsUpdatedAt = now;
  }
  last.settingsJson = stableJson(syncableSettings());

  // 5. Timer: whichever device changed it most recently wins.
  const remoteSnap = timerDoc?.snap;
  if (remoteSnap && (Number(remoteSnap.changedAt) || 0) > localTimerChangedAt()) {
    withApplying(() => timer.applyRemote(remoteSnap));
  } else {
    B.set(R.timer, { snap: cloudSnapshot(timer.exportSnapshot()), savedAt: now, deviceId });
  }
  last.timerSig = timerSignature(timer.exportSnapshot());

  if (Object.keys(userPatch).length) B.set(R.user, userPatch, { merge: true });
  rememberTasks();
  attachLocal();
  attachRemote();
  try {
    await track(B.commit());
  } catch {
    /* status already shows the error; listeners keep running */
  }
  if (ctx && gen === generation && pending === 0 && state.status !== 'error') idleStatus();
}

export function stopSync() {
  while (unsubs.length) {
    try {
      unsubs.pop()();
    } catch {
      /* ignore */
    }
  }
  clearTimeout(settingsTimer);
  clearTimeout(slowTimer);
  generation++;
  ctx = null;
  pending = 0;
  last.tasks = new Map();
  setStatus('off');
}

export const isSyncing = () => !!ctx;

/* ---------- local → cloud ---------- */

function attachLocal() {
  unsubs.push(bus.on('tasks:changed', onLocalTasks));
  unsubs.push(bus.on('settings:changed', onLocalSettings));
  unsubs.push(bus.on('stats:session-added', onLocalSession));
  unsubs.push(bus.on('stats:cleared', onLocalCleared));
  unsubs.push(bus.on('timer:state', onLocalTimer));
  const onNet = () => (pending ? setStatus(navigator.onLine ? 'syncing' : 'offline') : idleStatus());
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  unsubs.push(() => {
    window.removeEventListener('online', onNet);
    window.removeEventListener('offline', onNet);
  });
}

function onLocalTasks({ tasks = [], activeId = null } = {}) {
  if (applying || !ctx) return;
  const R = refs();
  const B = batcher();
  let writes = 0;
  const seen = new Set();
  for (const t of tasks) {
    seen.add(t.id);
    const json = stableJson(t);
    if (last.tasks.get(t.id) === json) continue;
    last.tasks.set(t.id, json);
    B.set(R.task(t.id), plain(t));
    writes++;
  }
  for (const id of [...last.tasks.keys()]) {
    if (seen.has(id)) continue;
    last.tasks.delete(id);
    B.set(R.task(id), { id, deleted: true, updatedAt: Date.now() });
    writes++;
  }
  if ((activeId ?? null) !== last.activeId) {
    last.activeId = activeId ?? null;
    last.activeAt = Date.now();
    B.set(R.user, { activeTaskId: last.activeId, activeUpdatedAt: last.activeAt }, { merge: true });
    writes++;
  }
  if (writes) track(B.commit());
}

function onLocalSettings({ remote } = {}) {
  if (applying || remote || !ctx) return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    if (!ctx) return;
    const s = syncableSettings();
    const json = stableJson(s);
    if (json === last.settingsJson) return;
    last.settingsJson = json;
    last.settingsAt = Date.now();
    track(ctx.F.setDoc(refs().user, { settings: s, settingsUpdatedAt: last.settingsAt }, { merge: true }));
  }, 800);
}

function onLocalSession({ session } = {}) {
  if (applying || !ctx || !session) return;
  const { F } = ctx;
  track(F.setDoc(refs().month(monthKey(session.endedAt)), { items: F.arrayUnion(cloudSession(session)), updatedAt: Date.now() }, { merge: true }));
}

async function onLocalCleared({ at } = {}) {
  if (applying || !ctx) return;
  const { F } = ctx;
  const R = refs();
  track(F.setDoc(R.user, { statsClearedAt: at }, { merge: true }));
  try {
    const docs = await F.getDocs(R.sessions);
    const B = batcher();
    docs.forEach((d) => B.delete(d.ref));
    track(B.commit());
  } catch (err) {
    console.warn('[aura] could not clear cloud sessions', err);
  }
}

function onLocalTimer() {
  if (applying || !ctx) return;
  const snap = timer.exportSnapshot();
  const sig = timerSignature(snap);
  if (sig === last.timerSig) return;
  last.timerSig = sig;
  track(ctx.F.setDoc(refs().timer, { snap: cloudSnapshot(snap), savedAt: Date.now(), deviceId }));
}

/* ---------- cloud → local ---------- */

function attachRemote() {
  const { F } = ctx;
  const R = refs();
  const onErr = (err) => {
    console.warn('[aura] sync listener error', err);
    if (ctx) setStatus('error', describe(err));
  };

  let userSeen = false;
  unsubs.push(
    F.onSnapshot(
      R.user,
      (snap) => {
        if (!snap.exists()) {
          // The server says the profile is gone after we'd seen it: the account was deleted elsewhere.
          if (userSeen && !snap.metadata.fromCache) bus.emit('sync:account-gone');
          return;
        }
        userSeen = true;
        if (snap.metadata.hasPendingWrites) return;
        const u = snap.data();
        if ((Number(u.statsClearedAt) || 0) > Stats.getClearedAt()) withApplying(() => Stats.applyCleared(u.statsClearedAt));
        if (u.settings && (Number(u.settingsUpdatedAt) || 0) > last.settingsAt) {
          last.settingsAt = Number(u.settingsUpdatedAt);
          withApplying(() => applySettings(u.settings));
          last.settingsJson = stableJson(syncableSettings());
        }
        if ((Number(u.activeUpdatedAt) || 0) > last.activeAt) {
          last.activeAt = Number(u.activeUpdatedAt);
          withApplying(() => Tasks.applyRemote({ activeId: u.activeTaskId ?? null }));
          last.activeId = activeIdNow();
        }
      },
      onErr,
    ),
  );

  unsubs.push(
    F.onSnapshot(
      R.tasks,
      (qs) => {
        const map = new Map(Tasks.getTasks().map((t) => [t.id, t]));
        let changed = false;
        for (const ch of qs.docChanges()) {
          if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) continue;
          const r = ch.doc.data();
          const l = map.get(r.id);
          const rs = Number(r.updatedAt) || 0;
          const ls = Number(l?.updatedAt) || Number(l?.createdAt) || 0;
          if (r.deleted) {
            if (l && rs >= ls) {
              map.delete(r.id);
              changed = true;
            }
          } else if (!l || rs > ls) {
            map.set(r.id, r);
            changed = true;
          }
        }
        if (changed) {
          withApplying(() => Tasks.applyRemote({ tasks: [...map.values()] }));
          rememberTasks();
        }
      },
      onErr,
    ),
  );

  unsubs.push(
    F.onSnapshot(
      R.sessions,
      (qs) => {
        const items = [];
        for (const ch of qs.docChanges()) {
          if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) continue;
          const list = ch.doc.data().items;
          if (Array.isArray(list)) items.push(...list);
        }
        if (items.length) withApplying(() => Stats.mergeRemote(items));
      },
      onErr,
    ),
  );

  unsubs.push(
    F.onSnapshot(
      R.timer,
      (snap) => {
        if (!snap.exists() || snap.metadata.hasPendingWrites) return;
        const d = snap.data();
        if (!d?.snap || d.deviceId === deviceId) return;
        if ((Number(d.snap.changedAt) || 0) <= localTimerChangedAt()) return;
        withApplying(() => timer.applyRemote(d.snap));
        last.timerSig = timerSignature(timer.exportSnapshot());
      },
      onErr,
    ),
  );
}

/* ---------- account deletion ---------- */

/** Deletes every document belonging to `uid` (tasks, sessions, timer, profile). */
export async function deleteCloudData({ db, F, uid }) {
  const docs = [];
  for (const sub of ['tasks', 'sessions', 'state']) {
    const qs = await F.getDocs(F.collection(db, 'users', uid, sub));
    qs.forEach((d) => docs.push(d.ref));
  }
  docs.push(F.doc(db, 'users', uid));
  for (let i = 0; i < docs.length; i += 400) {
    const batch = F.writeBatch(db);
    docs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}
