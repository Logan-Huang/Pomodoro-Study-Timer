// Aura timer view: the ring, the digits, the controls.
// DOM is built once; updates only touch nodes whose value changed.

import { bus } from '../core/bus.js';
import { load, save } from '../core/storage.js';
import { getSettings } from '../core/settings.js';
import { getMode, isReducedMotion } from '../core/state.js';
import { timer } from '../timer/engine.js';
import { icon } from './icons.js';

const R = 158;
const CIRC = 2 * Math.PI * R;
const TICKS = 120;
const CX = 200;

const PHASE_ICON = { focus: 'brain', short: 'coffee', long: 'leaf', countdown: 'hourglass', stopwatch: 'stopwatch' };
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/* ---------- formatting ---------- */

const pad = (n) => String(n).padStart(2, '0');

function clockString(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function durLabel(ms) {
  const totalMin = Math.round(ms / 60000);
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

function parseClock(text) {
  const v = String(text).trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(parseFloat(v) * 60000) || null;
  const parts = v.split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  const secs = n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  return secs > 0 ? secs * 1000 : null;
}

function ticksMarkup() {
  let out = '';
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2;
    const major = i % 10 === 0;
    const r1 = 176;
    const r2 = major ? 192 : 184;
    const s = Math.sin(a);
    const c = Math.cos(a);
    out += `<line class="tv-tick${major ? ' tv-tick--major' : ''}" x1="${(CX + r1 * s).toFixed(2)}" y1="${(CX - r1 * c).toFixed(2)}" x2="${(CX + r2 * s).toFixed(2)}" y2="${(CX - r2 * c).toFixed(2)}"/>`;
  }
  return out;
}

function template() {
  return `
<div class="tv">
  <div class="tv-top">
    <div class="segmented tv-modes" role="tablist" aria-label="Timer type" hidden>
      <button class="segmented__btn" role="tab" type="button" data-sub="countdown" aria-selected="false">Countdown</button>
      <button class="segmented__btn" role="tab" type="button" data-sub="stopwatch" aria-selected="false">Stopwatch</button>
    </div>
    <div class="tv-phases" role="group" aria-label="Pomodoro phase" hidden>
      <button class="chip tv-phase-chip" type="button" data-phase="focus">Focus</button>
      <button class="chip tv-phase-chip" type="button" data-phase="short">Short break</button>
      <button class="chip tv-phase-chip" type="button" data-phase="long">Long break</button>
    </div>
    <div class="tv-plan" hidden>
      <span class="tv-plan__icon">${icon('calendar', { size: 16 })}</span>
      <span class="tv-plan__text"><span class="tv-plan__title"></span><span class="tv-plan__until"></span></span>
      <button class="btn-icon btn-icon--sm tv-plan__clear" type="button" data-action="clear-plan" aria-label="Clear plan" title="Clear plan">${icon('close', { size: 14 })}</button>
    </div>
    <p class="tv-schedule-hint" hidden>Pick a study block from your schedule to auto-plan it →</p>
  </div>

  <div class="tv-ring">
    <div class="tv-aura" aria-hidden="true"><div class="tv-aura__spin"></div></div>
    <div class="tv-pulse" aria-hidden="true"></div>
    <svg id="timer-ring" class="tv-svg" viewBox="0 0 400 400" role="img" aria-label="Timer progress">
      <defs>
        <linearGradient id="tv-grad" gradientUnits="userSpaceOnUse" x1="40" y1="360" x2="360" y2="40">
          <stop offset="0" style="stop-color:var(--accent)"/>
          <stop offset="0.5" style="stop-color:var(--accent-2)"/>
          <stop offset="1" style="stop-color:var(--accent-3)"/>
        </linearGradient>
        <filter id="tv-blur" filterUnits="userSpaceOnUse" x="-60" y="-60" width="520" height="520"><feGaussianBlur stdDeviation="9"/></filter>
        <filter id="tv-blur-sm" filterUnits="userSpaceOnUse" x="-60" y="-60" width="520" height="520"><feGaussianBlur stdDeviation="4"/></filter>
      </defs>
      <g class="tv-ticks">${ticksMarkup()}</g>
      <circle class="tv-track" cx="${CX}" cy="${CX}" r="${R}"/>
      <g class="tv-arcs" transform="rotate(-90 ${CX} ${CX})">
        <circle class="tv-arc tv-arc--glow" cx="${CX}" cy="${CX}" r="${R}" filter="url(#tv-blur)" stroke-dasharray="${CIRC} ${CIRC}"/>
        <circle class="tv-arc tv-arc--main" cx="${CX}" cy="${CX}" r="${R}" stroke-dasharray="${CIRC} ${CIRC}"/>
      </g>
      <g class="tv-orb" transform="translate(${CX} ${CX - R})">
        <circle class="tv-orb__halo" r="17"/>
        <circle class="tv-orb__glow" r="10" filter="url(#tv-blur-sm)"/>
        <circle class="tv-orb__core" r="5.5"/>
      </g>
    </svg>
    <div class="tv-center">
      <div class="tv-phase"><span class="tv-phase__icon"></span><span class="tv-phase__label"></span></div>
      <div class="tv-timewrap">
        <button class="tv-time" type="button" data-action="edit" disabled></button>
        <input class="input tv-edit" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="mm:ss" aria-label="Set countdown time" hidden>
      </div>
      <div class="tv-sub" data-hint="click to edit"></div>
      <div class="tv-dots" aria-hidden="true"></div>
    </div>
  </div>

  <div class="tv-controls">
    <button class="chip tv-adjust" type="button" data-adjust="-60000" aria-label="Subtract one minute">−1<small>m</small></button>
    <button class="btn-icon tv-reset" type="button" data-action="reset" aria-label="Reset" title="Reset">${icon('reset', { size: 20 })}</button>
    <button class="tv-play" type="button" data-action="toggle" aria-label="Start">
      <span class="tv-play__ring" aria-hidden="true"></span>
      <span class="tv-play__ripples" aria-hidden="true"></span>
      <span class="tv-play__icon tv-play__icon--play">${icon('play', { size: 30, stroke: 2.2 })}</span>
      <span class="tv-play__icon tv-play__icon--pause">${icon('pause', { size: 30, stroke: 2.2 })}</span>
    </button>
    <button class="btn-icon tv-skip" type="button" data-action="skip" aria-label="Skip to next" title="Skip">${icon('skip', { size: 20 })}</button>
    <button class="btn-icon tv-lap" type="button" data-action="lap" aria-label="Lap" title="Lap" hidden>${icon('flag', { size: 20 })}</button>
    <button class="chip tv-adjust" type="button" data-adjust="60000" aria-label="Add one minute">+1<small>m</small></button>
  </div>

  <div class="tv-presets" role="group" aria-label="Countdown presets" hidden></div>
  <div class="tv-strip" role="list" aria-label="Plan segments" hidden></div>
  <ol class="tv-laps" aria-label="Laps" hidden></ol>
  <p class="tv-hint">Press <kbd class="kbd">Space</kbd> to begin</p>
  <div class="tv-live sr-only" aria-live="polite" role="status"></div>
</div>`;
}

/* ---------- view ---------- */

export function initTimerView(root) {
  if (!root) {
    console.warn('[aura] timer view: mount element missing');
    return null;
  }
  root.classList.add('timer-root');
  root.innerHTML = template();
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => Array.from(root.querySelectorAll(sel));

  const ui = {
    modes: q('.tv-modes'),
    subBtns: qa('.tv-modes [data-sub]'),
    phases: q('.tv-phases'),
    phaseChips: qa('.tv-phase-chip'),
    plan: q('.tv-plan'),
    planTitle: q('.tv-plan__title'),
    planUntil: q('.tv-plan__until'),
    schedHint: q('.tv-schedule-hint'),
    ring: q('.tv-ring'),
    arcs: qa('.tv-arc'),
    arcGroup: q('.tv-arcs'),
    orb: q('.tv-orb'),
    ticks: qa('.tv-tick'),
    phaseIcon: q('.tv-phase__icon'),
    phaseLabel: q('.tv-phase__label'),
    timeWrap: q('.tv-timewrap'),
    time: q('.tv-time'),
    edit: q('.tv-edit'),
    sub: q('.tv-sub'),
    dots: q('.tv-dots'),
    adjusts: qa('.tv-adjust'),
    play: q('.tv-play'),
    ripples: q('.tv-play__ripples'),
    skip: q('.tv-skip'),
    lapBtn: q('.tv-lap'),
    presets: q('.tv-presets'),
    strip: q('.tv-strip'),
    laps: q('.tv-laps'),
    hint: q('.tv-hint'),
    live: q('.tv-live'),
  };

  const cache = {
    digits: '',
    cells: [],
    p: -1,
    sw: null,
    lit: 0,
    icon: '',
    dotCount: -1,
    presetKey: '',
    presetChips: [],
    stripKey: '',
    stripFills: [],
    lapKey: -1,
    orbHidden: null,
  };
  let hasStarted = false;
  let editing = false;
  let raf = 0;
  let completeTimer = 0;
  let pendingAnnounce = '';
  let lastKey = null;
  let announceFlip = false;
  let subSaved = '';

  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  const setHidden = (el, hide) => { if (el.hidden !== hide) el.hidden = hide; };

  /* ----- digits ----- */

  function makeChar(ch) {
    const s = document.createElement('span');
    s.className = 'tv-char';
    s.textContent = ch;
    return s;
  }

  function rebuildDigits(str) {
    ui.time.textContent = '';
    cache.cells = [];
    for (const ch of str) {
      const cell = document.createElement('span');
      cell.className = ch === ':' ? 'tv-digit tv-digit--sep' : 'tv-digit';
      cell.setAttribute('aria-hidden', 'true');
      const c = makeChar(ch);
      cell.appendChild(c);
      cell.cur = c;
      ui.time.appendChild(cell);
      cache.cells.push(cell);
    }
  }

  function setDigits(str) {
    if (str === cache.digits) return;
    const prev = cache.digits;
    cache.digits = str;
    ui.timeWrap.classList.toggle('is-long', str.length > 5);
    ui.time.setAttribute('aria-label', ui.time.disabled ? str : `Edit countdown, ${str}`);
    if (!prev || prev.length !== str.length) { rebuildDigits(str); return; }
    // Hidden tabs don't run CSS animations, so swap text instantly there too.
    const reduced = isReducedMotion() || document.hidden;
    for (let i = 0; i < str.length; i++) {
      if (prev[i] === str[i]) continue;
      const cell = cache.cells[i];
      if (reduced) {
        cell.querySelectorAll('.is-out').forEach((n) => n.remove());
        cell.cur.classList.remove('is-in');
        cell.cur.textContent = str[i];
        continue;
      }
      const old = cell.cur;
      const neu = makeChar(str[i]);
      old.classList.add('is-out');
      neu.classList.add('is-in');
      cell.appendChild(neu);
      cell.cur = neu;
      setTimeout(() => old.remove(), 460);
    }
  }

  /* ----- per-frame painting (cheap; guarded) ----- */

  function paintFrame(s) {
    const sw = s.engineMode === 'stopwatch';
    const digits = sw ? clockString(Math.floor(s.elapsedMs / 1000)) : clockString(Math.ceil(s.remainingMs / 1000));
    setDigits(digits);

    const p = s.progress;
    if (Math.abs(p - cache.p) > 1e-5 || sw !== cache.sw) {
      cache.p = p;
      cache.sw = sw;
      const len = sw ? p * CIRC : (1 - p) * CIRC;
      const dash = `${Math.max(0, len).toFixed(2)} ${CIRC.toFixed(2)}`;
      const off = sw ? '0' : (-p * CIRC).toFixed(2);
      for (const arc of ui.arcs) {
        arc.setAttribute('stroke-dasharray', dash);
        arc.setAttribute('stroke-dashoffset', off);
      }
      ui.arcGroup.classList.toggle('is-empty', len < 0.6);
      const a = p * Math.PI * 2;
      ui.orb.setAttribute('transform', `translate(${(CX + R * Math.sin(a)).toFixed(2)} ${(CX - R * Math.cos(a)).toFixed(2)})`);

      const lit = Math.min(TICKS, Math.floor(p * TICKS + 1e-6));
      if (lit !== cache.lit) {
        const lo = Math.min(lit, cache.lit);
        const hi = Math.max(lit, cache.lit);
        for (let i = lo; i < hi; i++) ui.ticks[i].classList.toggle('is-on', i < lit);
        cache.lit = lit;
      }
    }

    if (s.engineMode === 'sequence' && cache.stripFills.length) {
      const fill = cache.stripFills[s.segmentIndex];
      if (fill && s.status !== 'done') fill.style.transform = `scaleX(${p.toFixed(4)})`;
    }
  }

  function loop() {
    raf = 0;
    if (document.hidden) return;
    const s = timer.getState();
    paintFrame(s);
    if (s.status === 'running') raf = requestAnimationFrame(loop);
  }

  function kick() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
  }

  /* ----- structural rendering (on state events) ----- */

  function subLine(s) {
    const ends = s.status === 'running' && s.endsAt ? `ends ${clockFmt.format(s.endsAt)}` : '';
    const paused = s.status === 'paused' ? 'Paused' : '';
    const tail = paused || ends;
    let base = '';
    if (s.engineMode === 'pomodoro') {
      if (s.phase === 'focus') base = `Session ${s.cycle + 1} of ${s.longBreakEvery}`;
      else if (s.phase === 'short') base = `Session ${Math.max(1, s.cycle)} of ${s.longBreakEvery} done`;
      else base = 'Set complete';
    } else if (s.engineMode === 'sequence') {
      const n = s.segments ? s.segments.length : 0;
      base = s.status === 'done' ? 'Plan complete' : `Block ${s.segmentIndex + 1} of ${n}`;
    } else if (s.engineMode === 'countdown') {
      base = s.status === 'done' ? "Time's up" : s.status === 'idle' ? 'Ready' : '';
    } else {
      base = s.status === 'idle' && !s.laps.length ? 'Ready' : `Lap ${s.laps.length + 1}`;
    }
    return [base, tail].filter(Boolean).join(' · ');
  }

  function renderTop(s, appMode) {
    const eng = s.engineMode;
    const kind = eng === 'sequence' ? 'plan'
      : appMode === 'schedule' ? 'hint'
      : eng === 'pomodoro' ? 'phases' : 'modes';
    setHidden(ui.modes, kind !== 'modes');
    setHidden(ui.phases, kind !== 'phases');
    setHidden(ui.plan, kind !== 'plan');
    setHidden(ui.schedHint, kind !== 'hint');

    if (kind === 'modes') {
      for (const b of ui.subBtns) {
        const on = b.dataset.sub === eng;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      }
    }
    if (eng === 'countdown' || eng === 'stopwatch') {
      if (subSaved !== eng) { subSaved = eng; if (appMode === 'timer') save('timerSub', eng); }
    }
    if (kind === 'phases') {
      for (const c of ui.phaseChips) {
        const on = c.dataset.phase === s.phase;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', String(on));
      }
    }
    if (kind === 'plan') {
      const m = s.meta || {};
      setText(ui.planTitle, m.title || 'Study plan');
      setText(ui.planUntil, m.endsAt ? `until ${clockFmt.format(m.endsAt)}` : '');
    }
  }

  function renderDots(s) {
    const show = s.engineMode === 'pomodoro';
    setHidden(ui.dots, !show);
    if (!show) return;
    const n = s.longBreakEvery;
    if (n !== cache.dotCount) {
      cache.dotCount = n;
      ui.dots.textContent = '';
      for (let i = 0; i < n; i++) {
        const d = document.createElement('span');
        d.className = 'tv-dot';
        ui.dots.appendChild(d);
      }
    }
    const dots = ui.dots.children;
    for (let i = 0; i < dots.length; i++) {
      const done = i < s.cycle;
      const current = i === s.cycle && s.phase === 'focus';
      dots[i].classList.toggle('is-done', done);
      dots[i].classList.toggle('is-current', current);
      dots[i].classList.toggle('is-pulsing', current && s.running);
    }
  }

  function renderPresets(s, appMode) {
    const show = appMode === 'timer' && s.engineMode === 'countdown';
    setHidden(ui.presets, !show);
    if (!show) return;
    const list = ((getSettings().timer || {}).presetsMin || []).filter((n) => n > 0);
    const key = list.join(',');
    if (key !== cache.presetKey) {
      cache.presetKey = key;
      ui.presets.textContent = '';
      cache.presetChips = list.map((min) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip tv-preset';
        b.dataset.min = String(min);
        b.textContent = durLabel(min * 60000);
        ui.presets.appendChild(b);
        return b;
      });
    }
    for (const b of cache.presetChips) {
      const on = Math.round(Number(b.dataset.min) * 60000) === s.totalMs;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  function segmentTitles(segs) {
    const counts = { focus: 0, short: 0, long: 0 };
    return segs.map((g) => {
      counts[g.phase] += 1;
      const base = g.label || `${{ focus: 'Focus', short: 'Break', long: 'Long break' }[g.phase]} ${counts[g.phase]}`;
      return `${base} · ${durLabel(g.durationMs)}`;
    });
  }

  function renderStrip(s) {
    const show = s.engineMode === 'sequence' && !!s.segments;
    setHidden(ui.strip, !show);
    if (!show) { cache.stripKey = ''; cache.stripFills = []; return; }
    const key = s.segments.map((g) => `${g.phase}:${g.durationMs}:${g.label || ''}`).join('|');
    if (key !== cache.stripKey) {
      cache.stripKey = key;
      ui.strip.textContent = '';
      const titles = segmentTitles(s.segments);
      cache.stripFills = s.segments.map((g, i) => {
        const seg = document.createElement('div');
        seg.className = `tv-strip__seg tv-strip__seg--${g.phase === 'focus' ? 'focus' : 'break'}`;
        seg.style.flex = `${g.durationMs} 1 0`;
        seg.title = titles[i];
        seg.setAttribute('role', 'listitem');
        seg.setAttribute('aria-label', titles[i]);
        const fill = document.createElement('span');
        fill.className = 'tv-strip__fill';
        seg.appendChild(fill);
        ui.strip.appendChild(seg);
        return fill;
      });
    }
    const segEls = ui.strip.children;
    for (let i = 0; i < segEls.length; i++) {
      const done = s.status === 'done' || i < s.segmentIndex;
      const current = !done && i === s.segmentIndex;
      segEls[i].classList.toggle('is-done', done);
      segEls[i].classList.toggle('is-current', current);
      segEls[i].classList.toggle('is-running', current && s.running);
      const f = cache.stripFills[i];
      if (done) f.style.transform = '';
      else if (!current) f.style.transform = 'scaleX(0)';
    }
  }

  function renderLaps(s) {
    const show = s.engineMode === 'stopwatch' && s.laps.length > 0;
    setHidden(ui.laps, !show);
    if (!show) { cache.lapKey = 0; return; }
    if (s.laps.length === cache.lapKey) return;
    const grew = s.laps.length > cache.lapKey && cache.lapKey > 0;
    cache.lapKey = s.laps.length;
    ui.laps.textContent = '';
    const fmt = (ms) => {
      const sec = ms / 1000;
      const m = Math.floor(sec / 60);
      return `${pad(m)}:${(sec % 60).toFixed(2).padStart(5, '0')}`;
    };
    const rows = s.laps.map((total, i) => ({ n: i + 1, split: total - (s.laps[i - 1] || 0), total })).reverse().slice(0, 6);
    rows.forEach((r, idx) => {
      const li = document.createElement('li');
      li.className = 'tv-lap-row' + (grew && idx === 0 ? ' is-new' : '');
      li.innerHTML = '<span class="tv-lap-row__n"></span><span class="tv-lap-row__split"></span><span class="tv-lap-row__total"></span>';
      li.children[0].textContent = `#${r.n}`;
      li.children[1].textContent = fmt(r.split);
      li.children[2].textContent = fmt(r.total);
      ui.laps.appendChild(li);
    });
  }

  function renderControls(s) {
    const sw = s.engineMode === 'stopwatch';
    for (const b of ui.adjusts) setHidden(b, sw);
    setHidden(ui.skip, sw);
    setHidden(ui.lapBtn, !sw);
    ui.lapBtn.disabled = !s.running;
    ui.play.classList.toggle('is-running', s.running);
    const label = s.running ? 'Pause' : s.status === 'paused' ? 'Resume' : s.status === 'done' ? 'Restart' : 'Start';
    if (ui.play.getAttribute('aria-label') !== label) ui.play.setAttribute('aria-label', label);
    ui.play.title = label;
    ui.adjusts.forEach((b) => { b.disabled = s.status === 'done'; });
  }

  function renderStatic(s) {
    const appMode = getMode();
    root.dataset.tvEngine = s.engineMode;
    root.dataset.tvStatus = s.status;
    root.dataset.tvPhase = s.phase;
    renderTop(s, appMode);

    const iconName = PHASE_ICON[s.phase] || 'clock';
    if (cache.icon !== iconName) {
      cache.icon = iconName;
      ui.phaseIcon.innerHTML = icon(iconName, { size: 20, stroke: 1.6 });
    }
    setText(ui.phaseLabel, s.label);
    setText(ui.sub, subLine(s));

    const editable = s.engineMode === 'countdown' && s.status === 'idle';
    if (ui.time.disabled === editable) {
      ui.time.disabled = !editable;
      cache.digits && ui.time.setAttribute('aria-label', editable ? `Edit countdown, ${cache.digits}` : cache.digits);
    }
    if (!editable && editing) endEdit(false);

    if (s.status === 'running') hasStarted = true;
    ui.hint.classList.toggle('is-hidden', hasStarted || s.status !== 'idle' || s.engineMode === 'sequence');
    ui.hint.hidden = appMode === 'schedule' && s.engineMode !== 'pomodoro';

    renderDots(s);
    renderPresets(s, appMode);
    renderStrip(s);
    renderLaps(s);
    renderControls(s);
  }

  /* ----- editing the countdown ----- */

  function beginEdit() {
    const s = timer.getState();
    if (editing || s.engineMode !== 'countdown' || s.status !== 'idle') return;
    editing = true;
    ui.timeWrap.classList.add('is-editing');
    ui.edit.hidden = false;
    ui.edit.value = cache.digits;
    ui.edit.classList.remove('is-invalid');
    ui.edit.focus();
    ui.edit.select();
  }

  function endEdit(apply) {
    if (!editing) return;
    if (apply) {
      const ms = parseClock(ui.edit.value);
      if (ms) timer.setCountdown(ms);
    }
    editing = false;
    ui.timeWrap.classList.remove('is-editing');
    ui.edit.hidden = true;
  }

  ui.edit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!parseClock(ui.edit.value)) {
        ui.edit.classList.remove('is-invalid');
        void ui.edit.offsetWidth;
        ui.edit.classList.add('is-invalid');
        return;
      }
      endEdit(true);
      ui.time.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endEdit(false);
      ui.time.focus();
    }
    e.stopPropagation();
  });
  ui.edit.addEventListener('blur', () => endEdit(true));

  /* ----- interaction ----- */

  function ripple(e) {
    if (isReducedMotion()) return;
    const rect = ui.play.getBoundingClientRect();
    const x = e.clientX ? e.clientX - rect.left : rect.width / 2;
    const y = e.clientY ? e.clientY - rect.top : rect.height / 2;
    const r = document.createElement('span');
    r.className = 'tv-ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    ui.ripples.appendChild(r);
    setTimeout(() => r.remove(), 750);
  }
  ui.play.addEventListener('pointerdown', ripple);

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    const { action, sub, phase, adjust, min } = t.dataset;
    if (action === 'toggle') timer.toggle();
    else if (action === 'reset') timer.reset();
    else if (action === 'skip') timer.skip();
    else if (action === 'lap') timer.lap();
    else if (action === 'edit') beginEdit();
    else if (action === 'clear-plan') timer.clearSequence();
    else if (sub) { save('timerSub', sub); subSaved = sub; timer.setEngineMode(sub); }
    else if (phase) timer.setPhase(phase);
    else if (adjust) timer.adjust(Number(adjust));
    else if (min) timer.setCountdown(Number(min) * 60000);
  });

  /* ----- accessibility announcements + completion moment ----- */

  function announce(text) {
    announceFlip = !announceFlip;
    ui.live.textContent = text + (announceFlip ? '' : ' ');
  }

  function announceChange(s) {
    const key = `${s.engineMode}|${s.phase}|${s.segmentIndex}|${s.status === 'done'}`;
    if (pendingAnnounce) {
      let text = pendingAnnounce;
      if (s.status === 'done') text += s.engineMode === 'sequence' ? ' Plan complete.' : '';
      else text += s.running ? ` ${s.label} started.` : ` ${s.label} ready.`;
      pendingAnnounce = '';
      announce(text);
    } else if (lastKey !== null && key !== lastKey) {
      announce(`${s.label} ${s.running ? 'started' : 'ready'}.`);
    }
    lastKey = key;
  }

  function celebrate() {
    root.classList.remove('tv-complete');
    void root.offsetWidth;
    root.classList.add('tv-complete');
    clearTimeout(completeTimer);
    completeTimer = setTimeout(() => root.classList.remove('tv-complete'), 1500);
  }

  /* ----- bus wiring ----- */

  function onState(s) {
    renderStatic(s);
    paintFrame(s);
    if (s.running) kick();
    announceChange(s);
  }

  bus.on('timer:state', onState);
  // Ticks (~4 Hz) keep the view current even when rAF is throttled (occluded/hidden windows).
  bus.on('timer:tick', (s) => { if (document.hidden) paintFrame(s); else if (!raf) kick(); });
  bus.on('timer:complete', (rec) => {
    if (!rec || !rec.natural) return;
    pendingAnnounce = `${rec.label} complete.`;
    celebrate();
  });
  bus.on('mode:change', () => renderStatic(timer.getState()));
  bus.on('settings:changed', () => {
    cache.presetKey = '';
    cache.dotCount = -1;
    renderStatic(timer.getState());
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const s = timer.getState();
    paintFrame(s);
    if (s.running) kick();
  });

  // Restore the last sub-mode remembered by the Timer tab (used by the segmented control).
  try { subSaved = load('timerSub', '') || ''; } catch { subSaved = ''; }

  const initial = timer.getState();
  renderStatic(initial);
  paintFrame(initial);
  lastKey = `${initial.engineMode}|${initial.phase}|${initial.segmentIndex}|${initial.status === 'done'}`;
  if (initial.running) kick();
  return { destroy() { if (raf) cancelAnimationFrame(raf); } };
}
