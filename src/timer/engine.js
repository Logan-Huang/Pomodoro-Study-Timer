// Aura timer engine.
// Absolute-timestamp timekeeping (Date.now()); ticks only drive evaluation, never accumulate time.
//
// Internal model: while running, elapsed = base + (now - anchor). Pausing folds that into `base`.
// Skip rule: skipping a Focus segment counts toward the Pomodoro cycle only if elapsed >= 50% of planned.

import { bus } from '../core/bus.js';
import { load, save } from '../core/storage.js';
import { getSettings } from '../core/settings.js';

const MIN_MS = 1000;
const MAX_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 250;
const PERSIST_EVERY_MS = 5000;
const LATE_AUTOSTART_LIMIT_MS = 120000; // after a sleep/suspend longer than this, never auto-run the next segment
const ENGINE_MODES = ['pomodoro', 'countdown', 'stopwatch', 'sequence'];
const PHASES = ['focus', 'short', 'long', 'countdown', 'stopwatch'];
const STATUSES = ['idle', 'running', 'paused', 'done'];
const LABELS = { focus: 'Focus', short: 'Short break', long: 'Long break', countdown: 'Countdown', stopwatch: 'Stopwatch' };

const S = {
  engineMode: 'pomodoro',
  phase: 'focus',
  status: 'idle',
  totalMs: 25 * 60000,
  base: 0,
  anchor: 0,
  began: false,
  segStartedAt: null,
  cycle: 0,
  segmentIndex: 0,
  segments: null,
  meta: null,
  laps: [],
  lastCountdownMs: 0,
  changedAt: 0,
};

let inited = false;
let lastPersist = 0;

/* ---------- settings helpers ---------- */

function clampMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return MIN_MS;
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(n)));
}

function settingsSafe() {
  try { return getSettings() || {}; } catch { return {}; }
}

function pomMs(phase) {
  const p = settingsSafe().pomodoro || {};
  const raw = phase === 'focus' ? p.focusMin : phase === 'short' ? p.shortBreakMin : p.longBreakMin;
  const fallback = phase === 'focus' ? 25 : phase === 'short' ? 5 : 15;
  return clampMs((Number(raw) > 0 ? Number(raw) : fallback) * 60000);
}

function longEvery() {
  const n = Math.floor(Number((settingsSafe().pomodoro || {}).longBreakEvery));
  return n >= 1 ? n : 4;
}

function defaultCountdownMs() {
  const min = Number((settingsSafe().timer || {}).countdownMin);
  return clampMs((min > 0 ? min : 10) * 60000);
}

/* ---------- derived state ---------- */

function elapsedAt(now) {
  const raw = S.status === 'running' ? S.base + (now - S.anchor) : S.base;
  const v = Math.max(0, raw);
  return S.engineMode === 'stopwatch' ? v : Math.min(v, S.totalMs);
}

function labelOf() {
  if (S.engineMode === 'sequence') {
    const seg = S.segments && S.segments[S.segmentIndex];
    if (seg && seg.label) return seg.label;
  }
  return LABELS[S.phase] || 'Timer';
}

function buildState(now = Date.now()) {
  const sw = S.engineMode === 'stopwatch';
  const el = elapsedAt(now);
  const running = S.status === 'running';
  return {
    engineMode: S.engineMode,
    phase: S.phase,
    status: S.status,
    running,
    label: labelOf(),
    totalMs: sw ? 0 : S.totalMs,
    elapsedMs: el,
    remainingMs: sw ? 0 : Math.max(0, S.totalMs - el),
    progress: sw ? (el % 60000) / 60000 : S.totalMs > 0 ? Math.min(1, el / S.totalMs) : 0,
    startedAt: S.segStartedAt,
    endsAt: running && !sw ? S.anchor + (S.totalMs - S.base) : null,
    cycle: S.cycle,
    longBreakEvery: longEvery(),
    segmentIndex: S.engineMode === 'sequence' ? S.segmentIndex : 0,
    segments: S.segments,
    meta: S.meta,
    laps: S.laps.slice(),
  };
}

