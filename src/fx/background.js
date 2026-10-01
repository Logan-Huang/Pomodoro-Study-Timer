// Living night sky + per-theme nature scenery, rendered in two WebGL passes (see shader.js):
// the sky into an offscreen texture, then the active scene program over it.
//
// Scene programs are big, and a first-time compile on Windows (D3D) can take many seconds, so they
// compile in the background (KHR_parallel_shader_compile) while the plain sky shows, then fade in.
// Browsers cache compiled programs on disk, so later loads are near-instant; once the active scene
// is up we quietly pre-compile the others so switching themes is instant too.

import { VERT, buildSkyShader, buildSceneShader } from './shader.js';
import { SCENE_KEYS, sceneKey, sceneSource } from './scenes/index.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const DEFAULT_BG = ['#120a2e', '#1b1250', '#0a2a4a', '#2a0f3d'];
const DEFAULT_ACC = ['#a78bfa', '#22d3ee', '#f472b6'];

const SKY_UNIFORMS = [
  'u_time', 'u_res', 'u_c0', 'u_c1', 'u_c2', 'u_c3', 'u_a0', 'u_a1', 'u_a2', 'u_energy', 'u_progress', 'u_intensity', 'u_mouse', 'u_aurora',
  'u_day', 'u_golden', 'u_sunElev', 'u_sun', 'u_dawn', 'u_tod', 'u_ring',
];
const SCENE_UNIFORMS = [...SKY_UNIFORMS, 'u_pulse', 'u_center', 'u_skyTex', 'u_alpha'];
// Time-of-day values eased together when the time or mode changes.
const TOD_KEYS = ['day', 'golden', 'sunElev', 'sunX', 'sunY', 'dawn', 'tod'];
// Resolution: the sky is soft, so it renders at half size; the scenery renders at full device
// resolution (crisp silhouettes and stars), capped, and steps down automatically on slow GPUs.
const SKY_SCALE = 0.5;
const SKY_MAX_SIDE = 1600;
const MAX_SCENE_PIXELS = 2560 * 1600;
const MAX_DPR = 2;
const MIN_QUALITY = 0.55;
const REVEAL_MS = 1600; // fade-in when a scene finishes compiling after it was requested
const WARM_DELAY_MS = 8000; // wait after the active scene is up before pre-compiling the others
const POLL_MS = 120;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ preserveDrawingBuffer?: boolean, onError?: (err: Error) => void, warm?: boolean }} [options]
 *   warm: false skips background pre-compiling of the other scenes (previews).
 */
