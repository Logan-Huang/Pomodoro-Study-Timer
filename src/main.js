import { bus } from './core/bus.js';
import { getSettings } from './core/settings.js';
import { loadSavedMode, setMode, isReducedMotion, isZen, setZen, toggleZen } from './core/state.js';
import { icon } from './ui/icons.js';
import { initPanels } from './ui/panels.js';
import { initModeSwitch } from './ui/modeswitch.js';
import { initShortcuts } from './ui/shortcuts.js';
import { initSettingsPanel } from './ui/settings-panel.js';

const app = document.getElementById('app');
const IDLE_MS = 2500;

/* ---------- small helpers ---------- */

function safe(name, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[aura] ${name} failed`, err);
  }
}

async function bootModule(name, load, init) {
  try {
    const mod = await load();
    return await init(mod);
  } catch (err) {
    console.error(`[aura] ${name} failed`, err);
  }
}

/* ---------- topbar icons ---------- */

const TOPBAR_ICONS = {
  tasks: 'tasks',
  stats: 'stats',
  sound: 'sound',
  settings: 'settings',
};

function injectTopbarIcons() {
  document.querySelectorAll('[data-open-panel]').forEach((btn) => {
    const name = TOPBAR_ICONS[btn.dataset.openPanel];
    if (name && !btn.querySelector('svg')) btn.innerHTML = icon(name, { size: 19 });
  });
  const zen = document.getElementById('btn-zen');
  if (zen) zen.innerHTML = icon('zen', { size: 19 });
  const fs = document.getElementById('btn-fullscreen');
  if (fs) fs.innerHTML = icon('fullscreen', { size: 19 });
}

/* ---------- reduced motion ---------- */

function applyReducedMotion() {
  document.documentElement.dataset.reducedMotion = String(isReducedMotion());
}

function initReducedMotion() {
  applyReducedMotion();
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.addEventListener) mq.addEventListener('change', applyReducedMotion);
    else if (mq.addListener) mq.addListener(applyReducedMotion);
  } catch {
    /* matchMedia unavailable */
  }
  bus.on('settings:changed', applyReducedMotion);
}

/* ---------- timer state mirror ---------- */

function initTimerMirror() {
  if (!app) return;
  bus.on('timer:state', (s) => {
    if (!s) return;
    app.dataset.phase = s.phase;
    app.dataset.status = s.status;
    app.dataset.running = String(!!s.running);
  });
}

/* ---------- fullscreen ---------- */

function initFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  if (!document.fullscreenEnabled || !root.requestFullscreen) {
    btn.hidden = true;
    return;
  }
  const paint = () => {
    const on = !!document.fullscreenElement;
    btn.innerHTML = icon(on ? 'fullscreen-exit' : 'fullscreen', { size: 19 });
    btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    btn.classList.toggle('is-active', on);
  };
  btn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else root.requestFullscreen().catch((err) => console.warn('[aura] fullscreen denied', err));
  });
  document.addEventListener('fullscreenchange', paint);
  paint();
}

/* ---------- zen mode ---------- */

function initZen() {
  if (!app) return;
  const btn = document.getElementById('btn-zen');
  btn?.addEventListener('click', () => toggleZen());

  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'zen-exit btn btn--sm';
  exit.setAttribute('aria-label', 'Exit zen mode');
  exit.innerHTML = `${icon('close', { size: 14 })}<span>Exit zen</span>`;
  exit.addEventListener('click', () => setZen(false));
  app.appendChild(exit);

  let idleTimer = 0;
  const wake = () => {
    if (!isZen()) return;
    app.classList.remove('cursor-hidden');
    app.classList.add('zen-awake');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      app.classList.remove('zen-awake');
      // Keep the cursor if focus is on the exit hint so keyboard users are not confused.
      if (isZen()) app.classList.add('cursor-hidden');
    }, IDLE_MS);
  };
  const stopIdle = () => {
    clearTimeout(idleTimer);
    app.classList.remove('cursor-hidden', 'zen-awake');
  };

  ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));

  bus.on('zen:change', ({ on }) => {
    btn?.classList.toggle('is-active', on);
    btn?.setAttribute('aria-pressed', String(on));
    exit.tabIndex = on ? 0 : -1;
    if (on) wake();
    else stopIdle();
  });
}

/* ---------- boot ---------- */

async function boot() {
  if (!app) {
    console.error('[aura] #app not found; aborting boot');
    return;
  }
  getSettings(); // load + sanitize persisted settings before anything reads them
  initReducedMotion();
  injectTopbarIcons();
  initTimerMirror();

  safe('panels', initPanels);
  safe('modeswitch', initModeSwitch);
  initFullscreen();
  initZen();

  await bootModule('fx', () => import('./fx/index.js'), (m) => m.initFx());
  await bootModule('features', () => import('./features/index.js'), (m) => m.initFeatures());
  await bootModule('timer', () => import('./timer/index.js'), (m) => m.initTimer());
  await bootModule('calendar', () => import('./calendar/index.js'), (m) => m.initCalendar());

  await bootModule('clock', () => import('./ui/clock.js'), (m) => m.initClock(document.getElementById('clock')));
  safe('settings-panel', () => initSettingsPanel(document.getElementById('settings-root')));
  safe('shortcuts', initShortcuts);

  setMode(loadSavedMode(), { initial: true });

  await bootModule('timer state', () => import('./timer/engine.js'), (m) => m.timer.emitState());

  bus.emit('app:ready', {});
  requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('is-booting')));
}

boot().catch((err) => {
  console.error('[aura] boot failed', err);
  app?.classList.remove('is-booting');
});
