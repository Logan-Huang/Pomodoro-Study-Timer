// Aura audio engine: every sound is synthesized with the Web Audio API.
import { bus } from '../core/bus.js';
import { getSettings, updateSettings } from '../core/settings.js';

const AMBIENTS = ['none', 'rain', 'ocean', 'wind', 'brown', 'pink', 'fire'];
const FOCUS_PHASES = ['focus', 'countdown', 'stopwatch'];

let ctx = null;
let master = null;
let comp = null;
let ambientBus = null;
let gate = null;
let analyser = null;
let active = null; // { kind, layer }
let lastState = null;
let unlocked = false;
let lastChimeAt = 0;
let inited = false;
const noiseCache = new Map();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const curve = (v) => Math.pow(clamp01(v), 1.6);
const soundSettings = () => getSettings().sound || {};

/* ---------------------------------------------------------------- context */

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: 'playback' });
  } catch {
    ctx = null;
    return null;
  }
  master = ctx.createGain();
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 24;
  comp.ratio.value = 4;
  comp.attack.value = 0.01;
  comp.release.value = 0.28;
  master.connect(comp);
  comp.connect(ctx.destination);

  ambientBus = ctx.createGain();
  gate = ctx.createGain();
  gate.connect(ambientBus);
  ambientBus.connect(master);

  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  ambientBus.connect(analyser);

  applyVolumes(true);
  updateGate(true);
  return ctx;
}

function applyVolumes(immediate = false) {
  if (!ctx) return;
  const s = soundSettings();
  const t = ctx.currentTime;
  const set = (param, v) => {
    if (immediate) param.setValueAtTime(v, t);
    else param.setTargetAtTime(v, t, 0.06);
  };
  set(master.gain, curve(s.volume ?? 0.7));
  set(ambientBus.gain, curve(s.ambientVolume ?? 0.35));
}

function gateOpen() {
  if (!soundSettings().ambientOnlyWhileFocus) return true;
  return !!lastState && lastState.status === 'running' && FOCUS_PHASES.includes(lastState.phase);
}

function updateGate(immediate = false) {
  if (!ctx || !gate) return;
  const v = gateOpen() ? 1 : 0;
  const t = ctx.currentTime;
  if (immediate) gate.gain.setValueAtTime(v, t);
  else gate.gain.setTargetAtTime(v, t, 0.4);
}

/* ------------------------------------------------------------------ noise */

function noiseBuffer(type) {
  const cached = noiseCache.get(type);
  if (cached && cached.sampleRate === ctx.sampleRate) return cached;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 8);
  const xf = Math.floor(sr * 0.08); // crossfade region for a seamless loop
  const total = len + xf;
  const buf = ctx.createBuffer(2, len, sr);
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(total);
    if (type === 'white') {
      for (let i = 0; i < total; i++) raw[i] = Math.random() * 2 - 1;
    } else if (type === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < total; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      let last = 0;
      for (let i = 0; i < total; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last * 3.5;
      }
    }
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = raw[i];
    for (let i = 0; i < xf; i++) {
      const a = (i / xf) * Math.PI * 0.5;
      d[i] = raw[i] * Math.sin(a) + raw[len + i] * Math.cos(a);
    }
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const scale = peak > 0 ? 0.8 / peak : 1;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] *= scale;
  }
  noiseCache.set(type, buf);
  return buf;
}

/* --------------------------------------------------------- graph helpers */

const amp = (v) => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};

const biq = (type, freq, q = 0.707) => {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
};

function chain(first, ...rest) {
  let cur = first;
  for (const n of rest) {
    cur.connect(n);
    cur = n;
  }
  return cur;
}

function newLayer() {
  return { out: ctx.createGain(), srcs: [], dead: false };
}

function noiseSrc(L, type, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(type);
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(0, Math.random() * s.buffer.duration * 0.9);
  L.srcs.push(s);
  return s;
}

