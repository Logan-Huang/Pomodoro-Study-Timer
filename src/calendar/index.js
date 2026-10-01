// Calendar service: connection state, event sync, auto-start, warnings, session logging.
import { bus } from '../core/bus.js';
import { load, save, remove } from '../core/storage.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { setMode, getMode } from '../core/state.js';
import * as google from './google.js';
import { GOOGLE_CLIENT_ID, SCOPE_WRITE } from './config.js';
import { classifyEvent, planBlock, summarizePlan } from './planner.js';
import { buildDemoDay } from './demo.js';
import { initScheduleView, initCalendarPill } from '../ui/schedule-view.js';

const MIN = 60000;
const REFRESH_MS = 5 * MIN;
const WATCH_MS = 20000;

const state = {
  status: 'disconnected', // disconnected | connecting | connected | demo | error
  events: [],
  calendars: load('gcal.calendars', []),
  lastSync: null,
  error: null,
  syncing: false,
};

let rawEvents = [];
let timer = null; // timer engine, loaded lazily so a missing module can't break the calendar
let initialized = false;
let service = null;
let refreshInFlight = null;
const autoStarted = new Set();
const warned = new Set();
let logFailureShown = false;

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const keywords = () => getSettings().calendar?.studyKeywords || [];

async function toast(message, opts = {}) {
  try {
    const mod = await import('../ui/notify.js');
    if (typeof mod.toast === 'function') return mod.toast(message, opts);
  } catch { /* notify module unavailable */ }
  console.info('[aura:calendar]', message);
  return () => {};
}

async function activeTaskTitle() {
  try {
    const mod = await import('../features/tasks.js');
    return mod.getActiveTask?.()?.title || '';
  } catch {
    return '';
  }
}

async function ensureTimer() {
  if (timer) return timer;
  try {
    timer = (await import('../timer/engine.js')).timer;
  } catch (e) {
    console.warn('[aura:calendar] timer engine unavailable', e);
  }
  return timer;
}

function classifyAll() {
  const kw = keywords();
  state.events = rawEvents.map((e) => ({ ...e, kind: classifyEvent(e, kw) }));
}

function setStatus(status, error = null) {
  state.status = status;
  state.error = error;
  document.getElementById('app')?.setAttribute('data-calendar', status);
  bus.emit('calendar:status', { status, error });
}

function emitUpdated() {
  bus.emit('calendar:updated', { events: state.events, status: state.status, lastSync: state.lastSync });
}

function setSyncing(on) {
  state.syncing = on;
  bus.emit('calendar:syncing', { syncing: on });
}

function setEvents(events, { cache = false } = {}) {
  rawEvents = events;
  classifyAll();
  state.lastSync = Date.now();
  if (cache) save('gcal.events', { events: rawEvents, savedAt: state.lastSync });
  emitUpdated();
}

function fetchWindow() {
  const today = startOfDay(Date.now());
  const end = new Date(today);
  end.setDate(end.getDate() + 2); // end of tomorrow
  return { timeMin: today, timeMax: end.getTime() };
}

function calendarIds() {
  const ids = getSettings().calendar?.calendarIds;
  return Array.isArray(ids) && ids.length ? ids : ['primary'];
}

async function refreshCalendars() {
  try {
    state.calendars = await google.listCalendars();
    save('gcal.calendars', state.calendars);
  } catch (e) {
    if (e.code === 'auth') throw e;
  }
}

function expire(message = 'Session expired — reconnect Google Calendar.') {
  rawEvents = [];
  state.events = [];
  remove('gcal.events');
  setStatus('disconnected', { code: 'expired', message });
  emitUpdated();
}

async function doRefresh() {
  if (state.status === 'demo') {
    setEvents(buildDemoDay(Date.now(), keywords()));
    return;
  }
  if (state.status !== 'connected') return;
  if (!google.getToken()) { expire(); return; }
  setSyncing(true);
  try {
    if (!state.calendars.length) await refreshCalendars();
    const events = await google.listEvents({ calendarIds: calendarIds(), ...fetchWindow(), calendars: state.calendars });
    setEvents(events, { cache: true });
    refreshCalendars().then(() => bus.emit('calendar:updated', { events: state.events, status: state.status, lastSync: state.lastSync })).catch(() => {});
  } catch (e) {
    if (e.code === 'auth') expire(e.message);
    else if (state.events.length) toast(e.message, { title: 'Calendar sync failed', tone: 'warn', icon: 'calendar' });
    else setStatus('error', { code: e.code, message: e.message });
  } finally {
    setSyncing(false);
  }
}

