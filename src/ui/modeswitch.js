import { bus } from '../core/bus.js';
import { getMode, setMode } from '../core/state.js';
import { icon } from './icons.js';

const ICONS = { pomodoro: 'brain', timer: 'clock', schedule: 'calendar' };

export function initModeSwitch() {
  const nav = document.getElementById('mode-switch');
  if (!nav) {
    console.warn('[aura] #mode-switch missing');
    return;
  }
  const buttons = [...nav.querySelectorAll('.mode-switch__btn')];
  const indicator = nav.querySelector('.mode-switch__indicator');

  buttons.forEach((btn) => {
    const name = ICONS[btn.dataset.mode];
    if (name && !btn.querySelector('svg')) btn.insertAdjacentHTML('afterbegin', icon(name, { size: 17 }));
    btn.setAttribute('role', 'tab');
  });

  const sync = () => {
    const mode = getMode();
    let active = null;
    buttons.forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      if (on) active = btn;
    });
    if (active && indicator) {
      nav.style.setProperty('--ind-x', `${active.offsetLeft}px`);
      nav.style.setProperty('--ind-w', `${active.offsetWidth}px`);
      nav.classList.add('is-ready');
    }
  };

  nav.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.mode-switch__btn') : null;
    if (btn) setMode(btn.dataset.mode);
  });

  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    next.focus();
    setMode(next.dataset.mode);
  });

  bus.on('mode:change', sync);
  window.addEventListener('resize', sync);
  if (document.fonts?.ready) document.fonts.ready.then(sync).catch(() => {});
  if (typeof ResizeObserver === 'function') new ResizeObserver(sync).observe(nav);
  sync();
}