function lfo(L, freq, depth, param) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = amp(depth);
  o.connect(g);
  g.connect(param);
  o.start();
  L.srcs.push(o);
  return o;
}

function randomLoop(L, fn, minMs, maxMs) {
  const step = () => {
    if (L.dead) return;
    try {
      if (!document.hidden) fn();
    } catch (e) {
      console.warn('[aura] ambient event failed', e);
    }
    setTimeout(step, rand(minMs, maxMs));
  };
  setTimeout(step, rand(minMs, maxMs));
}

function panner(pan) {
  if (!ctx.createStereoPanner) return null;
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

/* ---------------------------------------------------------- ambient beds */

function droplet(dest) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = rand(1400, 4200);
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * rand(1.3, 1.9), t + 0.03);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(rand(0.008, 0.04), t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.03, 0.09));
  o.connect(g);
  const p = panner(rand(-0.8, 0.8));
  if (p) {
    g.connect(p);
    p.connect(dest);
  } else {
    g.connect(dest);
  }
  o.start(t);
  o.stop(t + 0.14);
}

function crackle(dest, big = false) {
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(big ? 'brown' : 'white');
  const dur = big ? rand(0.08, 0.16) : rand(0.006, 0.03);
  const f = biq(big ? 'lowpass' : 'bandpass', big ? 220 : rand(900, 5200), big ? 0.7 : rand(0.8, 3));
  const g = ctx.createGain();
  const peak = big ? rand(0.4, 0.8) : rand(0.12, 0.6);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  const p = panner(rand(-0.7, 0.7));
  if (p) {
    g.connect(p);
    p.connect(dest);
  } else {
    g.connect(dest);
  }
  s.start(t, rand(0, 6), dur + 0.02);
}

const BUILDERS = {
  rain(L) {
    const bed = amp(0.55);
    bed.connect(L.out);
    chain(noiseSrc(L, 'pink'), biq('highpass', 600, 0.5), biq('lowpass', 9000), amp(0.9), bed);
    chain(noiseSrc(L, 'pink', 1.07), biq('bandpass', 2400, 0.55), amp(0.8), bed);
    chain(noiseSrc(L, 'brown'), biq('bandpass', 380, 0.7), amp(0.9), bed);
    randomLoop(L, () => droplet(L.out), 35, 210);
  },

  ocean(L) {
    const swell = amp(0.5);
    swell.connect(L.out);
    lfo(L, 0.085, 0.38, swell.gain);
    lfo(L, 0.031, 0.12, swell.gain);
    const lp = biq('lowpass', 600, 0.6);
    lfo(L, 0.085, 330, lp.frequency);
    chain(noiseSrc(L, 'brown'), lp, amp(1.7), swell);
    const foam = amp(0.12);
    lfo(L, 0.079, 0.1, foam.gain);
    chain(noiseSrc(L, 'pink', 0.93), biq('highpass', 1800), biq('lowpass', 7000), foam, L.out);
  },

  wind(L) {
    const bp = biq('bandpass', 520, 1.3);
    lfo(L, 0.11, 240, bp.frequency);
    lfo(L, 0.043, 140, bp.frequency);
    lfo(L, 0.07, 0.6, bp.Q);
    const gust = amp(0.6);
    lfo(L, 0.052, 0.35, gust.gain);
    lfo(L, 0.021, 0.15, gust.gain);
    chain(noiseSrc(L, 'pink'), bp, amp(2.6), gust, L.out);

    const bp2 = biq('bandpass', 1150, 2);
    lfo(L, 0.083, 320, bp2.frequency);
    lfo(L, 0.029, 0.7, bp2.Q);
    const gust2 = amp(0.35);
    lfo(L, 0.037, 0.25, gust2.gain);
    chain(noiseSrc(L, 'pink', 1.1), bp2, amp(1.5), gust2, L.out);
  },

  fire(L) {
    chain(noiseSrc(L, 'brown'), biq('lowpass', 320, 0.7), amp(1.6), L.out);
    const roar = amp(0.4);
    lfo(L, 0.37, 0.12, roar.gain);
    chain(noiseSrc(L, 'pink', 0.8), biq('bandpass', 240, 0.6), roar, L.out);
    randomLoop(
      L,
      () => {
        const n = Math.random() < 0.28 ? Math.floor(rand(2, 5)) : 1;
        for (let i = 0; i < n; i++) setTimeout(() => !L.dead && crackle(L.out), i * rand(12, 60));
        if (Math.random() < 0.1) crackle(L.out, true);
      },
      70,
      430,
    );
  },

  brown(L) {
    chain(noiseSrc(L, 'brown'), biq('highpass', 30), biq('lowpass', 900, 0.5), amp(1.6), L.out);
  },

  pink(L) {
    chain(noiseSrc(L, 'pink'), biq('highpass', 40), biq('lowpass', 5500, 0.5), amp(0.9), L.out);
  },
};

