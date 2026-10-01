// Visual FX entry point: theme palettes, aurora background, particles, spotlight.

import { bus } from '../core/bus.js';
import { getSettings } from '../core/settings.js';
import { isZen } from '../core/state.js';
import { THEMES, applyTheme, paletteFor, phaseKind } from './themes.js';
import { TOD_MODES, lightAt, hourFor, sunTimes } from './timeofday.js';
import { initBackground } from './background.js';
import { initParticles } from './particles.js';
import { initSpotlight } from './spotlight.js';

let background = null;
let particles = null;
let timerApi = null;
let currentKind = null;
let currentTheme = null;
let lastStatus = 'idle';
let started = false;
let bgFailed = false;

const noopBg = { setPalette() {}, setEnergy() {}, setProgress() {}, pulse() {}, setScene() {}, setAurora() {}, setTimeOfDay() {}, setTime() {}, renderNow() {}, setIntensity() {}, setEnabled() {}, setReducedMotion() {}, destroy() {} };

// "?theme=forest" previews a theme for this page load only (never saved).
const previewTheme = (() => {
  try {
    const t = new URLSearchParams(location.search).get('theme');
    return t && THEMES[t] ? t : null;
  } catch {
    return null;
  }
})();

function themeKey() {
  return previewTheme || getSettings()?.theme;
}

// "?tod=dusk" or "?hour=14.5" previews a time of day for this page load only.
const previewTod = (() => {
  try {
    const q = new URLSearchParams(location.search);
    const hour = q.get('hour');
    if (hour !== null && Number.isFinite(Number(hour))) return { hour: Number(hour) };
    const mode = q.get('tod');
    return mode && TOD_MODES.includes(mode) ? { mode } : null;
  } catch {
    return null;
  }
})();

let todTimer = 0;
let todMode = null;

function currentLight() {
  const now = new Date();
  const times = sunTimes(now);
  if (previewTod?.hour !== undefined) return lightAt(previewTod.hour, times);
  const mode = previewTod?.mode || getSettings()?.visuals?.timeOfDay || 'auto';
  return lightAt(hourFor(TOD_MODES.includes(mode) ? mode : 'auto', now, times), times);
}

// Sky, scenery lighting, weather and UI contrast follow the time of day. Auto mode re-reads the
// clock every 30 s (tiny continuous steps); switching modes eases over a few seconds.
function applyTimeOfDay(ms) {
  const light = currentLight();
  background.setTimeOfDay?.(light, ms);
  particles?.setDaylight?.(light.day);
  document.documentElement.dataset.tod = light.label;
}

function watchTimeOfDay() {
  clearInterval(todTimer);
  todTimer = setInterval(() => applyTimeOfDay(20000), 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyTimeOfDay(1500);
  });
}

// Nature scenery + particle weather for the current theme (both follow the visuals toggles).
function applyScenery(ms) {
  const v = getSettings()?.visuals || {};
  const t = THEMES[themeKey()] || THEMES.aurora;
  const showScene = v.scenery !== false && v.background !== false;
  background.setScene(showScene ? t.scene : 'none', ms);
  background.setAurora(showScene ? t.aurora ?? 1 : 1, ms);
  particles?.setWeather?.(v.scenery !== false ? t.weather : 'none');
}

function safe(fn, label) {
  try {
    return fn();
  } catch (err) {
    console.error(`[fx] ${label} failed`, err);
    return undefined;
  }
}

function currentState() {
  try {
    return timerApi ? timerApi.getState() : null;
  } catch {
    return null;
  }
}

function energyFor(status) {
  const base = status === 'running' ? 1 : status === 'paused' ? 0.5 : 0.35;
  return isZen() ? Math.min(1, base + 0.1) : base;
}

function intensityValue() {
  const v = Number(getSettings()?.visuals?.intensity);
  const base = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  return isZen() ? Math.min(1.25, base * 1.15 + 0.05) : base;
}

function pushPalette(ms) {
  const theme = themeKey();
  const p = applyTheme(theme, currentKind);
  background.setPalette(p.bg, [p.accent, p.accent2, p.accent3], ms);
  particles?.setColors([p.accent, p.accent2, p.accent3]);
}

function applyVisuals() {
  const v = getSettings()?.visuals || {};
  const root = document.documentElement;
  const flag = (x) => (x === false ? 'off' : 'on');
  root.dataset.bg = bgFailed ? 'off' : flag(v.background);
  root.dataset.grain = flag(v.grain);
  root.dataset.particles = flag(v.particles);
  background.setEnabled(v.background !== false);
  // Ambient motes hide via data-particles; bursts stay available so celebrations still land.
  particles?.setEnabled(true);
  background.setIntensity(intensityValue());
}

