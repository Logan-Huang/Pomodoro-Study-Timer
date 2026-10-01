// Pure merge rules for cloud sync (no DOM, no Firebase), so they can be tested on their own.
//
// - Tasks: newest edit wins per task (`updatedAt`); deletions travel as tombstones
//   { id, deleted: true, updatedAt } so a task deleted on one device doesn't come back from another.
// - Sessions: an append-only log; merging is a union by id. Ids are derived from the timer segment,
//   so the same session logged on two devices collapses to one.
// - Anything that ended at or before a "Reset statistics" time is dropped.

/** When a record last changed (older records may only have createdAt). */
export const stamp = (r) => Number(r?.updatedAt) || Number(r?.createdAt) || 0;

const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.createdAt || 0) - (b.createdAt || 0);

/**
 * @param {object[]} localTasks this device's tasks
 * @param {object[]} remoteRecords the account's task documents (may include tombstones)
 * @returns {{ live: object[], toPush: object[] }} the merged task list (ordered) and the local
 *   versions the server doesn't have yet (missing remotely, or newer than the server's copy)
 */
export function mergeTasks(localTasks, remoteRecords) {
  const local = new Map(localTasks.map((t) => [t.id, t]));
  const remote = new Map(remoteRecords.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
  const live = [];
  const toPush = [];
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(id);
    const r = remote.get(id);
    if (l && (!r || stamp(l) > stamp(r))) {
      live.push(l);
      toPush.push(l);
    } else if (r && !r.deleted) {
      live.push(r);
    }
  }
  live.sort(byOrder);
  return { live, toPush };
}

/**
 * @returns {{ all: object[], toPush: object[] }} every session (deduplicated, oldest first) and the
 *   local ones the server is missing
 */
export function mergeSessions(localSessions, remoteSessions, clearedAt = 0) {
  const byId = new Map();
  for (const s of remoteSessions) {
    if (s && typeof s.id === 'string' && s.endedAt > clearedAt) byId.set(s.id, s);
  }
  const toPush = [];
  for (const s of localSessions) {
    if (!s || typeof s.id !== 'string' || !(s.endedAt > clearedAt) || byId.has(s.id)) continue;
    byId.set(s.id, s);
    toPush.push(s);
  }
  return { all: [...byId.values()].sort((a, b) => a.endedAt - b.endedAt), toPush };
}

/** Sessions are stored in one document per month (UTC), e.g. "2026-09". */
export const monthKey = (ts) => new Date(ts).toISOString().slice(0, 7);

export function groupByMonth(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const k = monthKey(s.endedAt);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return map;
}

/** JSON with sorted keys, for cheap "did this change?" comparisons. */
export function stableJson(value) {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

/** The parts of a timer snapshot that describe its state (not when it was saved). */
export function timerSignature(snap) {
  if (!snap) return '';
  const { savedAt, changedAt, v, ...rest } = snap;
  return stableJson(rest);
}

/** Drops `undefined` (Firestore rejects it) and functions; deep-copies plain data. */
export const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

// Google Calendar data stays in the browser (see privacy.html, and Google's Limited Use rules), so
// anything that came from the Calendar API is stripped before it's uploaded.

/** Settings as stored in the account: without the calendar selection (ids come from the Calendar API). */
export function cloudSettings(settings) {
  const s = plain(settings);
  if (s && s.calendar && typeof s.calendar === 'object') delete s.calendar.calendarIds;
  return s;
}

/** Remote settings with this device's own calendar selection kept. */
export function withLocalCalendars(remote, local) {
  if (!remote || typeof remote !== 'object') return remote;
  const calendar = { ...(remote.calendar || {}) };
  const ids = local?.calendar?.calendarIds;
  if (Array.isArray(ids)) calendar.calendarIds = ids.slice();
  else delete calendar.calendarIds;
  return { ...remote, calendar };
}

/** Timer snapshot as uploaded: a calendar plan keeps only its end time, not the event's id or title. */
export function cloudSnapshot(snap) {
  const s = plain(snap);
  if (s && s.meta && typeof s.meta === 'object') s.meta = plain({ source: s.meta.source, endsAt: s.meta.endsAt });
  return s;
}

/** Session as uploaded: no calendar event id. */
export function cloudSession(session) {
  const s = plain(session);
  if (s && s.eventId != null) s.eventId = null;
  return s;
}
