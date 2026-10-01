// Shader assembly. Rendering is two passes so every program stays small enough to compile quickly
// (Windows D3D compiles of one giant shader took up to a minute):
//   1. SKY program: the living night sky -> an offscreen texture (sqrt-encoded, see SKY_MAIN).
//   2. SCENE program (one per theme): reads the sky texture through skyColor(), paints the nature
//      scene over it, then applies the shared post (pulse ring, vignette, tone map, dither).
// Scenes live in ./scenes/*.js.

export const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float u_time;
uniform vec2  u_res;
uniform vec3  u_c0, u_c1, u_c2, u_c3;
uniform vec3  u_a0, u_a1, u_a2;
uniform float u_energy;
uniform float u_progress;
uniform float u_pulse;
uniform vec2  u_center;
uniform float u_intensity;
uniform vec2  u_mouse;
uniform float u_aurora;
// Time of day (see timeofday.js): daylight 0..1, sunrise/sunset warmth 0..1, sun elevation -1..1,
// sun position in screen uv (can be off-screen), 1 on the morning side, local hour, timer-ring centre.
uniform float u_day;
uniform float u_golden;
uniform float u_sunElev;
uniform vec2  u_sun;
uniform float u_dawn;
uniform float u_tod;
uniform vec2  u_ring;
`;

const NOISE = `
float hash11(float n) { return fract(sin(n) * 43758.5453123); }
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 17.3));
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}
`;

const SKY = `
// One aurora curtain: soft lower boundary with a faint luminous rim, long fade upward, fine striations.
float curtain(vec2 p, float seed, float t, float baseY, float spread, out float hueMix) {
  vec2 q = vec2(p.x * 0.9 + seed * 5.3, t * 0.06 + seed);
  float warp = fbm(q + fbm(q * 1.7 + t * 0.03) * 1.2);
  float centre = baseY + (warp - 0.5) * spread + 0.05 * sin(p.x * 1.6 + t * 0.12 + seed * 2.0);
  float d = p.y - centre;
  float below = exp(-pow(max(-d, 0.0) / 0.085, 2.0));
  float above = exp(-max(d, 0.0) / (0.20 + 0.10 * warp));
  float body = (d < 0.0 ? below : above) + 0.22 * exp(-pow(d / 0.03, 2.0));
  float stri = 0.55 + 0.45 * vnoise(vec2(p.x * 70.0 + warp * 18.0 + seed * 9.0, d * 3.0 - t * 0.15));
  stri *= 0.75 + 0.25 * vnoise(vec2(p.x * 190.0 + seed, t * 0.4));
  float sway = smoothstep(0.25, 0.85, fbm(vec2(p.x * 1.4 + seed * 3.0, t * 0.05 + seed * 7.0)));
  hueMix = warp;
  return body * stri * (0.25 + 0.95 * sway);
}

