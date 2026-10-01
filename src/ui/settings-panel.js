import { bus } from '../core/bus.js';
import { getSettings, updateSettings, resetSettings } from '../core/settings.js';
import { setMode } from '../core/state.js';
import { icon } from './icons.js';
import { openPanel, closePanel } from './panels.js';
import { openShortcuts } from './shortcuts.js';

const FALLBACK_THEMES = {
  aurora: { name: 'Aurora', tagline: 'Violet, cyan and rose', swatch: ['#a78bfa', '#22d3ee', '#f472b6'] },
  sunset: { name: 'Sunset', tagline: 'Amber into magenta', swatch: ['#fb923c', '#f472b6', '#a78bfa'] },
  ocean: { name: 'Ocean', tagline: 'Deep teal currents', swatch: ['#38bdf8', '#2dd4bf', '#818cf8'] },
  forest: { name: 'Forest', tagline: 'Moss and lantern light', swatch: ['#4ade80', '#a3e635', '#2dd4bf'] },
  sakura: { name: 'Sakura', tagline: 'Soft blossom pink', swatch: ['#f9a8d4', '#fda4af', '#c4b5fd'] },
  midnight: { name: 'Midnight', tagline: 'Quiet indigo and steel', swatch: ['#818cf8', '#60a5fa', '#94a3b8'] },
};

const RM_OPTIONS = [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']];
const TOD_OPTIONS = [['auto', 'Auto'], ['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']];
const CLOCK_OPTIONS = [['auto', 'Auto'], ['12h', '12-hour'], ['24h', '24-hour']];

const syncers = [];
let noteTimer = 0;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function patchFor(path, value) {
  const keys = path.split('.');
  const patch = {};
  let cur = patch;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else cur = cur[k] = {};
  });
  return patch;
}

const setPath = (path, value) => updateSettings(patchFor(path, value));

/* ---------- markup builders ---------- */

function row(label, desc, control, { stack = false } = {}) {
  return `
    <div class="set-row${stack ? ' set-row--stack' : ''}">
      <div class="set-row__text">
        <div class="set-row__label">${label}</div>
        ${desc ? `<div class="set-row__desc">${desc}</div>` : ''}
      </div>
      <div class="set-row__control">${control}</div>
    </div>`;
}

function stepper(path, { min, max, step = 1, unit = 'min', label }) {
  return `
    <div class="set-stepper">
      <div class="stepper" data-stepper="${path}" data-min="${min}" data-max="${max}" data-step-size="${step}">
        <button class="stepper__btn" type="button" data-step="-1" aria-label="Decrease ${esc(label)}">−</button>
        <input class="stepper__input input" type="number" inputmode="numeric" min="${min}" max="${max}" step="${step}" aria-label="${esc(label)}">
        <button class="stepper__btn" type="button" data-step="1" aria-label="Increase ${esc(label)}">+</button>
      </div>
      ${unit ? `<span class="set-unit faint">${unit}</span>` : ''}
    </div>`;
}

function switchRow(path, label, desc) {
  return row(label, desc, `
    <label class="switch">
      <input type="checkbox" class="switch__input" data-switch="${path}" aria-label="${esc(label)}">
      <span class="switch__track" aria-hidden="true"></span>
    </label>`);
}

function card(title, iconName, body, extraClass = '') {
  return `
    <section class="set-card glass ${extraClass}">
      <h3 class="section-title set-card__title">${icon(iconName, { size: 14 })}<span>${title}</span></h3>
      ${body}
    </section>`;
}

