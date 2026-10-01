// Ambient bokeh motes, themed weather (snow, fireflies, petals, dust, sea sparkle) and elegant
// celebration bursts on a DPR-aware 2D canvas. Everything is drawn from pre-rendered sprites
// in a single rAF loop that sleeps when nothing moves.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const pickIndex = (n) => Math.floor(Math.random() * n);
const mixRgb = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function hexToRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const DEFAULT_COLORS = ['#a78bfa', '#22d3ee', '#f472b6'];
const WEATHER_KINDS = new Set(['none', 'snow', 'fireflies', 'petals', 'dust', 'sparkle']);
const MAX_PARTICLES = 160; // ambient motes still shown + weather particles
const AMBIENT_SHARE = 0.25; // share of ambient motes kept while a weather is active
const FADE_S = 1; // weather crossfade duration
const WHITE = [255, 255, 255];

function spriteCanvas(width, height, paint) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  if (g) paint(g, width, height);
  return c;
}

/** Square radial-gradient sprite; stops are [offset, rgb, alpha]. */
function radialSprite(size, stops) {
  return spriteCanvas(size, size, (g) => {
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    for (const [o, c, a] of stops) grad.addColorStop(o, rgba(c, a));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  });
}

/** Cherry-blossom petal (base on the left, notched tip on the right) with a lighter rim. */
function petalSprite(base, back) {
  return spriteCanvas(64, 40, (g) => {
    const deep = back ? mixRgb(base, [120, 60, 96], 0.22) : base;
    const light = mixRgb(base, WHITE, back ? 0.32 : 0.6);
    g.beginPath();
    g.moveTo(4, 20);
    g.bezierCurveTo(12, 5, 38, 1, 58, 9);
    g.quadraticCurveTo(55, 15, 51, 20);
    g.quadraticCurveTo(55, 25, 58, 31);
    g.bezierCurveTo(38, 39, 12, 35, 4, 20);
    g.closePath();
    const grad = g.createRadialGradient(12, 20, 1, 18, 20, 44);
    grad.addColorStop(0, rgba(mixRgb(deep, [214, 70, 130], 0.25), 1));
    grad.addColorStop(0.45, rgba(deep, 1));
    grad.addColorStop(1, rgba(light, 1));
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = 1.6;
    g.strokeStyle = rgba(light, back ? 0.35 : 0.75);
    g.stroke();
    g.globalAlpha = back ? 0.12 : 0.2;
    g.strokeStyle = rgba(mixRgb(deep, [170, 50, 110], 0.4), 1);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(7, 20);
    g.quadraticCurveTo(28, 18.5, 46, 20);
    g.stroke();
  });
}

/** Sea glint: bright core with a long horizontal and a short vertical flare. */
function glintSprite(c) {
  return spriteCanvas(64, 64, (g) => {
    g.globalCompositeOperation = 'lighter';
    let grad = g.createRadialGradient(32, 32, 0, 32, 32, 16);
    grad.addColorStop(0, rgba(WHITE, 1));
    grad.addColorStop(0.25, rgba(c, 0.75));
    grad.addColorStop(0.6, rgba(c, 0.18));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    grad = g.createLinearGradient(1, 0, 63, 0);
    grad.addColorStop(0, rgba(c, 0));
    grad.addColorStop(0.5, rgba(WHITE, 0.9));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.fillRect(1, 30.5, 62, 3);
    grad = g.createLinearGradient(0, 22, 0, 42);
    grad.addColorStop(0, rgba(c, 0));
    grad.addColorStop(0.5, rgba(WHITE, 0.2));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.fillRect(31.25, 22, 1.5, 20);
  });
}