// The night sky (base gradient, nebula, aurora, horizon glow).
vec3 nightSky(vec2 uv, vec2 p, float t, float bright) {
  // Base night sky: vertical blend through the four palette colours with slow drift.
  float n0 = fbm(p * 0.9 + vec2(t * 0.012, -t * 0.008));
  vec3 base = mix(u_c0, u_c1, smoothstep(0.0, 0.9, uv.y * 0.8 + n0 * 0.45));
  base = mix(base, u_c2, smoothstep(0.35, 0.95, uv.x + (n0 - 0.5) * 0.7) * 0.55);
  base = mix(base, u_c3, smoothstep(0.55, 0.05, uv.y + (n0 - 0.5) * 0.4) * 0.5);
  vec3 col = base * 0.34;

  // Soft nebula clouds (domain warped).
  vec2 nq = p * 1.15 + vec2(t * 0.015, t * 0.01);
  vec2 wq = vec2(fbm(nq + 3.1), fbm(nq + 7.9 - t * 0.02));
  float neb = fbm(nq + wq * 1.9);
  float neb2 = fbm(nq * 1.6 - wq * 1.4 + 20.0);
  vec3 nebCol = mix(u_c1, u_c2, smoothstep(0.3, 0.75, neb2));
  nebCol = mix(nebCol, u_c3, smoothstep(0.4, 0.9, wq.x) * 0.6);
  col += nebCol * smoothstep(0.32, 0.85, neb) * 0.85 * bright;
  col += mix(u_a0, u_a2, neb2) * pow(smoothstep(0.45, 0.95, neb * neb2 * 2.0), 2.0) * 0.10 * bright;

  // Aurora curtains, concentrated in the upper half.
  vec3 aur = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float hm;
    float c = curtain(p, fi * 1.7 + 0.3, t, 0.60 + fi * 0.09 - 0.02 * fi * fi, 0.30 + 0.06 * fi, hm);
    vec3 tint = mix(u_a0, u_a1, smoothstep(0.25, 0.75, hm));
    tint = mix(tint, u_a2, smoothstep(0.55, 1.0, hm + 0.25 * sin(p.x * 2.0 + fi * 2.1 + t * 0.05)) * 0.7);
    if (i == 1) tint = mix(tint, u_a1, 0.35);
    if (i == 2) tint = mix(tint, u_a2, 0.45);
    float vfade = smoothstep(0.18, 0.62, uv.y);
    aur += tint * c * vfade * (0.85 - 0.18 * fi);
  }
  // u_aurora: per-theme strength (full over the alpine lake, a faint glow over the desert).
  // Aurora is a night phenomenon: gone well before sunrise colours or daylight show.
  float nightOnly = 1.0 - smoothstep(0.0, 0.4, u_day + u_golden * 0.9);
  col += aur * 0.95 * bright * u_intensity * u_aurora * nightOnly;

  // Horizon glow that rises with progress.
  float rise = 0.34 + 0.30 * clamp(u_progress, 0.0, 1.0);
  float hg = exp(-uv.y / rise * 2.6);
  float hn = 0.75 + 0.5 * fbm(vec2(p.x * 2.2 + t * 0.05, t * 0.04));
  vec3 hcol = mix(u_a0, u_a1, smoothstep(-0.7, 0.7, p.x + 0.15 * sin(t * 0.07)));
  col += hcol * hg * hn * (0.20 + 0.30 * clamp(u_progress, 0.0, 1.0)) * bright * u_intensity;
  col += mix(u_a2, u_a0, 0.5) * exp(-uv.y * 9.0) * 0.12 * bright;
  return col;
}

// Soft drifting clouds (0..1 coverage) and how lit they are from the sun side.
float skyClouds(vec2 p, float t, vec2 sunP, out float lit) {
  vec2 q = vec2(p.x * 1.35 + t * 0.006, p.y * 3.4);
  float c = fbm(q + fbm(q * 0.7 + 4.0) * 0.8);
  float band = smoothstep(0.30, 0.52, p.y) * (1.0 - smoothstep(0.92, 1.1, p.y));
  float cov = smoothstep(0.50, 0.72, c) * band;
  float c2 = fbm(q + vec2(0.03, -0.05) * normalize(sunP - p + 1e-4));
  lit = clamp(0.55 + (c - c2) * 5.0, 0.0, 1.0);
  return cov;
}

// Sun bloom: a hot halo plus faint rays — what makes the disc read as the sun rather than a moon.
// Soft, so it lives in this half-resolution pass (the crisp disc is drawn in the scene pass).
float sunBloom(vec2 p, vec2 sunP, float t) {
  vec2 d = p - sunP;
  float dist = length(d) + 1e-4;
  float halo = exp(-dist * 30.0) * 0.95 + exp(-dist * 9.0) * 0.28;
  float rays = pow(abs(cos(atan(d.y, d.x) * 4.0 + t * 0.012)), 18.0) * exp(-dist * 11.0) * 0.2;
  return halo + rays;
}

// Clear daytime sky: deep zenith to hazy horizon, sun glow, sunlit cumulus. Lightly theme-tinted.
vec3 daySky(vec2 uv, vec2 p, vec2 sunP, float t) {
  vec3 zen = mix(vec3(0.07, 0.20, 0.52), u_a1 * 0.45, 0.16);
  vec3 hor = mix(vec3(0.52, 0.66, 0.84), u_a0 * 0.8 + 0.12, 0.10);
  vec3 col = mix(hor, zen, pow(clamp(uv.y * 1.05, 0.0, 1.0), 0.75));
  float d = length(p - sunP);
  col += vec3(1.0, 0.95, 0.85) * (exp(-d * 3.2) * 0.35 + exp(-d * 14.0) * 0.4);
  col += vec3(1.0, 0.94, 0.80) * sunBloom(p, sunP, t) * smoothstep(-0.06, 0.02, u_sunElev);
  float lit;
  float cov = skyClouds(p, t, sunP, lit);
  vec3 cloud = mix(vec3(0.46, 0.52, 0.64), vec3(1.0, 0.99, 0.96), lit);
  return mix(col, cloud * 0.95, cov * 0.85);
}