// Loudness trims so beds sit at a similar perceived level (measured RMS spread was ~11 dB;
// brighter beds get less boost since high frequencies read louder).
const AMBIENT_TRIM = { rain: 1.6, wind: 1.4, pink: 1.25, ocean: 1, brown: 1, fire: 1 };

function stopLayer(L) {
  const t = ctx.currentTime;
  try {
    L.out.gain.cancelScheduledValues(t);
    L.out.gain.setValueAtTime(L.out.gain.value, t);
    L.out.gain.linearRampToValueAtTime(0, t + 1.2);
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    L.dead = true;
    for (const s of L.srcs) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    try {
      L.out.disconnect();
    } catch {
      /* ignore */
    }
  }, 1400);
}

function applyAmbient() {
  if (!ctx || !unlocked) return;
  let want = soundSettings().ambient || 'none';
  if (!AMBIENTS.includes(want)) want = 'none';
  if (active ? active.kind === want : want === 'none') return;
  if (active) {
    stopLayer(active.layer);
    active = null;
  }
  if (want === 'none') return;
  const build = BUILDERS[want];
  if (!build) return;
  const L = newLayer();
  try {
    build(L);
  } catch (e) {
    console.warn('[aura] ambient build failed', e);
    L.dead = true;
    return;
  }
  const t = ctx.currentTime;
  L.out.gain.setValueAtTime(0, t);
  L.out.gain.linearRampToValueAtTime(AMBIENT_TRIM[want] ?? 1, t + 1.2);
  L.out.connect(gate);
  active = { kind: want, layer: L };
}

/* ----------------------------------------------------------------- chimes */

