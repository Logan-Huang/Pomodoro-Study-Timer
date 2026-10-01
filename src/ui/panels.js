import { bus } from '../core/bus.js';
import { icon } from './icons.js';

const NAMES = ['tasks', 'stats', 'sound', 'settings'];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let app = null;
let open = '';
let opener = null;
let inited = false;

const panelEl = (name) => document.getElementById(`panel-${name}`);

export function getOpenPanel() {
  return open;
}

function syncOpeners() {
  document.querySelectorAll('[data-open-panel]').forEach((btn) => {
    const on = btn.dataset.openPanel === open;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

function focusables(panel) {
  return [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function openPanel(name) {
  if (!NAMES.includes(name) || !app) return;
  if (open === name) return;
  if (open) closePanel({ restore: false });
  const panel = panelEl(name);
  if (!panel) return;
  if (!opener || !document.contains(opener)) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  open = name;
  app.dataset.panel = name;
  panel.setAttribute('aria-hidden', 'false');
  panel.removeAttribute('inert');
  syncOpeners();
  bus.emit('panel:open', { name });
  // Wait a frame so the slide transition starts before focus moves.
  requestAnimationFrame(() => {
    if (open !== name) return;
    const target = panel.querySelector('[data-close-panel]') || panel;
    target.focus({ preventScroll: true });
  });
}

export function closePanel({ restore = true } = {}) {
  if (!open || !app) return;
  const name = open;
  const panel = panelEl(name);
  open = '';
  app.dataset.panel = '';
  if (panel) {
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('inert', '');
  }
  syncOpeners();
  if (restore && opener && document.contains(opener)) opener.focus({ preventScroll: true });
  if (restore) opener = null;
  bus.emit('panel:close', { name });
}

export function togglePanel(name) {
  if (open === name) closePanel();
  else openPanel(name);
}

export function initPanels() {
  if (inited) return;
  app = document.getElementById('app');
  if (!app) {
    console.warn('[aura] #app missing; panels disabled');
    return;
  }
  inited = true;

  document.querySelectorAll('[data-close-panel]').forEach((btn) => {
    btn.innerHTML = icon('close', { size: 16 });
  });

  NAMES.forEach((name) => {
    const panel = panelEl(name);
    if (!panel) return;
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('inert', '');
    panel.tabIndex = -1;
  });

  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const opn = t.closest('[data-open-panel]');
    if (opn) {
      opener = opn;
      togglePanel(opn.dataset.openPanel);
      return;
    }
    if (t.closest('[data-close-panel]')) closePanel();
  });

  document.getElementById('scrim')?.addEventListener('click', () => closePanel());

  document.addEventListener('keydown', (e) => {
    if (!open) return;
    const panel = panelEl(open);
    if (!panel) return;
    if (e.key === 'Escape') {
      // The shortcuts overlay closes first.
      const ov = document.getElementById('shortcuts-overlay');
      if (ov && !ov.hidden) return;
      e.preventDefault();
      closePanel();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(panel);
    if (!items.length) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!panel.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
