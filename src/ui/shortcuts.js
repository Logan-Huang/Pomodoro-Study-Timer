import { setMode, toggleZen, isZen, setZen } from '../core/state.js';
import { getOpenPanel, togglePanel } from './panels.js';
import { icon } from './icons.js';

const LIST = [
  { keys: ['Space'], label: 'Start / pause' },
  { keys: ['R'], label: 'Reset' },
  { keys: ['S'], label: 'Skip segment' },
  { keys: ['L'], label: 'Lap (stopwatch)' },
  { keys: ['↑'], label: 'Add one minute' },
  { keys: ['↓'], label: 'Remove one minute' },
  { keys: ['1'], label: 'Pomodoro mode' },
  { keys: ['2'], label: 'Timer mode' },
  { keys: ['3'], label: 'Schedule mode' },
  { keys: ['T'], label: 'Tasks' },
  { keys: ['I'], label: 'Insights' },
  { keys: ['M'], label: 'Soundscapes' },
  { keys: [','], label: 'Settings' },
  { keys: ['Z'], label: 'Zen mode' },
  { keys: ['F'], label: 'Fullscreen' },
  { keys: ['?'], label: 'This overlay' },
  { keys: ['Esc'], label: 'Close overlay, panel, zen' },
];

let overlay = null;
let lastFocus = null;
let engine = null;

function getOverlay() {
  return overlay || (overlay = document.getElementById('shortcuts-overlay'));
}

function build(el) {
  el.innerHTML = `
    <div class="shortcuts-card glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" tabindex="-1">
      <header class="shortcuts-card__header">
        <h2 id="shortcuts-title" class="panel__title">Keyboard shortcuts</h2>
        <button class="btn-icon btn-icon--sm" type="button" data-shortcuts-close aria-label="Close">${icon('close', { size: 16 })}</button>
      </header>
      <ul class="shortcuts-grid">
        ${LIST.map((s) => `<li class="shortcuts-row"><span class="shortcuts-row__label">${s.label}</span><span class="shortcuts-row__keys">${s.keys.map((k) => `<kbd class="kbd">${k}</kbd>`).join('')}</span></li>`).join('')}
      </ul>
    </div>`;
}

export function isShortcutsOpen() {
  const el = getOverlay();
  return !!el && !el.hidden;
}

function closeShortcuts() {
  const el = getOverlay();
  if (!el || el.hidden) return;
  el.classList.remove('is-open');
  el.hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
}

export function openShortcuts() {
  const el = getOverlay();
  if (!el || !el.hidden) return;
  if (!el.firstElementChild) build(el);
  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  el.hidden = false;
  requestAnimationFrame(() => {
    el.classList.add('is-open');
    el.querySelector('.shortcuts-card')?.focus({ preventScroll: true });
  });
}

function typing(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

async function withTimer(fn) {
  try {
    if (!engine) engine = (await import('../timer/engine.js')).timer;
    fn(engine);
  } catch (err) {
    console.error('[aura] timer shortcut failed', err);
  }
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (isShortcutsOpen()) {
      e.preventDefault();
      closeShortcuts();
    } else if (!getOpenPanel() && isZen()) {
      e.preventDefault();
      setZen(false);
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (typing(e.target)) return;

  if (isShortcutsOpen()) {
    if (e.key === 'Tab') {
      e.preventDefault();
      getOverlay().querySelector('[data-shortcuts-close]')?.focus();
    }
    if (e.key !== '?') return;
  }

  const el = e.target instanceof Element ? e.target : null;
  const onButton = !!el?.closest('button, a, [role="tab"]');
  const onTab = !!el?.closest('[role="tab"]');
  switch (e.key) {
    case ' ':
    case 'Spacebar':
      if (onButton) return; // the focused control handles Space itself
      e.preventDefault();
      withTimer((t) => t.toggle());
      return;
    case 'r': case 'R': withTimer((t) => t.reset()); return;
    case 's': case 'S': withTimer((t) => t.skip()); return;
    case 'l': case 'L': withTimer((t) => t.lap()); return;
    case 'ArrowUp':
      if (onTab) return;
      e.preventDefault();
      withTimer((t) => t.adjust(60000));
      return;
    case 'ArrowDown':
      if (onTab) return;
      e.preventDefault();
      withTimer((t) => t.adjust(-60000));
      return;
    case '1': setMode('pomodoro'); return;
    case '2': setMode('timer'); return;
    case '3': setMode('schedule'); return;
    case 't': case 'T': togglePanel('tasks'); return;
    case 'i': case 'I': togglePanel('stats'); return;
    case 'm': case 'M': togglePanel('sound'); return;
    case ',': togglePanel('settings'); return;
    case 'z': case 'Z': toggleZen(); return;
    case 'f': case 'F': toggleFullscreen(); return;
    case '?':
      e.preventDefault();
      if (isShortcutsOpen()) closeShortcuts();
      else openShortcuts();
      return;
    default:
  }
}

export function initShortcuts() {
  const el = getOverlay();
  if (!el) {
    console.warn('[aura] #shortcuts-overlay missing');
  } else {
    build(el);
    el.addEventListener('click', (e) => {
      const t = e.target;
      if (t === el || (t instanceof Element && t.closest('[data-shortcuts-close]'))) closeShortcuts();
    });
  }
  document.addEventListener('keydown', onKey);
}