/* ---------- persistence ---------- */

function snapshot() {
  return {
    v: 1,
    engineMode: S.engineMode,
    phase: S.phase,
    status: S.status,
    totalMs: S.totalMs,
    base: S.base,
    anchor: S.anchor,
    began: S.began,
    segStartedAt: S.segStartedAt,
    cycle: S.cycle,
    segmentIndex: S.segmentIndex,
    segments: S.segments,
    meta: S.meta,
    laps: S.laps,
    lastCountdownMs: S.lastCountdownMs,
    changedAt: S.changedAt,
    savedAt: Date.now(),
  };
}

function persist() {
  lastPersist = Date.now();
  save('timer', snapshot());
}

// Validates a saved snapshot (local storage or another device) and loads it into S.
// Returns false, leaving S untouched, when the snapshot is unusable.
function assignSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return false;
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  const okMode = ENGINE_MODES.includes(snap.engineMode);
  const okPhase = PHASES.includes(snap.phase);
  if (!okMode || !okPhase || !STATUSES.includes(snap.status) || !(snap.totalMs >= 0)) return false;
  const segs = Array.isArray(snap.segments) ? normalizeSegments(snap.segments) : null;
  if (snap.engineMode === 'sequence' && (!segs || !segs.length)) return false;
  Object.assign(S, {
    engineMode: snap.engineMode,
    phase: snap.phase,
    status: snap.status,
    totalMs: num(snap.totalMs),
    base: num(snap.base),
    anchor: num(snap.anchor),
    began: !!snap.began,
    segStartedAt: Number.isFinite(snap.segStartedAt) ? snap.segStartedAt : null,
    cycle: Math.max(0, Math.floor(num(snap.cycle))),
    segmentIndex: 0,
    segments: snap.engineMode === 'sequence' ? segs : null,
    meta: snap.engineMode === 'sequence' && snap.meta && typeof snap.meta === 'object' ? snap.meta : null,
    laps: Array.isArray(snap.laps) ? snap.laps.filter(Number.isFinite) : [],
  });
  if (S.engineMode === 'sequence') S.segmentIndex = Math.min(Math.max(0, Math.floor(num(snap.segmentIndex))), S.segments.length - 1);
  if (Number.isFinite(snap.lastCountdownMs) && snap.lastCountdownMs >= MIN_MS) S.lastCountdownMs = clampMs(snap.lastCountdownMs);
  if (S.status === 'running' && !S.anchor) S.status = 'paused';
  S.changedAt = Number.isFinite(snap.changedAt) ? snap.changedAt : num(snap.savedAt);
  return true;
}

function restore() {
  S.lastCountdownMs = defaultCountdownMs();
  if (!assignSnapshot(load('timer', null))) {
    S.totalMs = pomMs('focus');
    return;
  }

  // A running segment whose end passed while the app was closed completes now and the next one waits idle.
  if (S.status === 'running' && S.engineMode !== 'stopwatch') {
    const now = Date.now();
    const end = S.anchor + (S.totalMs - S.base);
    if (now >= end) finish({ natural: true, skipped: false, at: end, now, allowRun: false });
  }
  if (S.engineMode === 'pomodoro') refreshIdleDuration();
}

/* ---------- segment transitions ---------- */

function enter(phase, totalMs) {
  S.phase = phase;
  S.totalMs = totalMs;
  S.base = 0;
  S.anchor = 0;
  S.status = 'idle';
  S.began = false;
  S.segStartedAt = null;
}

function enterSeq(i) {
  const seg = S.segments[i];
  enter(seg.phase, seg.durationMs);
  S.segmentIndex = i;
  S.cycle = S.segments.slice(0, i).filter((g) => g.phase === 'focus').length;
}

