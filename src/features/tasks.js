// Task list + focus intention, persisted under storage key 'tasks'.
// Tasks track time in minutes: estMin (estimate) and focusMs (time logged against the task).
import { bus } from '../core/bus.js';
import { load, save } from '../core/storage.js';
import { getSettings } from '../core/settings.js';

const KEY = 'tasks';
export const EST_STEP_MIN = 25;
export const EST_MAX_MIN = 1440;
let tasks = [];
let activeId = null;
let inited = false;

export const clampEstMin = (n) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(EST_MAX_MIN, v) : EST_STEP_MIN;
};
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
const uid = () => `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const find = (id) => tasks.find((t) => t.id === id);

function snapshot() {
  return { tasks: getTasks(), activeId };
}

// Every change of the active task goes through here. Listeners (stats) hear about it while the
// previous task is still active, so time already spent in a running session can be credited to it.
function changeActive(next) {
  if (next === activeId) return;
  bus.emit('tasks:active-will-change', { prevId: activeId, nextId: next });
  activeId = next;
}

// Local edits: keep each task's `order` in step with its position, stamping `updatedAt` on anything
// that moved, so cloud sync can merge lists from several devices (newest edit wins per task).
function commit() {
  const now = Date.now();
  tasks.forEach((t, i) => {
    if (t.order !== i) {
      t.order = i;
      t.updatedAt = now;
    }
  });
  save(KEY, { tasks, activeId });
  bus.emit('tasks:changed', snapshot());
}

const touch = (t) => {
  t.updatedAt = Date.now();
};

function focusMinSetting() {
  try {
    return Math.max(1, Number(getSettings().pomodoro?.focusMin) || EST_STEP_MIN);
  } catch {
    return EST_STEP_MIN;
  }
}

// Time already logged per task in the session history (used once, to migrate session-based tasks).
function loggedMsByTask() {
  const map = new Map();
  const sessions = load('sessions', []);
  if (!Array.isArray(sessions)) return map;
  for (const s of sessions) {
    if (s && typeof s.taskId === 'string' && Number.isFinite(s.durationMs)) {
      map.set(s.taskId, (map.get(s.taskId) || 0) + s.durationMs);
    }
  }
  return map;
}

/**
 * Normalizes a stored task. Older session-based tasks (estPomos / pomosDone) are migrated to
 * minutes; their legacy fields are kept on the object so no stored data is lost.
 */
function normalize(raw, ctx) {
  if (!raw || typeof raw.id !== 'string') return null;
  const title = clean(raw.title);
  if (!title) return null;
  const task = {
    ...raw,
    id: raw.id,
    title,
    done: !!raw.done,
    createdAt: Number(raw.createdAt) || Date.now(),
    doneAt: raw.done ? Number(raw.doneAt) || Date.now() : null,
  };
  const est = Number(raw.estMin);
  if (!(Number.isFinite(est) && est > 0)) {
    task.estMin = clampEstMin(raw.estPomos != null ? Number(raw.estPomos) * ctx.focusMin() : EST_STEP_MIN);
    ctx.migrated = true;
  } else {
    task.estMin = clampEstMin(est);
  }
  const ms = Number(raw.focusMs);
  if (!(Number.isFinite(ms) && ms >= 0)) {
    const fromSessions = ctx.logged().get(raw.id) || 0;
    const fromPomos = Math.max(0, Number(raw.pomosDone) || 0) * ctx.focusMin() * 60000;
    task.focusMs = Math.round(Math.max(fromSessions, fromPomos));
    ctx.migrated = true;
  } else {
    task.focusMs = Math.round(ms);
  }
  return task;
}

export function initTasks() {
  if (inited) return;
  inited = true;
  const data = load(KEY, null);
  let logged = null;
  let fm = null;
  const ctx = {
    migrated: false,
    logged: () => (logged ??= loggedMsByTask()),
    focusMin: () => (fm ??= focusMinSetting()),
  };
  tasks = Array.isArray(data?.tasks) ? data.tasks.map((t) => normalize(t, ctx)).filter(Boolean) : [];
  const a = data?.activeId;
  activeId = a && tasks.some((t) => t.id === a && !t.done) ? a : null;
  if (ctx.migrated) save(KEY, { tasks, activeId });
  bus.emit('tasks:changed', snapshot());
}

export const getTasks = () => tasks.map((t) => ({ ...t }));

export function getActiveTask() {
  const t = activeId ? find(activeId) : null;
  return t ? { ...t } : null;
}

export function setActiveTask(id) {
  const next = id && find(id) && !find(id).done ? id : null;
  if (next === activeId) return;
  changeActive(next);
  commit();
}

export function addTask(title, estMin = EST_STEP_MIN) {
  const t = clean(title);
  if (!t) return null;
  const task = {
    id: uid(),
    title: t,
    done: false,
    estMin: clampEstMin(estMin),
    focusMs: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    doneAt: null,
  };
  tasks.push(task);
  if (!activeId) changeActive(task.id);
  commit();
  return { ...task };
}

export function updateTask(id, patch = {}) {
  const t = find(id);
  if (!t) return null;
  if ('title' in patch) {
    const title = clean(patch.title);
    if (title) t.title = title;
  }
  if ('estMin' in patch) t.estMin = clampEstMin(patch.estMin);
  if ('focusMs' in patch) t.focusMs = Math.max(0, Math.round(Number(patch.focusMs) || 0));
  if ('done' in patch && !!patch.done !== t.done) {
    // Hand off first (while the task is still active and open) so a running session's time lands on it.
    if (patch.done && activeId === id) changeActive(null);
    t.done = !!patch.done;
    t.doneAt = t.done ? Date.now() : null;
  }
  touch(t);
  commit();
  return { ...t };
}

/**
 * Credits focused time to a task (reads the live record, so callers can't pass a stale total).
 * `creditKey` (the session id) makes crediting idempotent: when two synced devices both see a
 * session finish, the task is only credited once.
 */
export function addTaskFocus(id, ms, creditKey) {
  const t = find(id);
  const add = Math.round(Number(ms) || 0);
  if (!t || add <= 0) return null;
  if (creditKey) {
    const credited = Array.isArray(t.credited) ? t.credited : [];
    if (credited.includes(creditKey)) return { ...t };
    t.credited = [...credited, creditKey].slice(-60);
  }
  t.focusMs = (t.focusMs || 0) + add;
  touch(t);
  commit();
  return { ...t };
}

/**
 * Replaces the list with synced data from the cloud. No hand-off events and no re-stamping, so
 * applying remote data never echoes back as a local edit.
 */
export function applyRemote({ tasks: list, activeId: nextActive } = {}) {
  if (Array.isArray(list)) {
    const ctx = { migrated: false, logged: () => new Map(), focusMin: focusMinSetting };
    tasks = list
      .map((t) => normalize(t, ctx))
      .filter(Boolean)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  }
  const want = nextActive !== undefined ? nextActive : activeId;
  activeId = want && tasks.some((t) => t.id === want && !t.done) ? want : null;
  save(KEY, { tasks, activeId });
  bus.emit('tasks:changed', snapshot());
}

/** Removes every task from this device (used when signing out; the account keeps its copy). */
export function clearLocal() {
  tasks = [];
  activeId = null;
  save(KEY, { tasks, activeId });
  bus.emit('tasks:changed', snapshot());
}

export function toggleDone(id) {
  const t = find(id);
  if (!t) return;
  updateTask(id, { done: !t.done });
}

export function removeTask(id) {
  const i = tasks.findIndex((t) => t.id === id);
  if (i < 0) return;
  if (activeId === id) changeActive(null);
  tasks.splice(i, 1);
  commit();
}

export function clearDone() {
  if (!tasks.some((t) => t.done)) return;
  tasks = tasks.filter((t) => !t.done);
  commit();
}

export function reorder(fromIndex, toIndex) {
  const n = tasks.length;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) return;
  const [moved] = tasks.splice(fromIndex, 1);
  tasks.splice(toIndex, 0, moved);
  commit();
}
