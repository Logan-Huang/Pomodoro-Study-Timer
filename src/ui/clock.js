// Top-bar clock: current time + date in a glass pill, with an icon that follows the scenery's
// time of day (html[data-tod]). Click toggles 12 / 24-hour. Updates on the minute.
import { bus } from '../core/bus.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { icon } from './icons.js';

// Sun on the horizon (dawn / dusk), drawn to match icons.js stroke style.
const HORIZON_ICON = `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17a5 5 0 0 1 10 0"/><path d="M3 17h18M12 6v3M4.9 9.9l1.8 1.8M19.1 9.9l-1.8 1.8M7 21h10"/></svg>`;

const ICONS = {
  day: () => icon('sun', { size: 16 }),
  dawn: () => HORIZON_ICON,
  dusk: () => HORIZON_ICON,
  night: () => icon('moon', { size: 16 }),
};

function wants12h() {
  const f = getSettings().clock?.format;
  if (f === '12h') return true;
  if (f === '24h') return false;
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 !== false;
  } catch {
    return true;
  }
}

function parts(d, h12) {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (!h12) return { hm: `${String(h).padStart(2, '0')}:${m}`, ampm: '' };
  return { hm: `${h % 12 || 12}:${m}`, ampm: h < 12 ? 'AM' : 'PM' };
}

const fmtTime = (d, h12) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: h12 });

/** Sunrise/sunset hint for the tooltip, using the same model as the scenery. */
async function sunHint(now, h12) {
  try {
    const { sunTimes } = await import('../fx/timeofday.js');
    const { sunrise, sunset } = sunTimes(now);
    const hour = now.getHours() + now.getMinutes() / 60;
    const at = (hrs) => {
      const d = new Date(now);
      d.setHours(Math.floor(hrs), Math.round((hrs % 1) * 60), 0, 0);
      return fmtTime(d, h12);
    };
    if (hour < sunrise) return `Sunrise ${at(sunrise)}`;
    if (hour < sunset) return `Sunset ${at(sunset)}`;
    return `Sunrise ${at(sunrise)}`;
  } catch {
    return '';
  }
}

export function initClock(el) {
  if (!el) {
    console.warn('[aura] #clock missing; clock skipped');
    return;
  }
  el.innerHTML = `
    <span class="clock__icon" aria-hidden="true"></span>
    <span class="clock__time tabular"><span class="clock__hm"></span><span class="clock__ampm"></span></span>
    <span class="clock__sep" aria-hidden="true"></span>
    <span class="clock__date"></span>`;
  const iconEl = el.querySelector('.clock__icon');
  const hmEl = el.querySelector('.clock__hm');
  const ampmEl = el.querySelector('.clock__ampm');
  const dateEl = el.querySelector('.clock__date');
  let timer = 0;
  let todShown = '';

  function renderIcon() {
    const tod = document.documentElement.dataset.tod || 'night';
    if (tod === todShown) return;
    todShown = tod;
    iconEl.innerHTML = (ICONS[tod] || ICONS.night)();
    el.dataset.tod = tod;
  }

  async function render() {
    const now = new Date();
    const h12 = wants12h();
    const { hm, ampm } = parts(now, h12);
    // The colon is its own span so it can breathe gently.
    const [hh, mm] = hm.split(':');
    hmEl.innerHTML = `${hh}<span class="clock__colon">:</span>${mm}`;
    ampmEl.textContent = ampm;
    ampmEl.hidden = !ampm;
    dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    renderIcon();
    const full = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const hint = await sunHint(now, h12);
    const label = `${fmtTime(now, h12)} · ${full}${hint ? ` · ${hint}` : ''}`;
    el.title = `${label}\nClick to switch to ${h12 ? '24' : '12'}-hour time`;
    el.setAttribute('aria-label', `${label}. Switch to ${h12 ? '24' : '12'}-hour time`);
  }

  // Tick exactly on each minute boundary (re-synced every minute, so sleep/drift can't skew it).
  function schedule() {
    clearTimeout(timer);
    const now = new Date();
    const ms = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 30;
    timer = setTimeout(() => {
      render();
      schedule();
    }, ms);
  }

  function applyVisibility() {
    el.hidden = getSettings().clock?.show === false;
  }

  el.addEventListener('click', () => {
    updateSettings({ clock: { format: wants12h() ? '24h' : '12h' } });
  });

  bus.on('settings:changed', ({ patch } = {}) => {
    if (!patch || !patch.clock) return;
    applyVisibility();
    render();
  });
  new MutationObserver(renderIcon).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tod'] });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      render();
      schedule();
    }
  });

  applyVisibility();
  render();
  schedule();
}