function refreshIdleDuration() {
  if (S.engineMode === 'pomodoro' && S.status === 'idle' && S.base === 0 && !S.began) {
    const ms = pomMs(S.phase);
    if (ms !== S.totalMs) { S.totalMs = ms; return true; }
  }
  return false;
}

function normalizeSegments(list) {
  return list
    .filter((g) => g && ['focus', 'short', 'long'].includes(g.phase) && Number(g.durationMs) >= MIN_MS)
    .map((g) => {
      const seg = { phase: g.phase, durationMs: Math.min(MAX_MS, Math.round(Number(g.durationMs))) };
      if (typeof g.label === 'string' && g.label) seg.label = g.label;
      return seg;
    });
}

function completionRecord(natural, skipped, elapsed, endedAt) {
  return {
    phase: S.phase,
    engineMode: S.engineMode,
    label: labelOf(),
    plannedMs: S.engineMode === 'stopwatch' ? 0 : S.totalMs,
    elapsedMs: Math.round(elapsed),
    startedAt: S.segStartedAt,
    endedAt,
    natural,
    skipped,
    meta: S.meta,
  };
}

// Emit a partial (unfinished) completion when at least one second was spent on the current segment.
function emitPartial(skipped = false, now = Date.now()) {
  if (S.status !== 'running' && S.status !== 'paused') return;
  const el = elapsedAt(now);
  if (el >= 1000) bus.emit('timer:complete', completionRecord(false, skipped, el, now));
}

// Decide what follows the current segment. Mutates S; returns { run, seqDone }.
function advance({ natural, wasRunning, elapsed, at, allowRun }) {
  let run = false;
  let seqDone = false;
  const p = settingsSafe().pomodoro || {};

  if (S.engineMode === 'pomodoro') {
    if (S.phase === 'focus') {
      const counts = natural || elapsed >= 0.5 * S.totalMs;
      if (counts) S.cycle += 1;
      const next = counts && S.cycle >= longEvery() ? 'long' : 'short';
      enter(next, pomMs(next));
      run = natural ? !!p.autoStartBreaks && allowRun : wasRunning;
    } else {
      if (S.phase === 'long') S.cycle = 0;
      enter('focus', pomMs('focus'));
      run = natural ? !!p.autoStartFocus && allowRun : wasRunning;
    }
  } else if (S.engineMode === 'countdown') {
    if (natural) {
      S.status = 'done';
      S.base = S.totalMs;
    } else {
      enter('countdown', S.totalMs);
    }
  } else if (S.engineMode === 'sequence') {
    const next = S.segmentIndex + 1;
    if (next < S.segments.length) {
      enterSeq(next);
      run = natural ? allowRun : wasRunning;
    } else {
      S.status = 'done';
      S.base = S.totalMs;
      seqDone = true;
    }
  }

  if (run) {
    S.status = 'running';
    S.anchor = at;
    S.began = true;
    S.segStartedAt = at;
  }
  return { run, seqDone };
}

// End the current segment (naturally or by skip), emit events in contract order, then advance.
function finish({ natural, skipped, at, now, allowRun = true }) {
  const wasRunning = S.status === 'running';
  const active = wasRunning || S.status === 'paused';
  const elapsed = natural ? S.totalMs : elapsedAt(now);
  if (natural || (active && elapsed >= 1000)) {
    bus.emit('timer:complete', completionRecord(natural, skipped, elapsed, at));
  }
  const res = advance({ natural, wasRunning, elapsed, at, allowRun });
  if (res.seqDone) bus.emit('timer:sequence-complete', { meta: S.meta, segments: S.segments });
  commit();
  if (res.run) emitPhaseStart();
}

function emitPhaseStart() {
  bus.emit('timer:phase-start', {
    phase: S.phase,
    engineMode: S.engineMode,
    label: labelOf(),
    durationMs: S.engineMode === 'stopwatch' ? 0 : S.totalMs,
    segmentIndex: S.engineMode === 'sequence' ? S.segmentIndex : 0,
    meta: S.meta,
  });
}

