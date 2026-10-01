import { bus } from './bus.js';
import { load, save } from './storage.js';
import { getSettings } from './settings.js';

export const MODES = ['pomodoro', 'timer', 'schedule'];

let mode = 'pomodoro';
let zen = false;

const appEl = () => document.getElementById('app');

export function getMode() {
  return mode;
}

export function setMode(next, { initial = false } = {}) {
  if (!MODES.includes(next)) next = 'pomodoro';
  if (next === mode && !initial) return;
  const prev = mode;
  mode = next;
  const el = appEl();
  if (el) el.dataset.mode = mode;
  save('mode', mode);
  bus.emit('mode:change', { mode, prev, initial });
}

export function loadSavedMode() {
  const saved = load('mode', 'pomodoro');
  return MODES.includes(saved) ? saved : 'pomodoro';
}

export function isReducedMotion() {
  const pref = getSettings().visuals?.reducedMotion || 'auto';
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function isZen() {
  return zen;
}

export function setZen(on) {
  on = !!on;
  if (on === zen) return;
  zen = on;
  const el = appEl();
  if (el) el.dataset.zen = String(zen);
  bus.emit('zen:change', { on: zen });
}

export function toggleZen() {
  setZen(!zen);
}