function refresh() {
  if (!refreshInFlight) refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function connect({ write = false } = {}) {
  // No await before google.connect: the OAuth popup must open inside the click's user gesture.
  const clientId = (getSettings().calendar?.clientId || GOOGLE_CLIENT_ID || '').trim();
  const previous = state.status;
  if (location.protocol === 'file:') {
    const error = { code: 'file_protocol', message: 'Google sign-in needs http://localhost. Run npm start and open http://localhost:5173.' };
    if (previous !== 'connected') setStatus('error', error);
    return { ok: false, error };
  }
  if (!clientId) {
    const error = { code: 'no_client_id', message: 'Add your Google OAuth Client ID first.' };
    if (previous !== 'connected') setStatus('error', error);
    return { ok: false, error };
  }
  if (!write) setStatus('connecting');
  try {
    await google.connect({ clientId, write, prompt: '' });
    save('gcal.demo', false);
    if (state.status !== 'connected') {
      rawEvents = [];
      state.events = [];
      setStatus('connected');
      emitUpdated();
    }
    refresh();
    return { ok: true };
  } catch (e) {
    const error = { code: e.code || 'unknown', message: e.message || 'Could not connect to Google.' };
    if (previous === 'connected' && google.getToken()) setStatus('connected');
    else setStatus('error', error);
    return { ok: false, error };
  }
}

function enableDemo() {
  save('gcal.demo', true);
  setStatus('demo');
  refresh();
}

function disconnect() {
  google.disconnect();
  save('gcal.demo', false);
  remove('gcal.events');
  rawEvents = [];
  state.events = [];
  state.calendars = [];
  state.lastSync = null;
  remove('gcal.calendars');
  setStatus('disconnected');
  emitUpdated();
}

function setCalendars(ids) {
  updateSettings({ calendar: { calendarIds: ids.length ? ids : ['primary'] } });
}

async function startPlan(startMs, endMs, meta = {}) {
  const engine = await ensureTimer();
  const segments = planBlock(startMs, endMs, getSettings().pomodoro);
  if (!segments.length) {
    toast('That window is too short for a focus session.', { tone: 'warn', icon: 'clock' });
    return false;
  }
  if (!engine) {
    toast('The timer is not available right now.', { tone: 'error', icon: 'warning' });
    return false;
  }
  engine.loadSequence(segments, { source: 'calendar', ...meta, endsAt: endMs }, { autoStart: true });
  if (getMode() !== 'schedule') setMode('schedule');
  const { focusCount } = summarizePlan(segments);
  toast(`Planned ${focusCount} focus session${focusCount === 1 ? '' : 's'} until ${fmtTime(endMs)}`, {
    tone: 'success', icon: 'calendar',
  });
  return true;
}

// ---- background watchers -------------------------------------------------------------------

function watch() {
  if (document.hidden || !timer) return;
  const now = Date.now();
  const cal = getSettings().calendar || {};
  const ts = timer.getState();

  if (cal.autoStartBlocks && (ts.status === 'idle' || ts.status === 'done')) {
    const block = state.events.find((e) => e.kind === 'study' && !e.allDay && e.start <= now && now < e.end && !autoStarted.has(e.id));
    if (block) {
      const segments = planBlock(now, block.end, getSettings().pomodoro);
      autoStarted.add(block.id);
      if (segments.length) {
        timer.loadSequence(segments, { source: 'calendar', eventId: block.id, title: block.title, endsAt: block.end }, { autoStart: true });
        toast(`Started a focus plan for "${block.title}" until ${fmtTime(block.end)}`, { tone: 'success', icon: 'calendar' });
      }
    }
  }

  const warnMin = Number(cal.warnBeforeEventMin) || 0;
  if (warnMin > 0 && ts.status === 'running') {
    const soon = state.events.find((e) => e.kind === 'busy' && !e.allDay && e.start > now && e.start - now <= warnMin * MIN && !warned.has(e.id));
    if (soon) {
      warned.add(soon.id);
      const mins = Math.max(1, Math.ceil((soon.start - now) / MIN));
      toast(`${soon.title} starts in ${mins} min — wrap up this session`, { tone: 'warn', icon: 'bell' });
    }
  }
}

async function logSession(rec) {
  const cal = getSettings().calendar || {};
  if (!cal.logSessions || state.status !== 'connected' || !google.hasScope(SCOPE_WRITE)) return;
  if (!rec || rec.phase !== 'focus' || rec.elapsedMs < 10 * MIN) return;
  const label = (await activeTaskTitle()) || rec.meta?.title || 'Study session';
  try {
    await google.createEvent({ calendarId: 'primary', title: `Focus · ${label}`, start: rec.startedAt, end: rec.endedAt, colorId: '9' });
  } catch (e) {
    if (!logFailureShown) {
      logFailureShown = true;
      toast(`Couldn't log that session to Google Calendar. ${e.message}`, { tone: 'warn', icon: 'calendar' });
    }
  }
}

// ---- public API ----------------------------------------------------------------------------

export function getCalendarState() {
  return { ...state, events: state.events.slice(), calendars: state.calendars.slice() };
}

export function refreshCalendar() {
  return service ? service.refresh() : Promise.resolve();
}

export function initCalendar() {
  if (initialized) return;
  initialized = true;

  service = {
    getState: () => state,
    refresh,
    connect,
    enableDemo,
    disconnect,
    setCalendars,
    startPlan,
    preload: () => google.loadGis().catch(() => {}),
    hasWriteScope: () => google.hasScope(SCOPE_WRITE),
    getTimerState: () => { try { return timer?.getState() ?? null; } catch { return null; } },
    toast,
  };

  ensureTimer();

  // Restore
  if (google.getToken()) {
    const cached = load('gcal.events', null);
    if (cached?.events?.length) {
      rawEvents = cached.events;
      state.lastSync = cached.savedAt || null;
      classifyAll();
    }
    setStatus('connected');
    refresh();
  } else if (load('gcal.demo', false)) {
    setStatus('demo');
    refresh();
  } else if (google.hadToken()) {
    setStatus('disconnected', { code: 'expired', message: 'Session expired — reconnect Google Calendar.' });
  } else {
    setStatus('disconnected');
  }

  try {
    initScheduleView(document.getElementById('schedule-root'), service);
    initCalendarPill(document.getElementById('calendar-pill'), service);
  } catch (e) {
    console.error('[aura:calendar] view failed to mount', e);
  }

  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const stale = !state.lastSync || Date.now() - state.lastSync > MIN;
    if (stale) refresh();
  });

  bus.on('settings:changed', ({ patch } = {}) => {
    const c = patch?.calendar;
    if (!c) return;
    if ('calendarIds' in c) { if (state.status === 'connected') refresh(); }
    else if ('studyKeywords' in c) { classifyAll(); emitUpdated(); }
  });

  bus.on('timer:complete', (rec) => { logSession(rec); });

  setInterval(watch, WATCH_MS);
}