// `userChange` marks a real change of timer state (start, pause, skip, a segment ending...). Its time
// (changedAt) decides which device wins when synced devices disagree; periodic saves don't bump it.
function commit(userChange = true) {
  if (userChange) S.changedAt = Date.now();
  syncTicker();
  persist();
  bus.emit('timer:state', buildState());
}

/* ---------- ticker (Web Worker with interval fallback) ---------- */

let worker = null;
let fallbackId = 0;

function startTicker() {
  if (worker || fallbackId) return;
  try {
    const src = "let id=0;onmessage=e=>{if(e.data==='start'){if(!id)id=setInterval(()=>postMessage('tick')," + TICK_MS + ")}else{clearInterval(id);id=0}}";
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = onTick;
    w.onerror = () => {
      try { w.terminate(); } catch { /* ignore */ }
      if (worker === w) {
        worker = null;
        if (S.status === 'running' && !fallbackId) fallbackId = setInterval(onTick, TICK_MS);
      }
    };
    w.postMessage('start');
    worker = w;
  } catch {
    fallbackId = setInterval(onTick, TICK_MS);
  }
}

function stopTicker() {
  if (worker) {
    try { worker.postMessage('stop'); worker.terminate(); } catch { /* ignore */ }
    worker = null;
  }
  if (fallbackId) { clearInterval(fallbackId); fallbackId = 0; }
}

function syncTicker() {
  if (S.status === 'running') startTicker();
  else stopTicker();
}

function evaluate(now) {
  let guard = 0;
  while (S.status === 'running' && S.engineMode !== 'stopwatch' && guard++ < 50) {
    const end = S.anchor + (S.totalMs - S.base);
    if (now < end) break;
    finish({ natural: true, skipped: false, at: end, now, allowRun: now - end <= LATE_AUTOSTART_LIMIT_MS });
  }
}

function onTick() {
  if (S.status !== 'running') { syncTicker(); return; }
  const now = Date.now();
  evaluate(now);
  if (S.status !== 'running') return;
  if (now - lastPersist >= PERSIST_EVERY_MS) persist();
  bus.emit('timer:tick', buildState(now));
}

/* ---------- public API ---------- */