function onSettings({ patch } = {}) {
  const theme = themeKey();
  const themeChanged = theme !== currentTheme;
  currentTheme = theme;
  applyVisuals();
  if (themeChanged) pushPalette(1400);
  if (themeChanged || patch?.visuals) applyScenery(themeChanged ? 1800 : 900);
  const mode = getSettings()?.visuals?.timeOfDay || 'auto';
  if (mode !== todMode) {
    todMode = mode;
    applyTimeOfDay(3000);
  }
}

function root() {
  return document.documentElement;
}

function onTimerState(state) {
  if (!state) return;
  const kind = phaseKind(state);
  lastStatus = state.status;
  if (kind !== currentKind) {
    currentKind = kind;
    pushPalette(1400);
  }
  background.setEnergy(energyFor(state.status), 1200);
  particles?.setEnergy(energyFor(state.status));
}

function ringCenter() {
  const el = document.getElementById('timer-ring');
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return [r.left + r.width / 2, r.top + r.height / 2];
  }
  return [window.innerWidth / 2, window.innerHeight / 2];
}

function onComplete(rec) {
  if (!rec || rec.natural !== true) return;
  const [x, y] = ringCenter();
  const big = rec.phase === 'focus' || rec.phase === 'countdown' || rec.phase === 'stopwatch';
  const p = paletteFor(themeKey(), currentKind || 'focus');
  particles?.burst(x, y, big ? { count: 130, power: 1.4, colors: [p.accent, p.accent2, p.accent3] } : { count: 55, power: 0.7, colors: [p.accent, p.accent2, p.accent3] });
  background.pulse(big ? 1 : 0.7);
}

function watchReducedMotion() {
  const apply = () => {
    const on = root().dataset.reducedMotion === 'true';
    background.setReducedMotion(on);
    particles?.setReducedMotion(on);
  };
  new MutationObserver(apply).observe(root(), { attributes: true, attributeFilter: ['data-reduced-motion'] });
  apply();
}

export function celebrate(x, y) {
  if (!particles) return;
  const cx = Number.isFinite(x) ? x : ringCenter()[0];
  const cy = Number.isFinite(y) ? y : ringCenter()[1];
  const p = paletteFor(themeKey(), currentKind || 'focus');
  particles.burst(cx, cy, { count: 110, power: 1.2, colors: [p.accent, p.accent2, p.accent3] });
  background.pulse(0.8);
}

export function initFx() {
  if (started) return;
  started = true;

  // The timer module may load after us or fail; never let that break visuals.
  import('../timer/engine.js')
    .then((m) => {
      timerApi = m.timer || null;
      const s = currentState();
      if (s) onTimerState(s);
    })
    .catch(() => {});

  const theme = themeKey();
  currentTheme = theme;
  currentKind = phaseKind(currentState());
  applyTheme(theme, currentKind);

  const bgCanvas = document.getElementById('bg-canvas');
  const fxCanvas = document.getElementById('fx-canvas');
  if (!bgCanvas) console.warn('[fx] #bg-canvas not found');
  if (!fxCanvas) console.warn('[fx] #fx-canvas not found');

  background = (bgCanvas && safe(() => initBackground(bgCanvas), 'background')) || noopBg;
  particles = (fxCanvas && safe(() => initParticles(fxCanvas), 'particles')) || null;
  bgFailed = background === noopBg || root().dataset.bg === 'off';
  safe(() => initSpotlight(), 'spotlight');

  applyVisuals();
  const p = paletteFor(theme, currentKind);
  background.setPalette(p.bg, [p.accent, p.accent2, p.accent3], 0);
  particles?.setColors([p.accent, p.accent2, p.accent3]);
  background.setEnergy(energyFor('idle'), 0);
  particles?.setEnergy(energyFor('idle'));
  safe(() => applyScenery(0), 'scenery');
  todMode = getSettings()?.visuals?.timeOfDay || 'auto';
  safe(() => applyTimeOfDay(0), 'time of day');
  safe(() => watchTimeOfDay(), 'time of day clock');
  safe(() => watchReducedMotion(), 'reduced-motion');

  bus.on('settings:changed', onSettings);
  bus.on('timer:state', onTimerState);
  bus.on('timer:tick', (s) => s && background.setProgress(s.progress));
  bus.on('timer:phase-start', () => background.pulse(0.6));
  bus.on('timer:complete', onComplete);
  bus.on('zen:change', () => {
    background.setIntensity(intensityValue());
    background.setEnergy(energyFor(lastStatus), 900);
    particles?.setEnergy(energyFor(lastStatus));
  });
}
