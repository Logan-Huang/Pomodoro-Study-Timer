// Pointer-following spotlight for glass surfaces (paints via .glass::after in fx.css).

const SELECTOR = '.glass, .btn';

export function initSpotlight() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  if (!window.matchMedia('(hover: hover)').matches) return;

  const root = document.documentElement;
  let pending = null;
  let raf = 0;
  let active = null;

  function apply() {
    raf = 0;
    const ev = pending;
    pending = null;
    if (!ev) return;
    if (root.dataset.reducedMotion === 'true') return;
    const target = ev.target instanceof Element ? ev.target.closest(SELECTOR) : null;
    if (active && active !== target) active.style.removeProperty('--fx-live');
    active = target;
    if (!target) return;
    const r = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${(ev.clientX - r.left).toFixed(1)}px`);
    target.style.setProperty('--my', `${(ev.clientY - r.top).toFixed(1)}px`);
    target.style.setProperty('--fx-live', '1');
  }

  function onMove(ev) {
    if (ev.pointerType && ev.pointerType !== 'mouse' && ev.pointerType !== 'pen') return;
    pending = ev;
    if (!raf) raf = requestAnimationFrame(apply);
  }

  function onLeave() {
    if (active) active.style.removeProperty('--fx-live');
    active = null;
  }

  document.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
}