// Sunrise / sunset sky: warm band on the sun side, violet zenith, clouds lit from below.
vec3 goldenSky(vec2 uv, vec2 p, vec2 sunP, float t) {
  vec3 warm = mix(vec3(1.0, 0.50, 0.24), u_a2 * 0.7 + vec3(0.3, 0.12, 0.05), 0.22);
  vec3 rose = mix(vec3(0.78, 0.36, 0.46), u_a0 * 0.6 + 0.1, 0.25);
  if (u_dawn > 0.5) rose = mix(rose, vec3(0.62, 0.48, 0.70), 0.35); // dawn a touch cooler
  vec3 zen = mix(vec3(0.10, 0.10, 0.30), u_c1 * 1.6, 0.35);
  float side = exp(-abs(p.x - sunP.x) * 0.9);
  float h = clamp(uv.y, 0.0, 1.0);
  vec3 col = mix(mix(rose, warm, side), zen, smoothstep(0.08, 0.85, h));
  float d = length(p - sunP);
  col += warm * (exp(-d * 2.4) * 0.45 + exp(-d * 10.0) * 0.45);
  col += mix(warm, vec3(1.0, 0.85, 0.6), 0.4) * sunBloom(p, sunP, t) * 0.8 * smoothstep(-0.06, 0.02, u_sunElev);
  float lit;
  float cov = skyClouds(p, t, sunP, lit);
  vec3 cloud = mix(vec3(0.28, 0.16, 0.28), mix(vec3(1.0, 0.62, 0.40), vec3(1.0, 0.80, 0.62), side), lit * (0.5 + 0.5 * side));
  return mix(col, cloud, cov * 0.8);
}

// The soft sky at screen uv (0..1, y up), for the current time of day. Rendered at reduced
// resolution; stars and the sun disc are added at full resolution in the scene pass (TEX_SKY).
vec3 skyColor(vec2 uv) {
  float aspect = u_res.x / u_res.y;
  vec2 par = (u_mouse - 0.5) * 0.03;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y) + par;
  vec2 sunP = vec2((u_sun.x - 0.5) * aspect, u_sun.y) + par;
  float t = u_time;
  float bright = 0.55 + 0.55 * clamp(u_energy, 0.0, 1.0);
  float day = clamp(u_day, 0.0, 1.0);
  float gold = clamp(u_golden, 0.0, 1.0);

  vec3 col = vec3(0.0);
  if (day < 0.995 && gold < 0.995) col = nightSky(uv, p, t, bright);
  if (day > 0.005) col = mix(col, daySky(uv, p, sunP, t), day);
  if (gold > 0.005) col = mix(col, goldenSky(uv, p, sunP, t), gold * 0.85);
  return col;
}
`;

// Sky pass output: sqrt-encoded (col / 2) so an 8-bit texture keeps dark-sky precision and
// highlights up to 2.0 survive. TEX_SKY decodes it for the scene pass.
const SKY_MAIN = `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  gl_FragColor = vec4(sqrt(clamp(skyColor(uv) * 0.5, 0.0, 1.0)), 1.0);
}
`;

const TEX_SKY = `
uniform sampler2D u_skyTex;

// Star field, drawn at full resolution so stars stay pin-sharp.
vec3 stars(vec2 uv, float aspect, float t) {
  vec3 acc = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float cells = 46.0 + fl * 38.0;
    vec2 g = vec2(uv.x * aspect, uv.y) * cells + fl * 31.7;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id);
    if (h > 0.93 - fl * 0.02) {
      vec2 off = (hash22(id) - 0.5) * 0.6;
      float d = length(f - off);
      float size = 0.05 + 0.10 * hash21(id + 3.1);
      float tw = 0.55 + 0.45 * sin(t * (0.6 + 2.2 * hash21(id + 9.7)) + h * 40.0);
      float s = smoothstep(size, 0.0, d) * tw;
      vec3 tint = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.92, 0.85), hash21(id + 5.5));
      acc += tint * s * (0.5 + 0.9 * hash21(id + 1.7));
    }
  }
  return acc;
}