function render() {
  return `
    <section class="set-card glass set-account" data-account></section>

    ${card('Focus rhythm', 'brain', [
      row('Focus', 'Length of a focus session', stepper('pomodoro.focusMin', { min: 1, max: 180, label: 'Focus minutes' })),
      row('Short break', 'Between focus sessions', stepper('pomodoro.shortBreakMin', { min: 1, max: 60, label: 'Short break minutes' })),
      row('Long break', 'After a full set of sessions', stepper('pomodoro.longBreakMin', { min: 1, max: 90, label: 'Long break minutes' })),
      row('Long break every', 'Focus sessions per set', stepper('pomodoro.longBreakEvery', { min: 2, max: 8, unit: 'sessions', label: 'Sessions before long break' })),
      switchRow('pomodoro.autoStartBreaks', 'Auto-start breaks', 'Roll straight into the break when focus ends'),
      switchRow('pomodoro.autoStartFocus', 'Auto-start focus', 'Begin the next session when a break ends'),
    ].join(''))}

    ${card('Timer', 'clock', [
      row('Default countdown', 'Where the timer starts in Timer mode', stepper('timer.countdownMin', { min: 1, max: 600, label: 'Default countdown minutes' })),
      row('Presets', 'Quick durations, up to 8', `
        <div class="set-presets">
          <div class="set-presets__list" data-presets></div>
          <form class="set-presets__add" data-preset-form>
            <input class="input" type="number" min="1" max="600" inputmode="numeric" placeholder="min" aria-label="New preset in minutes" data-preset-input>
            <button class="btn btn--sm" type="submit">${icon('plus', { size: 14 })}<span>Add</span></button>
          </form>
        </div>`, { stack: true }),
    ].join(''))}

    ${card('Appearance', 'sparkle', [
      `<div class="set-themes" data-themes role="group" aria-label="Theme"></div>`,
      switchRow('visuals.background', 'Animated background', 'Living aurora behind the glass'),
      switchRow('visuals.scenery', 'Nature scenery', 'A themed landscape with its own weather'),
      row('Time of day', 'Auto follows your clock: sunrise, daylight, sunset and night.', `
        <div class="segmented set-tod" role="tablist" aria-label="Time of day" data-segmented="visuals.timeOfDay">
          ${TOD_OPTIONS.map(([v, l]) => `<button type="button" class="segmented__btn" role="tab" data-value="${v}" aria-selected="false">${l}</button>`).join('')}
        </div>`, { stack: true }),
      switchRow('clock.show', 'Clock', 'Current time in the top bar'),
      row('Clock format', 'Auto follows your system; click the clock to flip it too.', `
        <div class="segmented" role="tablist" aria-label="Clock format" data-segmented="clock.format">
          ${CLOCK_OPTIONS.map(([v, l]) => `<button type="button" class="segmented__btn" role="tab" data-value="${v}" aria-selected="false">${l}</button>`).join('')}
        </div>`),
      switchRow('visuals.particles', 'Particles', 'Drifting light motes and weather'),
      switchRow('visuals.grain', 'Film grain', 'Subtle texture overlay'),
      row('Visual intensity', 'Brightness and motion of the atmosphere', `
        <div class="set-slider"><input type="range" class="slider" min="0" max="1" step="0.05" data-slider="visuals.intensity" aria-label="Visual intensity"><output class="set-slider__value tabular faint" data-slider-out></output></div>`),
      row('Reduced motion', 'Calms animation. Auto follows your system.', `
        <div class="segmented" role="tablist" aria-label="Reduced motion" data-segmented="visuals.reducedMotion">
          ${RM_OPTIONS.map(([v, l]) => `<button type="button" class="segmented__btn" role="tab" data-value="${v}" aria-selected="false">${l}</button>`).join('')}
        </div>`),
    ].join(''))}

    ${card('Notifications', 'bell', [
      switchRow('notifications.desktop', 'Desktop notifications', 'Alert me when a session ends'),
      `<p class="set-note muted" data-notify-note hidden></p>`,
      switchRow('notifications.titleCountdown', 'Title countdown', 'Show the time left in the browser tab'),
      switchRow('notifications.faviconProgress', 'Favicon progress', 'Draw progress on the tab icon'),
    ].join(''))}

    ${card('Daily goal', 'target', row('Focus goal', 'Minutes of focus per day', stepper('goals.dailyFocusMin', { min: 15, max: 720, step: 15, label: 'Daily focus goal in minutes' })))}

    ${card('Sound', 'sound', row('Chimes and ambience', 'Choose a chime, volume and a soundscape.', `<button class="btn btn--sm" type="button" data-go="sound">${icon('sound', { size: 15 })}<span>Open Soundscapes</span></button>`))}

    ${card('Google Calendar', 'calendar', row('Schedule mode', 'Connect a calendar or try the demo day to plan Pomodoros around your events.', `<button class="btn btn--sm" type="button" data-go="schedule">${icon('calendar', { size: 15 })}<span>Open Schedule</span></button>`))}

    ${card('Data', 'download', `
      ${row('Export', 'Download your settings, sessions and tasks as JSON', `<button class="btn btn--sm" type="button" data-export>${icon('download', { size: 15 })}<span>Export</span></button>`)}
      ${row('Reset statistics', 'Clears sessions, streaks and totals', `<button class="btn btn--sm" type="button" data-confirm="stats" data-label="Reset statistics"><span>Reset statistics</span></button>`)}
      ${row('Restore defaults', 'Puts every setting back the way it was', `<button class="btn btn--sm" type="button" data-confirm="defaults" data-label="Restore defaults"><span>Restore defaults</span></button>`)}
    `)}

    <footer class="set-footer">
      <button class="btn btn--ghost btn--sm" type="button" data-shortcuts>${icon('keyboard', { size: 15 })}<span>Keyboard shortcuts</span></button>
      <span class="set-footer__legal"><a href="privacy.html" target="_blank" rel="noopener">Privacy</a> · <a href="terms.html" target="_blank" rel="noopener">Terms</a></span>
      <span class="set-footer__version serif">Aura v1.1</span>
    </footer>`;
}

