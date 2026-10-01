// Focus session log, daily summaries and streaks (storage key 'sessions').
import { bus } from '../core/bus.js';
import { load, save } from '../core/storage.js';
import { getSettings } from '../core/settings.js';
import { getActiveTask, addTaskFocus, getTasks } from './tasks.js';

const KEY = 'sessions';
const CAP = 5000;
const MIN_LOG_MS = 60000;
const KIND_BY_PHASE = { focus: 'focus', countdown: 'timer', stopwatch: 'stopwatch' };

let sessions = [];
let dayCache = null;
let segCache = null; // segment startedAt -> ms already logged for that segment
let clearedAt = 0; // sessions that ended at or before this were cleared ("Reset statistics", synced)
let inited = false;

// Live (not yet logged) time from the segment currently running or paused.
let timerState = null;
let loggedStart; // startedAt of the segment most recently completed, so it is never counted twice
let lastLiveMs = 0;

/**
 * Time already logged for a segment. A mid-session task hand-off logs part of a segment early, and
 * on a synced account another device may already have logged it. Derived from the log itself, so
 * it holds across reloads and devices.
 */
function alreadyLogged(startedAt) {
  if (!Number.isFinite(startedAt)) return 0;
  if (!segCache) {
    segCache = new Map();
    for (const s of sessions) {
      if (Number.isFinite(s.segStart)) segCache.set(s.segStart, (segCache.get(s.segStart) || 0) + s.durationMs);
    }
  }
  return segCache.get(startedAt) || 0;
}