export function initBackground(canvas, options = {}) {
  if (!canvas) {
    console.warn('[fx] background: canvas missing');
    return null;
  }
  const root = document.documentElement;
  const opts = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!options.preserveDrawingBuffer };

  let gl = null;
  let parallel = null;
  let buffer = null;
  let skyTex = null;
  let skyFbo = null;
  let skyProg = null;
  const scenes = new Map(); // scene key ('none' = sky only) -> program entry
  let destroyed = false;
  let enabled = true;
  let reduced = root.dataset.reducedMotion === 'true';
  let contextLost = false;
  let rafId = 0;
  let stillPending = false;
  let pollTimer = 0;
  let warmTimer = 0;
  let lastTs = 0;
  let simTime = Math.random() * 100;
  let width = 1; // scene pass = canvas size
  let height = 1;
  let skyW = 1; // sky pass = offscreen texture size
  let skyH = 1;
  let quality = 1; // adaptive resolution multiplier for the scene pass
  let slowFrames = 0;
  let frameAvg = 16.7;

  // Animated state.
  let colors = flatten(DEFAULT_BG, DEFAULT_ACC);
  let palFrom = colors.slice();
  let palTo = colors.slice();
  let palStart = 0;
  let palDur = 0;
  let energy = 0.35;
  let energyFrom = energy;
  let energyTo = energy;
  let energyStart = 0;
  let energyDur = 0;
  let progress = 0;
  let progressShown = 0;
  let pulse = 0;
  let pulseCenter = [0.5, 0.5];
  let intensity = 0.8;
  let mouse = [0.5, 0.5];
  let mouseTarget = [0.5, 0.5];
  // Scenery: `scene` fades in over `scenePrev`; `sceneWanted` is promoted once its program is ready.
  let scene = 'none';
  let scenePrev = 'none';
  let sceneWanted = 'none';
  let sceneWantedMs = 0;
  let sceneMix = 1;
  let sceneStart = 0;
  let sceneDur = 0;
  let aurora = 1;
  let auroraFrom = 1;
  let auroraTo = 1;
  let auroraStart = 0;
  let auroraDur = 0;
  // Time of day (night by default until fx/index.js sets it).
  const NIGHT = { day: 0, golden: 0, sunElev: -1, sunX: 0.5, sunY: -0.8, dawn: 0, tod: 23 };
  let tod = { ...NIGHT };
  let todFrom = { ...NIGHT };
  let todTo = { ...NIGHT };
  let todStart = 0;
  let todDur = 0;
  let ring = [0.5, 0.54];
  let ringCheck = 0;
  const readyWaiters = [];

  function flatten(bg, acc) {
    return [...bg.slice(0, 4).flatMap(hexToRgb), ...acc.slice(0, 3).flatMap(hexToRgb)];
  }

  /* ---------- programs ---------- */

  // Starts compiling; completion is checked later with poll() so the main thread never blocks.
  function createProgram(fragSrc, names) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERT);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    return { program, vs, fs, names, uni: null, ready: false, failed: false, error: null };
  }

  function poll(entry) {
    if (!entry || entry.failed) return false;
    if (entry.ready) return true;
    if (parallel && !gl.getProgramParameter(entry.program, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
      const log = gl.getShaderInfoLog(entry.fs) || gl.getProgramInfoLog(entry.program) || 'unknown error';
      entry.failed = true;
      entry.error = new Error('Shader compile failed: ' + log);
      return false;
    }
    entry.uni = {};
    for (const n of entry.names) entry.uni[n] = gl.getUniformLocation(entry.program, n);
    gl.deleteShader(entry.vs);
    gl.deleteShader(entry.fs);
    entry.ready = true;
    return true;
  }

  function sceneProgram(key) {
    let entry = scenes.get(key);
    if (!entry && gl && !contextLost) {
      entry = createProgram(buildSceneShader(sceneSource(key)), SCENE_UNIFORMS);
      scenes.set(key, entry);
    }
    return entry;
  }

  function setupTarget() {
    if (!skyTex) skyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, skyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, skyW, skyH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (!skyFbo) skyFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, skyFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setupGL() {
    gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL unavailable');
    parallel = gl.getExtension('KHR_parallel_shader_compile');
    skyTex = null;
    skyFbo = null;
    scenes.clear();
    skyProg = createProgram(buildSkyShader(), SKY_UNIFORMS);
    sceneProgram('none');
    if (sceneWanted !== 'none') sceneProgram(sceneWanted);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    setupTarget();
    gl.viewport(0, 0, width, height);
    watchCompiles();
  }

  function fail(err) {
    console.warn('[fx] background disabled:', err && err.message ? err.message : err);
    report(err);
    root.dataset.bg = 'off';
    destroyed = true;
    stopLoop();
  }

  function report(err) {
    try {
      options.onError?.(err);
    } catch { /* ignore */ }
  }

  /* ---------- scene switching ---------- */

  function startTransition(key, ms, now = performance.now()) {
    if (key === scene) return;
    scenePrev = sceneMix >= 0.5 ? scene : scenePrev;
    scene = key;
    sceneStart = now;
    sceneDur = reduced || !enabled || !(ms > 0) ? 0 : ms;
    sceneMix = sceneDur === 0 ? 1 : 0;
  }

  // Promotes the requested scene once compiled; a failed compile falls back to the plain sky.
  function settleScene(now) {
    if (sceneWanted === scene) return;
    const entry = sceneProgram(sceneWanted);
    if (poll(entry)) {
      startTransition(sceneWanted, sceneWantedMs, now);
      resolveWaiters();
      scheduleWarm();
    } else if (entry && entry.failed) {
      console.warn(`[fx] scene "${sceneWanted}" unavailable:`, entry.error?.message);
      report(entry.error);
      sceneWanted = scene;
      resolveWaiters();
    }
  }

  function resolveWaiters() {
    while (readyWaiters.length) readyWaiters.shift()();
  }

  // Polls pending compiles even when no animation loop is running (reduced motion, previews).
  let skyShown = false;
  function watchCompiles() {
    clearTimeout(pollTimer);
    pollTimer = 0;
    if (destroyed || contextLost || !gl) return;
    const skyReady = poll(skyProg);
    if (skyProg.failed) {
      fail(skyProg.error);
      return;
    }
    if (!rafId) {
      const before = scene;
      settleScene(performance.now());
      // Only redraw when something new can be shown.
      if (scene !== before || (skyReady && !skyShown)) {
        skyShown = skyReady;
        requestStill();
      }
    }
    if (!skyReady || sceneWanted !== scene) pollTimer = setTimeout(watchCompiles, POLL_MS);
  }

  // After the active scene is up, compile the rest one by one so theme switches are instant later.
  let warming = false;
  function scheduleWarm() {
    if (options.warm === false || !parallel || warmTimer || warming) return;
    warmTimer = setTimeout(() => {
      warmTimer = 0;
      warming = true;
      warmNext();
    }, WARM_DELAY_MS);
  }

  function warmNext() {
    if (destroyed || contextLost || !gl) {
      warming = false;
      return;
    }
    const busy = [...scenes.values()].some((e) => !e.ready && !e.failed && !poll(e));
    if (!busy) {
      const next = SCENE_KEYS.find((k) => !scenes.has(k));
      if (!next) {
        warming = false;
        return;
      }
      sceneProgram(next);
    }
    setTimeout(warmNext, 400);
  }

  /* ---------- sizing & helpers ---------- */

  function resize() {
    const cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    let scale = Math.min(window.devicePixelRatio || 1, MAX_DPR) * quality;
    if (cssW * cssH * scale * scale > MAX_SCENE_PIXELS) scale = Math.sqrt(MAX_SCENE_PIXELS / (cssW * cssH));
    width = Math.max(2, Math.round(cssW * scale));
    height = Math.max(2, Math.round(cssH * scale));
    let sky = SKY_SCALE;
    if (Math.max(cssW, cssH) * sky > SKY_MAX_SIDE) sky = SKY_MAX_SIDE / Math.max(cssW, cssH);
    skyW = Math.max(2, Math.round(cssW * sky));
    skyH = Math.max(2, Math.round(cssH * sky));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (gl && !contextLost && skyTex) {
      setupTarget();
      gl.viewport(0, 0, width, height);
    }
    requestStill();
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }

  function ringCenter() {
    const el = document.getElementById('timer-ring');
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) return [clamp((r.left + r.width / 2) / vw, 0, 1), clamp(1 - (r.top + r.height / 2) / vh, 0, 1)];
    }
    return [0.5, 0.5];
  }

  function currentColors(now) {
    if (palDur <= 0) return palTo;
    const k = clamp((now - palStart) / palDur, 0, 1);
    if (k >= 1) {
      palDur = 0;
      colors = palTo.slice();
      return palTo;
    }
    const e = ease(k);
    for (let i = 0; i < colors.length; i++) colors[i] = lerp(palFrom[i], palTo[i], e);
    return colors;
  }

  function currentEnergy(now) {
    if (energyDur <= 0) return energyTo;
    const k = clamp((now - energyStart) / energyDur, 0, 1);
    if (k >= 1) {
      energyDur = 0;
      energy = energyTo;
      return energy;
    }
    energy = lerp(energyFrom, energyTo, ease(k));
    return energy;
  }

  function currentSceneMix(now) {
    if (sceneDur <= 0) return sceneMix;
    const k = clamp((now - sceneStart) / sceneDur, 0, 1);
    sceneMix = ease(k);
    if (k >= 1) {
      sceneDur = 0;
      sceneMix = 1;
    }
    return sceneMix;
  }

  function currentTod(now) {
    if (todDur <= 0) return tod;
    const k = clamp((now - todStart) / todDur, 0, 1);
    const e = ease(k);
    for (const key of TOD_KEYS) tod[key] = lerp(todFrom[key], todTo[key], e);
    if (k >= 1) todDur = 0;
    return tod;
  }

  function currentAurora(now) {
    if (auroraDur <= 0) return auroraTo;
    const k = clamp((now - auroraStart) / auroraDur, 0, 1);
    aurora = lerp(auroraFrom, auroraTo, ease(k));
    if (k >= 1) auroraDur = 0;
    return aurora;
  }

  function isAnimating() {
    return enabled && !reduced && !document.hidden && !contextLost && !destroyed;
  }

  /* ---------- drawing ---------- */

  function setShared(u, c, e, a, w, h) {
    gl.uniform1f(u.u_time, simTime);
    gl.uniform2f(u.u_res, w, h);
    gl.uniform3f(u.u_c0, c[0], c[1], c[2]);
    gl.uniform3f(u.u_c1, c[3], c[4], c[5]);
    gl.uniform3f(u.u_c2, c[6], c[7], c[8]);
    gl.uniform3f(u.u_c3, c[9], c[10], c[11]);
    gl.uniform3f(u.u_a0, c[12], c[13], c[14]);
    gl.uniform3f(u.u_a1, c[15], c[16], c[17]);
    gl.uniform3f(u.u_a2, c[18], c[19], c[20]);
    gl.uniform1f(u.u_energy, e);
    gl.uniform1f(u.u_progress, progressShown);
    gl.uniform1f(u.u_intensity, intensity);
    gl.uniform2f(u.u_mouse, mouse[0], mouse[1]);
    gl.uniform1f(u.u_aurora, a);
    gl.uniform1f(u.u_day, tod.day);
    gl.uniform1f(u.u_golden, tod.golden);
    gl.uniform1f(u.u_sunElev, tod.sunElev);
    gl.uniform2f(u.u_sun, tod.sunX, tod.sunY);
    gl.uniform1f(u.u_dawn, tod.dawn);
    gl.uniform1f(u.u_tod, tod.tod);
    gl.uniform2f(u.u_ring, ring[0], ring[1]);
  }

  function drawScene(entry, alpha, c, e, a) {
    const u = entry.uni;
    gl.useProgram(entry.program);
    setShared(u, c, e, a, width, height);
    gl.uniform1f(u.u_pulse, pulse);
    gl.uniform2f(u.u_center, pulseCenter[0], pulseCenter[1]);
    gl.uniform1i(u.u_skyTex, 0);
    gl.uniform1f(u.u_alpha, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function draw(now) {
    if (!gl || contextLost || destroyed) return;
    if (!poll(skyProg)) {
      if (skyProg && skyProg.failed) fail(skyProg.error);
      return;
    }
    settleScene(now);
    const cur = scenes.get(scene);
    if (!poll(cur)) return;
    const c = currentColors(now);
    const e = currentEnergy(now);
    const a = currentAurora(now);
    currentTod(now);
    if (now - ringCheck > 1000) {
      ringCheck = now;
      ring = ringCenter();
    }

    // Pass 1: sky -> texture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, skyFbo);
    gl.viewport(0, 0, skyW, skyH);
    gl.disable(gl.BLEND);
    gl.useProgram(skyProg.program);
    setShared(skyProg.uni, c, e, a, skyW, skyH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 2: scene(s) over the sky, to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, skyTex);
    const mix = currentSceneMix(now);
    const prev = scenes.get(scenePrev);
    if (mix < 1 && scenePrev !== scene && poll(prev)) {
      drawScene(prev, 1, c, e, a);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawScene(cur, mix, c, e, a);
      gl.disable(gl.BLEND);
    } else {
      drawScene(cur, 1, c, e, a);
    }
  }

  function frame(ts) {
    rafId = 0;
    if (!isAnimating()) return;
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    const e = currentEnergy(ts);
    simTime += dt * (0.25 + 0.75 * e);
    progressShown += (progress - progressShown) * Math.min(1, dt * 3);
    if (pulse > 0) pulse = Math.max(0, pulse - dt / 1.8);
    mouse[0] += (mouseTarget[0] - mouse[0]) * Math.min(1, dt * 2);
    mouse[1] += (mouseTarget[1] - mouse[1]) * Math.min(1, dt * 2);
    draw(ts);
    adaptQuality(dt * 1000);
    rafId = requestAnimationFrame(frame);
  }

  // If frames stay slow (< ~40 fps) for a couple of seconds, render the scenery at a lower
  // resolution. Only steps down, so it never oscillates.
  function adaptQuality(ms) {
    if (ms <= 0 || ms > 250) return; // ignore tab switches / hitches
    frameAvg += (ms - frameAvg) * 0.05;
    slowFrames = frameAvg > 25 ? slowFrames + 1 : 0;
    if (slowFrames > 120 && quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 0.15);
      slowFrames = 0;
      frameAvg = 16.7;
      resize();
    }
  }

  function startLoop() {
    if (rafId || !isAnimating()) return;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastTs = 0;
  }

  // Reduced motion / paused: draw one still frame when something changed.
  function requestStill() {
    if (destroyed || !enabled || contextLost || stillPending || rafId) return;
    stillPending = true;
    requestAnimationFrame((ts) => {
      stillPending = false;
      if (destroyed || !enabled || contextLost) return;
      settle();
      draw(ts);
    });
  }

  // Jumps every transition to its end state (still frames, previews).
  function settle() {
    palDur = 0;
    colors = palTo.slice();
    energyDur = 0;
    energy = energyTo;
    progressShown = progress;
    sceneDur = 0;
    sceneMix = 1;
    auroraDur = 0;
    aurora = auroraTo;
    todDur = 0;
    tod = { ...todTo };
    ring = ringCenter();
  }

  function onVisibility() {
    if (document.hidden) stopLoop();
    else if (reduced) requestStill();
    else startLoop();
  }

  function onMouse(ev) {
    mouseTarget = [ev.clientX / (window.innerWidth || 1), 1 - ev.clientY / (window.innerHeight || 1)];
  }

  function onLost(ev) {
    ev.preventDefault();
    contextLost = true;
    clearTimeout(pollTimer);
    stopLoop();
  }

  function onRestored() {
    try {
      contextLost = false;
      scene = 'none';
      scenePrev = 'none';
      setupGL();
      resize();
      if (reduced) requestStill();
      else startLoop();
    } catch (err) {
      fail(err);
    }
  }

  try {
    resize();
    setupGL();
  } catch (err) {
    fail(err);
    return makeNoop();
  }

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pointermove', onMouse, { passive: true });

  if (reduced) requestStill();
  else startLoop();

  return {
    setPalette(bgHex4, accentHex3, ms = 1400) {
      const next = flatten(bgHex4 || DEFAULT_BG, accentHex3 || DEFAULT_ACC);
      const now = performance.now();
      palFrom = currentColors(now).slice();
      palTo = next;
      palStart = now;
      palDur = reduced || !enabled ? 0 : Math.max(0, ms);
      if (palDur === 0) colors = next.slice();
      requestStill();
    },
    setEnergy(v, ms = 1200) {
      const now = performance.now();
      energyFrom = currentEnergy(now);
      energyTo = clamp(Number(v) || 0, 0, 1);
      energyStart = now;
      energyDur = reduced ? 0 : Math.max(0, ms);
      if (energyDur === 0) energy = energyTo;
      requestStill();
    },
    setProgress(p) {
      progress = clamp(Number(p) || 0, 0, 1);
      if (reduced) requestStill();
    },
    pulse(strength = 1) {
      if (reduced || !enabled) return;
      pulse = clamp(Math.max(pulse * 0.5, strength), 0, 1);
      pulseCenter = ringCenter();
      startLoop();
    },
    /**
     * Crossfades the landscape to scene `key` ('none' = sky only). If its program is still compiling,
     * the current view stays up and the new scene fades in as soon as it's ready.
     */
    setScene(key, ms = 1800) {
      const next = sceneKey(key);
      if (next === sceneWanted) return;
      sceneWanted = next;
      const entry = sceneProgram(next);
      const ready = poll(entry);
      sceneWantedMs = ready ? ms : Math.max(ms, REVEAL_MS);
      if (ready) {
        startTransition(next, ms);
        resolveWaiters();
      }
      watchCompiles();
      if (sceneDur > 0) startLoop();
      requestStill();
    },
    /**
     * Time of day from timeofday.js lightAt(): { day, golden, elevation, sun:[x,y], dawn, hour }.
     * Eased over `ms` (mode switches); minute-by-minute clock updates pass a short or zero ms.
     */
    setTimeOfDay(light, ms = 2500) {
      if (!light) return;
      const now = performance.now();
      todFrom = { ...currentTod(now) };
      todTo = {
        day: clamp(Number(light.day) || 0, 0, 1),
        golden: clamp(Number(light.golden) || 0, 0, 1),
        sunElev: clamp(Number(light.elevation) || 0, -1, 1),
        sunX: Number(light.sun?.[0]) || 0.5,
        sunY: Number(light.sun?.[1]) || -0.8,
        dawn: light.dawn ? 1 : 0,
        tod: Number(light.hour) || 0,
      };
      todStart = now;
      todDur = reduced || !enabled || !(ms > 0) ? 0 : ms;
      if (todDur === 0) tod = { ...todTo };
      requestStill();
    },
    /** Aurora curtain strength 0..1 (per theme), eased over `ms`. */
    setAurora(v, ms = 1800) {
      const now = performance.now();
      auroraFrom = currentAurora(now);
      auroraTo = clamp(Number.isFinite(Number(v)) ? Number(v) : 1, 0, 1);
      auroraStart = now;
      auroraDur = reduced || !enabled || !(ms > 0) ? 0 : ms;
      if (auroraDur === 0) aurora = auroraTo;
      requestStill();
    },
    /** Resolves once the requested scene's program is compiled (or failed). */
    whenReady() {
      if (sceneWanted === scene && poll(skyProg)) return Promise.resolve();
      return new Promise((resolve) => {
        readyWaiters.push(resolve);
        watchCompiles();
      }).then(() => new Promise((resolve) => {
        const check = () => (poll(skyProg) || skyProg?.failed ? resolve() : setTimeout(check, POLL_MS));
        check();
      }));
    },
    /** Pins the animation clock (seconds); used for deterministic previews. */
    setTime(t) {
      if (Number.isFinite(t)) simTime = t;
      requestStill();
    },
    /** Draws one frame immediately with all transitions settled (previews / screenshots). */
    renderNow() {
      settle();
      draw(performance.now());
    },
    setIntensity(v) {
      intensity = clamp(Number(v), 0, 1.5);
      if (!Number.isFinite(intensity)) intensity = 0.8;
      requestStill();
    },
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) stopLoop();
      else if (reduced) requestStill();
      else startLoop();
    },
    setReducedMotion(on) {
      reduced = !!on;
      if (reduced) {
        stopLoop();
        pulse = 0;
        requestStill();
      } else startLoop();
    },
    destroy() {
      destroyed = true;
      stopLoop();
      clearTimeout(resizeTimer);
      clearTimeout(pollTimer);
      clearTimeout(warmTimer);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onMouse);
      try {
        if (gl) {
          if (skyProg) gl.deleteProgram(skyProg.program);
          for (const e of scenes.values()) gl.deleteProgram(e.program);
          if (buffer) gl.deleteBuffer(buffer);
          if (skyTex) gl.deleteTexture(skyTex);
          if (skyFbo) gl.deleteFramebuffer(skyFbo);
        }
      } catch { /* context already gone */ }
    },
  };
}

function makeNoop() {
  const n = () => {};
  return {
    setPalette: n, setEnergy: n, setProgress: n, pulse: n, setScene: n, setAurora: n, setTimeOfDay: n, whenReady: () => Promise.resolve(),
    setTime: n, renderNow: n, setIntensity: n, setEnabled: n, setReducedMotion: n, destroy: n,
  };
}