export function initParticles(canvas) {
  if (!canvas) {
    console.warn('[fx] particles: canvas missing');
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn('[fx] particles: 2D context unavailable');
    return null;
  }
  const root = document.documentElement;

  let dpr = 1;
  let w = 0;
  let h = 0;
  let sz = 1; // viewport size scale for weather particles
  let palette = DEFAULT_COLORS.map(hexToRgb);
  let paletteKey = palette.join(';');
  let energy = 0.35;
  let energyShown = 0.35;
  let daylight = 0;
  let enabled = true;
  let reduced = root.dataset.reducedMotion === 'true';
  let destroyed = false;
  let rafId = 0;
  let lastTs = 0;
  let clock = 0;
  let motes = [];
  let sparks = [];
  let rings = [];
  let glows = [];
  let sprites = new Map();

  // Weather: one layer per kind; layers crossfade (fade -> target) when the kind changes.
  let weatherKind = 'none';
  let layers = [];
  let shareTarget = 1;
  let shareShown = 1;
  let weatherSprites = new Map();
  let ringTimer = 0;
  const ring = { x: 0, y: 0, r: 1 };
  const env = { wind: 8, pwind: 6, dwind: 1 };

  // Pre-rendered soft radial sprites keep per-frame cost low.
  function sprite(rgb) {
    const key = rgb.join(',');
    let s = sprites.get(key);
    if (s) return s;
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
    grad.addColorStop(0.35, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    if (sprites.size > 40) sprites = new Map();
    sprites.set(key, c);
    return c;
  }

  function targetCount() {
    const area = Math.max(1, w * h);
    const n = Math.round(area / 26000);
    const count = clamp(n, 35, 80);
    return reduced ? Math.round(count * 0.4) : count;
  }

  function makeMote(anywhere) {
    const depth = Math.random();
    return {
      x: rand(0, w),
      y: anywhere ? rand(0, h) : h + rand(10, 80),
      depth,
      r: 1.5 + depth * depth * 16,
      vy: 5 + depth * 16,
      sway: rand(6, 26),
      swaySpeed: rand(0.15, 0.5),
      phase: rand(0, TAU),
      twSpeed: rand(0.4, 1.4),
      base: 0.08 + depth * 0.22,
      rank: Math.random(), // motes with rank above the share hide while a weather is on
      color: palette[Math.floor(Math.random() * palette.length)],
    };
  }

  function seedMotes() {
    const n = targetCount();
    motes.length = Math.min(motes.length, n);
    while (motes.length < n) motes.push(makeMote(true));
  }

  // Readability: weather dims gently around the timer ring (the digits sit on top of it).
  function updateRing() {
    const el = document.getElementById('timer-ring');
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        ring.x = r.left + r.width / 2;
        ring.y = r.top + r.height / 2;
        ring.r = Math.max(40, r.width / 2);
        return;
      }
    }
    ring.x = w / 2;
    ring.y = h * 0.46;
    ring.r = Math.max(40, Math.min(h * 0.28, w * 0.39));
  }

  function calm(x, y, k) {
    const dx = (x - ring.x) / ring.r;
    const dy = (y - ring.y) / ring.r;
    const d2 = dx * dx + dy * dy;
    return d2 > 5 ? 1 : 1 - k * Math.exp(-d2 * 1.3);
  }

  // ---------------------------------------------------------------- weather kinds
  // Each kind: counts(area) -> [main, aux], make(anywhere, aux), step(p, k), draw(parts, alpha, spr, still),
  // sprites() (built lazily per palette), blend (canvas composite mode).

  const SNOW_TIERS = [
    { share: 0.55, size: [1.5, 2.3], vy: [15, 23], wind: 0.55, amp: [5, 12], a: [0.45, 0.65] },
    { share: 0.87, size: [2.6, 3.8], vy: [27, 38], wind: 0.8, amp: [9, 20], a: [0.6, 0.82] },
    { share: 1, size: [5.5, 8.5], vy: [46, 64], wind: 1.15, amp: [16, 30], a: [0.38, 0.52] },
  ];

  const WEATHER = {
    snow: {
      blend: 'source-over',
      counts: (area) => [clamp(Math.round(area / 13000), 42, 112), 0],
      sprites() {
        const c = mixRgb([238, 244, 255], palette[1] || palette[0], 0.12);
        return {
          sharp: radialSprite(32, [[0, c, 1], [0.35, c, 0.92], [0.6, c, 0.42], [0.8, c, 0.12], [1, c, 0]]),
          soft: radialSprite(64, [[0, c, 0.8], [0.38, c, 0.64], [0.68, c, 0.22], [1, c, 0]]),
        };
      },
      make(anywhere) {
        const roll = Math.random();
        const tier = roll < SNOW_TIERS[0].share ? 0 : roll < SNOW_TIERS[1].share ? 1 : 2;
        const T = SNOW_TIERS[tier];
        const size = rand(T.size[0], T.size[1]) * sz;
        return {
          tier,
          size,
          x: rand(-20, w + 20),
          y: anywhere ? rand(-20, h) : rand(-60, -size * 3),
          vy: rand(T.vy[0], T.vy[1]),
          wind: T.wind * rand(0.8, 1.2),
          amp: rand(T.amp[0], T.amp[1]),
          freq: rand(0.25, 0.6),
          phase: rand(0, TAU),
          a: rand(T.a[0], T.a[1]),
        };
      },
      step(p, k) {
        p.y += p.vy * k;
        p.x += env.wind * p.wind * k;
        p.phase += p.freq * k;
        if (p.x > w + 40) p.x -= w + 80;
        else if (p.x < -40) p.x += w + 80;
        if (p.y > h + 30) Object.assign(p, this.make(false));
      },
      draw(parts, alpha, spr) {
        for (const p of parts) {
          const x = p.x + Math.sin(p.phase) * p.amp + Math.sin(p.phase * 2.3 + 1.7) * p.amp * 0.25;
          const near = p.tier === 2;
          const d = near ? p.size * 4 : p.size * 2.6;
          ctx.globalAlpha = p.a * alpha * calm(x, p.y, near ? 0.7 : 0.45);
          ctx.drawImage(near ? spr.soft : spr.sharp, x - d / 2, p.y - d / 2, d, d);
        }
      },
    },

    fireflies: {
      blend: 'lighter',
      counts: (area) => [clamp(Math.round(area / 48000), 12, 35), 0],
      sprites() {
        return {
          core: radialSprite(32, [[0, [255, 255, 226], 1], [0.22, [240, 255, 170], 0.92], [0.5, [206, 242, 110], 0.32], [1, [176, 228, 86], 0]]),
          halo: radialSprite(64, [[0, [224, 250, 128], 0.9], [0.2, [206, 242, 106], 0.5], [0.45, [184, 230, 90], 0.16], [0.75, [164, 218, 78], 0.04], [1, [150, 210, 70], 0]]),
          bloom: radialSprite(64, [[0, [200, 236, 100], 0.5], [0.3, [184, 226, 90], 0.24], [0.62, [160, 210, 76], 0.07], [1, [140, 200, 70], 0]]),
        };
      },
      make() {
        const d = Math.random();
        return {
          hx: rand(-20, w + 20),
          hy: h * (0.64 + 0.3 * d),
          size: (0.8 + 0.9 * d) * sz,
          t: rand(0, 300),
          ax1: rand(30, 80), fx1: rand(0.12, 0.3), px1: rand(0, TAU),
          ax2: rand(12, 34), fx2: rand(0.35, 0.7), px2: rand(0, TAU),
          ay1: rand(10, 26), fy1: rand(0.15, 0.35), py1: rand(0, TAU),
          ay2: rand(5, 13), fy2: rand(0.45, 0.85), py2: rand(0, TAU),
          drift: rand(-5, 5),
          period: rand(3.2, 7),
          off: Math.random(),
          on: rand(0.45, 0.65),
          peak: rand(0.55, 1),
        };
      },
      step(p, k) {
        p.t += k;
        p.hx += p.drift * k;
        if (p.hx > w + 60) p.hx -= w + 120;
        else if (p.hx < -60) p.hx += w + 120;
      },
      draw(parts, alpha, spr, still) {
        for (const p of parts) {
          let b;
          if (still) b = p.off < 0.55 ? p.peak * 0.6 : 0;
          else {
            const u = (p.t / p.period + p.off) % 1;
            b = u < p.on ? Math.pow(Math.sin((Math.PI * u) / p.on), 2) * p.peak : 0;
          }
          if (b < 0.01) continue;
          const x = p.hx + p.ax1 * Math.sin(p.t * p.fx1 + p.px1) + p.ax2 * Math.sin(p.t * p.fx2 + p.px2);
          const y = p.hy + p.ay1 * Math.sin(p.t * p.fy1 + p.py1) + p.ay2 * Math.sin(p.t * p.fy2 + p.py2);
          const a = alpha * b;
          let d = 110 * p.size;
          ctx.globalAlpha = a * 0.3;
          ctx.drawImage(spr.bloom, x - d / 2, y - d / 2, d, d);
          d = 40 * p.size;
          ctx.globalAlpha = a * 0.75;
          ctx.drawImage(spr.halo, x - d / 2, y - d / 2, d, d);
          d = 10 * p.size;
          ctx.globalAlpha = Math.min(1, a * 1.1);
          ctx.drawImage(spr.core, x - d / 2, y - d / 2, d, d);
        }
      },
    },

    petals: {
      blend: 'source-over',
      counts: (area) => [clamp(Math.round(area / 62000), 9, 24), 0],
      sprites() {
        const tint = palette[0];
        const bases = [[255, 183, 211], [247, 158, 196], [255, 210, 227]].map((c, i) => mixRgb(c, tint, i === 2 ? 0.12 : 0.22));
        return { front: bases.map((c) => petalSprite(c, false)), back: bases.map((c) => petalSprite(c, true)) };
      },
      make(anywhere) {
        const d = Math.random();
        let x;
        let y;
        if (anywhere) {
          x = rand(-0.05 * w, w);
          y = rand(-0.05 * h, h);
        } else if (Math.random() < w / (w + h * 0.8)) {
          x = rand(-0.3 * w, w * 0.95);
          y = rand(-50, -20);
        } else {
          x = rand(-50, -20);
          y = rand(-0.05 * h, h * 0.75);
        }
        return {
          x,
          y,
          size: (11 + 11 * d) * sz,
          vx: 14 + 18 * d,
          vy: 13 + 14 * d,
          rot: rand(0, TAU),
          vr: rand(0.25, 0.8) * (Math.random() < 0.5 ? -1 : 1),
          flip: rand(0, TAU),
          vf: rand(0.9, 1.9),
          amp: rand(8, 26),
          sf: rand(0.35, 0.8),
          sp: rand(0, TAU),
          a: 0.5 + 0.4 * d,
          v: pickIndex(3),
        };
      },
      step(p, k) {
        // Petals fall faster edge-on and float when they catch the air face-on.
        const edge = 1 - Math.abs(Math.cos(p.flip));
        p.x += (p.vx + env.pwind) * k;
        p.y += p.vy * (0.75 + 0.55 * edge) * k;
        p.rot += p.vr * k;
        p.flip += p.vf * k;
        p.sp += p.sf * k;
        if (p.x > w + 40 || p.y > h + 40) Object.assign(p, this.make(false));
      },
      draw(parts, alpha, spr) {
        for (const p of parts) {
          const x = p.x + Math.sin(p.sp) * p.amp;
          const y = p.y;
          const sx = Math.cos(p.flip);
          const ax = Math.max(0.12, Math.abs(sx));
          const cs = Math.cos(p.rot);
          const sn = Math.sin(p.rot);
          ctx.setTransform(dpr * cs * ax, dpr * sn * ax, -dpr * sn, dpr * cs, dpr * x, dpr * y);
          ctx.globalAlpha = alpha * p.a * (0.7 + 0.3 * ax) * calm(x, y, 0.45);
          const L = p.size;
          const H = p.size * 0.625;
          ctx.drawImage(sx < 0 ? spr.back[p.v] : spr.front[p.v], -L / 2, -H / 2, L, H);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      },
    },

    dust: {
      blend: 'lighter',
      counts: (area) => [clamp(Math.round(area / 19000), 24, 72), clamp(Math.round(area / 260000), 2, 7)],
      sprites() {
        const warm = [[255, 196, 140], [255, 172, 138], [255, 218, 160]];
        const mote = warm.map((c, i) => mixRgb(c, palette[i % palette.length], 0.28));
        const bokeh = [0, 1].map((i) => mixRgb([255, 186, 140], palette[i % palette.length], 0.3));
        return {
          mote: mote.map((c) => radialSprite(32, [[0, c, 0.95], [0.3, c, 0.45], [1, c, 0]])),
          bokeh: bokeh.map((c) => radialSprite(128, [[0, c, 0.3], [0.62, c, 0.36], [0.84, c, 0.52], [0.93, c, 0.18], [1, c, 0]])),
        };
      },
      make(anywhere, aux) {
        if (aux) {
          return {
            aux: true,
            x: rand(-40, w + 40),
            hy: h * rand(0.6, 0.93),
            r: rand(12, 30) * sz,
            vx: rand(2, 6),
            bob: rand(6, 16),
            bf: rand(0.08, 0.18),
            ph: rand(0, TAU),
            a: rand(0.1, 0.16),
            tw: rand(0.1, 0.25),
            v: pickIndex(2),
          };
        }
        return {
          aux: false,
          x: rand(-10, w + 10),
          hy: h * (0.52 + 0.47 * (1 - Math.pow(Math.random(), 1.7))),
          r: (1.2 + 3 * Math.pow(Math.random(), 2)) * sz,
          vx: rand(4, 15),
          bob: rand(3, 11),
          bf: rand(0.18, 0.45),
          ph: rand(0, TAU),
          a: rand(0.42, 0.8),
          tw: rand(0.3, 0.9),
          twp: rand(0, TAU),
          v: pickIndex(3),
        };
      },
      step(p, k) {
        p.x += p.vx * env.dwind * k;
        p.ph += p.bf * k;
        const m = p.aux ? p.r + 10 : 10;
        if (p.x > w + m) p.x -= w + 2 * m;
      },
      draw(parts, alpha, spr) {
        const top = h * 0.5;
        const span = h * 0.16;
        for (const p of parts) {
          const y = p.hy + Math.sin(p.ph) * p.bob;
          if (p.aux) {
            const d = p.r * 2;
            ctx.globalAlpha = alpha * p.a * (0.8 + 0.2 * Math.sin(clock * p.tw + p.ph));
            ctx.drawImage(spr.bokeh[p.v], p.x - d / 2, y - d / 2, d, d);
            continue;
          }
          const fy = smooth(clamp((y - top) / span, 0, 1));
          if (fy <= 0) continue;
          const d = p.r * 4;
          ctx.globalAlpha = alpha * p.a * fy * (0.7 + 0.3 * Math.sin(clock * p.tw + p.twp));
          ctx.drawImage(spr.mote[p.v], p.x - d / 2, y - d / 2, d, d);
        }
      },
    },

    sparkle: {
      blend: 'lighter',
      counts: (area) => [clamp(Math.round(area / 13000), 28, 96), clamp(Math.round(area / 90000), 5, 16)],
      sprites() {
        const c = mixRgb([225, 248, 255], palette[0], 0.22);
        const m = mixRgb([200, 232, 255], palette[1] || palette[0], 0.35);
        return { glint: glintSprite(c), mist: radialSprite(32, [[0, m, 0.9], [0.3, m, 0.45], [1, m, 0]]) };
      },
      place(p) {
        // Denser and smaller toward the horizon, larger and sparser near the viewer.
        const yn = Math.pow(Math.random(), 1.5);
        p.x = rand(0, w);
        p.y = h * (0.705 + 0.29 * yn);
        p.s = (0.5 + 0.9 * yn) * sz;
        p.peak = rand(0.6, 1);
        p.still = Math.random() < 0.3;
      },
      make(anywhere, aux) {
        if (aux) {
          return {
            aux: true,
            x: rand(0, w),
            y0: h * rand(0.8, 1.02),
            rise: h * rand(0.1, 0.22),
            life: anywhere ? Math.random() : 0,
            dur: rand(14, 26),
            r: rand(1.6, 4.2) * sz,
            vx: rand(-4, 4),
            a: rand(0.22, 0.4),
          };
        }
        const p = { aux: false, u: Math.random(), period: rand(2.4, 5.5) };
        this.place(p);
        return p;
      },
      step(p, k) {
        if (p.aux) {
          p.life += k / p.dur;
          p.x += p.vx * k;
          if (p.life >= 1) Object.assign(p, this.make(false, true));
          return;
        }
        p.u += k / p.period;
        p.x += 3 * k;
        if (p.u >= 1) {
          p.u -= 1;
          this.place(p);
        }
      },
      draw(parts, alpha, spr, still) {
        for (const p of parts) {
          if (p.aux) {
            const d = p.r * 4;
            const x = p.x + Math.sin(p.life * 9 + p.r) * 6;
            ctx.globalAlpha = alpha * p.a * Math.sin(Math.PI * clamp(p.life, 0, 1));
            ctx.drawImage(spr.mist, x - d / 2, p.y0 - p.rise * p.life - d / 2, d, d);
            continue;
          }
          let b;
          if (still) b = p.still ? p.peak * 0.55 : 0;
          else {
            const e = (p.u - 0.5) / 0.13;
            b = Math.exp(-e * e) * p.peak;
          }
          if (b < 0.02) continue;
          const d = 34 * p.s;
          ctx.globalAlpha = alpha * b;
          ctx.drawImage(spr.glint, p.x - d / 2, p.y - d * 0.3, d, d * 0.6);
        }
      },
    },
  };

  function weatherCounts(kind) {
    const def = WEATHER[kind];
    if (!def) return [0, 0];
    let [n, m] = def.counts(Math.max(1, w * h));
    const room = MAX_PARTICLES - Math.ceil(targetCount() * AMBIENT_SHARE);
    n = Math.max(0, Math.min(n, room - m));
    if (reduced) {
      n = Math.round(n * 0.4);
      m = Math.round(m * 0.5);
    }
    return [n, m];
  }

  function fillLayer(layer, anywhere) {
    const def = WEATHER[layer.kind];
    const [n, m] = weatherCounts(layer.kind);
    const main = layer.parts.filter((p) => !p.aux).slice(0, n);
    const aux = layer.parts.filter((p) => p.aux).slice(0, m);
    while (main.length < n) main.push(def.make(anywhere, false));
    while (aux.length < m) aux.push(def.make(anywhere, true));
    layer.parts = aux.concat(main); // aux (bokeh, mist) draws behind
  }

  function rescaleWeather(sx, sy) {
    for (const l of layers) {
      for (const p of l.parts) {
        if ('x' in p) p.x *= sx;
        if ('hx' in p) p.hx *= sx;
        if ('y' in p) p.y *= sy;
        if ('hy' in p) p.hy *= sy;
        if ('y0' in p) p.y0 *= sy;
        if ('rise' in p) p.rise *= sy;
      }
    }
  }

  function weatherSpritesFor(kind) {
    const key = kind + '|' + paletteKey;
    let s = weatherSprites.get(key);
    if (!s) {
      if (weatherSprites.size > 12) weatherSprites = new Map();
      s = WEATHER[kind].sprites();
      weatherSprites.set(key, s);
    }
    return s;
  }

  function settleWeather() {
    for (const l of layers) l.fade = l.target;
    layers = layers.filter((l) => l.fade > 0);
    shareShown = shareTarget;
  }

  function stepWeather(dt) {
    const spd = 0.85 + energyShown * 0.3;
    const k = dt * spd;
    env.wind = 8 + 6 * Math.sin(clock * 0.045) + 3.5 * Math.sin(clock * 0.12 + 1.3);
    env.pwind = 6 + 5 * Math.sin(clock * 0.07 + 0.4);
    env.dwind = 0.85 + 0.25 * Math.sin(clock * 0.05 + 2.1);
    const fadeStep = dt / FADE_S;
    shareShown += clamp(shareTarget - shareShown, -fadeStep, fadeStep);
    for (const l of layers) {
      l.fade += clamp(l.target - l.fade, -fadeStep, fadeStep);
      const def = WEATHER[l.kind];
      for (const p of l.parts) def.step(p, k);
    }
    if (layers.some((l) => l.fade <= 0 && l.target === 0)) layers = layers.filter((l) => l.fade > 0 || l.target > 0);
    if (layers.length) {
      ringTimer -= dt;
      if (ringTimer <= 0) {
        ringTimer = 1.5;
        updateRing();
      }
    }
  }

  function drawWeather() {
    for (const l of layers) {
      // Fireflies only glow once it gets dark.
      const alpha = smooth(clamp(l.fade, 0, 1)) * (l.kind === 'fireflies' ? 1 - daylight : 1);
      if (alpha <= 0.003) continue;
      const def = WEATHER[l.kind];
      ctx.globalCompositeOperation = def.blend;
      def.draw(l.parts, alpha, weatherSpritesFor(l.kind), reduced);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
  }

  // ---------------------------------------------------------------- core loop

  function resize() {
    const ow = w;
    const oh = h;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth || 1;
    h = window.innerHeight || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sz = clamp(Math.sqrt(w * h) / 1200, 0.85, 1.25);
    seedMotes();
    if (ow && oh && (ow !== w || oh !== h)) rescaleWeather(w / ow, h / oh);
    for (const l of layers) fillLayer(l, true);
    updateRing();
    render(0, true);
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }

  function hasBurst() {
    return sparks.length > 0 || rings.length > 0 || glows.length > 0;
  }

  function ambientVisible() {
    return enabled && root.dataset.particles !== 'off';
  }

  function needsLoop() {
    if (destroyed || document.hidden) return false;
    if (hasBurst()) return true;
    return ambientVisible() && !reduced;
  }

  function step(dt) {
    clock += dt;
    energyShown += (energy - energyShown) * Math.min(1, dt * 1.5);
    const speed = 0.55 + energyShown * 0.9;
    for (const m of motes) {
      m.y -= m.vy * speed * dt;
      m.phase += m.swaySpeed * dt;
      if (m.y < -m.r * 2) Object.assign(m, makeMote(false), { x: rand(0, w) });
    }
    if (ambientVisible() && !reduced) stepWeather(dt);
    else settleWeather();
    for (const s of sparks) {
      s.life -= dt;
      const drag = Math.pow(s.drag, dt * 60);
      s.vx *= drag;
      s.vy = s.vy * drag + s.g * dt;
      s.px = s.x;
      s.py = s.y;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    sparks = sparks.filter((s) => s.life > 0);
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < r.dur);
    for (const g of glows) g.t += dt;
    glows = glows.filter((g) => g.t < g.dur);
  }

  function render(ts, staticFrame) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    if (ambientVisible()) {
      const boost = 0.75 + energyShown * 0.55;
      for (const m of motes) {
        // While a weather is active only ~25% of the motes stay, fading by rank.
        const vis = shareShown >= 1 ? 1 : clamp((shareShown + 0.06 - m.rank) * 12, 0, 1);
        if (vis <= 0) continue;
        const tw = staticFrame || reduced ? 0.8 : 0.6 + 0.4 * Math.sin(clock * m.twSpeed + m.phase * 3);
        const a = clamp(m.base * tw * boost * (reduced ? 0.7 : 1), 0, 0.6) * vis * (1 - daylight * 0.85);
        const x = m.x + (reduced ? 0 : Math.sin(m.phase) * m.sway);
        const r = m.r * (0.9 + 0.2 * energyShown);
        ctx.globalAlpha = a;
        const s = sprite(m.color);
        ctx.drawImage(s, x - r * 2, m.y - r * 2, r * 4, r * 4);
      }
      if (layers.length) drawWeather();
    }
    // Soft glow used for reduced-motion celebrations.
    for (const g of glows) {
      const k = g.t / g.dur;
      const a = Math.sin(Math.PI * k) * 0.55 * g.power;
      ctx.globalAlpha = clamp(a, 0, 1);
      const s = sprite(g.color);
      const r = g.radius * (0.85 + 0.3 * k);
      ctx.drawImage(s, g.x - r, g.y - r, r * 2, r * 2);
    }
    for (const r of rings) {
      if (r.t < 0) continue;
      const k = r.t / r.dur;
      const e = 1 - Math.pow(1 - k, 3);
      ctx.globalAlpha = (1 - k) * 0.7 * r.power;
      ctx.lineWidth = 1.5 + (1 - k) * 1.5;
      ctx.strokeStyle = `rgb(${r.color[0]},${r.color[1]},${r.color[2]})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * e, 0, TAU);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    for (const s of sparks) {
      const k = clamp(s.life / s.max, 0, 1);
      const a = s.ember ? Math.sin(Math.PI * (1 - k)) * 0.8 : Math.pow(k, 0.8);
      ctx.globalAlpha = clamp(a, 0, 1);
      if (!s.ember) {
        ctx.strokeStyle = `rgb(${s.color[0]},${s.color[1]},${s.color[2]})`;
        ctx.lineWidth = s.size * (0.4 + k * 0.6);
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      const spr = sprite(s.color);
      const r = s.size * (s.ember ? 3.2 : 2.6);
      ctx.drawImage(spr, s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(ts) {
    rafId = 0;
    if (!needsLoop()) {
      lastTs = 0;
      settleWeather();
      render(ts, true);
      return;
    }
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    step(dt);
    render(ts, false);
    rafId = requestAnimationFrame(frame);
  }

  function ensureLoop() {
    if (rafId || !needsLoop()) return;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function refresh() {
    if (rafId) return;
    if (needsLoop()) ensureLoop();
    else {
      settleWeather();
      render(0, true);
    }
  }

  function onVisibility() {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      lastTs = 0;
    } else ensureLoop();
  }

  function pick(colors) {
    const list = colors && colors.length ? colors.map(hexToRgb) : palette;
    return list[Math.floor(Math.random() * list.length)];
  }

  resize();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  ensureLoop();

  return {
    setColors(hex) {
      if (!Array.isArray(hex) || !hex.length) return;
      palette = hex.map(hexToRgb);
      paletteKey = palette.join(';');
      for (const m of motes) m.color = palette[Math.floor(Math.random() * palette.length)];
      refresh();
    },
    setEnergy(v) {
      energy = clamp(Number(v) || 0, 0, 1);
      if (reduced) energyShown = energy;
      refresh();
    },
    setEnabled(on) {
      enabled = !!on;
      refresh();
      if (enabled) ensureLoop();
    },
    setReducedMotion(on) {
      reduced = !!on;
      seedMotes();
      for (const l of layers) fillLayer(l, true);
      if (reduced && rafId && !hasBurst()) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      refresh();
      ensureLoop();
    },
    /** Daylight 0..1 from the time of day: glowing motes and fireflies fade out in the sun. */
    setDaylight(v) {
      daylight = clamp(Number(v) || 0, 0, 1);
    },
    /** Themed weather drifting over the scenery: 'none' | 'snow' | 'fireflies' | 'petals' | 'dust' | 'sparkle'. */
    setWeather(kind) {
      if (destroyed) return;
      const next = WEATHER_KINDS.has(kind) ? kind : 'none';
      if (next === weatherKind) return;
      weatherKind = next;
      shareTarget = next === 'none' ? 1 : AMBIENT_SHARE;
      for (const l of layers) l.target = 0;
      if (next !== 'none') {
        let layer = layers.find((l) => l.kind === next);
        if (!layer) {
          layer = { kind: next, parts: [], fade: 0, target: 1 };
          fillLayer(layer, true);
          layers.push(layer);
        }
        layer.target = 1;
        updateRing();
      }
      // Crossfade only when it can be seen animating; otherwise switch at once.
      if (!needsLoop() || reduced) settleWeather();
      refresh();
      ensureLoop();
    },
    /** Steps the simulation by `seconds` at once (previews / tests), then draws a frame. */
    advance(seconds) {
      if (destroyed) return;
      let left = clamp(Number(seconds) || 0, 0, 120);
      while (left > 0) {
        const dt = Math.min(1 / 60, left);
        step(dt);
        left -= dt;
      }
      render(0, false);
    },
    destroy() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      ctx.clearRect(0, 0, w, h);
    },
  };
}
