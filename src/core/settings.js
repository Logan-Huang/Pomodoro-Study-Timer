import { bus } from './bus.js';
import { load, save } from './storage.js';

export const DEFAULT_SETTINGS = {
  pomodoro: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 4, autoStartBreaks: true, autoStartFocus: false },
  timer: { countdownMin: 10, presetsMin: [5, 10, 15, 25, 45, 60] },
  theme: 'aurora',
  visuals: { background: true, scenery: true, timeOfDay: 'auto', particles: true, grain: true, intensity: 0.8, reducedMotion: 'auto' }, // timeOfDay: auto|dawn|day|dusk|night
  sound: { chime: 'crystal', volume: 0.7, ambient: 'none', ambientVolume: 0.35, ambientOnlyWhileFocus: false, uiSounds: true },
  notifications: { desktop: false, titleCountdown: true, faviconProgress: true },
  goals: { dailyFocusMin: 120 },
  clock: { show: true, format: 'auto' }, // format: auto|12h|24h
  calendar: {
    clientId: '',
    calendarIds: ['primary'],
    studyKeywords: ['study', 'focus', 'homework', 'review', 'revise', 'revision', 'exam', 'read', 'reading', 'deep work', 'practice', 'assignment', 'essay', 'lab report', 'problem set'],
    autoStartBlocks: false,
    warnBeforeEventMin: 5,
    logSessions: false,
    dayStartHour: 7,
    dayEndHour: 23,
  },
};

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Deep merge: plain objects merge recursively, everything else (incl. arrays) is replaced.
function merge(target, patch) {
  if (!isObj(patch)) return target;
  for (const key of Object.keys(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const value = patch[key];
    if (isObj(value)) {
      if (!isObj(target[key])) target[key] = {};
      merge(target[key], value);
    } else {
      target[key] = Array.isArray(value) ? value.slice() : value;
    }
  }
  return target;
}

// Keep only keys that exist in defaults with matching shape so stale/corrupt storage can't poison state.
function sanitize(defaults, input) {
  const out = clone(defaults);
  if (!isObj(input)) return out;
  for (const key of Object.keys(defaults)) {
    if (!(key in input)) continue;
    const d = defaults[key];
    const v = input[key];
    if (isObj(d)) {
      if (isObj(v)) out[key] = sanitize(d, v);
    } else if (Array.isArray(d)) {
      if (Array.isArray(v)) out[key] = v.slice();
    } else if (typeof v === typeof d) {
      out[key] = v;
    }
  }
  return out;
}

let settings = sanitize(DEFAULT_SETTINGS, load('settings', null));

export function getSettings() {
  return settings;
}

export function updateSettings(patch) {
  if (!isObj(patch)) return settings;
  merge(settings, patch);
  save('settings', settings);
  bus.emit('settings:changed', { settings, patch });
  return settings;
}

export function resetSettings() {
  const fresh = clone(DEFAULT_SETTINGS);
  // Preserve the calendar client id: it is a connection credential, not a preference.
  fresh.calendar.clientId = settings.calendar?.clientId || '';
  settings = fresh;
  save('settings', settings);
  bus.emit('settings:changed', { settings, patch: clone(fresh) });
  return settings;
}