/** Local-time day key, YYYY-MM-DD. */
export function dateKey(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function dayIndex(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

// Sessions belong to the local day on which they ended.
function dayMap() {
  if (dayCache) return dayCache;
  const map = new Map();
  for (const s of sessions) {
    const k = dateKey(new Date(s.endedAt));
    const e = map.get(k) || { focusMs: 0, sessions: 0 };
    e.focusMs += s.durationMs;
    e.sessions += 1;
    map.set(k, e);
  }
  dayCache = map;
  return map;
}

const goalMs = () => Math.max(0, Number(getSettings().goals?.dailyFocusMin) || 0) * 60000;

function emitUpdated() {
  bus.emit('stats:updated', { today: getDaySummary(), streak: getStreak() });
}

function commit() {
  dayCache = null;
  segCache = null;
  save(KEY, sessions);
  emitUpdated();
}

function isSession(s) {
  return s && typeof s === 'object' && Number.isFinite(s.endedAt) && Number.isFinite(s.durationMs);
}

export function initStats() {
  if (inited) return;
  inited = true;
  const data = load(KEY, []);
  sessions = Array.isArray(data) ? data.filter(isSession).slice(-CAP) : [];
  clearedAt = Number(load('statsClearedAt', 0)) || 0;
  dayCache = null;

  bus.on('timer:complete', onComplete);
  bus.on('timer:tick', onTimer);
  bus.on('timer:state', onTimer);
  bus.on('tasks:active-will-change', ({ prevId } = {}) => checkpoint(prevId));
  bus.on('settings:changed', ({ patch } = {}) => {
    if (patch && patch.goals) emitUpdated();
  });
  emitUpdated();
}

/**
 * Whole minutes of the current focus-type segment (focus, countdown, stopwatch — including
 * calendar plans) that haven't been logged yet. Counts up one minute at a time while it runs.
 */
export function getLiveMs() {
  const s = timerState;
  if (!s || !(s.phase in KIND_BY_PHASE)) return 0;
  if (s.status !== 'running' && s.status !== 'paused') return 0;
  if (loggedStart !== undefined && s.startedAt === loggedStart) return 0;
  const unlogged = (Number(s.elapsedMs) || 0) - alreadyLogged(s.startedAt);
  return Math.floor(Math.max(0, unlogged) / 60000) * 60000;
}

// Session ids are derived from the segment, so two synced devices that both see the same session
// finish produce the same id, and the log (and the task's credited time) only counts it once.
function sessionId(kind, segStart, offsetMs) {
  if (!Number.isFinite(segStart)) return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `s_${kind}_${segStart}_${Math.round(offsetMs / 1000)}`;
}

/** Logs a session (and credits a task) unless it's already in the log. */
function logSession(entry, offsetMs, creditTaskId) {
  const id = sessionId(entry.kind, entry.segStart, offsetMs);
  if (sessions.some((s) => s.id === id)) return null;
  if (creditTaskId) {
    try {
      addTaskFocus(creditTaskId, entry.durationMs, id);
    } catch (e) {
      console.warn('[aura] could not credit task time', e);
    }
  }
  const session = { id, ...entry };
  sessions.push(session);
  if (sessions.length > CAP) sessions = sessions.slice(-CAP);
  commit();
  bus.emit('stats:session-added', { session });
  return session;
}

/**
 * The active task is about to change (switched, marked done or deleted) while a session may be
 * running: log the time spent so far and credit it to that task. The rest of the session is logged
 * normally when it ends, so nothing is counted twice.
 */
function checkpoint(taskId) {
  const s = timerState;
  if (!taskId || !s || !(s.phase in KIND_BY_PHASE)) return;
  if (s.status !== 'running' && s.status !== 'paused') return;
  if (loggedStart !== undefined && s.startedAt === loggedStart) return;
  const done = alreadyLogged(s.startedAt);
  const portion = (Number(s.elapsedMs) || 0) - done;
  if (!(portion >= MIN_LOG_MS)) return;
  const task = getTasks().find((t) => t.id === taskId);
  const now = Date.now();
  logSession(
    {
      kind: KIND_BY_PHASE[s.phase],
      label: s.label || '',
      segStart: s.startedAt,
      startedAt: (s.startedAt || now - s.elapsedMs) + done,
      endedAt: now,
      durationMs: portion,
      taskId,
      taskTitle: task ? task.title : null,
      eventId: s.meta?.eventId || null,
      natural: false,
    },
    done,
    taskId,
  );
  lastLiveMs = getLiveMs();
}

function onTimer(state) {
  timerState = state || null;
  const live = getLiveMs();
  if (live !== lastLiveMs) {
    lastLiveMs = live;
    emitUpdated();
  }
}

function onComplete(rec) {
  if (!rec || !(rec.phase in KIND_BY_PHASE)) return;
  // The engine still reports this segment until its next timer:state; stop counting it live now.
  loggedStart = rec.startedAt;
  lastLiveMs = 0;
  // Only the part not already logged (at a task hand-off, or by another synced device); a
  // remainder after a hand-off counts from 1 s.
  const done = alreadyLogged(rec.startedAt);
  const portion = rec.elapsedMs - done;
  if (!(portion >= (done > 0 ? 1000 : MIN_LOG_MS))) {
    emitUpdated();
    return;
  }
  const active = safeActive();
  const logged = logSession(
    {
      kind: KIND_BY_PHASE[rec.phase],
      label: rec.label || '',
      segStart: rec.startedAt,
      startedAt: (rec.startedAt || rec.endedAt - rec.elapsedMs) + done,
      endedAt: rec.endedAt || Date.now(),
      durationMs: portion,
      taskId: active ? active.id : null,
      taskTitle: active ? active.title : null,
      eventId: rec.meta?.eventId || null,
      natural: !!rec.natural,
    },
    done,
    active ? active.id : null,
  );
  if (!logged) emitUpdated();
}

function safeActive() {
  try {
    return getActiveTask();
  } catch {
    return null;
  }
}

export const getSessions = () => sessions.slice();

// Logged focus for a day, plus live time when the day is today.
function dayFocusMs(key, map = dayMap()) {
  const logged = map.get(key)?.focusMs || 0;
  return key === dateKey() ? logged + getLiveMs() : logged;
}

/** pct is the fraction of the daily goal reached, clamped to 0..1. Includes live time for today. */
export function getDaySummary(date = new Date()) {
  const key = dateKey(date);
  const e = dayMap().get(key) || { focusMs: 0, sessions: 0 };
  const focusMs = dayFocusMs(key);
  const g = goalMs();
  return { focusMs, sessions: e.sessions, goalMs: g, pct: g > 0 ? Math.min(1, focusMs / g) : 0 };
}

export function getStreak() {
  const map = dayMap();
  const has = (k) => dayFocusMs(k, map) >= MIN_LOG_MS;
  const now = new Date();

  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (has(dateKey(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const days = [...map.keys()].filter(has).map(dayIndex).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { current, best: Math.max(best, current) };
}

/** Last `days` local days, oldest first, ending today. */
export function getRange(days) {
  const map = dayMap();
  const now = new Date();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dateKey(date);
    const e = map.get(key);
    out.push({ dateKey: key, date, focusMs: dayFocusMs(key, map), sessions: e ? e.sessions : 0 });
  }
  return out;
}

/** "Reset statistics": clears the log here and (via cloud sync) on every signed-in device. */
export function clearStats() {
  clearedAt = Date.now();
  save('statsClearedAt', clearedAt);
  sessions = [];
  commit();
  bus.emit('stats:cleared', { at: clearedAt });
}

export function exportData() {
  return { sessions: getSessions(), tasks: getTasks() };
}

/* ---------- cloud sync hooks ---------- */

export const getClearedAt = () => clearedAt;

/** Adds sessions from the cloud (deduplicated by id). Returns how many were new. */
export function mergeRemote(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const have = new Set(sessions.map((s) => s.id));
  let added = 0;
  for (const s of items) {
    if (!isSession(s) || typeof s.id !== 'string' || have.has(s.id) || s.endedAt <= clearedAt) continue;
    sessions.push({ ...s });
    have.add(s.id);
    added++;
  }
  if (!added) return 0;
  sessions.sort((a, b) => a.endedAt - b.endedAt);
  if (sessions.length > CAP) sessions = sessions.slice(-CAP);
  commit();
  lastLiveMs = getLiveMs();
  return added;
}

/** Another device reset statistics at `at`: drop everything that ended before then. */
export function applyCleared(at) {
  if (!(Number(at) > clearedAt)) return;
  clearedAt = Number(at);
  save('statsClearedAt', clearedAt);
  sessions = sessions.filter((s) => s.endedAt > clearedAt);
  commit();
}

/**
 * On sign-in the account's reset time replaces this device's. A reset made here before signing in
 * already deleted this device's sessions, so lowering the time only lets the account's history in.
 */
export function adoptClearedAt(at) {
  const next = Number(at) || 0;
  if (next > clearedAt) return applyCleared(next);
  if (next === clearedAt) return;
  clearedAt = next;
  save('statsClearedAt', clearedAt);
}

/** Removes the session log from this device (used when signing out; the account keeps its copy). */
export function clearLocal() {
  sessions = [];
  clearedAt = 0;
  save('statsClearedAt', 0);
  commit();
}