// The sun disc (full resolution, so terrain drawn over the sky cuts it cleanly). Additive-ish.
vec3 sunDisc(vec2 uv, float aspect) {
  if (u_sunElev < -0.06) return vec3(0.0);
  vec2 d = vec2((uv.x - u_sun.x) * aspect, uv.y - u_sun.y);
  float r = 0.026;
  float aa = 1.5 / u_res.y;
  float disc = smoothstep(r + aa, r - aa, length(d));
  vec3 c = mix(vec3(1.0, 0.97, 0.90) * 2.4, vec3(1.0, 0.58, 0.28) * 2.2, clamp(u_golden, 0.0, 1.0));
  return c * disc * smoothstep(-0.06, 0.02, u_sunElev);
}

// The sky pass plus stars and sun, at any screen uv (scenes also use it for mirrored reflections).
vec3 skyColor(vec2 uv) {
  vec3 v = texture2D(u_skyTex, clamp(uv, 0.0, 1.0)).rgb;
  vec3 col = 2.0 * v * v;
  float aspect = u_res.x / u_res.y;
  vec2 par = (u_mouse - 0.5) * 0.03;
  float energy = clamp(u_energy, 0.0, 1.0);
  float starVis = 1.0 - smoothstep(0.0, 0.35, u_day + u_golden * 0.4);
  if (starVis > 0.001) col += stars(uv + par * 0.4, aspect, u_time) * smoothstep(0.12, 0.65, uv.y) * (0.65 + 0.35 * energy) * starVis;
  vec3 sd = sunDisc(uv, aspect);
  col = mix(col, sd, clamp(sd.r, 0.0, 1.0));
  return col;
}
`;

const SCENE_MAIN = `
uniform float u_alpha;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float t = u_time;

  vec3 col = sceneColor(uv, skyColor(uv));

  // Daylight readability: a soft shade behind the timer so white digits stay legible on bright skies.
  vec2 rc = vec2((uv.x - u_ring.x) * aspect, uv.y - u_ring.y);
  col *= 1.0 - exp(-dot(rc, rc) / 0.032) * 0.26 * clamp(u_day + u_golden * 0.3, 0.0, 1.0);

  // Completion shockwave from the timer ring.
  if (u_pulse > 0.001) {
    vec2 cp = vec2((uv.x - u_center.x) * aspect, uv.y - u_center.y);
    float rad = (1.0 - u_pulse) * 1.35;
    float ring = exp(-pow((length(cp) - rad) / 0.075, 2.0));
    col += mix(u_a0, u_a1, 0.5) * ring * u_pulse * 0.55;
    col += u_a2 * exp(-length(cp) * 3.0) * u_pulse * u_pulse * 0.12;
  }

  // Radial vignette.
  vec2 vp = uv - 0.5;
  vp.x *= 0.9;
  col *= 1.0 - smoothstep(0.35, 0.95, length(vp)) * 0.62;

  // Gentle filmic tone mapping, then dither to kill banding.
  col = 1.0 - exp(-max(col, 0.0) * 1.35);
  col = pow(col, vec3(0.96));
  float dn = hash21(gl_FragCoord.xy + fract(t) * 91.7) + hash21(gl_FragCoord.yx * 1.31 + 7.7);
  col += (dn - 1.0) / 255.0 * 1.5;

  gl_FragColor = vec4(max(col, 0.0), u_alpha);
}
`;

/** Pass 1: the sky into an offscreen texture. */
export function buildSkyShader() {
  return HEADER + NOISE + SKY + SKY_MAIN;
}

/**
 * Pass 2: one scene over the sky texture, plus post.
 * @param {string} sceneGlsl helpers + one scene + `vec3 sceneColor(vec2 uv, vec3 sky)`
 */
export function buildSceneShader(sceneGlsl) {
  return HEADER + NOISE + TEX_SKY + sceneGlsl + SCENE_MAIN;
}