/* ---------- wiring ---------- */

function wireSteppers(root) {
  root.querySelectorAll('[data-stepper]').forEach((el) => {
    const path = el.dataset.stepper;
    const min = Number(el.dataset.min);
    const max = Number(el.dataset.max);
    const stepSize = Number(el.dataset.stepSize) || 1;
    const input = el.querySelector('input');
    const btns = el.querySelectorAll('[data-step]');

    const commit = (raw) => {
      let v = Math.round(Number(raw));
      if (!Number.isFinite(v)) v = Number(get(getSettings(), path));
      v = clamp(v, min, max);
      if (stepSize > 1) v = clamp(Math.round(v / stepSize) * stepSize, min, max);
      input.value = String(v);
      if (v !== get(getSettings(), path)) setPath(path, v);
    };

    btns.forEach((b) => b.addEventListener('click', () => {
      const cur = Number(get(getSettings(), path));
      commit(cur + Number(b.dataset.step) * stepSize);
    }));
    input.addEventListener('change', () => commit(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(input.value); }
      e.stopPropagation();
    });

    syncers.push((s) => {
      const v = get(s, path);
      if (document.activeElement !== input) input.value = String(v);
      const n = Number(v);
      btns[0].disabled = n <= min;
      btns[1].disabled = n >= max;
    });
  });
}

function wireSwitches(root) {
  root.querySelectorAll('[data-switch]').forEach((input) => {
    const path = input.dataset.switch;
    if (path === 'notifications.desktop') return; // handled separately
    input.addEventListener('change', () => setPath(path, input.checked));
    syncers.push((s) => { input.checked = !!get(s, path); });
  });
}

function showNote(root, text) {
  const note = root.querySelector('[data-notify-note]');
  if (!note) return;
  note.textContent = text;
  note.hidden = !text;
  clearTimeout(noteTimer);
  if (text) noteTimer = setTimeout(() => { note.hidden = true; }, 7000);
}

