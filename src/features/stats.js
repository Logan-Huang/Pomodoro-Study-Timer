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
let inited = false;

// Live (not yet logged) time from the segment currently running or paused.
let timerState = null;
let loggedStart; // startedAt of the segment most recently logged, so it is never counted twice
let lastLiveMs = 0;
// Part of the running segment already logged early, when the active task changed mid-session
// (e.g. it was marked done). Keyed by the segment's startedAt.
let segLogged = { start: undefined, ms: 0 };

const alreadyLogged = (startedAt) => (segLogged.start !== undefined && segLogged.start === startedAt ? segLogged.ms : 0);

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
  try {
    addTaskFocus(taskId, portion);
  } catch (e) {
    console.warn('[aura] could not credit task time', e);
  }
  pushSession({
    kind: KIND_BY_PHASE[s.phase],
    label: s.label || '',
    startedAt: (s.startedAt || now - s.elapsedMs) + done,
    endedAt: now,
    durationMs: portion,
    taskId,
    taskTitle: task ? task.title : null,
    eventId: s.meta?.eventId || null,
    natural: false,
  });
  segLogged = { start: s.startedAt, ms: done + portion };
  lastLiveMs = getLiveMs();
  commit();
}

function pushSession(entry) {
  sessions.push({ id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...entry });
  if (sessions.length > CAP) sessions = sessions.slice(-CAP);
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
  // Only the part not already logged at a task hand-off; a remainder after a hand-off counts from 1 s.
  const done = alreadyLogged(rec.startedAt);
  segLogged = { start: undefined, ms: 0 };
  const portion = rec.elapsedMs - done;
  if (!(portion >= (done > 0 ? 1000 : MIN_LOG_MS))) {
    emitUpdated();
    return;
  }
  const active = safeActive();
  if (active) {
    try {
      addTaskFocus(active.id, portion);
    } catch (e) {
      console.warn('[aura] could not credit task time', e);
    }
  }

  pushSession({
    kind: KIND_BY_PHASE[rec.phase],
    label: rec.label || '',
    startedAt: (rec.startedAt || rec.endedAt - rec.elapsedMs) + done,
    endedAt: rec.endedAt || Date.now(),
    durationMs: portion,
    taskId: active ? active.id : null,
    taskTitle: active ? active.title : null,
    eventId: rec.meta?.eventId || null,
    natural: !!rec.natural,
  });
  commit();
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

export function clearStats() {
  sessions = [];
  commit();
}

export function exportData() {
  return { sessions: getSessions(), tasks: getTasks() };
}
