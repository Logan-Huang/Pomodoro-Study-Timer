// Toasts, title countdown, dynamic favicon and desktop notifications.
import { bus } from '../core/bus.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { icon } from './icons.js';

const DEFAULT_TITLE = 'Aura — Study Timer';
const MAX_VISIBLE = 3;
const TONE_ICON = { info: 'info', success: 'check', warn: 'warning', error: 'warning' };

const live = [];
let engine = null;
let lastState = null;
let lastTitle = '';
let lastFaviconKey = '';
let faviconDynamic = false;
let origHref = '';
let origType = '';
let faviconCanvas = null;
let permissionPending = null;
let inited = false;

/* ------------------------------------------------------------------ toast */

export function toast(message, opts = {}) {
  const { title, icon: iconName, tone = 'info', duration = 4200, action } = opts;
  const root = document.getElementById('toast-root');
  if (!root) {
    console.warn('[aura] #toast-root missing; toast skipped');
    return () => {};
  }
  const el = document.createElement('div');
  el.className = `toast glass glass--strong toast--${tone}`;
  el.setAttribute('role', 'status');
  const timed = Number.isFinite(duration) && duration > 0;
  if (timed) el.style.setProperty('--toast-dur', `${duration}ms`);

  const badge = document.createElement('span');
  badge.className = 'toast__icon';
  badge.innerHTML = icon(iconName || TONE_ICON[tone] || 'info', { size: 18 });
  el.append(badge);

  const body = document.createElement('div');
  body.className = 'toast__body';
  if (title) {
    const t = document.createElement('div');
    t.className = 'toast__title';
    t.textContent = title;
    body.append(t);
  }
  if (message) {
    const m = document.createElement('div');
    m.className = 'toast__msg';
    m.textContent = message;
    body.append(m);
  }
  el.append(body);

  let gone = false;
  let tid = 0;
  let remaining = duration;
  let startedAt = 0;
  const rec = { dismiss };

  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(tid);
    const i = live.indexOf(rec);
    if (i >= 0) live.splice(i, 1);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 420);
  }

  if (action && action.label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--sm toast__action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      try {
        action.onClick?.();
      } catch (e) {
        console.error(e);
      }
      dismiss();
    });
    el.append(btn);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-icon btn-icon--sm toast__close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.innerHTML = icon('close', { size: 14 });
  close.addEventListener('click', dismiss);
  el.append(close);

  if (timed) {
    const bar = document.createElement('span');
    bar.className = 'toast__bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<i></i>';
    el.append(bar);
  }

  const resumeTimer = () => {
    if (!timed || gone || tid) return;
    startedAt = performance.now();
    el.classList.remove('is-paused');
    tid = setTimeout(dismiss, Math.max(200, remaining));
  };
  const pauseTimer = () => {
    if (!timed || gone || !tid) return;
    clearTimeout(tid);
    tid = 0;
    remaining -= performance.now() - startedAt;
    el.classList.add('is-paused');
  };
  el.addEventListener('pointerenter', pauseTimer);
  el.addEventListener('pointerleave', resumeTimer);
  el.addEventListener('focusin', pauseTimer);
  el.addEventListener('focusout', resumeTimer);

  root.append(el);
  live.push(rec);
  while (live.length > MAX_VISIBLE) live[0].dismiss();
  resumeTimer();
  return dismiss;
}

/* --------------------------------------------------------- desktop notify */

export async function requestDesktopPermission() {
  if (typeof Notification === 'undefined') {
    toast('Desktop notifications are not supported in this browser.', { tone: 'warn', icon: 'bell' });
    return false;
  }
  if (permissionPending) return permissionPending;
  permissionPending = (async () => {
    let perm = Notification.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = 'denied';
      }
    }
    const granted = perm === 'granted';
    updateSettings({ notifications: { desktop: granted } });
    if (perm === 'denied') {
      toast('Notifications are blocked. Allow them in your browser’s site settings.', {
        tone: 'warn',
        icon: 'bell',
      });
    }
    return granted;
  })();
  try {
    return await permissionPending;
  } finally {
    permissionPending = null;
  }
}