function wireNotifications(root) {
  const input = root.querySelector('[data-switch="notifications.desktop"]');
  if (!input) return;
  input.addEventListener('change', async () => {
    if (!input.checked) {
      showNote(root, '');
      setPath('notifications.desktop', false);
      return;
    }
    input.disabled = true;
    let granted = false;
    try {
      const mod = await import('./notify.js');
      granted = !!(await mod.requestDesktopPermission());
    } catch (err) {
      console.error('[aura] notification permission failed', err);
    }
    input.disabled = false;
    if (granted) {
      showNote(root, '');
      setPath('notifications.desktop', true);
    } else {
      input.checked = false;
      setPath('notifications.desktop', false);
      showNote(root, 'Notifications are blocked. Allow them for this site in your browser settings, then try again.');
    }
  });
  syncers.push((s) => { input.checked = !!s.notifications?.desktop; });
}

function wirePresets(root) {
  const list = root.querySelector('[data-presets]');
  const form = root.querySelector('[data-preset-form]');
  const field = root.querySelector('[data-preset-input]');
  if (!list || !form || !field) return;
  let lastKey = '';

  const save = (arr) => {
    const clean = [...new Set(arr.map((n) => Math.round(Number(n))).filter((n) => n >= 1 && n <= 600))].sort((a, b) => a - b).slice(0, 8);
    updateSettings({ timer: { presetsMin: clean } });
  };

  list.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-remove]') : null;
    if (!btn) return;
    save(getSettings().timer.presetsMin.filter((n) => n !== Number(btn.dataset.remove)));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Math.round(Number(field.value));
    if (!Number.isFinite(v) || v < 1 || v > 600) { field.focus(); return; }
    const cur = getSettings().timer.presetsMin;
    if (cur.length >= 8 && !cur.includes(v)) {
      showNote(root, '');
      field.setCustomValidity('Up to 8 presets');
      field.reportValidity();
      field.setCustomValidity('');
      return;
    }
    save([...cur, v]);
    field.value = '';
  });
  field.addEventListener('keydown', (e) => e.stopPropagation());

  syncers.push((s) => {
    const arr = s.timer.presetsMin;
    const key = arr.join(',');
    if (key === lastKey) return;
    lastKey = key;
    list.innerHTML = arr.length
      ? arr.map((n) => `<span class="chip set-preset"><span>${n}m</span><button type="button" class="set-preset__x" data-remove="${n}" aria-label="Remove ${n} minute preset">${icon('close', { size: 11, stroke: 2.2 })}</button></span>`).join('')
      : '<span class="faint set-empty">No presets yet</span>';
    form.querySelector('button').disabled = false;
  });
}

async function wireThemes(root) {
  const grid = root.querySelector('[data-themes]');
  if (!grid) return;
  let themes = FALLBACK_THEMES;
  try {
    const mod = await import('../fx/themes.js');
    if (mod.THEMES && Object.keys(mod.THEMES).length) themes = mod.THEMES;
  } catch (err) {
    console.warn('[aura] themes module unavailable, using fallback list', err);
  }
  grid.innerHTML = Object.entries(themes).map(([key, t]) => {
    const [a, b, c] = t.swatch || FALLBACK_THEMES.aurora.swatch;
    return `
      <button type="button" class="set-theme" data-theme="${key}" aria-pressed="false" style="--t1:${a};--t2:${b};--t3:${c}">
        <span class="set-theme__preview" aria-hidden="true"><span class="set-theme__check">${icon('check', { size: 13, stroke: 2.4 })}</span></span>
        <span class="set-theme__name">${esc(t.name || key)}</span>
        <span class="set-theme__tag serif">${esc(t.tagline || '')}</span>
      </button>`;
  }).join('');
  const sync = (s) => {
    grid.querySelectorAll('[data-theme]').forEach((btn) => {
      const on = btn.dataset.theme === s.theme;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  };
  grid.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-theme]') : null;
    if (btn) setPath('theme', btn.dataset.theme);
  });
  syncers.push(sync);
  sync(getSettings());
}