export const timer = {
  getState() { return buildState(); },

  setEngineMode(mode) {
    if (!['pomodoro', 'countdown', 'stopwatch'].includes(mode) || S.engineMode === mode) return;
    emitPartial();
    S.segments = null;
    S.meta = null;
    S.laps = [];
    S.engineMode = mode;
    S.cycle = 0;
    if (mode === 'pomodoro') enter('focus', pomMs('focus'));
    else if (mode === 'countdown') enter('countdown', S.lastCountdownMs || defaultCountdownMs());
    else enter('stopwatch', 0);
    commit();
  },

  setPhase(phase) {
    if (S.engineMode !== 'pomodoro' || !['focus', 'short', 'long'].includes(phase)) return;
    emitPartial();
    enter(phase, pomMs(phase));
    commit();
  },

  start() {
    if (S.status === 'running') return;
    const now = Date.now();
    if (S.status === 'done') {
      if (S.engineMode === 'sequence') enterSeq(0);
      else { S.base = 0; S.status = 'idle'; S.began = false; S.segStartedAt = null; }
    }
    const first = !S.began;
    S.status = 'running';
    S.anchor = now;
    if (first) { S.began = true; S.segStartedAt = now; }
    commit();
    if (first) emitPhaseStart();
  },

  pause() {
    if (S.status !== 'running') return;
    S.base = elapsedAt(Date.now());
    S.status = 'paused';
    commit();
  },

  resume() {
    if (S.status === 'paused') timer.start();
  },

  toggle() {
    if (S.status === 'running') timer.pause();
    else timer.start();
  },

  reset() {
    const now = Date.now();
    if (S.engineMode === 'pomodoro' && S.status === 'idle' && S.base === 0 && S.totalMs === pomMs(S.phase)) {
      // Already idle at full duration: a second reset returns to Focus, cycle 0.
      if (S.phase !== 'focus' || S.cycle !== 0) {
        enter('focus', pomMs('focus'));
        S.cycle = 0;
        commit();
      }
      return;
    }
    emitPartial(false, now);
    if (S.engineMode === 'pomodoro') enter(S.phase, pomMs(S.phase));
    else if (S.engineMode === 'countdown') enter('countdown', S.lastCountdownMs || S.totalMs);
    else if (S.engineMode === 'stopwatch') { enter('stopwatch', 0); S.laps = []; }
    else if (S.engineMode === 'sequence') enterSeq(S.segmentIndex);
    commit();
  },

  skip() {
    if (S.engineMode === 'stopwatch') return;
    if (S.engineMode === 'sequence' && S.status === 'done') return;
    const now = Date.now();
    finish({ natural: false, skipped: true, at: now, now, allowRun: true });
  },

  setCountdown(ms) {
    const v = clampMs(ms);
    emitPartial();
    if (S.engineMode !== 'countdown') {
      S.segments = null;
      S.meta = null;
      S.laps = [];
      S.cycle = 0;
      S.engineMode = 'countdown';
    }
    S.lastCountdownMs = v;
    enter('countdown', v);
    commit();
  },

  adjust(deltaMs) {
    if (S.engineMode === 'stopwatch' || S.status === 'done' || !Number.isFinite(deltaMs)) return;
    const el = elapsedAt(Date.now());
    let next = clampMs(S.totalMs + deltaMs);
    next = Math.min(MAX_MS, Math.max(next, Math.ceil(el) + MIN_MS));
    if (next === S.totalMs) return;
    S.totalMs = next;
    if (S.engineMode === 'countdown' && S.status === 'idle') S.lastCountdownMs = next;
    if (S.engineMode === 'sequence' && S.segments) {
      S.segments = S.segments.map((g, i) => (i === S.segmentIndex ? { ...g, durationMs: next } : g));
    }
    commit();
  },

  lap() {
    if (S.engineMode !== 'stopwatch' || S.status !== 'running') return;
    S.laps.push(Math.round(elapsedAt(Date.now())));
    commit();
  },

  loadSequence(segments, meta = {}, { autoStart = false } = {}) {
    const segs = normalizeSegments(Array.isArray(segments) ? segments : []);
    if (!segs.length) return;
    emitPartial();
    S.engineMode = 'sequence';
    S.segments = segs;
    S.meta = meta && typeof meta === 'object' ? { ...meta } : {};
    S.laps = [];
    enterSeq(0);
    commit();
    if (autoStart) timer.start();
  },

  clearSequence() {
    if (S.engineMode !== 'sequence') return;
    emitPartial();
    S.segments = null;
    S.meta = null;
    S.engineMode = 'pomodoro';
    S.cycle = 0;
    enter('focus', pomMs('focus'));
    commit();
  },

  emitState() {
    bus.emit('timer:state', buildState());
  },

  /** The persisted snapshot (absolute timestamps), used to sync the timer across devices. */
  exportSnapshot() {
    return snapshot();
  },

  /**
   * Adopts a snapshot from another device. Timestamps are absolute, so a running timer continues
   * at the right point; if its end has already passed, the next tick completes it as usual.
   */
  applyRemote(snap) {
    if (!assignSnapshot(snap)) return false;
    commit(false);
    return true;
  },
};

/** Restore persisted state, wire listeners. Idempotent. */
export function initEngine() {
  if (inited) return;
  inited = true;
  restore();
  bus.on('settings:changed', ({ patch } = {}) => {
    const changed = refreshIdleDuration();
    if (changed || (patch && patch.pomodoro)) commit(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.status === 'running') onTick();
  });
  window.addEventListener('pagehide', persist);
  commit(false);
}

try { S.totalMs = pomMs('focus'); } catch { /* settings not ready yet */ }
