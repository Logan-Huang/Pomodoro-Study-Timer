// Soundscapes panel (#sound-root): ambient cards with live visualizer, volumes, chimes.
import { bus } from '../core/bus.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { icon } from './icons.js';
import { setAmbient, playChime, getAnalyser } from '../audio/audio.js';

const SOUNDS = [
  { kind: 'rain', name: 'Rain', desc: 'Soft rainfall on leaves', icon: 'rain' },
  { kind: 'ocean', name: 'Ocean', desc: 'Slow, rolling waves', icon: 'waves' },
  { kind: 'wind', name: 'Wind', desc: 'Drifting mountain air', icon: 'wind' },
  { kind: 'brown', name: 'Brown noise', desc: 'Deep, warm, steady hush', icon: 'noise' },
  { kind: 'pink', name: 'Pink noise', desc: 'Balanced, gentle static', icon: 'noise' },
  { kind: 'fire', name: 'Fireplace', desc: 'Crackling embers', icon: 'fire' },
];
const CHIMES = [
  ['crystal', 'Crystal'],
  ['bell', 'Bell'],
  ['marimba', 'Marimba'],
  ['soft', 'Soft'],
  ['none', 'None'],
];
const BARS = 20;

const pct = (v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 100);

export function initSoundView(root) {
  if (!root) {
    console.warn('[aura] #sound-root missing; sound view skipped');
    return;
  }
  const s0 = getSettings().sound || {};

  root.innerHTML = `
    <div class="snd">
      <div class="section-title">Ambient</div>
      <div class="snd-grid">
        ${SOUNDS.map(
          (c) => `
          <button type="button" class="snd-card glass" data-kind="${c.kind}" aria-pressed="false">
            <span class="snd-card__icon">${icon(c.icon, { size: 20 })}</span>
            <span class="snd-card__name">${c.name}</span>
            <span class="snd-card__desc">${c.desc}</span>
            <canvas class="snd-card__viz" aria-hidden="true"></canvas>
          </button>`,
        ).join('')}
      </div>

      <div class="snd-block">
        <label class="snd-row" for="snd-ambient-vol">
          <span class="snd-row__label">${icon('volume', { size: 16 })} Ambient volume</span>
          <span class="snd-row__value tabular" data-val="ambient">${pct(s0.ambientVolume)}%</span>
        </label>
        <input id="snd-ambient-vol" class="slider" type="range" min="0" max="100" step="1" value="${pct(s0.ambientVolume)}" style="--fill:${pct(s0.ambientVolume)}%">
        <label class="switch snd-switch">
          <input type="checkbox" class="switch__input" data-set="ambientOnlyWhileFocus">
          <span class="switch__track" aria-hidden="true"></span>
          <span class="switch__label">Only while focusing</span>
        </label>
        <p class="snd-hint faint">Ambient fades in when a focus session, countdown or stopwatch runs, and rests during breaks.</p>
      </div>

      <div class="divider"></div>

      <div class="section-title">Completion chime</div>
      <div class="snd-chips" role="group" aria-label="Completion chime">
        ${CHIMES.map(([k, label]) => `<button type="button" class="chip" data-chime="${k}" aria-pressed="false">${label}</button>`).join('')}
      </div>

      <div class="snd-block">
        <label class="snd-row" for="snd-master-vol">
          <span class="snd-row__label">${icon('sound', { size: 16 })} Master volume</span>
          <span class="snd-row__value tabular" data-val="master">${pct(s0.volume)}%</span>
        </label>
        <input id="snd-master-vol" class="slider" type="range" min="0" max="100" step="1" value="${pct(s0.volume)}" style="--fill:${pct(s0.volume)}%">
        <label class="switch snd-switch">
          <input type="checkbox" class="switch__input" data-set="uiSounds">
          <span class="switch__track" aria-hidden="true"></span>
          <span class="switch__label">Interface sounds</span>
        </label>
      </div>
    </div>`;

  const cards = [...root.querySelectorAll('.snd-card')];
  const chips = [...root.querySelectorAll('[data-chime]')];
  const ambientVol = root.querySelector('#snd-ambient-vol');
  const masterVol = root.querySelector('#snd-master-vol');
  const onlyFocus = root.querySelector('[data-set="ambientOnlyWhileFocus"]');
  const uiSounds = root.querySelector('[data-set="uiSounds"]');

  /* ---- state -> UI ---- */
  function sync() {
    const s = getSettings().sound || {};
    for (const card of cards) {
      const on = card.dataset.kind === s.ambient;
      card.classList.toggle('is-active', on);
      card.setAttribute('aria-pressed', String(on));
    }
    for (const chip of chips) {
      const on = chip.dataset.chime === s.chime;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    }
    const setSlider = (el, v, key) => {
      const p = pct(v);
      if (Number(el.value) !== p) el.value = p;
      el.style.setProperty('--fill', `${p}%`);
      root.querySelector(`[data-val="${key}"]`).textContent = `${p}%`;
    };
    setSlider(ambientVol, s.ambientVolume, 'ambient');
    setSlider(masterVol, s.volume, 'master');
    onlyFocus.checked = !!s.ambientOnlyWhileFocus;
    uiSounds.checked = !!s.uiSounds;
    kick();
  }

  /* ---- controls ---- */
  root.querySelector('.snd-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.snd-card');
    if (!card) return;
    const cur = getSettings().sound?.ambient;
    setAmbient(cur === card.dataset.kind ? 'none' : card.dataset.kind);
  });
  root.querySelector('.snd-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chime]');
    if (!chip) return;
    const kind = chip.dataset.chime;
    updateSettings({ sound: { chime: kind } });
    playChime(kind);
  });
  ambientVol.addEventListener('input', () =>
    updateSettings({ sound: { ambientVolume: Number(ambientVol.value) / 100 } }),
  );
  masterVol.addEventListener('input', () => updateSettings({ sound: { volume: Number(masterVol.value) / 100 } }));
  masterVol.addEventListener('change', () => playChime());
  onlyFocus.addEventListener('change', () => updateSettings({ sound: { ambientOnlyWhileFocus: onlyFocus.checked } }));
  uiSounds.addEventListener('change', () => updateSettings({ sound: { uiSounds: uiSounds.checked } }));

  /* ---- visualizer ---- */
  let open = false;
  let raf = 0;
  let data = null;
  let colors = null;
  let frame = 0;
  let peak = 60;
  const levels = new Float32Array(BARS);

  function readColors() {
    const cs = getComputedStyle(root);
    colors = [cs.getPropertyValue('--accent').trim() || '#a78bfa', cs.getPropertyValue('--accent-2').trim() || '#22d3ee'];
  }

  function draw(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!colors || frame++ % 90 === 0) readColors();

    const an = getAnalyser();
    let hasData = false;
    if (an) {
      if (!data || data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const usable = Math.floor(data.length * 0.62);
      let frameMax = 0;
      for (let i = 0; i < BARS; i++) {
        const lo = Math.floor(Math.pow(i / BARS, 1.7) * usable) + 1;
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / BARS, 1.7) * usable) + 1);
        let sum = 0;
        for (let b = lo; b < hi; b++) sum += data[b];
        const v = sum / (hi - lo);
        frameMax = Math.max(frameMax, v);
        levels[i] = Math.max(v / peak, levels[i] * 0.9);
      }
      peak = Math.max(40, peak * 0.995, frameMax);
      hasData = frameMax > 0;
    }
    const gap = 2;
    const bw = (w - gap * (BARS - 1)) / BARS;
    const grad = g.createLinearGradient(0, h, 0, 0);
    try {
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(1, colors[1]);
      g.fillStyle = grad;
    } catch {
      g.fillStyle = '#a78bfa';
    }
    for (let i = 0; i < BARS; i++) {
      const lv = hasData ? Math.min(1, levels[i]) : 0;
      const bh = 2 + lv * (h - 2);
      g.globalAlpha = hasData ? 0.95 : 0.35;
      g.beginPath();
      g.roundRect(i * (bw + gap), h - bh, bw, bh, Math.min(bw / 2, 2));
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function loop() {
    raf = 0;
    if (!open || document.hidden) return;
    const canvas = root.querySelector('.snd-card.is-active .snd-card__viz');
    if (!canvas) return;
    draw(canvas);
    raf = requestAnimationFrame(loop);
  }

  function kick() {
    if (raf || !open || document.hidden) return;
    if (!root.querySelector('.snd-card.is-active')) return;
    raf = requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', kick);
  bus.on('settings:changed', sync);
  bus.on('panel:open', ({ name } = {}) => {
    if (name !== 'sound') return;
    open = true;
    sync();
  });
  bus.on('panel:close', ({ name } = {}) => {
    if (name === 'sound') open = false;
  });
  sync();
}
