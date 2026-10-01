// Aura themes: palettes per theme and per phase kind (focus / break / idle), plus the nature
// scene painted under the sky (scenes/*.js), how strongly the aurora shows over it (0..1), and
// the particle weather drifting over it.

const pal = (accent, accent2, accent3, bg) => ({ accent, accent2, accent3, bg });

export const THEMES = {
  aurora: {
    name: 'Aurora',
    scene: 'alpine',
    aurora: 1,
    weather: 'snow',
    tagline: 'Northern lights over a snowy alpine lake',
    swatch: ['#a78bfa', '#22d3ee', '#f472b6'],
    focus: pal('#a78bfa', '#22d3ee', '#f472b6', ['#120a2e', '#1b1250', '#0a2a4a', '#2a0f3d']),
    break: pal('#5eead4', '#7dd3fc', '#a7f3d0', ['#04201f', '#0a3a3d', '#0b2a4a', '#0f3a30']),
    idle: pal('#9d8fdc', '#4fbfd3', '#d77fb0', ['#0e0a24', '#161040', '#0a2340', '#220d33']),
  },
  sunset: {
    name: 'Sunset',
    scene: 'desert',
    aurora: 0.15,
    weather: 'dust',
    tagline: 'Amber dusk over desert mesas',
    swatch: ['#fbbf24', '#fb7185', '#e879f9'],
    focus: pal('#fb923c', '#fb7185', '#e879f9', ['#2a0d1c', '#4a1230', '#3a1408', '#2d0b3a']),
    break: pal('#fcd34d', '#fda4af', '#f0abfc', ['#33140f', '#4a1f2c', '#3d2308', '#3a1440']),
    idle: pal('#dd9560', '#d9788a', '#c47bd0', ['#220b17', '#3b0f28', '#2e1106', '#250a30']),
  },
  ocean: {
    name: 'Ocean',
    scene: 'coast',
    aurora: 0.4,
    weather: 'sparkle',
    tagline: 'A moonlit sea and its rocky coast',
    swatch: ['#22d3ee', '#60a5fa', '#818cf8'],
    focus: pal('#22d3ee', '#60a5fa', '#818cf8', ['#03142e', '#06265a', '#04324a', '#100f52']),
    break: pal('#67e8f9', '#93c5fd', '#a5b4fc', ['#04213a', '#08356a', '#054a5a', '#14206a']),
    idle: pal('#4fb5c8', '#6b95cf', '#8a92d8', ['#020f22', '#051d44', '#032738', '#0c0c40']),
  },
  forest: {
    name: 'Forest',
    scene: 'forest',
    aurora: 0.3,
    weather: 'fireflies',
    tagline: 'Misty pine woods and fireflies',
    swatch: ['#34d399', '#a3e635', '#2dd4bf'],
    focus: pal('#34d399', '#a3e635', '#2dd4bf', ['#03170f', '#07301f', '#0a3a35', '#1a3008']),
    break: pal('#86efac', '#d9f99d', '#5eead4', ['#06261a', '#0d4a30', '#0f4a45', '#2a4a10']),
    idle: pal('#4fb891', '#8fb84a', '#3fb3a5', ['#02110b', '#052318', '#072a27', '#132406']),
  },
  sakura: {
    name: 'Sakura',
    scene: 'sakura',
    aurora: 0.25,
    weather: 'petals',
    tagline: 'Cherry blossoms in a moonlit valley',
    swatch: ['#f9a8d4', '#c4b5fd', '#fdba74'],
    focus: pal('#f472b6', '#c4b5fd', '#fdba74', ['#2a0a26', '#45123f', '#2a1250', '#3a1524']),
    break: pal('#f9a8d4', '#ddd6fe', '#fed7aa', ['#331030', '#521a4a', '#341a5e', '#46202e']),
    idle: pal('#d47fac', '#a89bd8', '#d9a06a', ['#1f081c', '#360e32', '#210f40', '#2c101c']),
  },
  midnight: {
    name: 'Midnight',
    scene: 'glacier',
    aurora: 0.75,
    weather: 'snow',
    tagline: 'Snowy peaks under a silver moon',
    swatch: ['#a5b4fc', '#93c5fd', '#e0e7ff'],
    focus: pal('#a5b4fc', '#7dd3fc', '#e0e7ff', ['#070a1c', '#0f1738', '#0a1f3c', '#141234']),
    break: pal('#c7d2fe', '#bae6fd', '#f1f5f9', ['#0a1024', '#16224a', '#0f2a4a', '#1a1a44']),
    idle: pal('#8b97d4', '#6aa8cc', '#b8bfdb', ['#050716', '#0b112b', '#08172d', '#0f0e28']),
  },
};

export const THEME_KEYS = Object.keys(THEMES);

const KINDS = ['focus', 'break', 'idle'];

export function paletteFor(themeKey, kind) {
  const theme = THEMES[themeKey] || THEMES.aurora;
  return theme[KINDS.includes(kind) ? kind : 'focus'] || theme.focus;
}

export function phaseKind(state) {
  if (!state) return 'idle';
  if (state.phase === 'short' || state.phase === 'long') return 'break';
  if (state.status === 'idle' && !(state.elapsedMs > 0)) return 'idle';
  return 'focus';
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Dark blend of the palette for the browser chrome color. */
export function blendDark(bg) {
  const base = [5, 4, 10];
  const avg = [0, 0, 0];
  for (const c of bg) hexToRgb(c).forEach((v, i) => (avg[i] += v / bg.length));
  const out = avg.map((v, i) => Math.round(base[i] * 0.55 + v * 0.45));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function applyTheme(themeKey, kind) {
  const key = THEMES[themeKey] ? themeKey : 'aurora';
  const p = paletteFor(key, kind);
  const root = document.documentElement;
  root.style.setProperty('--accent', p.accent);
  root.style.setProperty('--accent-2', p.accent2);
  root.style.setProperty('--accent-3', p.accent3);
  p.bg.forEach((c, i) => root.style.setProperty(`--bg-${i}`, c));
  root.dataset.theme = key;
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.setAttribute('content', blendDark(p.bg));
  return p;
}