function wireSlider(root) {
  root.querySelectorAll('[data-slider]').forEach((input) => {
    const path = input.dataset.slider;
    const out = input.parentElement.querySelector('[data-slider-out]');
    const paint = (v) => {
      const pct = clamp(Number(v), 0, 1) * 100;
      input.style.setProperty('--fill', `${pct}%`);
      if (out) out.textContent = `${Math.round(pct)}%`;
    };
    input.addEventListener('input', () => {
      paint(input.value);
      setPath(path, Number(input.value));
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    syncers.push((s) => {
      const v = get(s, path);
      if (document.activeElement !== input) input.value = String(v);
      paint(v);
    });
  });
}

function wireSegmented(root) {
  root.querySelectorAll('[data-segmented]').forEach((seg) => {
    const path = seg.dataset.segmented;
    const btns = [...seg.querySelectorAll('[data-value]')];
    seg.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-value]') : null;
      if (b) setPath(path, b.dataset.value);
    });
    seg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      next.focus();
      setPath(path, next.dataset.value);
    });
    syncers.push((s) => {
      const v = get(s, path);
      btns.forEach((b) => {
        const on = b.dataset.value === v;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
    });
  });
}

function twoStep(btn, action) {
  const label = btn.querySelector('span');
  const original = btn.dataset.label || label.textContent;
  let timer = 0;
  const reset = () => {
    clearTimeout(timer);
    btn.classList.remove('btn--danger');
    label.textContent = original;
    btn.dataset.armed = '';
  };
  btn.addEventListener('click', async () => {
    if (btn.dataset.armed) {
      reset();
      await action();
      return;
    }
    btn.dataset.armed = '1';
    btn.classList.add('btn--danger');
    label.textContent = 'Click again to confirm';
    timer = setTimeout(reset, 3000);
  });
  btn.addEventListener('blur', reset);
}

export async function exportAll() {
  let extra = {};
  try {
    const mod = await import('../features/stats.js');
    extra = mod.exportData?.() || {};
  } catch (err) {
    console.warn('[aura] stats export unavailable', err);
  }
  const payload = { exportedAt: new Date().toISOString(), settings: getSettings(), ...extra };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.href = url;
  a.download = `aura-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireActions(root) {
  root.querySelector('[data-go="sound"]')?.addEventListener('click', () => openPanel('sound'));
  root.querySelector('[data-go="schedule"]')?.addEventListener('click', () => {
    closePanel();
    setMode('schedule');
  });
  root.querySelector('[data-shortcuts]')?.addEventListener('click', () => openShortcuts());
  root.querySelector('[data-export]')?.addEventListener('click', () => { exportAll(); });

  const stats = root.querySelector('[data-confirm="stats"]');
  if (stats) {
    twoStep(stats, async () => {
      try {
        const mod = await import('../features/stats.js');
        mod.clearStats?.();
      } catch (err) {
        console.error('[aura] clearStats failed', err);
      }
    });
  }
  const defaults = root.querySelector('[data-confirm="defaults"]');
  if (defaults) twoStep(defaults, () => resetSettings());
}

export function initSettingsPanel(root) {
  if (!root) {
    console.warn('[aura] settings root missing');
    return;
  }
  syncers.length = 0;
  root.classList.add('set-root');
  root.innerHTML = render();

  wireSteppers(root);
  wireSwitches(root);
  wireNotifications(root);
  wirePresets(root);
  wireSlider(root);
  wireSegmented(root);
  wireActions(root);
  wireThemes(root);
  import('./account-card.js')
    .then((m) => m.mountAccountCard(root.querySelector('[data-account]')))
    .catch((err) => console.error('[aura] account card failed', err));

  const syncAll = (s = getSettings()) => syncers.forEach((fn) => {
    try { fn(s); } catch (err) { console.error('[aura] settings sync failed', err); }
  });
  syncAll();
  bus.on('settings:changed', ({ settings }) => syncAll(settings));
}
