// Schedule mode UI: live day timeline, NOW hero card, calendar setup, options menu, status pill.
import { bus } from '../core/bus.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { setMode } from '../core/state.js';
import { icon } from './icons.js';
import { planBlock, summarizePlan, findFreeSlots, getNowContext } from '../calendar/planner.js';
import { GOOGLE_CLIENT_ID } from '../calendar/config.js';

const MIN = 60000;
const HOUR = 3600000;
const HOUR_PX = 64;
const BUFFER = 5 * MIN;
const PLAN_CAP = 4 * HOUR;
const MIN_PLAN = 10 * MIN;

// ---- helpers -------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#8b8fa8');
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtRange = (a, b) => `${fmtTime(a)} – ${fmtTime(b)}`;
const fmtHour = (h) => new Date(2000, 0, 1, h % 24).toLocaleTimeString([], { hour: 'numeric' });
const fmtDur = (ms) => {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (dayStart, n) => { const d = new Date(dayStart); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const clampInt = (v, lo, hi, fallback) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : fallback);
const safeLink = (u) => (/^https:\/\//i.test(u || '') ? u : '');

function timeAgo(ms) {
  const m = Math.floor((Date.now() - ms) / MIN);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Replace innerHTML only when it changed, keeping keyboard focus on the same control. */
function setHtml(el, html) {
  if (el.__html === html) return false;
  const a = document.activeElement;
  let sel = null;
  if (a && el.contains(a) && a.dataset?.act) {
    sel = `[data-act="${a.dataset.act}"]`;
    if (a.dataset.id) sel += `[data-id="${CSS.escape(a.dataset.id)}"]`;
    if (a.dataset.start) sel += `[data-start="${CSS.escape(a.dataset.start)}"]`;
  }
  el.innerHTML = html;
  el.__html = html;
  if (sel) { try { el.querySelector(sel)?.focus({ preventScroll: true }); } catch { /* element gone */ } }
  return true;
}

function describeError(err) {
  if (!err) return null;
  const origin = esc(location.origin);
  const code = String(err.code || '');
  const msg = String(err.message || '');
  if (code === 'file_protocol') return { title: 'Open Aura over http', body: 'Google sign-in does not work from a file. Run <code>npm start</code> and open <code>http://localhost:5173</code>.' };
  if (code === 'no_client_id') return { title: 'Client ID needed', body: 'Paste your Google OAuth Client ID above, or explore the demo day.' };
  if (code === 'expired') return { title: 'Session expired', body: 'Your Google session ended. Reconnect to bring your day back.' };
  if (code === 'popup_failed_to_open') return { title: 'Popup blocked', body: 'Your browser blocked the Google window. Allow popups for this site, then try again.' };
  if (code === 'popup_closed') return { title: 'Sign-in window closed', body: `The Google window closed before finishing. If it showed an origin error, add <code>${origin}</code> to Authorized JavaScript origins.` };
  if (code === 'access_denied') return { title: 'Access denied', body: 'Add your Google account as a Test user on the OAuth consent screen (Audience → Test users), then try again.' };
  if (code === 'gis_load') return { title: 'Google sign-in unavailable', body: esc(msg) };
  if (/invalid_client|origin_mismatch|redirect_uri|invalid_request|idpiframe/i.test(code + msg)) {
    return { title: 'Client ID or origin mismatch', body: `Check the Client ID and add <code>${origin}</code> to Authorized JavaScript origins for it in Google Cloud Console.` };
  }
  if (code === 'api_disabled') return { title: 'Calendar API is off', body: esc(msg) };
  return { title: 'Could not connect', body: esc(msg || 'Something went wrong talking to Google.') };
}

// ---- schedule view -------------------------------------------------------------------------

export function initScheduleView(root, service) {
  if (!root) { console.warn('[aura] #schedule-root not found; schedule view disabled'); return; }

  const ui = {
    menuOpen: false,
    expandedId: null,
    revealDetail: false,
    needsScroll: true,
    clientId: null,
    localError: null,
    preloaded: false,
    lastMinute: -1,
    entrySig: '',
  };
  let timerState = null;
  try { timerState = service.getTimerState?.() ?? null; } catch { timerState = null; }
  let timerSig = '';

  root.innerHTML = `
    <div class="sch" data-view="main">
      <div class="sch__setup"></div>
      <div class="sch__main">
        <div class="sch__head"></div>
        <div class="sch__now"></div>
        <div class="sch__allday"></div>
        <div class="sch__scroller"><div class="sch__tl"></div></div>
      </div>
      <div class="sch__menu glass glass--strong" role="dialog" aria-label="Schedule options" hidden></div>
    </div>`;
  const sch = root.querySelector('.sch');
  const refs = {
    setup: sch.querySelector('.sch__setup'),
    head: sch.querySelector('.sch__head'),
    now: sch.querySelector('.sch__now'),
    allday: sch.querySelector('.sch__allday'),
    scroller: sch.querySelector('.sch__scroller'),
    tl: sch.querySelector('.sch__tl'),
    menu: sch.querySelector('.sch__menu'),
  };

  const st = () => service.getState();
  const isSetupView = () => ['disconnected', 'error', 'connecting'].includes(st().status);

  // ---- data model ----
  function dayModel(now = Date.now()) {
    const day0 = startOfDay(now);
    const day1 = addDays(day0, 1);
    const day2 = addDays(day0, 2);
    const events = st().events || [];
    const overlaps = (e, a, b) => e.end > a && e.start < b;
    return {
      now, day0, day1, day2,
      today: events.filter((e) => overlaps(e, day0, day1)),
      tomorrow: events.filter((e) => e.start >= day1 && e.start < day2),
    };
  }

  function planWindow(start, end) {
    const e = Math.min(end, start + PLAN_CAP);
    return e - start >= MIN_PLAN ? { start, end: e } : null;
  }

  function freeWindow(now, ctx, day0, day1) {
    const dayEndMs = day0 + clampInt(getSettings().calendar?.dayEndHour, 1, 24, 23) * HOUR;
    const nextToday = ctx.next && ctx.next.start < day1 ? ctx.next : null;
    const end = nextToday ? nextToday.start - BUFFER : Math.max(dayEndMs, now + HOUR);
    return planWindow(now, end);
  }

  // ---- head ----
  function renderHead() {
    const s = st();
    const demo = s.status === 'demo';
    const html = `
      <div class="sch__row">
        <div class="sch__titles">
          <h2 class="sch__h">Today</h2>
          <p class="sch__date"></p>
        </div>
        <div class="sch__tools">
          <span class="badge badge--accent sch__src">${demo ? 'Demo day' : 'Google Calendar'}</span>
          <button class="btn-icon btn-icon--sm sch__refresh" type="button" data-act="refresh" aria-label="Refresh calendar" title="Refresh">${icon('refresh', { size: 16 })}</button>
          <button class="btn-icon btn-icon--sm sch__more${ui.menuOpen ? ' is-active' : ''}" type="button" data-act="menu" aria-label="Schedule options" aria-haspopup="dialog" aria-expanded="${ui.menuOpen}">${icon('more', { size: 16 })}</button>
        </div>
      </div>
      <p class="sch__sync faint"></p>`;
    if (setHtml(refs.head, html)) updateSyncUi();
  }

  function updateSyncUi() {
    const s = st();
    const date = refs.head.querySelector('.sch__date');
    const sync = refs.head.querySelector('.sch__sync');
    const refresh = refs.head.querySelector('.sch__refresh');
    if (date) date.textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if (refresh) refresh.classList.toggle('is-spinning', !!s.syncing);
    if (sync) {
      sync.textContent = s.syncing ? 'Syncing…'
        : s.status === 'demo' ? 'Sample schedule, refreshed daily'
          : s.lastSync ? `Synced ${timeAgo(s.lastSync)}` : '';
    }
  }

  // ---- NOW hero ----
  function studyHero(ev, now) {
    const settings = getSettings();
    const plan = planBlock(now, ev.end, settings.pomodoro);
    const sum = summarizePlan(plan);
    const left = Math.max(1, Math.ceil((ev.end - now) / MIN));
    const big = left < 60 ? String(left) : `${Math.floor(left / 60)}h ${String(left % 60).padStart(2, '0')}m`;
    const unit = left < 60 ? 'min left' : 'left';
    const pct = Math.min(100, Math.max(0, ((now - ev.start) / Math.max(1, ev.end - ev.start)) * 100));
    const firstFocus = plan.find((s) => s.phase === 'focus');
    const running = timerState?.engineMode === 'sequence' && timerState.meta?.eventId === ev.id && timerState.status !== 'done';
    const strip = plan.map((s) => `<span class="sch-strip__seg sch-strip__seg--${s.phase}" style="flex:${s.durationMs}" title="${esc(s.label)} · ${fmtDur(s.durationMs)}"></span>`).join('');
    const planText = plan.length
      ? `${sum.focusCount} × ${Math.round(firstFocus.durationMs / MIN)}m focus · ends ${fmtTime(ev.end)}`
      : `Only ${left} min left — too short for a full plan`;
    const cta = !plan.length ? ''
      : running ? `<span class="badge badge--accent sch-now__progress">${icon('play', { size: 12 })}In progress</span>`
        : `<button class="btn btn--primary" type="button" data-act="plan-current" data-id="${esc(ev.id)}">${icon('play', { size: 16 })}<span>Start focus plan</span></button>`;
    return `
      <div class="sch-now__eyebrow"><span class="cal-dot cal-dot--live"></span>Now · Study block</div>
      <h3 class="sch-now__title">${esc(ev.title)}</h3>
      <p class="sch-now__range tabular">${fmtRange(ev.start, ev.end)}</p>
      <div class="sch-now__left"><span class="sch-now__big tabular">${big}</span><span class="sch-now__unit">${unit}</span></div>
      <div class="sch-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Block progress"><span class="sch-bar__fill" style="width:${pct.toFixed(1)}%"></span></div>
      ${plan.length ? `<div class="sch-strip" aria-hidden="true">${strip}</div>` : ''}
      <div class="sch-now__foot"><span class="sch-now__plan">${planText}</span>${cta}</div>`;
  }

  function busyHero(ev, now, ctx, model) {
    const slot = findFreeSlots(model.today, ev.end, model.day1, { minMs: 20 * MIN, bufferMs: BUFFER })[0];
    return `
      <div class="sch-now__eyebrow sch-now__eyebrow--muted"><span class="cal-dot" style="--c:${safeColor(ev.color)}"></span>Busy</div>
      <h3 class="sch-now__title sch-now__title--sm">In ${esc(ev.title)} until ${fmtTime(ev.end)}</h3>
      <p class="sch-now__range tabular">${fmtDur(ev.end - now)} to go${slot ? ` · next free window ${fmtRange(slot.start, slot.end - BUFFER)}` : ''}</p>
      <div class="sch-now__foot"><button class="btn btn--sm" type="button" data-act="plan-next-free">${icon('sparkle', { size: 15 })}<span>Plan the next free window</span></button></div>`;
  }

  function freeHero(ctx, now, model) {
    const nextToday = ctx.next && ctx.next.start < model.day1 ? ctx.next : null;
    const win = freeWindow(now, ctx, model.day0, model.day1);
    const title = nextToday ? `Free until ${fmtTime(nextToday.start)}` : 'Free for the rest of today';
    const sub = nextToday ? fmtDur(nextToday.start - now) : 'Nothing else on the calendar';
    return `
      <div class="sch-now__eyebrow sch-now__eyebrow--muted"><span class="cal-dot cal-dot--free"></span>Open time</div>
      <h3 class="sch-now__title sch-now__title--sm">${title}</h3>
      <p class="sch-now__range tabular">${sub}</p>
      ${win ? `<div class="sch-now__foot"><button class="btn btn--primary btn--sm" type="button" data-act="plan-free">${icon('target', { size: 15 })}<span>Plan focus for this window</span></button></div>` : ''}`;
  }

  function renderNow() {
    const model = dayModel();
    const { now } = model;
    const ctx = getNowContext(st().events, now);
    const cur = ctx.current;
    const variant = cur ? (cur.kind === 'study' ? 'study' : 'busy') : 'free';
    const body = cur ? (cur.kind === 'study' ? studyHero(cur, now) : busyHero(cur, now, ctx, model)) : freeHero(ctx, now, model);
    const next = ctx.next;
    const nextRow = next ? `
      <div class="sch-next">
        <span class="sch-next__k">Up next</span>
        <span class="sch-next__t">${esc(next.title)}</span>
        <span class="sch-next__in tabular">${next.start >= model.day1 ? 'tomorrow ' + fmtTime(next.start) : 'in ' + fmtDur(next.start - now)}</span>
      </div>` : '';
    setHtml(refs.now, `<div class="sch-now glass sch-now--${variant}">${body}</div>${nextRow}`);
  }

  function renderAllDay() {
    const { today } = dayModel();
    const items = today.filter((e) => e.allDay);
    setHtml(refs.allday, items.length
      ? `<div class="sch-allday">${items.map((e) => `<span class="badge sch-allday__chip" style="--c:${safeColor(e.color)}"><span class="cal-dot" style="--c:${safeColor(e.color)}"></span>${esc(e.title)}</span>`).join('')}</div>`
      : '');
  }

  // ---- timeline ----
  function layoutColumns(items) {
    let cluster = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      const cols = [];
      for (const it of cluster) {
        let i = cols.findIndex((end) => end <= it.start);
        if (i < 0) { i = cols.length; cols.push(0); }
        cols[i] = it.end;
        it.col = i;
      }
      cluster.forEach((it) => { it.cols = cols.length; });
    };
    for (const it of items) {
      if (cluster.length && it.start >= clusterEnd) { flush(); cluster = []; clusterEnd = -Infinity; }
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.end);
    }
    if (cluster.length) flush();
    return items;
  }

  function tomorrowHtml(model) {
    const rows = model.tomorrow.map((e) => `
      <li class="sch-tmr__row"><span class="cal-dot" style="--c:${safeColor(e.color)}"></span><span class="sch-tmr__time tabular">${e.allDay ? 'All day' : fmtTime(e.start)}</span><span class="sch-tmr__title">${esc(e.title)}</span></li>`).join('');
    return rows ? `<section class="sch-tmr" aria-label="Tomorrow"><div class="section-title">Tomorrow</div><ul class="sch-tmr__list">${rows}</ul></section>` : '';
  }

  function renderTimeline() {
    const s = st();
    const model = dayModel();
    const { now, day0, day1 } = model;
    ui.lastMinute = Math.floor(now / MIN);

    if (s.syncing && !s.lastSync && !s.events.length) {
      setHtml(refs.tl, `<div class="sch-skel" aria-busy="true" aria-label="Loading your day">${'<span class="sch-skel__bar"></span>'.repeat(5)}</div>`);
      return;
    }
    if (!model.today.length) {
      setHtml(refs.tl, `
        <div class="empty-state sch-empty">
          ${icon('calendar', { size: 26 })}
          <p class="sch-empty__t serif">A wide-open day.</p>
          <p class="muted sch-empty__s">Nothing on the calendar. Carve out a focus block?</p>
          <button class="btn btn--primary btn--sm" type="button" data-act="plan-free">${icon('sparkle', { size: 15 })}<span>Plan the day</span></button>
        </div>${tomorrowHtml(model)}`);
      return;
    }

    const timed = model.today.filter((e) => !e.allDay);
    const cal = getSettings().calendar || {};
    let h0 = clampInt(cal.dayStartHour, 0, 23, 7);
    let h1 = clampInt(cal.dayEndHour, 1, 24, 23);
    if (h1 <= h0) { h0 = 7; h1 = 23; }
    for (const e of timed) {
      h0 = Math.min(h0, Math.floor((Math.max(e.start, day0) - day0) / HOUR));
      h1 = Math.max(h1, Math.ceil((Math.min(e.end, day1) - day0) / HOUR));
    }
    h0 = Math.max(0, h0);
    h1 = Math.min(24, Math.max(h1, h0 + 4));
    const rangeStart = day0 + h0 * HOUR;
    const rangeEnd = Math.min(day1, day0 + h1 * HOUR);
    const y = (ms) => ((ms - rangeStart) / HOUR) * HOUR_PX;
    const height = (h1 - h0) * HOUR_PX;

    const sig = `${timed.map((e) => e.id).join('|')}#${s.lastSync}`;
    const enter = sig !== ui.entrySig;
    ui.entrySig = sig;

    const hours = [];
    for (let h = h0; h <= h1; h += 1) hours.push(`<div class="sch-hr" style="top:${(h - h0) * HOUR_PX}px"><span class="sch-hr__label tabular">${fmtHour(h)}</span></div>`);

    const items = layoutColumns(timed
      .map((e) => ({ e, start: Math.max(e.start, rangeStart), end: Math.min(e.end, rangeEnd) }))
      .filter((it) => it.end > it.start)
      .sort((a, b) => a.start - b.start || b.end - a.end));

    const evHtml = items.map((it, i) => {
      const e = it.e;
      const top = y(it.start);
      const h = Math.max(((it.end - it.start) / HOUR) * HOUR_PX - 2, 24);
      const study = e.kind === 'study';
      const tiny = h < 40;
      const cls = ['sch-ev', study ? 'sch-ev--study' : 'sch-ev--busy', e.end <= now ? 'is-past' : '', tiny ? 'sch-ev--tiny' : '', enter ? 'is-enter' : '', ui.expandedId === e.id ? 'is-open' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" style="top:${top}px;height:${h}px;left:calc(${(it.col / it.cols) * 100}% + 0px);width:calc(${100 / it.cols}% - 4px);--ev:${safeColor(e.color)};--i:${Math.min(i, 14)}" data-act="event" data-id="${esc(e.id)}" aria-expanded="${ui.expandedId === e.id}" aria-label="${esc(e.title)}, ${fmtRange(e.start, e.end)}">
        <span class="sch-ev__title">${study && !tiny ? icon('book', { size: 13 }) : ''}<span>${esc(e.title)}</span></span>
        ${h >= 46 ? `<span class="sch-ev__time tabular">${fmtRange(e.start, e.end)}</span>` : ''}
      </button>`;
    }).join('');

    const slots = findFreeSlots(timed, Math.max(now, rangeStart), rangeEnd, { minMs: 20 * MIN, bufferMs: BUFFER });
    const slotHtml = slots.map((sl) => {
      const h = ((sl.end - sl.start) / HOUR) * HOUR_PX - 2;
      return `<div class="sch-slot" style="top:${y(sl.start)}px;height:${h}px">
        ${h >= 46 ? `<span class="sch-slot__label tabular">Free · ${fmtDur(sl.end - sl.start)}</span>` : ''}
        <button type="button" class="sch-slot__btn" data-act="plan-slot" data-start="${sl.start}" data-end="${sl.end}" aria-label="Plan focus from ${fmtTime(Math.max(now, sl.start))} to ${fmtTime(sl.end - BUFFER)}">${icon('plus', { size: 12, stroke: 2.2 })}<span>Focus</span></button>
      </div>`;
    }).join('');

    let detail = '';
    const open = ui.expandedId && items.find((it) => it.e.id === ui.expandedId);
    if (open) {
      const e = open.e;
      const planStart = Math.max(now, e.start);
      const canPlan = e.end - planStart >= MIN_PLAN;
      const link = safeLink(e.htmlLink);
      const evH = Math.max(((open.end - open.start) / HOUR) * HOUR_PX - 2, 24);
      detail = `<div class="sch-detail glass glass--strong" style="top:${y(open.start) + evH + 6}px;--ev:${safeColor(e.color)}" role="region" aria-label="Event details">
        <div class="sch-detail__head"><strong class="sch-detail__title">${esc(e.title)}</strong><button class="btn-icon btn-icon--sm" type="button" data-act="event-close" aria-label="Close details">${icon('close', { size: 14 })}</button></div>
        <p class="sch-detail__meta tabular">${fmtRange(e.start, e.end)} · ${fmtDur(e.end - e.start)}</p>
        ${e.location ? `<p class="sch-detail__loc">${icon('target', { size: 13 })}<span>${esc(e.location)}</span></p>` : ''}
        <div class="sch-detail__actions">
          ${canPlan ? `<button class="btn btn--primary btn--sm" type="button" data-act="plan-event" data-id="${esc(e.id)}">${icon('play', { size: 14 })}<span>Plan focus for this block</span></button>` : ''}
          ${link ? `<a class="btn btn--ghost btn--sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer"><span>Open in Google Calendar</span>${icon('external', { size: 14 })}</a>` : ''}
        </div>
      </div>`;
    }

    const nowLine = now >= rangeStart && now <= rangeEnd
      ? `<div class="sch-nowline" style="top:${y(now)}px" data-range="${rangeStart}"><span class="sch-nowline__dot"></span></div>` : '';

    const html = `<div class="sch-tl"><div class="sch-tl__inner" style="height:${height}px" data-range-start="${rangeStart}" data-range-end="${rangeEnd}">
        ${hours.join('')}
        <div class="sch-tl__grid">${slotHtml}${evHtml}${detail}</div>
        ${nowLine}
      </div></div>${tomorrowHtml(model)}`;
    const changed = setHtml(refs.tl, html);
    if (changed && ui.revealDetail) {
      ui.revealDetail = false;
      refs.tl.querySelector('.sch-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    applyScroll();
  }

  function updateNowLine() {
    const inner = refs.tl.querySelector('.sch-tl__inner');
    const line = refs.tl.querySelector('.sch-nowline');
    if (!inner || !line) return;
    const start = +inner.dataset.rangeStart;
    line.style.top = `${((Date.now() - start) / HOUR) * HOUR_PX}px`;
  }

  function applyScroll() {
    if (!ui.needsScroll || refs.scroller.clientHeight === 0) return;
    const line = refs.tl.querySelector('.sch-nowline');
    const first = refs.tl.querySelector('.sch-ev');
    const anchor = line || first;
    if (!anchor) return;
    const sr = refs.scroller.getBoundingClientRect();
    const y = anchor.getBoundingClientRect().top - sr.top + refs.scroller.scrollTop;
    refs.scroller.scrollTop = Math.max(0, y - refs.scroller.clientHeight * (line ? 0.3 : 0.1));
    ui.needsScroll = false;
  }

  // ---- setup / onboarding ----
  function renderSetup() {
    const s = st();
    const cfg = getSettings().calendar || {};
    if (ui.clientId === null) ui.clientId = cfg.clientId || GOOGLE_CLIENT_ID || '';
    const connecting = s.status === 'connecting';
    const err = describeError(ui.localError || s.error);
    const origin = esc(location.origin);
    const fileWarn = location.protocol === 'file:'
      ? `<div class="sch-err" role="alert"><strong>Open Aura over http</strong><p>Google sign-in does not work from a file. Run <code>npm start</code> and open <code>http://localhost:5173</code>.</p></div>` : '';
    const html = `
      <div class="sch-setup">
        <svg class="sch-art" viewBox="0 0 220 170" aria-hidden="true">
          <defs>
            <linearGradient id="sch-g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient>
            <radialGradient id="sch-g2"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></radialGradient>
          </defs>
          <circle cx="110" cy="85" r="78" fill="url(#sch-g2)"/>
          <circle cx="110" cy="85" r="66" fill="none" stroke="url(#sch-g1)" stroke-opacity=".55" stroke-width="1.2"/>
          <circle cx="110" cy="85" r="82" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1" stroke-dasharray="2 6"/>
          <g class="sch-orbit sch-orbit--a"><circle cx="176" cy="85" r="5" fill="url(#sch-g1)"/><circle cx="176" cy="85" r="10" fill="url(#sch-g1)" opacity=".25"/></g>
          <g class="sch-orbit sch-orbit--b"><circle cx="28" cy="85" r="3.5" fill="var(--accent-3)"/></g>
          <rect x="66" y="47" width="88" height="76" rx="14" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.28)"/>
          <path d="M66 68h88" stroke="rgba(255,255,255,.22)"/>
          <rect x="66.5" y="47.5" width="87" height="21" rx="13.5" fill="url(#sch-g1)" opacity=".55"/>
          <g fill="rgba(255,255,255,.28)">
            <rect x="77" y="78" width="12" height="10" rx="3"/><rect x="94" y="78" width="12" height="10" rx="3"/><rect x="111" y="78" width="12" height="10" rx="3"/><rect x="128" y="78" width="12" height="10" rx="3"/>
            <rect x="77" y="94" width="12" height="10" rx="3"/><rect x="128" y="94" width="12" height="10" rx="3"/>
            <rect x="77" y="108" width="12" height="7" rx="3"/><rect x="94" y="108" width="12" height="7" rx="3"/>
          </g>
          <rect x="94" y="94" width="29" height="10" rx="3" fill="url(#sch-g1)"/>
          <rect x="111" y="108" width="29" height="7" rx="3" fill="var(--accent-3)" opacity=".8"/>
        </svg>
        <h2 class="sch-setup__h">Sync your day</h2>
        <p class="sch-setup__p muted">Connect Google Calendar (read-only) and Aura will spot your study blocks, find free windows, and fit Pomodoro cycles exactly inside them.</p>
        ${fileWarn}
        <label class="field sch-setup__field">
          <span class="field__label">Google OAuth Client ID</span>
          <input class="input sch-setup__input" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="1234567890-abc.apps.googleusercontent.com" value="${esc(ui.clientId)}">
        </label>
        ${err ? `<div class="sch-err" role="alert"><strong>${err.title}</strong><p>${err.body}</p></div>` : ''}
        <div class="sch-setup__actions">
          <button class="btn btn--primary btn--lg btn--block" type="button" data-act="connect" ${connecting ? 'disabled' : ''}>${icon('google', { size: 18 })}<span>${connecting ? 'Waiting for Google…' : 'Connect Google Calendar'}</span></button>
          <button class="btn btn--ghost btn--block" type="button" data-act="demo">${icon('sparkle', { size: 16 })}<span>Explore a demo day</span></button>
        </div>
        <details class="sch-how">
          <summary>How do I get a Client ID?</summary>
          <ol class="sch-how__list">
            <li>Open the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> and create or pick a project.</li>
            <li>Go to APIs &amp; Services → Library and enable the <strong>Google Calendar API</strong>.</li>
            <li>Open the OAuth consent screen, choose <strong>External</strong>, fill in an app name, and add your own Google account as a <strong>Test user</strong>.</li>
            <li>Go to Credentials → Create credentials → <strong>OAuth client ID</strong> → Web application.</li>
            <li>Under <strong>Authorized JavaScript origins</strong> add <code>${origin}</code>. No redirect URI is needed.</li>
            <li>Copy the Client ID (it ends in <code>.apps.googleusercontent.com</code>) and paste it above.</li>
          </ol>
        </details>
      </div>`;
    // Google's sign-in script loads only for people who have set up Calendar (or start to, see
    // warmGoogle), so a plain visit makes no request to Google.
    if (setHtml(refs.setup, html) && getSettings().calendar?.clientId) warmGoogle();
  }

  function warmGoogle() {
    if (ui.preloaded || location.protocol === 'file:') return;
    ui.preloaded = true;
    service.preload?.();
  }

  // ---- options menu ----
  function keywordChips() {
    const kws = getSettings().calendar?.studyKeywords || [];
    return kws.map((k) => `<span class="cal-kw__chip">${esc(k)}<button type="button" data-act="kw-remove" data-kw="${esc(k)}" aria-label="Remove keyword ${esc(k)}">${icon('close', { size: 11, stroke: 2.2 })}</button></span>`).join('')
      || '<span class="faint">No keywords yet</span>';
  }

  function calendarRows() {
    const s = st();
    const ids = getSettings().calendar?.calendarIds || ['primary'];
    if (!s.calendars.length) return '<p class="faint cal-menu__note">Loading calendars…</p>';
    return s.calendars.map((c) => {
      const checked = ids.includes(c.id) || (c.primary && ids.includes('primary'));
      return `<label class="cal-cal"><input type="checkbox" data-cal="${esc(c.id)}" data-primary="${c.primary ? '1' : ''}" ${checked ? 'checked' : ''}><span class="cal-dot" style="--c:${safeColor(c.color)}"></span><span class="cal-cal__name">${esc(c.summary)}</span></label>`;
    }).join('');
  }

  function renderMenu() {
    const s = st();
    const cal = getSettings().calendar || {};
    const demo = s.status === 'demo';
    refs.menu.innerHTML = `
      ${demo ? '' : `<section class="cal-menu__sec"><div class="section-title">Calendars</div><div class="cal-menu__cals">${calendarRows()}</div></section>`}
      <section class="cal-menu__sec">
        <label class="switch"><input type="checkbox" class="switch__input" data-set="autoStartBlocks" ${cal.autoStartBlocks ? 'checked' : ''}><span class="switch__track" aria-hidden="true"></span><span class="switch__label">Auto-start study blocks</span></label>
        ${demo ? '' : `<label class="switch"><input type="checkbox" class="switch__input" data-set="logSessions" ${cal.logSessions ? 'checked' : ''}><span class="switch__track" aria-hidden="true"></span><span class="switch__label">Log focus sessions to Google Calendar</span></label>`}
        <div class="cal-menu__warn">
          <span class="cal-menu__warn-l">Warn before events</span>
          <div class="stepper"><button class="stepper__btn" type="button" data-step="-1" aria-label="Decrease minutes">−</button><input class="stepper__input input" type="number" min="0" max="30" value="${clampInt(cal.warnBeforeEventMin, 0, 30, 5)}" aria-label="Minutes to warn before an event"><button class="stepper__btn" type="button" data-step="1" aria-label="Increase minutes">+</button></div>
          <span class="faint">min</span>
        </div>
      </section>
      <section class="cal-menu__sec">
        <div class="section-title">Study keywords</div>
        <div class="cal-kw">${keywordChips()}</div>
        <form class="cal-kw-add" data-form="kw"><input class="input" type="text" maxlength="40" placeholder="Add keyword" aria-label="Add study keyword"><button class="btn btn--sm" type="submit">Add</button></form>
      </section>
      <button class="btn btn--danger btn--sm btn--block cal-menu__out" type="button" data-act="disconnect">${icon('logout', { size: 15 })}<span>${demo ? 'Exit demo' : 'Disconnect'}</span></button>`;
  }

  function openMenu() {
    ui.menuOpen = true;
    renderMenu();
    refs.menu.hidden = false;
    renderHead();
    refs.menu.querySelector('input,button')?.focus({ preventScroll: true });
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!ui.menuOpen) return;
    ui.menuOpen = false;
    refs.menu.hidden = true;
    renderHead();
    if (restoreFocus) refs.head.querySelector('.sch__more')?.focus({ preventScroll: true });
  }

  function saveKeywords(list) {
    updateSettings({ calendar: { studyKeywords: list } });
    const box = refs.menu.querySelector('.cal-kw');
    if (box) box.innerHTML = keywordChips();
  }

  // ---- actions ----
  const findEvent = (id) => (st().events || []).find((e) => e.id === id);

  async function runPlan(start, end, meta) {
    const win = planWindow(start, end);
    if (!win) { service.toast?.('That window is too short for a focus session.', { tone: 'warn', icon: 'clock' }); return; }
    await service.startPlan(win.start, win.end, meta);
  }

  function doConnect() {
    const input = refs.setup.querySelector('.sch-setup__input');
    const value = (input?.value ?? ui.clientId ?? '').trim();
    ui.clientId = value;
    ui.localError = null;
    if (value !== (getSettings().calendar?.clientId || '')) updateSettings({ calendar: { clientId: value } });
    if (location.protocol === 'file:') { ui.localError = { code: 'file_protocol' }; renderSetup(); return; }
    if (!value) { ui.localError = { code: 'no_client_id' }; renderSetup(); refs.setup.querySelector('.sch-setup__input')?.focus(); return; }
    service.connect(); // synchronous up to the OAuth popup, so the click gesture is preserved
  }

  function onAction(act, el, event) {
    const now = Date.now();
    switch (act) {
      case 'connect': doConnect(); break;
      case 'demo': ui.localError = null; ui.needsScroll = true; service.enableDemo(); break;
      case 'refresh': service.refresh(); break;
      case 'menu': ui.menuOpen ? closeMenu() : openMenu(); break;
      case 'disconnect': closeMenu(); ui.localError = null; service.disconnect(); break;
      case 'event': {
        const id = el.dataset.id;
        ui.expandedId = ui.expandedId === id ? null : id;
        ui.revealDetail = !!ui.expandedId;
        renderTimeline();
        break;
      }
      case 'event-close': ui.expandedId = null; renderTimeline(); break;
      case 'plan-event': {
        const ev = findEvent(el.dataset.id);
        if (ev) runPlan(Math.max(now, ev.start), ev.end, { source: 'calendar', eventId: ev.id, title: ev.title });
        break;
      }
      case 'plan-current': {
        const ev = findEvent(el.dataset.id);
        if (ev) runPlan(now, ev.end, { source: 'calendar', eventId: ev.id, title: ev.title });
        break;
      }
      case 'plan-slot': {
        const start = Math.max(now, +el.dataset.start);
        runPlan(start, +el.dataset.end - BUFFER, { source: 'calendar', title: 'Free window' });
        break;
      }
      case 'plan-free': {
        const model = dayModel(now);
        const ctx = getNowContext(st().events, now);
        const win = freeWindow(now, ctx, model.day0, model.day1);
        if (win) runPlan(win.start, win.end, { source: 'calendar', title: 'Focus window' });
        else service.toast?.('No room for a focus block right now.', { tone: 'warn', icon: 'clock' });
        break;
      }
      case 'plan-next-free': {
        const model = dayModel(now);
        const ctx = getNowContext(st().events, now);
        const from = ctx.current ? ctx.current.end : now;
        const slot = findFreeSlots(model.today, from, model.day1, { minMs: 20 * MIN, bufferMs: BUFFER })[0];
        if (slot) runPlan(Math.max(now, slot.start), slot.end - BUFFER, { source: 'calendar', title: 'Free window' });
        else service.toast?.('No free window left today.', { tone: 'info', icon: 'calendar' });
        break;
      }
      case 'kw-remove': {
        const kw = el.dataset.kw;
        saveKeywords((getSettings().calendar?.studyKeywords || []).filter((k) => k !== kw));
        break;
      }
      default: break;
    }
    event.stopPropagation?.();
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && root.contains(el)) { onAction(el.dataset.act, el, e); return; }
    const stepBtn = e.target.closest('.stepper__btn');
    if (stepBtn && refs.menu.contains(stepBtn)) {
      const input = stepBtn.parentElement.querySelector('.stepper__input');
      input.value = clampInt(+input.value + +stepBtn.dataset.step, 0, 30, 5);
      updateSettings({ calendar: { warnBeforeEventMin: +input.value } });
    }
  });

  // Showing interest in connecting loads Google's script early, so the sign-in popup opens straight from the click.
  for (const type of ['pointerenter', 'focusin', 'touchstart']) refs.setup.addEventListener(type, warmGoogle, { passive: true });

  refs.setup.addEventListener('input', (e) => {
    if (e.target.classList.contains('sch-setup__input')) ui.clientId = e.target.value;
  });
  refs.setup.addEventListener('change', (e) => {
    if (e.target.classList.contains('sch-setup__input')) {
      ui.clientId = e.target.value.trim();
      updateSettings({ calendar: { clientId: ui.clientId } });
    }
  });
  refs.setup.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('sch-setup__input')) { e.preventDefault(); doConnect(); }
  });

  refs.menu.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.cal !== undefined) {
      const ids = [...refs.menu.querySelectorAll('[data-cal]:checked')].map((i) => (i.dataset.primary ? 'primary' : i.dataset.cal));
      if (!ids.length) { t.checked = true; return; }
      service.setCalendars(ids);
    } else if (t.dataset.set === 'autoStartBlocks') {
      updateSettings({ calendar: { autoStartBlocks: t.checked } });
    } else if (t.dataset.set === 'logSessions') {
      if (!t.checked) { updateSettings({ calendar: { logSessions: false } }); return; }
      if (service.hasWriteScope?.()) { updateSettings({ calendar: { logSessions: true } }); return; }
      t.checked = false;
      const res = await service.connect({ write: true }); // called directly from the change gesture
      if (res?.ok) { updateSettings({ calendar: { logSessions: true } }); t.checked = true; }
      else service.toast?.(res?.error?.message || 'Write access was not granted.', { tone: 'warn', icon: 'calendar' });
    } else if (t.classList.contains('stepper__input')) {
      t.value = clampInt(t.value, 0, 30, 5);
      updateSettings({ calendar: { warnBeforeEventMin: +t.value } });
    }
  });

  refs.menu.addEventListener('submit', (e) => {
    if (e.target.dataset.form !== 'kw') return;
    e.preventDefault();
    const input = e.target.querySelector('input');
    const word = input.value.trim().toLowerCase();
    input.value = '';
    const list = getSettings().calendar?.studyKeywords || [];
    if (word && !list.includes(word)) saveKeywords([...list, word]);
    input.focus();
  });

  document.addEventListener('pointerdown', (e) => {
    if (ui.menuOpen && !refs.menu.contains(e.target) && !e.target.closest('.sch__more')) closeMenu();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.menuOpen) { e.stopPropagation(); closeMenu({ restoreFocus: true }); }
    else if (e.key === 'Escape' && ui.expandedId) { e.stopPropagation(); ui.expandedId = null; renderTimeline(); }
  });

  // ---- orchestration ----
  function renderAll() {
    const setup = isSetupView();
    sch.dataset.view = setup ? 'setup' : 'main';
    if (setup) {
      if (ui.menuOpen) { ui.menuOpen = false; refs.menu.hidden = true; }
      renderSetup();
      return;
    }
    renderHead();
    renderNow();
    renderAllDay();
    renderTimeline();
    updateSyncUi();
  }

  function guarded(fn) {
    return (...args) => { try { fn(...args); } catch (err) { console.error('[aura:schedule]', err); } };
  }

  const tick = guarded(() => {
    if (isSetupView() || document.hidden) return;
    updateSyncUi();
    renderNow();
    if (Math.floor(Date.now() / MIN) !== ui.lastMinute) { renderAllDay(); renderTimeline(); } else updateNowLine();
  });

  bus.on('calendar:status', guarded(() => {
    ui.needsScroll = true;
    ui.expandedId = null;
    if (!isSetupView()) ui.localError = null;
    renderAll();
  }));
  bus.on('calendar:updated', guarded(() => {
    if (isSetupView()) return;
    renderHead();
    renderNow();
    renderAllDay();
    renderTimeline();
    updateSyncUi();
    if (ui.menuOpen) { const box = refs.menu.querySelector('.cal-menu__cals'); if (box) box.innerHTML = calendarRows(); }
  }));
  bus.on('calendar:syncing', guarded(() => {
    if (isSetupView()) return;
    updateSyncUi();
    if (st().syncing && !st().lastSync) renderTimeline();
  }));
  bus.on('timer:state', guarded((s) => {
    timerState = s;
    const sig = `${s?.engineMode}|${s?.status}|${s?.meta?.eventId || ''}`;
    if (sig === timerSig) return;
    timerSig = sig;
    if (!isSetupView()) renderNow();
  }));
  bus.on('settings:changed', guarded(({ patch } = {}) => {
    if (isSetupView() || !patch) return;
    if (patch.calendar || patch.pomodoro) { renderNow(); renderTimeline(); }
  }));
  bus.on('mode:change', guarded(({ mode } = {}) => {
    if (mode === 'schedule') requestAnimationFrame(() => { applyScroll(); tick(); });
  }));

  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tick, 30000);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => applyScroll()).observe(refs.scroller);

  guarded(renderAll)();
}

