// Insights panel (#stats-root): goal ring, streak, weekly bars, heatmap, totals, tasks, recent.
import { bus } from '../core/bus.js';
import { getSettings } from '../core/settings.js';
import { icon } from './icons.js';
import { getSessions, getDaySummary, getStreak, getRange, getLiveMs, dateKey } from '../features/stats.js';

const HEAT_WEEKS = 16;
const KIND_ICON = { focus: 'brain', timer: 'hourglass', stopwatch: 'stopwatch' };
const KIND_LABEL = { focus: 'Pomodoro focus', timer: 'Timer', stopwatch: 'Stopwatch' };

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** "1h 05m" / "45m". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function bigDuration(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}<small>m</small>`;
  return `${h}<small>h</small> ${String(m).padStart(2, '0')}<small>m</small>`;
}

function goalLabel(min) {
  return min % 60 === 0 ? `${min / 60}h` : formatDuration(min * 60000);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortDate = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dayTip = (d, ms, n) =>
  `${shortDate(d)} · ${ms > 0 ? `${formatDuration(ms)} · ${plural(n, 'session')}` : 'No focus'}`;

function heroHtml(today, goalMin) {
  const R = 70;
  const C = 2 * Math.PI * R;
  const off = C * (1 - today.pct);
  const reached = today.goalMs > 0 && today.focusMs >= today.goalMs;
  return `
    <section class="st-card st-hero glass" aria-label="Today">
      <div class="st-section-head"><span class="section-title">Today</span>${
        reached ? `<span class="badge badge--success">${icon('check', { size: 12, stroke: 2.4 })} Goal reached</span>` : ''
      }</div>
      <div class="st-ring" style="--circ:${C.toFixed(2)};--off:${off.toFixed(2)}">
        <svg class="st-ring__svg" viewBox="0 0 176 176" aria-hidden="true">
          <defs>
            <linearGradient id="st-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style="stop-color:var(--accent)"/>
              <stop offset="1" style="stop-color:var(--accent-2)"/>
            </linearGradient>
          </defs>
          <circle class="st-ring__track" cx="88" cy="88" r="${R}"/>
          <circle class="st-ring__arc${today.focusMs <= 0 ? ' is-empty' : ''}" cx="88" cy="88" r="${R}" transform="rotate(-90 88 88)" stroke="url(#st-grad)"/>
        </svg>
        <div class="st-ring__center">
          <span class="st-big">${bigDuration(today.focusMs)}</span>
          <span class="st-ring__sub">of ${goalLabel(goalMin)} goal</span>
        </div>
      </div>
      <div class="st-hero__meta">
        <span class="st-pill">${plural(today.sessions, 'session')}</span>
        <span class="st-pill">${Math.round((today.goalMs > 0 ? today.focusMs / today.goalMs : 0) * 100)}% of goal</span>
      </div>
    </section>`;
}

function streakHtml(streak, todayMs) {
  const lit = streak.current > 0;
  let text;
  let sub;
  if (lit) {
    text = `<b>${streak.current}</b>-day streak`;
    sub = todayMs >= 60000 ? `Best · ${plural(streak.best, 'day')}` : `Focus today to keep it · Best ${streak.best}`;
  } else {
    text = 'No streak yet';
    sub = streak.best > 0 ? `Best · ${plural(streak.best, 'day')}` : 'A single minute of focus begins one';
  }
  return `
    <section class="st-card st-streak glass" aria-label="Streak">
      <span class="st-streak__flame${lit ? ' is-lit' : ''}">${icon('flame', { size: 22 })}</span>
      <div class="st-streak__text"><strong>${text}</strong><span>${sub}</span></div>
    </section>`;
}

function weekHtml(goalMs, todayKey) {
  const week = getRange(7);
  const max = Math.max(goalMs * 1.15, ...week.map((d) => d.focusMs), 60000);
  const bars = week
    .map((d, i) => {
      const tip = dayTip(d.date, d.focusMs, d.sessions);
      const label = d.date.toLocaleDateString(undefined, { weekday: 'short' });
      const h = d.focusMs > 0 ? Math.max(3, (d.focusMs / max) * 100) : 0;
      return `
        <div class="st-bar${d.dateKey === todayKey ? ' is-today' : ''}" tabindex="0" role="img" data-tip="${esc(tip)}" aria-label="${esc(tip)}" style="--h:${h.toFixed(1)}%;--i:${i}">
          <div class="st-bar__track"><div class="st-bar__fill"></div></div>
          <span class="st-bar__day">${label}</span>
        </div>`;
    })
    .join('');
  const goalLine =
    goalMs > 0
      ? `<div class="st-goal" style="--y:${((goalMs / max) * 100).toFixed(1)}%"><span>Goal</span></div>`
      : '';
  return `
    <section class="st-card glass" aria-label="Last 7 days">
      <div class="st-section-head"><span class="section-title">Last 7 days</span></div>
      <div class="st-week">
        <div class="st-week__tracks">${goalLine}</div>
        <div class="st-week__bars">${bars}</div>
      </div>
    </section>`;
}

function heatLevel(ms, goalMs) {
  if (ms < 60000) return 0;
  const g = goalMs > 0 ? goalMs : 7200000;
  const r = ms / g;
  if (r < 0.15) return 1;
  if (r < 0.4) return 2;
  if (r < 0.75) return 3;
  if (r < 1) return 4;
  return 5;
}

function heatHtml(goalMs) {
  const today = new Date();
  const weekdayIdx = (today.getDay() + 6) % 7; // Monday = 0
  const days = (HEAT_WEEKS - 1) * 7 + weekdayIdx + 1;
  const range = getRange(days);
  let cells = '';
  let months = '';
  let lastMonth = -1;
  for (let col = 0; col < HEAT_WEEKS; col++) {
    const first = range[col * 7];
    if (first && first.date.getMonth() !== lastMonth) {
      lastMonth = first.date.getMonth();
      months += `<span style="grid-column:${col + 1}">${first.date.toLocaleDateString(undefined, { month: 'short' })}</span>`;
    }
    for (let row = 0; row < 7; row++) {
      const d = range[col * 7 + row];
      if (!d) {
        cells += '<i class="st-cell is-future" aria-hidden="true"></i>';
        continue;
      }
      const lvl = heatLevel(d.focusMs, goalMs);
      cells += `<i class="st-cell" data-l="${lvl}" data-tip="${esc(dayTip(d.date, d.focusMs, d.sessions))}" style="--c:${col}"></i>`;
    }
  }
  let legend = '';
  for (let l = 0; l <= 5; l++) legend += `<i class="st-cell" data-l="${l}"></i>`;
  return `
    <section class="st-card glass" aria-label="Focus heatmap">
      <div class="st-section-head"><span class="section-title">Last ${HEAT_WEEKS} weeks</span></div>
      <div class="st-months" aria-hidden="true">${months}</div>
      <div class="st-heat" role="img" aria-label="Heatmap of daily focus over the last ${HEAT_WEEKS} weeks">${cells}</div>
      <div class="st-legend" aria-hidden="true"><span>Less</span>${legend}<span>More</span></div>
    </section>`;
}

function totalsHtml(sessions, liveMs = 0) {
  const logged = sessions.reduce((a, s) => a + s.durationMs, 0);
  const total = logged + liveMs;
  const avg = sessions.length ? logged / sessions.length : 0;
  const perDay = new Map();
  for (const s of sessions) {
    const k = dateKey(new Date(s.endedAt));
    perDay.set(k, (perDay.get(k) || 0) + s.durationMs);
  }
  let bestKey = null;
  let bestMs = 0;
  for (const [k, ms] of perDay) {
    if (ms > bestMs) {
      bestMs = ms;
      bestKey = k;
    }
  }
  const [y, m, d] = (bestKey || '2000-01-01').split('-').map(Number);
  const tile = (label, value, sub = '') =>
    `<div class="st-tile"><span class="st-tile__label">${label}</span><strong class="st-tile__value">${value}</strong>${
      sub ? `<span class="st-tile__sub">${sub}</span>` : ''
    }</div>`;
  return `
    <section class="st-card glass" aria-label="Totals">
      <div class="st-section-head"><span class="section-title">All time</span></div>
      <div class="st-tiles">
        ${tile('Focus time', formatDuration(total))}
        ${tile('Sessions', String(sessions.length))}
        ${tile('Avg. session', formatDuration(avg))}
        ${tile('Best day', formatDuration(bestMs), bestKey ? shortDate(new Date(y, m - 1, d)) : '')}
      </div>
    </section>`;
}

function topTasksHtml(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!s.taskTitle) continue;
    const key = s.taskId || s.taskTitle;
    const e = map.get(key) || { title: s.taskTitle, ms: 0 };
    e.ms += s.durationMs;
    e.title = s.taskTitle;
    map.set(key, e);
  }
  const top = [...map.values()].sort((a, b) => b.ms - a.ms).slice(0, 5);
  if (!top.length) return '';
  const max = top[0].ms;
  const rows = top
    .map(
      (t, i) => `
      <li class="st-task" style="--i:${i}">
        <div class="st-task__row"><span class="st-task__name">${esc(t.title)}</span><span class="st-task__time tabular">${formatDuration(t.ms)}</span></div>
        <div class="st-task__bar"><i style="--w:${((t.ms / max) * 100).toFixed(1)}%"></i></div>
      </li>`,
    )
    .join('');
  return `
    <section class="st-card glass" aria-label="Top tasks">
      <div class="st-section-head"><span class="section-title">Top tasks</span></div>
      <ul class="st-tasks">${rows}</ul>
    </section>`;
}

function whenLabel(ts, todayKey, yesterdayKey) {
  const d = new Date(ts);
  const k = dateKey(d);
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (k === todayKey) return `Today · ${t}`;
  if (k === yesterdayKey) return `Yesterday · ${t}`;
  return `${shortDate(d)} · ${t}`;
}

function recentHtml(sessions, todayKey) {
  const now = new Date();
  const yesterdayKey = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const rows = sessions
    .slice(-8)
    .reverse()
    .map(
      (s) => `
      <li class="st-recent__item">
        <span class="st-recent__icon">${icon(KIND_ICON[s.kind] || 'clock', { size: 16 })}</span>
        <div class="st-recent__main">
          <span class="st-recent__title">${esc(s.taskTitle || s.label || KIND_LABEL[s.kind] || 'Session')}</span>
          <span class="st-recent__when">${esc(whenLabel(s.endedAt, todayKey, yesterdayKey))}</span>
        </div>
        <span class="st-recent__dur tabular">${formatDuration(s.durationMs)}</span>
      </li>`,
    )
    .join('');
  return `
    <section class="st-card glass" aria-label="Recent sessions">
      <div class="st-section-head"><span class="section-title">Recent sessions</span></div>
      <ul class="st-recent">${rows}</ul>
    </section>`;
}

export function initStatsView(root) {
  if (!root) {
    console.warn('[aura] #stats-root missing; stats view skipped');
    return;
  }
  let open = false;

  function render(animate) {
    const goalMin = Number(getSettings().goals?.dailyFocusMin) || 0;
    const today = getDaySummary();
    const streak = getStreak();
    const sessions = getSessions();
    const todayKey = dateKey();
    let html = heroHtml(today, goalMin) + streakHtml(streak, today.focusMs);
    if (sessions.length === 0) {
      html += `
        <div class="st-empty empty-state">
          ${icon('stats', { size: 28, stroke: 1.5 })}
          <p class="serif">Your story begins with the first session.</p>
          <span class="faint">Focus for a minute or more and it will appear here.</span>
        </div>`;
    } else {
      html +=
        weekHtml(today.goalMs, todayKey) +
        heatHtml(today.goalMs) +
        totalsHtml(sessions, getLiveMs()) +
        topTasksHtml(sessions) +
        recentHtml(sessions, todayKey);
    }
    root.innerHTML = `<div class="st${animate ? '' : ' st--static'}">${html}<div class="st-tip" role="presentation"></div></div>`;
  }

  /* tooltips (delegated) */
  function showTip(target) {
    const host = root.querySelector('.st');
    const tip = root.querySelector('.st-tip');
    if (!host || !tip) return;
    tip.textContent = target.dataset.tip;
    tip.classList.add('is-on');
    const h = host.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const half = tip.offsetWidth / 2 + 6;
    const x = clamp(r.left + r.width / 2 - h.left, half, Math.max(half, h.width - half));
    tip.style.left = `${x}px`;
    tip.style.top = `${r.top - h.top - 8}px`;
  }
  const hideTip = () => root.querySelector('.st-tip')?.classList.remove('is-on');
  const tipTarget = (e) => (e.target.closest ? e.target.closest('[data-tip]') : null);

  root.addEventListener('pointerover', (e) => {
    const t = tipTarget(e);
    if (t) showTip(t);
  });
  root.addEventListener('pointerout', (e) => {
    if (tipTarget(e)) hideTip();
  });
  root.addEventListener('pointerdown', (e) => {
    const t = tipTarget(e);
    if (t) showTip(t);
    else hideTip();
  });
  root.addEventListener('focusin', (e) => {
    const t = tipTarget(e);
    if (t) showTip(t);
  });
  root.addEventListener('focusout', hideTip);

  bus.on('panel:open', ({ name } = {}) => {
    if (name !== 'stats') return;
    open = true;
    render(true);
  });
  bus.on('panel:close', ({ name } = {}) => {
    if (name === 'stats') open = false;
  });
  bus.on('stats:updated', () => open && render(false));
  bus.on('settings:changed', ({ patch } = {}) => {
    if (open && patch && patch.goals) render(false);
  });
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