function partial(dest, freq, t, { gain, attack = 0.005, decay, type = 'sine', detune = 0 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

// Output bus with an optional feedback echo; nodes are released after the tail.
function chimeRig(tail, { delay = 0, fb = 0, wet = 0 } = {}) {
  const bus_ = ctx.createGain();
  bus_.connect(master);
  const nodes = [bus_];
  if (delay > 0) {
    const d = ctx.createDelay(1);
    d.delayTime.value = delay;
    const f = amp(fb);
    const lp = biq('lowpass', 3800);
    const w = amp(wet);
    bus_.connect(d);
    d.connect(lp);
    lp.connect(f);
    f.connect(d);
    lp.connect(w);
    w.connect(master);
    nodes.push(d, lp, f, w);
  }
  setTimeout(() => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }, (tail + 0.6) * 1000);
  return bus_;
}

const CHIMES = {
  crystal(t) {
    const out = chimeRig(4.5, { delay: 0.28, fb: 0.34, wet: 0.32 });
    const notes = [1046.5, 1318.5, 1568, 2093];
    const parts = [
      [1, 1, 1.6],
      [2.01, 0.3, 1.1],
      [3.98, 0.12, 0.8],
      [5.43, 0.05, 0.5],
    ];
    notes.forEach((f, i) => {
      const at = t + i * 0.13;
      for (const [ratio, g, dec] of parts) {
        partial(out, f * ratio, at, { gain: 0.13 * g, decay: dec, attack: 0.006 });
      }
    });
  },

  bell(t) {
    const out = chimeRig(6.5, { delay: 0.21, fb: 0.24, wet: 0.2 });
    const f0 = 293.66;
    const parts = [
      [1, 0.2, 5.5],
      [2.756, 0.12, 3.6],
      [5.404, 0.07, 2.2],
      [8.933, 0.04, 1.3],
    ];
    for (const [r, g, dec] of parts) partial(out, f0 * r, t, { gain: g, decay: dec, attack: 0.004 });
    partial(out, f0 * 1.003, t, { gain: 0.07, decay: 5, attack: 0.004 });
  },

  marimba(t) {
    const out = chimeRig(1.6);
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const at = t + i * 0.15;
      partial(out, f, at, { gain: 0.22, decay: 0.55, attack: 0.006 });
      partial(out, f * 4, at, { gain: 0.07, decay: 0.12, attack: 0.004 });
      partial(out, f * 10, at, { gain: 0.015, decay: 0.04, attack: 0.002 });
    });
  },

  soft(t) {
    const out = chimeRig(2.4);
    const lp = biq('lowpass', 1600, 0.3);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(1, t + 0.75);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    lp.connect(env);
    env.connect(out);
    for (const f of [261.63, 329.63, 392, 523.25]) {
      for (const cents of [-5, 5]) {
        const o = ctx.createOscillator();
        const g = amp(0.055);
        o.type = 'sine';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(g);
        g.connect(lp);
        o.start(t);
        o.stop(t + 2);
      }
    }
  },
};

export function playChime(kind) {
  const k = kind || soundSettings().chime || 'crystal';
  if (k === 'none') return;
  const fn = CHIMES[k];
  if (!fn) return;
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  lastChimeAt = performance.now();
  try {
    fn(c.currentTime + 0.04);
  } catch (e) {
    console.warn('[aura] chime failed', e);
  }
}

function blip(f0, f1, dur, gain) {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const t = c.currentTime + 0.01;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function playUi(kind) {
  if (!soundSettings().uiSounds) return;
  if (kind === 'start') blip(520, 780, 0.16, 0.05);
  else if (kind === 'pause') blip(640, 420, 0.16, 0.045);
  else if (kind === 'tap') blip(900, 860, 0.05, 0.03);
}

/* ----------------------------------------------------------------- public */

export function setAmbient(kind) {
  const k = AMBIENTS.includes(kind) ? kind : 'none';
  updateSettings({ sound: { ambient: k } });
  applyAmbient();
}

export function getAnalyser() {
  return analyser;
}

function onTimerState(s) {
  const prev = lastState;
  lastState = s;
  updateGate();
  if (!prev || !s) return;
  const chimedRecently = performance.now() - lastChimeAt < 1500;
  if (s.status === 'running' && prev.status !== 'running' && !chimedRecently) {
    playUi('start');
  } else if (s.status === 'paused' && prev.status === 'running') {
    playUi('pause');
  }
}

function unlock() {
  const c = ensureCtx();
  if (!c) return;
  c.resume()
    .then(() => {
      if (c.state === 'running') {
        for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
          window.removeEventListener(ev, unlock, true);
        }
      }
    })
    .catch(() => {});
  if (!unlocked) {
    unlocked = true;
    updateGate(true);
    applyAmbient();
  }
}

export function initAudio() {
  if (inited) return;
  inited = true;
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  }
  import('../timer/engine.js')
    .then((m) => {
      if (!lastState && m.timer) lastState = m.timer.getState();
    })
    .catch(() => {});

  bus.on('timer:state', onTimerState);
  bus.on('timer:complete', (rec) => {
    if (rec && rec.natural) playChime();
  });
  bus.on('settings:changed', () => {
    applyVolumes();
    updateGate();
    applyAmbient();
  });
}