// ---- status pill ---------------------------------------------------------------------------

export function initCalendarPill(el, service) {
  if (!el) { console.warn('[aura] #calendar-pill not found; pill disabled'); return; }

  function text() {
    const now = Date.now();
    const events = service.getState().events || [];
    const ctx = getNowContext(events, now);
    const tomorrow = addDays(startOfDay(now), 1);
    if (ctx.current) {
      const left = Math.max(1, Math.ceil((ctx.current.end - now) / MIN));
      return { kind: ctx.current.kind === 'study' ? 'live' : 'busy', label: `Now · ${ctx.current.title} · ${fmtDur(left * MIN)} left` };
    }
    if (ctx.next && ctx.next.start < tomorrow) {
      return { kind: 'next', label: `Next · ${ctx.next.title} in ${fmtDur(ctx.next.start - now)}` };
    }
    return { kind: 'free', label: 'Free for the rest of today' };
  }

  function render() {
    const status = service.getState().status;
    const visible = status === 'connected' || status === 'demo';
    el.hidden = !visible;
    if (!visible) { el.innerHTML = ''; el.__html = ''; return; }
    const { kind, label } = text();
    setHtml(el, `<button type="button" class="cal-pill glass" data-kind="${kind}" aria-label="${esc(label)}. Open schedule"><span class="cal-pill__dot" aria-hidden="true"></span><span class="cal-pill__text">${esc(label)}</span></button>`);
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('.cal-pill')) setMode('schedule');
  });
  const safe = () => { try { render(); } catch (err) { console.error('[aura:pill]', err); } };
  bus.on('calendar:updated', safe);
  bus.on('calendar:status', safe);
  setInterval(() => { if (!document.hidden) safe(); }, 30000);
  safe();
}