function notifyDesktop(title, body) {
  try {
    if (typeof Notification === 'undefined') return;
    if (!getSettings().notifications?.desktop) return;
    if (Notification.permission !== 'granted') return;
    if (!(document.hidden || !document.hasFocus())) return;
    const n = new Notification(title, { body, tag: 'aura-timer', renotify: true, silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (e) {
    console.warn('[aura] desktop notification failed', e);
  }
}

/* ------------------------------------------------------- title + favicon */

const pad = (n) => String(n).padStart(2, '0');

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function displaySeconds(s) {
  const up = s.engineMode === 'stopwatch' || s.phase === 'stopwatch';
  return up ? Math.floor(s.elapsedMs / 1000) : Math.ceil(s.remainingMs / 1000);
}

function updateTitle(s) {
  const on = s && s.running && getSettings().notifications?.titleCountdown;
  const next = on ? `${fmtClock(displaySeconds(s))} · ${s.label} — Aura` : DEFAULT_TITLE;
  if (next !== lastTitle) {
    lastTitle = next;
    document.title = next;
  }
}

function cssColor(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function drawFavicon(s) {
  const link = document.getElementById('favicon');
  if (!link) return;
  if (!faviconCanvas) {
    faviconCanvas = document.createElement('canvas');
    faviconCanvas.width = faviconCanvas.height = 64;
  }
  const up = s.engineMode === 'stopwatch' || s.phase === 'stopwatch';
  const frac = up ? s.progress : s.totalMs > 0 ? s.remainingMs / s.totalMs : 0;
  const c = faviconCanvas.getContext('2d');
  c.clearRect(0, 0, 64, 64);
  c.fillStyle = '#0a0812';
  c.beginPath();
  c.arc(32, 32, 31, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 8;
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.beginPath();
  c.arc(32, 32, 21, 0, Math.PI * 2);
  c.stroke();
  if (frac > 0.004) {
    let grad;
    try {
      grad = c.createLinearGradient(8, 8, 56, 56);
      grad.addColorStop(0, cssColor('--accent', '#a78bfa'));
      grad.addColorStop(1, cssColor('--accent-2', '#22d3ee'));
    } catch {
      grad = '#a78bfa';
    }
    c.strokeStyle = grad;
    c.beginPath();
    c.arc(32, 32, 21, -Math.PI / 2, -Math.PI / 2 + Math.min(1, frac) * Math.PI * 2);
    c.stroke();
  }
  if (!faviconDynamic) {
    origHref = link.getAttribute('href') || '';
    origType = link.getAttribute('type') || 'image/svg+xml';
  }
  link.setAttribute('type', 'image/png');
  link.setAttribute('href', faviconCanvas.toDataURL('image/png'));
  faviconDynamic = true;
}

function restoreFavicon() {
  lastFaviconKey = '';
  if (!faviconDynamic) return;
  const link = document.getElementById('favicon');
  if (link) {
    link.setAttribute('href', origHref);
    link.setAttribute('type', origType);
  }
  faviconDynamic = false;
}

function updateFavicon(s) {
  const on = s && s.running && getSettings().notifications?.faviconProgress;
  if (!on) {
    restoreFavicon();
    return;
  }
  const key = `${s.phase}:${displaySeconds(s)}`;
  if (key === lastFaviconKey) return;
  lastFaviconKey = key;
  drawFavicon(s);
}

function updateChrome(s) {
  if (!s) return;
  lastState = s;
  updateTitle(s);
  updateFavicon(s);
}

/* --------------------------------------------------------- announcements */

const minutes = (ms) => Math.max(1, Math.round(ms / 60000));

function describeCompletion(rec, st) {
  if (rec.phase === 'focus') {
    if (st && (st.phase === 'short' || st.phase === 'long') && st.totalMs) {
      const long = st.phase === 'long' ? 'long ' : '';
      return { title: 'Focus complete', body: `Enjoy a ${minutes(st.totalMs)}-minute ${long}break.` };
    }
    return { title: 'Focus complete', body: 'Beautifully done. Take a moment to breathe.' };
  }
  if (rec.phase === 'short' || rec.phase === 'long') {
    const idle = st && st.status === 'idle';
    return {
      title: 'Break’s over',
      body: 'Ready to focus?',
      action: idle && engine ? { label: 'Start focus', onClick: () => engine.start() } : null,
    };
  }
  if (rec.phase === 'countdown') {
    return { title: 'Countdown complete', body: `Your ${minutes(rec.plannedMs || rec.elapsedMs)}-minute timer has finished.` };
  }
  return null;
}

function onComplete(rec) {
  if (!rec || !rec.natural) return;
  // Let the engine advance to the next segment before describing what's next.
  setTimeout(() => {
    let st = null;
    try {
      st = engine ? engine.getState() : lastState;
    } catch {
      st = lastState;
    }
    if (st && st.engineMode === 'sequence' && st.status === 'done') return;
    const info = describeCompletion(rec, st);
    if (!info) return;
    toast(info.body, {
      title: info.title,
      tone: 'success',
      icon: rec.phase === 'short' || rec.phase === 'long' ? 'target' : 'check',
      duration: 6000,
      action: info.action || undefined,
    });
    notifyDesktop(info.title, info.body);
  }, 90);
}

function onSequenceComplete(payload) {
  const name = payload?.meta?.title;
  const body = name ? `${name} — well done.` : 'Beautifully paced. Take a real break.';
  toast(body, { title: 'Study block complete', tone: 'success', icon: 'sparkle', duration: 7000 });
  notifyDesktop('Study block complete', body);
}

/* ------------------------------------------------------------------- init */

export function initNotify() {
  if (inited) return;
  inited = true;
  import('../timer/engine.js')
    .then((m) => {
      engine = m.timer || null;
      if (engine && !lastState) updateChrome(engine.getState());
    })
    .catch(() => {});

  bus.on('timer:state', updateChrome);
  bus.on('timer:tick', updateChrome);
  bus.on('timer:complete', onComplete);
  bus.on('timer:sequence-complete', onSequenceComplete);
  bus.on('settings:changed', ({ patch } = {}) => {
    lastTitle = '';
    lastFaviconKey = '';
    if (lastState) updateChrome(lastState);
    else updateTitle(null);
    if (
      patch?.notifications?.desktop === true &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      requestDesktopPermission();
    }
  });
  updateTitle(null);
}
