// Scene: Blossom valley (theme: sakura).
// A valley under the real sky: snow-dusted peaks, patchwork hills, a terraced hill with a switchback lantern
// path up to a five-tier pagoda, groves of cherry trees, a pond with a torii gate, lily pads, drifting petals
// and floating lanterns, birds crossing the daytime sky, framed by a large blossoming cherry on the left
// whose crown is built from clusters of five-petal flowers.
// Time of day: sak_rig() sets one light rig and palette per pixel (sunlit-look weight, key light direction and
// colour, sky ambient, the real sky's horizon haze, valley mist, lantern switch). Each layer keeps its moonlit
// night colours and blends toward a sunlit-albedo look through that rig; colours shared by repeated shapes are
// blended once, outside the loops, so the clock moves the whole valley continuously at little cost.
// GLSL rules: GLSL ES 1.00, every helper in this file is prefixed "sak_", entry point scene_sakura(uv, sky).
// Compile-time note (ANGLE/D3D inlines every call and unrolls every loop): the land is evaluated once
// (at the mirrored uv for water pixels), the heavy helpers have as few call sites as possible, and the
// crown's lighting gradient comes from one value-and-gradient pass instead of extra evaluations.
export default {
  key: 'sakura',
  name: 'Blossom valley',
  glsl: `
// ------------------------------------------------------------------ scene: sakura (sak_*)
const float SAK_WATER = 0.155;
const float SAK_TORII_Y = 0.112;

// Light rig and palette, set once per pixel by sak_rig() before anything is painted.
float sak_gW;   // 0 = the moonlit night look .. 1 = the sunlit look (day, sunrise, sunset)
float sak_gOn;  // lanterns and windows: 1 at night .. 0 in daylight
float sak_gS;   // the sun is up (direct sunlight)
float sak_gG;   // sunrise / sunset warmth
float sak_gM;   // valley mist: 1 at night, thick at dawn, thin by day
float sak_gKB;  // break mood: a pale pre-dawn
float sak_gKI;  // idle mood: the valley asleep under a cooler moon
float sak_gLp;  // lantern strength before the time-of-day switch
vec3 sak_gL;    // key light direction (x right, y up, z toward the viewer): the moon, then the sun
vec3 sak_gK;    // key light colour
vec3 sak_gA;    // ambient sky fill
vec3 sak_gH;    // the real sky just above the horizon in this column (aerial perspective)
vec3 sak_gT;    // sunlit-look light on ground facing up: key by the sun's height plus sky ambient
vec3 sak_gF;    // sunlit-look light on forms facing the key light
vec3 sak_gHz;   // palette haze of the night look
vec3 sak_gBl;   // blossom colour of the night look
vec3 sak_gBD;   // blossom albedo of the sunlit look
vec3 sak_gMt;   // moonlight tint
vec3 sak_gWm;   // lantern glow
vec3 sak_gDw;   // break's pre-dawn blush
// Blossom-clump colours, shared by both clump layers of the big tree (set in scene_sakura).
vec3 sak_cL;
vec3 sak_cDk;
vec3 sak_cBr;
vec3 sak_cRm;
vec3 sak_cCt;
vec3 sak_cSg;

// Coverage of an sdf in world units (crisp, ~1.6 px ramp).
float sak_fill(float d) {
  float w = 0.8 / u_res.y;
  return smoothstep(w, -w, d);
}
float sak_rect(vec2 p, vec2 c, vec2 hs) {
  vec2 d = abs(p - c) - hs;
  return max(d.x, d.y);
}
float sak_smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sak_seg(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float sak_edge(float x) { return smoothstep(0.12, 0.95, abs(x)); }
// Three octaves of 1D value noise (cheaper than sc_fbm1 for gentle profiles), ~0..1.
float sak_n3(float x) { return sc_n1(x) * 0.57 + sc_n1(x * 2.07 + 17.3) * 0.29 + sc_n1(x * 4.3 + 31.0) * 0.14; }

float sak_lamp() { return sak_gLp * sak_gOn; }
// Lanterns switch on one by one as dusk deepens (h: that lantern's hash); all lit at night.
float sak_lampH(float h) { return sak_gLp * smoothstep(h * 0.55, h * 0.55 + 0.25, sak_gOn); }

// Sunlit colour of an albedo: key light by a lambert term plus sky ambient (ao scales the ambient).
vec3 sak_sun(vec3 alb, float lam, float ao) { return alb * (sak_gK * clamp(lam, 0.0, 1.0) + sak_gA * ao); }

// The light rig and palette for this pixel (x: screen x of the column, for the horizon haze).
void sak_rig(float x) {
  // Phase moods read from the sakura palettes (they crossfade with the uniforms).
  float kB = smoothstep(0.52, 0.64, u_a0.g);
  float kI = smoothstep(0.93, 0.86, u_a0.r);
  sak_gKB = kB;
  sak_gKI = kI;
  sak_gHz = u_c1 * 0.5 + u_c2 * 0.45 + mix(u_a1, u_a0, 0.35) * 0.08;
  sak_gBl = mix(mix(u_a0, vec3(1.0, 0.8, 0.9), 0.22 + 0.08 * kB), u_a1 * 0.9, 0.3 * kI);
  sak_gBD = mix(vec3(1.0, 0.72, 0.84), u_a0, 0.3);
  sak_gMt = mix(mix(vec3(1.0, 0.95, 0.92), u_a1, 0.22), vec3(0.78, 0.85, 1.0), 0.35 * kI);
  sak_gWm = mix(vec3(1.0, 0.56, 0.24), u_a2, 0.3);
  sak_gDw = mix(u_a2, u_a0, 0.4);
  sak_gLp = (0.8 + 0.2 * u_energy) * (1.0 - 0.4 * kB);
  float g = clamp(u_golden, 0.0, 1.0);
  float e = max(u_sunElev, 0.0);
  sak_gG = g;
  sak_gW = clamp(u_day + g * 0.9, 0.0, 1.0);
  sak_gOn = sc_lights();
  sak_gS = smoothstep(-0.05, 0.05, u_sunElev);
  // Mist pools in the valley at sunrise, thins to a light haze by day, lingers a little at sunset.
  sak_gM = mix(1.0, 0.14 + g * mix(0.34, 0.8, u_dawn), sak_gW);
  // Light follows the sun across the sky (low from the left at sunrise, overhead at noon, low from the
  // right at sunset); before sunrise and after sunset it comes from the moon on the right. A low sun is
  // in front of the viewer, so it rakes across the valley: little frontal light, bright rims.
  vec3 sl = vec3(clamp((u_sun.x - 0.5) * 2.6, -1.0, 1.0), 0.18 + e * 1.1, 0.06 + 0.5 * smoothstep(0.08, 0.45, e));
  sak_gL = normalize(mix(vec3(0.5, 0.64, 0.58), sl, smoothstep(0.0, 0.35, u_day + g)));
  vec3 gold = mix(vec3(1.0, 0.56, 0.3), vec3(1.0, 0.7, 0.66), u_dawn * 0.65);
  vec3 sunK = mix(vec3(1.0, 0.95, 0.87), gold, clamp(g * 1.7, 0.0, 1.0) * 0.92) * 1.3;
  sak_gK = mix(sak_gMt * 0.45, sunK, sak_gS);
  vec3 aDay = mix(vec3(0.33, 0.43, 0.6), u_a1 * 0.5, 0.1);
  vec3 aGold = mix(vec3(0.3, 0.19, 0.29), vec3(0.3, 0.28, 0.46), u_dawn);
  sak_gA = mix(mix(sak_gHz * 0.5, aDay, clamp(u_day, 0.0, 1.0)), aGold, g * 0.7);
  // Sampled just above the horizon, below the aurora (its fine striations would streak the land).
  vec3 h = texture2D(u_skyTex, vec2(x, 0.2)).rgb;
  sak_gH = 2.0 * h * h;
  sak_gT = sak_gK * clamp(0.3 + 0.65 * sak_gL.y, 0.0, 1.0) + sak_gA;
  sak_gF = sak_gK * 0.85 + sak_gA;
}

// Placement relative to the aspect so narrow phone screens still see every landmark.
float sak_pagodaX() { return -clamp(0.27 * sc_aspect(), 0.1, 0.52); }
float sak_toriiX() { return clamp(0.29 * sc_aspect(), 0.1, 0.56); }
vec2 sak_moonPos() { return vec2(0.31 * sc_aspect(), 0.80); }
float sak_nearScale() { return clamp(0.3 + 0.4 * sc_aspect(), 0.55, 1.0); }

// ------------------------------------------------------------------ sky: moon, birds, dawn
// Distant birds gliding across the daytime sky in loose flocks (coverage 0..1): one bird per cell of a
// band that drifts slowly left, flocks where a slow noise over the cells allows. p: world coords.
float sak_birds(vec2 p, float t) {
  float cw = 0.034;
  float ci = floor((p.x + t * 0.011) / cw);
  vec2 h = hash22(vec2(ci, 7.3));
  if (h.x > smoothstep(0.5, 0.78, sc_n1(ci * 0.23 + 3.0)) * 0.9) return 0.0;
  vec2 c = vec2((ci + 0.25 + 0.5 * h.y) * cw - t * 0.011,
    0.8 + 0.1 * (sc_n1(ci * 0.11 + 9.0) - 0.5) + (h.x - 0.4) * 0.035 + 0.003 * sin(t * 0.4 + ci));
  float s = 0.0048 * (0.75 + 0.5 * h.y);
  vec2 d = (p - c) / s;
  float ax = abs(d.x);
  if (ax > 1.0 || abs(d.y) > 1.0) return 0.0;
  float flap = sin(t * (6.0 + 3.0 * h.x) + ci * 2.0) * smoothstep(-0.2, 0.6, sin(t * 0.37 + ci * 1.3));
  float wy = (0.2 + 0.5 * flap) * ax - 0.35 * ax * ax;
  return sak_fill((abs(d.y - wy) - 0.19 * (1.0 - 0.65 * ax)) * s);
}

vec3 sak_sky(vec2 p, vec3 sky) {
  float t = u_time;
  float kB = sak_gKB;
  float kI = sak_gKI;
  vec3 mt = sak_gMt;
  vec2 mc = sak_moonPos();
  vec3 col = sky;
  // Break: a rose-peach pre-dawn blush rising behind the far peaks. Idle: a cooler, darker night.
  float hzn = exp(-max(p.y - 0.2, 0.0) / 0.15);
  col += sak_gDw * kB * 0.7 * (1.0 - sak_gW) * hzn * (0.45 + 0.55 * exp(-(p.x - 0.25) * (p.x - 0.25) / 0.5));
  col = mix(col, col * vec3(0.78, 0.84, 1.08), (0.5 - 0.36 * sak_gW) * kI);
  // Crescent moon (night only): crisp limb, soft terminator, faint maria, earthshine and a two-part halo.
  float nv = sc_nightVis();
  float r = 0.034;
  vec2 d = p - mc;
  float ld = length(d);
  float aa = 1.0 / u_res.y;
  float disc = smoothstep(r + aa, r - aa, ld);
  float sh = length(d - vec2(0.36, 0.2) * r) / (r * 0.95);
  float lit = disc * smoothstep(0.96, 1.06, sh);
  float surf = 0.84 + 0.16 * vnoise(d / r * 2.8 + 3.0);
  surf *= 0.8 + 0.2 * sqrt(max(1.0 - ld * ld / (r * r), 0.0));
  col += mt * nv * (lit * surf * 1.75 + disc * (1.0 - lit) * 0.05);
  col += mt * nv * (exp(-max(ld - r, 0.0) / (r * 1.1)) * 0.15 + exp(-ld / (r * 7.0)) * 0.06) * (1.0 + 0.5 * kI - 0.35 * kB);
  // Birds by day and at sunset, dark against the bright sky.
  float bv = 1.0 - nv;
  if (bv > 0.0 && p.y > 0.7) col = mix(col, sak_gA * 0.22 + vec3(0.02, 0.016, 0.024), sak_birds(p, t) * bv * 0.85);
  return col;
}

// ------------------------------------------------------------------ land helpers
// 1D value noise with its derivative.
vec2 sak_nd(float x) {
  float i = floor(x);
  float f = fract(x);
  float a = hash11(i);
  float b = hash11(i + 1.0);
  return vec2(mix(a, b, f * f * (3.0 - 2.0 * f)), (b - a) * 6.0 * f * (1.0 - f));
}
// Peak profile with slope: one ridged octave for the summits, smooth detail on top. x: height, y: d/dx,
// z: the slope of the smooth second octave alone (no crease at the summits, for broad faces).
vec3 sak_range(float x) {
  vec3 v = vec3(0.0);
  float a = 0.5;
  float fr = 1.0;
  for (int i = 0; i < 5; i++) {
    vec2 n = sak_nd(x * fr + float(i) * 7.31);
    if (i == 0) {
      float s = n.x * 2.0 - 1.0;
      n = vec2(1.0 - abs(s), -sign(s) * 2.0 * n.y);
    }
    // Only the two broad octaves feed the slope: big lit and shaded faces, no streaks.
    v += a * vec3(n.x, i < 2 ? n.y * fr : 0.0, i == 1 ? n.y * fr : 0.0);
    fr *= 2.13;
    a *= 0.5;
  }
  return v;
}

// Five-tier pagoda. q: local coords (origin = base centre, 1 unit = scale). Returns the sdf (local units).
// win: lit windows, door and eave lanterns; glow: halo of those lights; rim: lit roof tops; rf: roof mask.
float sak_pagoda(vec2 q, float kI, float sx, out float win, out float glow, out float rim, out float rf) {
  float ax = abs(q.x);
  float d = sak_rect(q, vec2(0.0, 0.025), vec2(0.3, 0.025));
  d = min(d, sak_rect(q, vec2(0.0, 0.058), vec2(0.25, 0.012)));
  float y = 0.07;
  win = 0.0;
  glow = 0.0;
  rim = 0.0;
  rf = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float hi = 0.16 - 0.011 * fi;
    float bw = 0.165 - 0.019 * fi;
    float rw = 0.36 - 0.043 * fi;
    d = min(d, sak_rect(q, vec2(0.0, y + hi * 0.27), vec2(bw, hi * 0.27)));
    // Roof: flat underside flicking up at the eaves, concave top sweeping down from the tier above.
    float tx = clamp(ax / rw, 0.0, 1.0);
    float r0 = y + hi * 0.52;
    float lift = 0.085 * tx * tx * tx * tx;
    float yb = r0 + lift;
    float yt = yb + 0.022 + (hi * 0.48 - 0.022) * pow(1.0 - tx, 1.6);
    float roof = max(ax - rw, max(yb - q.y, q.y - yt));
    d = min(d, roof);
    rf += step(roof, 0.0);
    // Tiled roof tops catch the light (brighter on the light's side); undersides stay dark.
    rim += step(roof, 0.0) * smoothstep(yb + 0.008, yb + 0.02, q.y) * (0.55 + 0.45 * smoothstep(-0.1, 0.25, q.x * sx));
    // Warm window on the lower tiers (fewer when the valley sleeps), lattice bars.
    float wr = sak_rect(q, vec2(0.0, y + hi * 0.25), vec2(bw * 0.42, hi * 0.15));
    float lat = 0.65 + 0.35 * smoothstep(0.2, 0.5, abs(fract(q.x * 38.0) - 0.5));
    float on = step(0.5, fi) * step(fi, 2.9 - kI * 1.5);
    win += smoothstep(0.01, -0.01, wr) * lat * on;
    glow += exp(-max(wr, 0.0) / 0.06) * on * 0.5;
    // Tiny lanterns hanging from the eave tips.
    float lp = length(vec2(ax - rw * 0.92, q.y - (r0 + 0.045 - 0.05)));
    win += smoothstep(0.022, 0.012, lp) * (1.0 - 0.6 * kI);
    glow += exp(-lp / 0.05) * (1.0 - 0.6 * kI);
    y += hi;
  }
  // Sorin spire: base box, stacked rings, jewel.
  float sy = q.y - y;
  float sd = sak_rect(q, vec2(0.0, y + 0.018), vec2(0.045, 0.018));
  float ring = step(0.5, fract(sy / 0.028)) * step(0.04, sy) * step(sy, 0.27);
  float sw = mix(0.011, 0.03 - 0.045 * sy, ring);
  sd = min(sd, max(ax - sw, max(-sy, sy - 0.36)));
  sd = min(sd, length(q - vec2(0.0, y + 0.37)) - 0.02);
  d = min(d, sd);
  rf += step(sd, 0.0);
  // Doorway.
  float dr = sak_rect(q, vec2(0.0, 0.115), vec2(0.035, 0.045));
  win += smoothstep(0.01, -0.01, dr);
  glow += exp(-max(dr, 0.0) / 0.07) * 0.6;
  return d;
}

// A tree seen from across the valley: trunk and limbs, then a crown of lobes painted back to front
// (lower lobes in front) with lit upper rims, shadowed undersides and petal-bump edges.
// base: foot of the trunk, R: crown size, seed 0..1, fade: mix toward the haze (distance),
// leaf: 1 for a fresh green (non-blossoming) tree among the cherries.
vec3 sak_tree(vec3 col, vec2 p, vec2 base, float R, float seed, float fade, float detail, float leaf) {
  vec2 d = p - base;
  if (abs(d.x) > R * 1.8 || d.y < -0.015 || d.y > R * 2.5) return col;
  float W = sak_gW;
  vec3 bl = sak_gBl;
  vec3 hz = sak_gHz;
  vec3 H = sak_gH;
  vec3 K = sak_gK;
  vec3 A = sak_gA;
  float tw = R * 0.075;
  vec2 fork = vec2((seed - 0.5) * R * 0.3, R * 0.62);
  float wd = sak_seg(d, vec2(0.0, -0.015), fork, tw * 1.3, tw);
  wd = min(wd, sak_seg(d, fork, vec2(-0.85 * R, 1.2 * R), tw * 0.8, tw * 0.25));
  wd = min(wd, sak_seg(d, fork, vec2(0.9 * R, 1.25 * R), tw * 0.8, tw * 0.25));
  wd = min(wd, sak_seg(d, fork, vec2(0.08 * R, 1.75 * R), tw * 0.7, tw * 0.25));
  col = mix(col, mix(mix(u_c0 * 0.07, hz * 0.2, fade), mix(vec3(0.13, 0.1, 0.09) * (K * 0.5 + A * 0.8), H, fade * 0.7), W), sak_fill(wd));
  // Night: moonlit pink (or a dark leafy mass). Day: the albedo under sun and sky, hazed with distance.
  vec3 dark = mix(mix(mix(bl * 0.12, u_c1 * 0.32, 0.4), u_c0 * 0.14 + hz * 0.08, leaf), hz * 0.45, fade);
  vec3 lite = mix(mix(bl * 0.95, hz * 0.34 + u_c1 * 0.12, leaf), mix(bl, hz, 0.5) * 0.9, fade);
  vec3 alb = mix(sak_gBD, vec3(0.2, 0.33, 0.13), leaf);
  dark = mix(dark, mix(alb * (A * 0.8 + K * 0.08 * (1.0 - leaf)), H, fade * 0.75), W);
  lite = mix(lite, mix(alb * sak_gF, H, fade * 0.55), W);
  vec3 rimC = mix(mix(bl, vec3(1.0, 0.95, 0.97), 0.5) * 0.28 * (1.0 - leaf * 0.7), K * alb * (0.35 + 0.5 * sak_gG), W) * (1.0 - fade);
  vec2 rl = normalize(sak_gL.xy);
  // Blossom dabs: two rotated lattices of small discs, each a little lighter or darker (painterly
  // texture of flower clusters); faded out where they would get smaller than a few pixels.
  vec2 dq = d / (R * 0.1) + seed * 9.0;
  vec2 dq2 = mat2(0.8, 0.6, -0.6, 0.8) * dq + 0.37;
  float dab = (hash21(floor(dq)) - 0.5) * smoothstep(0.48, 0.3, length(fract(dq) - 0.5));
  dab += (hash21(floor(dq2) + 5.0) - 0.5) * smoothstep(0.48, 0.3, length(fract(dq2) - 0.5));
  dab *= detail;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 h = hash22(vec2(seed * 71.3, fi * 3.7));
    float sx = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
    vec2 lc = fi < 0.5 ? vec2(0.0, 1.75) : (fi < 2.5 ? vec2(sx * 0.78, 1.42) : vec2(sx * 0.36, 1.1));
    lc = (lc + (h - 0.5) * 0.2) * R;
    float lr = R * (fi < 0.5 ? 0.56 : 0.52) * (0.9 + 0.2 * h.y);
    vec2 dv = (d - lc) / (lr * vec2(1.18, 0.9));
    float ll = length(dv);
    float an = atan(dv.y, dv.x);
    float wob = (0.055 * sin(an * 9.0 + h.x * 20.0) + 0.035 * sin(an * 17.0 + h.y * 30.0)) * smoothstep(0.4, 1.0, ll);
    float cov = sak_fill((ll - 1.0 + wob) * lr);
    if (cov > 0.0) {
      vec3 n = vec3(dv, sqrt(max(1.0 - ll * ll, 0.0)));
      float lit = 0.3 + 0.7 * clamp(dot(n, sak_gL), 0.0, 1.0);
      lit *= 0.7 + 0.3 * smoothstep(-0.9, 0.3, dv.y);
      lit = clamp(lit + dab * 0.45 * (0.4 + 0.6 * lit), 0.0, 1.1);
      vec3 cc = mix(dark, lite, lit * lit * (3.0 - 2.0 * lit));
      cc += rimC * smoothstep(0.7, 1.0, ll) * smoothstep(0.1, 0.9, dot(dv, rl) / max(ll, 1e-3));
      col = mix(col, cc, cov);
    }
  }
  return col;
}

// A small tree on the grove's hill line (a crown ~20 px across): trunk and three lobes, lit like sak_tree.
vec3 sak_treeS(vec3 col, vec2 p, vec2 base, float R, float seed, float leaf) {
  vec2 d = p - base;
  if (abs(d.x) > R * 1.6 || d.y < -0.004 || d.y > R * 2.4) return col;
  float W = sak_gW;
  vec3 bl = sak_gBl;
  vec3 hz = sak_gHz;
  vec3 H = sak_gH;
  vec3 K = sak_gK;
  vec3 A = sak_gA;
  col = mix(col, mix(u_c0 * 0.07 * 0.6 + hz * 0.08, mix(vec3(0.13, 0.1, 0.09) * (K * 0.5 + A * 0.8), H, 0.28), W), sak_fill(max(abs(d.x) - R * 0.09, d.y - R)));
  vec3 dark = mix(mix(mix(bl * 0.12, u_c1 * 0.32, 0.4), u_c0 * 0.14 + hz * 0.08, leaf), hz * 0.45, 0.4);
  vec3 lite = mix(mix(bl * 0.95, hz * 0.34 + u_c1 * 0.12, leaf), mix(bl, hz, 0.5) * 0.9, 0.4);
  vec3 alb = mix(sak_gBD, vec3(0.2, 0.33, 0.13), leaf);
  dark = mix(dark, mix(alb * (A * 0.8 + K * 0.08 * (1.0 - leaf)), H, 0.3), W);
  lite = mix(lite, mix(alb * sak_gF, H, 0.22), W);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 h = hash22(vec2(seed * 71.3, fi * 3.7));
    vec2 lc = (vec2(fi == 0.0 ? 0.0 : (fi - 1.5) * 1.3, fi == 0.0 ? 1.62 : 1.18) + (h - 0.5) * 0.2) * R;
    float lr = R * (fi == 0.0 ? 0.62 : 0.56) * (0.9 + 0.2 * h.y);
    vec2 dv = (d - lc) / (lr * vec2(1.18, 0.9));
    float ll = length(dv);
    vec3 n = vec3(dv, sqrt(max(1.0 - ll * ll, 0.0)));
    float lit = (0.3 + 0.7 * clamp(dot(n, sak_gL), 0.0, 1.0)) * (0.7 + 0.3 * smoothstep(-0.9, 0.3, dv.y));
    col = mix(col, mix(dark, lite, lit * lit * (3.0 - 2.0 * lit)), sak_fill((ll - 1.0) * lr));
  }
  return col;
}

// The pagoda's terraced mound: a stack of elliptical terraces seen from slightly above, painted bottom
// up: stone walls (lit on the light's side), grassy terrace tops lined with little blossom trees, and a
// switchback path marked by tiny lanterns. x: world x relative to the mound centre.
vec3 sak_mound(vec3 col, float x, float y, vec3 mist, float refl) {
  float t = u_time;
  float px = 1.0 / u_res.y;
  float W = sak_gW;
  float kI = sak_gKI;
  vec3 hz = sak_gHz;
  vec3 mt = sak_gMt;
  vec3 bl = sak_gBl;
  vec3 wm = sak_gWm;
  vec3 H = sak_gH;
  vec3 K = sak_gK;
  vec3 A = sak_gA;
  vec3 L = sak_gL;
  // Colours shared by every terrace, blended once between the moonlit and the sunlit look.
  vec3 stone = vec3(0.45, 0.42, 0.39);
  vec3 wBase = mix(mix(hz * 0.22, u_c2 * 0.2, 0.3), stone * A * 0.62, W);
  vec3 wSide = mix(mt * 0.045, stone * K * 0.85, W);
  vec3 wLip = mix(mix(mt, bl, 0.3) * 0.1, K * 0.07, W);
  vec3 wAdd = H * 0.3 * W;
  vec3 tTop = mix(mix(hz * 0.4, bl * 0.2, 0.2) + mt * 0.03, mix(vec3(0.27, 0.4, 0.15) * sak_gT, H, 0.25), W);
  vec3 stC = mix(hz * 0.45 + wm * 0.06, mix(vec3(0.56, 0.53, 0.48) * sak_gT, H, 0.3), W);
  vec3 trDk = mix(mix(bl * 0.16, hz * 0.3, 0.4), mix(sak_gBD * A * 0.85, H, 0.25), W);
  vec3 trLt = mix(mix(bl * 0.7, mist, 0.3), mix(sak_gBD * sak_gF, H, 0.25), W);
  vec3 lfDk = mix(trDk, mix(vec3(0.22, 0.38, 0.16) * A * 0.85, H, 0.25), W);
  vec3 lfLt = mix(trLt, mix(vec3(0.22, 0.38, 0.16) * sak_gF, H, 0.25), W);
  vec3 trRm = mix(mix(bl, vec3(1.0), 0.4) * 0.1, K * sak_gBD * 0.08, W);
  vec3 trTk = mix(hz * 0.12, H * 0.35, W);
  vec3 pthC = mix(mix(hz * 0.45, wm * 0.35, 0.35), mix(vec3(0.62, 0.54, 0.42) * sak_gT, H, 0.25), W);
  vec2 tlD = mix(vec2(0.55, 0.83), normalize(L.xy), W);
  float lamp = 1.0 - 0.5 * kI;
  float sw = x < 0.0 ? 0.8 : 1.0;
  float kt = 0.12;
  float zP = 0.17;
  float eP = 0.0;
  float rP = 0.4;
  float sP = -0.12;
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    float r = (0.27 - 0.047 * fk) * sw;
    float rb = r + 0.016 * sw;
    float z = 0.207 + 0.0255 * fk - 0.0012 * fk * fk;
    float e = sqrt(max(r * r - x * x, 0.0));
    float eb = sqrt(max(rb * rb - x * x, 0.0));
    float yTop = z - kt * e;
    // Sloping stone wall between the terrace below and this terrace's front lip.
    float Rw = mix(rb, r, clamp((y - zP) / (z - zP), 0.0, 1.0));
    float wallD = max(max(abs(x) - Rw, y - yTop), zP - kt * eb - y);
    float wall = sak_fill(wallD);
    float wf = clamp((y - (zP - kt * eb)) / max(yTop - zP + kt * eb, 1e-4), 0.0, 1.0);
    float sn = (0.88 + 0.12 * sc_n1(x * 700.0 + floor(wf * 4.0) * 17.0 + fk * 31.0)) * (1.0 - 0.07 * W * step(0.5, fract(wf * 4.0)));
    // The curved wall turns toward the light: moonlit on the right at night, sunlit on the sun's side by day.
    float nx = clamp(x / r, -1.0, 1.0);
    float side = mix(smoothstep(-0.3, 1.0, nx), clamp(dot(vec3(nx, 0.15, sqrt(max(1.0 - nx * nx, 0.0))), L), 0.0, 1.0), W);
    vec3 wc = (wBase * (0.7 + 0.3 * wf) + wSide * side * (0.5 + 0.5 * wf)) * sn + wAdd;
    wc += wLip * exp(-max(yTop - y, 0.0) / (1.3 * px));
    // Flat terrace top (the sliver in front of the next wall shows): grass by day.
    float yz = (y - z) / kt;
    float f = x * x + yz * yz - r * r;
    float topD = f / (2.0 * sqrt(x * x + yz * yz / (kt * kt)) + 1e-4);
    col = mix(col, wc, wall);
    col = mix(col, tTop, sak_fill(topD));
    // Stair up this wall where the path arrives.
    float sK = (mod(fk, 2.0) < 0.5 ? -1.0 : 1.0) * (0.55 - 0.1 * fk) * r * step(0.5, fk);
    float st = step(abs(x - sK), 0.0035) * wall * (0.6 + 0.4 * step(0.5, fract((y - zP) / 0.004)));
    col = mix(col, stC, st * 0.8);
    if (k > 0 && refl < 0.5) {
      // A row of trees on the terrace below, standing in front of this wall (mostly cherries).
      float cx0 = x * 55.0 + fk * 0.37;
      float hc = hash11(floor(cx0) * 1.31 + fk * 7.7);
      float grp = smoothstep(0.3, 0.65, sc_n1(x * 26.0 + fk * 13.0));
      float R = (0.0045 + 0.003 * hc) * (0.6 + 0.4 * grp);
      float yb = zP - kt * eP * 0.8;
      vec2 dcl = vec2((fract(cx0) - 0.5 - (hc - 0.5) * 0.2) / 55.0, y - yb - R * 0.95);
      float lob = min(length(dcl), length(dcl - vec2((hc - 0.5) * 1.4 * R, -0.3 * R)) + 0.25 * R);
      float live = step(0.2, hc) * step(abs(x), rP * 0.97) * step(0.35, grp + hc * 0.4);
      float tree = sak_fill(lob - R) * live;
      float trunk = sak_fill(max(abs(dcl.x) - 0.0007, abs(y - yb + 0.001) - R * 0.5)) * live;
      float tl = clamp(0.45 + 0.6 * dot(dcl / R, tlD), 0.1, 1.1);
      float lf = step(0.82, hc);
      vec3 trc = mix(mix(trDk, lfDk, lf), mix(trLt, lfLt, lf), tl);
      trc += trRm * smoothstep(0.6, 1.0, length(dcl) / R) * step(0.0, dcl.y + dcl.x * 0.5);
      col = mix(col, trTk, trunk);
      col = mix(col, trc, tree);
      // The path along the front of the terrace below, with tiny lanterns.
      float along = step(min(sP, sK), x) * step(x, max(sP, sK));
      float yp = zP - kt * eP * 0.82;
      col = mix(col, pthC, smoothstep(1.4 * px, 0.4 * px, abs(y - yp)) * along * 0.7 * (1.0 - tree));
      float u = clamp((x - sP) / (sK - sP + 1e-4), 0.0, 1.0);
      float xl = sP + (sK - sP) * floor(u * 4.0 + 0.5) / 4.0;
      vec2 lp = vec2(xl, zP - kt * sqrt(max(rP * rP - xl * xl, 0.0)) * 0.82 + 0.0025);
      float ldd = length(vec2(x, y) - lp);
      float fl = 0.85 + 0.15 * sin(t * (1.3 + fk * 0.21) + xl * 90.0);
      col += wm * (smoothstep(1.9 * px, 0.7 * px, ldd) * 1.2 + exp(-ldd / 0.005) * 0.13) * fl * sak_lampH(hash11(xl * 37.0 + fk)) * lamp;
    }
    zP = z;
    eP = e;
    rP = r;
    sP = sK;
  }
  return col;
}

// Everything above the pond: far peaks, mid range, the pagoda hill, the grove, the far shore.
// refl = 1 for the (ripple-broken) reflection, which skips the finest detail.
vec3 sak_land(vec2 uv, vec3 sky, float refl) {
  float t = u_time;
  float px = 1.0 / u_res.y;
  float W = sak_gW;
  float g = sak_gG;
  float kB = sak_gKB;
  float kI = sak_gKI;
  vec3 H = sak_gH;
  vec3 L = sak_gL;
  vec3 K = sak_gK;
  vec3 A = sak_gA;
  vec3 hz = sak_gHz;
  vec3 mt = sak_gMt;
  vec3 wm = sak_gWm;
  // Light side for silhouettes (+1 from the right, -1 from the left); overhead sun keeps a little modelling.
  float lx = clamp(L.x * 2.0, -1.0, 1.0);
  float lxf = (lx < 0.0 ? -1.0 : 1.0) * max(abs(lx), 0.3);
  vec3 mist = mix(hz, vec3(sc_luma(hz)), 0.25) * 0.85 + mt * 0.035;
  mist = mix(mist, sak_gDw * 0.42 + hz * 0.35, 0.5 * kB);
  mist = mix(mist, mist * vec3(0.72, 0.8, 1.1), 0.6 * kI);
  // By day the mist is the sky's own haze, lit by the sun; thickest in the valleys at sunrise.
  mist = mix(mist, H * 1.04 + K * 0.05, W);
  float mk = sak_gM;
  vec3 col = sky;

  // 1. Far peaks, cool and pale with distance; faces turned to the light catch it, snow on the summits.
  vec2 p0 = sc_world(uv, 0.04);
  if (p0.y < 0.47) {
    vec3 r = sak_range(p0.x * 2.6 + 4.0);
    float h0 = 0.19 + 0.25 * r.x + 0.04 * sak_edge(p0.x);
    float sl = r.y * 2.6 * 0.25;
    float dd = h0 - p0.y;
    float lit = clamp(-sl * 1.2 * lxf, -1.0, 1.0);
    // Spurs running down from the crest along the fall line: soft facets alternating lit / shaded.
    vec2 sp = sak_nd(p0.x * 15.0 + dd * 9.0 * clamp(sl * 5.0, -1.0, 1.0) + 3.0);
    float face = clamp(lit * 0.8 + (smoothstep(-0.22, 0.22, sp.y) - 0.5) * 0.6 * lxf * smoothstep(0.003, 0.02, dd), -1.0, 1.0);
    float crest = exp(-max(dd, 0.0) / (2.0 * px));
    vec3 c0 = hz * 0.58 + u_c2 * 0.13 + mt * 0.02;
    // atmospheric: less saturated and a touch cooler than the near hills
    c0 = mix(c0, vec3(sc_luma(c0)) * vec3(0.93, 0.96, 1.08), 0.32);
    c0 *= 1.0 + 0.42 * face * exp(-max(dd, 0.0) / 0.08);
    c0 += mt * 0.08 * crest * (0.2 + 0.8 * max(lit, 0.0));
    c0 += sak_gDw * kB * (1.0 - W) * (0.06 + 0.2 * exp(-max(dd, 0.0) / (1.6 * px)) + 0.08 * max(lit, 0.0));
    // Day: blue-violet rock over forested lower slopes, snow streaking down the gullies of the high
    // summits (fewer caps in the middle, below the timer); faces lit by the sun against blue shadow (the ridge's own slope near the crest, the spurs
    // below it), melting into the real sky's haze with depth.
    float spur = (smoothstep(-0.22, 0.22, sp.y) - 0.5) * smoothstep(0.003, 0.02, dd);
    float fdep = exp(-dd / 0.03);
    vec3 fn = normalize(vec3((-sl * 1.2 + spur * 0.9) * fdep - r.z * 0.8 * (1.0 - fdep), 0.8, 0.45));
    float lam = dot(fn, L);
    float fo = smoothstep(0.3, 0.275, p0.y + 0.02 * sp.x);
    float sline = 0.336 + 0.03 * sp.x - 0.012 * sin(p0.x * 150.0 + sp.x * 5.0) * smoothstep(0.004, 0.012, dd) + 0.018 * smoothstep(0.4, 0.1, abs(p0.x));
    float snow = smoothstep(-0.0015, 0.0015, p0.y - sline) * (1.0 - fo);
    vec3 alb = mix(mix(vec3(0.34, 0.35, 0.46), vec3(0.19, 0.27, 0.27), fo), vec3(0.88, 0.9, 0.98), snow);
    vec3 cD = alb * (K * clamp(lam, 0.0, 1.0) * 0.95 + A * 0.8);
    cD += K * (0.04 + 0.35 * g) * crest * max(lit, 0.0);
    cD = mix(cD, H, (0.26 + 0.36 * smoothstep(0.0, 0.14, dd)) * (1.0 - 0.3 * g));
    c0 = mix(c0, cD, W);
    c0 = mix(c0, mist, smoothstep(0.01, 0.14, dd) * 0.85 * mk);
    col = mix(col, c0, sak_fill(-dd / sqrt(1.0 + sl * sl)));
  }

  // 3. Rolling hills (patchwork fields by day) and the pagoda's terraced mound.
  vec2 p2 = sc_world(uv, 0.18);
  float xp = sak_pagodaX();
  float roll = 0.19 + 0.07 * sak_edge(p2.x) + 0.03 * (sak_n3(p2.x * 3.0 + 9.0) - 0.5);
  float cg = p2.x * 150.0;
  float ch = hash11(floor(cg) + 3.0);
  float cu = fract(cg) * 2.0 - 1.0;
  roll += 0.0035 * (0.4 + ch) * sqrt(max(1.0 - cu * cu, 0.0)) * step(0.35, ch);
  if (p2.y < 0.36) {
    float dd = roll - p2.y;
    float crest = exp(-max(dd, 0.0) / (2.0 * px));
    vec3 c2 = mix(hz * 0.36, u_c2 * 0.3, 0.3);
    c2 += mt * (0.045 * crest + 0.01 * exp(-max(dd, 0.0) / 0.015));
    // Day: spring-green hills in patches of meadow and young fields, the crest line of trees dotted
    // with blossom.
    float fld = sc_n1(p2.x * 38.0 + floor(dd * 70.0 + sin(p2.x * 9.0) + 1.0) * 7.3);
    vec3 hA = mix(vec3(0.2, 0.31, 0.14), vec3(0.34, 0.42, 0.17), fld * smoothstep(0.004, 0.012, dd));
    hA = mix(hA, sak_gBD * 0.8, step(0.72, ch) * smoothstep(0.004, 0.0, dd));
    vec3 c2D = hA * sak_gT + K * (0.08 + 0.3 * g) * crest;
    c2 = mix(c2, mix(c2D, H, 0.3 * (1.0 - 0.3 * g)), W);
    c2 = mix(c2, mist * 0.9, smoothstep(0.0, 0.07, dd) * 0.8 * mk);
    col = mix(col, c2, sc_below(p2.y, roll));
    if (abs(p2.x - xp) < 0.3) col = sak_mound(col, p2.x - xp, p2.y, mist, refl);
    col = mix(col, mist * 0.95, smoothstep(0.232, 0.16, p2.y) * 0.75 * mk);
  }
  // The pagoda crowning the mound.
  vec2 pq = (p2 - vec2(xp, 0.289)) / 0.1;
  if (abs(pq.x) < 0.6 && pq.y > -0.1 && pq.y < 1.3) {
    float win;
    float glow;
    float rim;
    float rf;
    float pd = sak_pagoda(pq, kI, lxf, win, glow, rim, rf);
    float pc = sak_fill(pd * 0.1);
    vec3 pcol = mix(hz * 0.14, u_c0 * 0.2, 0.5) + mix(mt, hz, 0.4) * 0.16 * min(rim, 1.0);
    // Day: vermilion timber under slate-grey tiled roofs; openings read dark.
    vec3 pa = mix(vec3(0.5, 0.15, 0.09), vec3(0.19, 0.19, 0.22), min(rf, 1.0));
    vec3 pD = sak_sun(pa, 0.3 + 0.45 * L.z + 0.25 * lxf * sign(pq.x), 1.0) * (1.0 - 0.6 * min(win, 1.0));
    pD += K * 0.14 * min(rim, 1.0);
    pcol = mix(pcol, mix(pD, H, 0.25), W);
    col = mix(col, pcol, pc);
    float lampE = sak_lamp();
    col += wm * min(win, 1.0) * pc * 1.2 * lampE;
    col += wm * glow * 0.05 * lampE;
  }

  // Mist drifting between the mound and the grove.
  vec2 p3 = sc_world(uv, 0.3);
  float h3 = 0.168 + 0.06 * sak_edge(p3.x * 0.95) + 0.02 * (sak_n3(p3.x * 4.5 + 21.0) - 0.5);
  {
    float bk = (p3.y - (h3 + 0.02)) / 0.035;
    float m = 0.6;
    if (refl < 0.5) m = sc_n1(p3.x * 3.0 + t * 0.02 + p3.y * 6.0) * 0.6 + sc_n1(p3.x * 7.0 - t * 0.03 - p3.y * 13.0) * 0.4;
    col = mix(col, mist * 1.05, exp(-bk * bk) * smoothstep(0.25, 0.8, m) * 0.5 * (1.0 + 0.4 * kI) * mk);
  }

  // 4. The grove: a nearer hill line with small trees, mostly cherries.
  if (p3.y < h3 + 0.06) {
    float dd = h3 - p3.y;
    float crest = exp(-max(dd, 0.0) / (2.0 * px));
    vec3 c3 = mix(hz * 0.2, u_c0 * 0.3, 0.3);
    c3 += mt * 0.035 * crest;
    vec3 c3D = vec3(0.19, 0.28, 0.12) * (0.88 + 0.24 * sc_n1(p3.x * 90.0)) * sak_gT;
    c3D += K * (0.08 + 0.3 * g) * crest;
    c3 = mix(c3, mix(c3D, H, 0.2), W);
    c3 = mix(c3, mist * 0.75, smoothstep(0.0, 0.05, dd) * 0.7 * mk);
    col = mix(col, c3, sc_below(p3.y, h3));
    // One tree per cell (crowns stay inside their cell, so no neighbour search is needed).
    float c = floor(p3.x * 14.0);
    float r1 = hash11(c * 2.71 + 5.0);
    float r2 = hash11(c * 4.33 + 1.0);
    float cx = (c + 0.5 + (r1 - 0.5) * 0.2) / 14.0;
    float bh = 0.168 + 0.06 * sak_edge(cx * 0.95) - 0.003;
    if (r2 > 0.25 + 0.6 * (1.0 - sak_edge(cx * 1.15))) col = sak_treeS(col, p3, vec2(cx, bh), 0.0165 * (0.85 + 0.3 * r1), r2, step(0.7, fract(r1 * 7.3)));
  }

  // Low mist on the pond's far edge.
  vec2 p4 = sc_world(uv, 0.45);
  {
    float bk = (p4.y - (SAK_WATER + 0.02)) / 0.03;
    float m = 0.6;
    if (refl < 0.5) m = sc_n1(p4.x * 7.0 - t * 0.03 + p4.y * 12.0);
    col = mix(col, mist, exp(-bk * bk) * (0.22 + 0.3 * m) * (1.0 + 0.3 * kI) * mk);
  }

  // 5. The far shore with larger cherry trees (and the odd leafy one on the right).
  float h4 = SAK_WATER + 0.008 + 0.006 * (sak_n3(p4.x * 9.0 + 4.0) - 0.5) + 0.028 * sak_edge(p4.x * 1.1);
  if (p4.y < h4 + 0.15) {
    float c = floor(p4.x * 4.2);
    float r1 = hash11(c * 3.17 + 41.3);
    float r2 = hash11(c * 5.71 + 13.7);
    float r3 = hash11(c * 1.93 + 7.1);
    float cx = (c + 0.5 + (r1 - 0.5) * 0.2) / 4.2;
    float e = sak_edge(cx * 1.25);
    float R = 0.052 * mix(0.8, 1.0, r3) * mix(0.55, 1.0, e);
    float base = SAK_WATER + 0.006 + 0.028 * sak_edge(cx * 1.1);
    if (r2 > 0.15 + 0.8 * (1.0 - e)) col = sak_tree(col, p4, vec2(cx, base), R, r1, 0.08, 1.0 - refl, step(0.8, r3) * step(0.0, cx));
    float dd = h4 - p4.y;
    float crest = exp(-max(dd, 0.0) / (2.0 * px));
    vec3 c4 = u_c0 * 0.1 + hz * 0.07;
    c4 += mt * 0.04 * crest;
    // Day: a grassy bank sloping to a darker, damp water line.
    vec3 c4D = mix(vec3(0.17, 0.27, 0.1), vec3(0.12, 0.11, 0.08), smoothstep(0.004, 0.012, dd)) * sak_gT;
    c4D += K * (0.1 + 0.3 * g) * crest;
    c4 = mix(c4, mix(c4D, H, 0.1), W);
    col = mix(col, c4, sc_below(p4.y, h4));
    // Small lanterns along the far shore path (their reflections come from the mirrored lookup).
    float li = floor(p4.x * 11.0);
    float lh = hash11(li * 3.7 + 1.0);
    vec2 lpos = vec2((li + 0.5 + (lh - 0.5) * 0.5) / 11.0, SAK_WATER + 0.011 + 0.028 * sak_edge(p4.x * 1.1));
    float ldd = length(p4 - lpos);
    float lon = step(0.4 + 0.35 * kI, lh) * smoothstep(0.2, 0.3, abs(lpos.x)) * sak_lampH(fract(lh * 13.7));
    col += wm * (smoothstep(1.8 * px, 0.6 * px, ldd) * 1.1 + exp(-ldd / 0.005) * 0.14) * lon * (0.85 + 0.15 * sin(t * 1.3 + lh * 40.0));
  }
  return col;
}

// Torii gate. q: local coords (origin = water line at the gate centre, 1 unit = gate height). sdf.
// cap: 1 on the black top beam.
float sak_torii(vec2 q, out float cap) {
  float ax = abs(q.x);
  float px0 = 0.3 - 0.035 * q.y;
  float d = max(abs(ax - px0) - (0.036 - 0.01 * q.y), max(-0.25 - q.y, q.y - 0.88));
  d = min(d, sak_rect(q, vec2(0.0, 0.64), vec2(0.42, 0.028)));
  d = min(d, sak_rect(q, vec2(0.0, 0.745), vec2(0.028, 0.08)));
  d = min(d, sak_rect(q, vec2(0.0, 0.843), vec2(0.5, 0.026)));
  float lift = 0.08 * pow(clamp(ax / 0.64, 0.0, 1.0), 2.6);
  float kb = 0.87 + lift;
  float kt = 0.955 + lift * 1.25;
  float kas = max(ax - (0.64 + 0.45 * (q.y - kb)), max(kb - q.y, q.y - kt));
  d = min(d, kas);
  cap = step(kas, 0.0) * step(kb + (kt - kb) * 0.55, q.y);
  return d;
}

// Kasuga-style stone lantern. q: local coords (origin = base centre, 1 unit = height). lamp: lit window.
float sak_toro(vec2 q, out float lamp) {
  float ax = abs(q.x);
  float d = sak_rect(q, vec2(0.0, 0.035), vec2(0.21, 0.035));
  d = min(d, sak_rect(q, vec2(0.0, 0.095), vec2(0.15, 0.028)));
  d = min(d, sak_rect(q, vec2(0.0, 0.29), vec2(0.055 + 0.012 * step(fract(q.y * 14.0), 0.18), 0.17)));
  d = min(d, sak_rect(q, vec2(0.0, 0.49), vec2(0.17, 0.03)));
  d = min(d, sak_rect(q, vec2(0.0, 0.6), vec2(0.12, 0.085)));
  float tx = clamp(ax / 0.3, 0.0, 1.0);
  float rb = 0.69 + 0.06 * tx * tx * tx;
  float rt = 0.72 + 0.06 * tx * tx * tx + 0.12 * (1.0 - tx);
  d = min(d, max(ax - 0.3, max(rb - q.y, q.y - rt)));
  d = min(d, sak_rect(q, vec2(0.0, 0.855), vec2(0.035, 0.02)));
  d = min(d, length(q - vec2(0.0, 0.905)) - 0.04);
  float win = sak_rect(q, vec2(0.0, 0.6), vec2(0.07, 0.055));
  lamp = smoothstep(0.012, -0.012, win);
  return d;
}

// Floating paper lanterns on the pond (world coords at depth 0.6), painted over the water colour wc:
// glowing paper body (brightest in the middle), dark cap and base, light pool and reflection streak.
vec3 sak_floaters(vec3 wc, vec2 p, float t, float rip, float on) {
  vec3 wm = sak_gWm;
  float lampE = sak_lamp() * on;
  vec3 capC = sak_gHz * 0.1 + wm * 0.06;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float bx = fi == 0.0 ? -0.3 : (fi == 1.0 ? 0.4 : 0.2);
    float by = fi == 0.0 ? 0.07 : (fi == 1.0 ? 0.045 : 0.128);
    float sz = mix(0.013, 0.006, by / 0.13);
    vec2 c = vec2(bx + sin(t * 0.021 + fi * 2.0) * 0.05, by + sin(t * 0.4 + fi) * 0.0008);
    vec2 d = p - c;
    float ry = c.y - p.y;
    if (ry > 0.0) wc += wm * exp(-d.x * d.x / (sz * sz * 0.3)) * exp(-ry / (sz * 5.0)) * (0.25 + 0.6 * rip) * lampE;
    wc += wm * exp(-length(d * vec2(0.6, 2.2)) / (sz * 1.6)) * 0.22 * lampE;
    vec2 bd = abs(d - vec2(0.0, sz * 0.62)) - vec2(sz * 0.42, sz * 0.46);
    float body = length(max(bd, 0.0)) + min(max(bd.x, bd.y), 0.0) - sz * 0.08;
    float cap = sak_rect(d, vec2(0.0, sz * 1.18), vec2(sz * 0.58 - (d.y - sz * 1.18) * 0.8, sz * 0.09));
    float base = sak_rect(d, vec2(0.0, sz * 0.07), vec2(sz * 0.56, sz * 0.07));
    vec2 sq = vec2(d.x / (sz * 0.5), (d.y - sz * 0.62) / (sz * 0.55));
    float shade = 1.0 - 0.55 * sq.y * sq.y - 0.35 * sq.x * sq.x;
    vec3 paper = wm * (0.55 + 0.75 * shade) + vec3(0.18, 0.1, 0.04) * shade * shade;
    paper *= 1.0 - 0.25 * sak_fill(abs(d.x) - sz * 0.03);
    wc = mix(wc, mix(wc, paper, on), sak_fill(body));
    wc = mix(wc, mix(wc, capC, on), sak_fill(min(cap, base)));
  }
  return wc;
}

// ------------------------------------------------------------------ the framing cherry tree
// Tapered limb, keeping the nearest: b.x distance, b.yz offset from the axis / radius (cylinder
// shading), b.w distance along the limb (bark marks).
void sak_limb(vec2 p, vec2 a, vec2 b, float ra, float rb, inout vec4 best) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec2 o = pa - ba * h;
  float r = mix(ra, rb, h);
  float d = length(o) - r;
  if (d < best.x) best.yzw = vec3(o / r, h * length(ba) + a.y);
  best.x = sak_smin(best.x, d, 0.012);
}
// Branch skeleton (tree coords: x from the left edge, y = 1 at the top of the screen).
vec4 sak_branches(vec2 q) {
  vec4 b = vec4(1.0, 0.0, 0.0, 0.0);
  sak_limb(q, vec2(-0.04, -0.4), vec2(0.07, 0.27), 0.08, 0.054, b);
  sak_limb(q, vec2(0.07, 0.27), vec2(0.045, 0.5), 0.054, 0.04, b);
  sak_limb(q, vec2(0.045, 0.5), vec2(0.2, 0.67), 0.036, 0.024, b);
  sak_limb(q, vec2(0.2, 0.67), vec2(0.4, 0.77), 0.024, 0.015, b);
  sak_limb(q, vec2(0.4, 0.77), vec2(0.58, 0.8), 0.015, 0.008, b);
  sak_limb(q, vec2(0.58, 0.8), vec2(0.66, 0.77), 0.008, 0.003, b);
  sak_limb(q, vec2(0.045, 0.5), vec2(0.0, 0.76), 0.032, 0.022, b);
  sak_limb(q, vec2(0.0, 0.76), vec2(0.07, 1.04), 0.022, 0.012, b);
  sak_limb(q, vec2(0.07, 0.27), vec2(0.21, 0.4), 0.03, 0.016, b);
  sak_limb(q, vec2(0.21, 0.4), vec2(0.33, 0.44), 0.016, 0.005, b);
  sak_limb(q, vec2(0.2, 0.67), vec2(0.27, 0.92), 0.015, 0.006, b);
  sak_limb(q, vec2(0.4, 0.77), vec2(0.47, 0.92), 0.011, 0.004, b);
  sak_limb(q, vec2(0.4, 0.77), vec2(0.47, 0.67), 0.009, 0.003, b);
  sak_limb(q, vec2(0.0, 0.76), vec2(0.16, 0.88), 0.013, 0.005, b);
  return b;
}

// Crown envelope: masses of blossom along the limbs, with gaps for sky and branches. Plain unions here
// (cheap, for the clump search); sak_crownG below blends the masses smoothly for the lighting.
float sak_crown(vec2 q) {
  vec2 s = vec2(0.85, 1.15);
  float d = length((q - vec2(0.03, 0.9)) * s) - 0.17;
  d = min(d, length((q - vec2(0.22, 0.86)) * s) - 0.13);
  d = min(d, length((q - vec2(0.41, 0.84)) * s) - 0.11);
  d = min(d, length((q - vec2(0.57, 0.82)) * s) - 0.08);
  d = min(d, length((q - vec2(0.45, 0.7)) * s) - 0.065);
  d = min(d, length((q - vec2(0.12, 0.68)) * s) - 0.08);
  d = min(d, length((q - vec2(0.3, 0.47)) * s) - 0.07);
  return d;
}
// The same envelope with its gradient, in one pass (xy: gradient direction, z: distance).
vec3 sak_blob(vec2 q, vec2 c, float r) {
  vec2 v = (q - c) * vec2(0.85, 1.15);
  float l = length(v);
  return vec3(v * vec2(0.85, 1.15) / max(l, 1e-5), l - r);
}
vec3 sak_sminG(vec3 a, vec3 b, float k) {
  float h = clamp(0.5 + 0.5 * (b.z - a.z) / k, 0.0, 1.0);
  return vec3(mix(b.xy, a.xy, h), mix(b.z, a.z, h) - k * h * (1.0 - h));
}
vec3 sak_minG(vec3 a, vec3 b) { return b.z < a.z ? b : a; }
vec3 sak_crownG(vec2 q) {
  vec3 d = sak_blob(q, vec2(0.03, 0.9), 0.17);
  d = sak_sminG(d, sak_blob(q, vec2(0.22, 0.86), 0.13), 0.05);
  d = sak_sminG(d, sak_blob(q, vec2(0.41, 0.84), 0.11), 0.05);
  d = sak_sminG(d, sak_blob(q, vec2(0.57, 0.82), 0.08), 0.04);
  d = sak_minG(d, sak_blob(q, vec2(0.45, 0.7), 0.065));
  d = sak_minG(d, sak_blob(q, vec2(0.12, 0.68), 0.08));
  d = sak_minG(d, sak_blob(q, vec2(0.3, 0.47), 0.07));
  return d;
}

// Blossom clumps: five rotated, offset lattices of clumps inside the crown, lower clumps in front.
// Returns the two front-most clumps covering q: xy = centre, z = radius (0 = none), w = seed.
void sak_clumps(vec2 q, out vec4 c1, out vec4 c2) {
  float cs = 0.09;
  c1 = vec4(0.0);
  c2 = vec4(0.0);
  float z1 = -1e4;
  float z2 = -1e4;
  for (int s = 0; s < 5; s++) {
    float fs = float(s);
    float an = fs * 0.61;
    mat2 rot = mat2(cos(an), sin(an), -sin(an), cos(an));
    vec2 off = vec2(0.37, 0.71) * fs * cs;
    vec2 qr = rot * q + off;
    vec2 id = floor(qr / cs);
    vec2 h = hash22(id + fs * 17.0);
    vec2 c = ((id + 0.5 + (h - 0.5) * 0.04) * cs - off) * rot;
    float r = cs * (0.3 + 0.09 * h.y);
    float alive = step(sak_crown(c), -0.1 * r) * step(0.1, fract(h.x * 7.7 + h.y));
    float z = -c.y + h.x * 0.02;
    if (alive > 0.5 && length((q - c) / vec2(1.12, 0.88)) < r * 1.14) {
      if (z > z1) {
        c2 = c1;
        z2 = z1;
        c1 = vec4(c, r, h.x + fs);
        z1 = z;
      } else if (z > z2) {
        c2 = vec4(c, r, h.x + fs);
        z2 = z;
      }
    }
  }
}

// Paint one clump of blossoms over col: a shaded body scattered with five-petal flowers (three rotated
// lattices, so no grid shows); the outer ring is flowers only, so the silhouette is made of petals.
// Colours come from the sak_c* globals (blended once per pixel for the time of day).
vec3 sak_clump(vec3 col, vec2 q, vec4 c, float ns, float mlit, float behind) {
  vec2 u = (q - c.xy) / c.z;
  vec2 v = u / vec2(1.12, 0.88);
  float lv = length(v);
  float W = sak_gW;
  float aaV = 1.0 / (u_res.y * c.z * ns);
  vec3 n = vec3(v, sqrt(max(1.0 - lv * lv, 0.0)));
  float lit = mlit * (0.78 - 0.18 * W + (0.32 + 0.3 * W) * clamp(dot(n, sak_cL), 0.0, 1.0));
  float fcov = 0.0;
  float fbr = 0.0;
  float fctr = 0.0;
  float an = c.w * 6.2831;
  mat2 rot = mat2(cos(an), sin(an), -sin(an), cos(an));
  vec2 ur = rot * u / 0.3;
  float aaF = aaV / 0.3;
  for (int s = 0; s < 3; s++) {
    float fs = float(s);
    float a2 = fs * 2.1;
    mat2 r2 = mat2(cos(a2), sin(a2), -sin(a2), cos(a2));
    vec2 o = vec2(0.31, 0.57) * fs;
    vec2 g = r2 * ur + o;
    vec2 id = floor(g);
    vec2 h = hash22(id + c.w * 13.1 + fs * 5.3);
    vec2 cc = id + 0.5 + (h - 0.5) * 0.1;
    vec2 w = g - cc;
    float inC = step(length(((cc - o) * r2) * rot * 0.3 / vec2(1.12, 0.88)), 0.88) * step(0.16, h.y);
    // Five petals without trig: cos(5a) of the (randomly turned) direction from the flower centre.
    float fd = length(w);
    vec2 dir = normalize(h - 0.5 + 1e-3);
    vec2 z = vec2(dot(w, dir), w.x * dir.y - w.y * dir.x) / max(fd, 1e-4);
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    float c5 = z.x * (x2 * x2 - 10.0 * x2 * y2 + 5.0 * y2 * y2);
    float rr = (0.37 + 0.07 * h.x) * (0.74 + 0.26 * sqrt(sqrt(0.5 + 0.5 * c5)));
    float f = smoothstep(rr + aaF, rr - aaF, fd) * inC;
    fbr = mix(fbr, (0.8 + 0.4 * h.x) * (1.0 - 0.28 * smoothstep(rr - 2.5 * aaF, rr, fd)), f);
    fctr = mix(fctr, smoothstep(0.1, 0.04, fd), f);
    fcov = max(fcov, f);
  }
  float rim = smoothstep(0.5, 1.0, dot(v, normalize(sak_cL.xy)));
  float crease = smoothstep(0.55, 1.0, lv) * smoothstep(0.1, -0.7, v.y);
  vec3 body = mix(sak_cDk * 1.2, sak_cBr * 0.7, lit * lit) * (1.0 - 0.4 * crease);
  vec3 fc = mix(sak_cDk * 1.5, sak_cBr * 1.1, lit) * fbr * (1.0 - 0.25 * crease);
  fc += sak_cRm * rim + sak_cSg * (0.5 + 0.5 * rim);
  fc = mix(fc, sak_cCt * (0.3 + 0.4 * lit), fctr * 0.55);
  vec3 cc = mix(body, fc, fcov) * behind;
  float bodyA = smoothstep(0.8 + aaV, 0.8 - aaV, lv);
  return mix(col, cc, max(fcov, bodyA));
}

vec3 scene_sakura(vec2 uv, vec3 sky) {
  float a = sc_aspect();
  float t = u_time;
  float px = 1.0 / u_res.y;
  sak_rig(uv.x);
  float kI = sak_gKI;
  float W = sak_gW;
  vec3 L = sak_gL;
  vec3 K = sak_gK;
  vec3 A = sak_gA;
  vec3 H = sak_gH;
  vec3 hz = sak_gHz;
  vec3 mt = sak_gMt;
  vec3 bl = sak_gBl;
  vec3 bD = sak_gBD;
  vec3 wm = sak_gWm;
  float lampE = sak_lamp();
  float ns = sak_nearScale();
  vec2 pm = sc_world(uv, 0.0);
  vec2 mc = sak_moonPos();
  // Where the glitter on the water gathers: under the moon at night, under the sun once it is up.
  float sv = sak_gS;
  vec3 kc = mix(mt, K, sv);

  // Framing tree coordinates: x measured from the left screen edge, top of the screen pinned at y = 1.
  vec2 pf = sc_world(uv, 1.0);
  float shift = mix(0.1, 0.03, smoothstep(0.6, 1.4, a));
  vec2 q = vec2(pf.x + 0.5 * a + shift, pf.y - 1.0) / ns + vec2(0.0, 1.0);
  q.x += sin(t * 0.35 + q.y * 2.3) * 0.004 * smoothstep(0.4, 1.0, q.y);
  bool treeZone = q.x < 0.72;

  // Pond: perspective ripple field and the mirrored lookup for reflections.
  vec2 pw = sc_world(uv, 0.45);
  float dyw = SAK_WATER - pw.y;
  bool water = dyw > 0.0;
  float wv = 1.0 / (max(dyw, 0.0) + 0.012);
  float wu = pw.x * wv;
  float r1 = vnoise(vec2(wu * 0.35, wv * 1.1 + t * 0.25));
  float r2 = vnoise(vec2(wu * 0.9 + 7.0, wv * 2.7 - t * 0.35));
  float rip = (r1 + 0.5 * r2) / 1.5 - 0.5;
  float amp = 0.004 + 0.03 * max(dyw, 0.0);
  vec2 luv = water ? vec2(uv.x + rip * amp * 1.5 / a, uv.y + 2.0 * dyw + rip * amp * 0.4) : uv;

  vec3 col = sky;
  if (water) {
    // The sky mirrored in the pond (the soft sky and the sun disc; stars are too faint to reflect).
    vec3 v = texture2D(u_skyTex, clamp(luv, 0.0, 1.0)).rgb;
    vec3 sd = sunDisc(luv, a);
    col = mix(2.0 * v * v, sd, clamp(sd.r, 0.0, 1.0));
  }
  col = sak_sky(sc_world(luv, 0.0), col);
  if (!water && uv.y > 0.46) {
    if (!treeZone) return col;
  } else {
    col = sak_land(luv, col, water ? 1.0 : 0.0);
  }

  vec2 pn = sc_world(uv, 0.8);
  float xb = (pn.x + 0.5 * a) / ns;
  float yb = pn.y / ns;
  float lanX = 0.43;
  float lanY = 0.19 - 0.52 * lanX * lanX - 0.006;
  vec2 ql = (vec2(xb, yb) - vec2(lanX, lanY)) / 0.12;

  if (uv.y < 0.46) {
    if (water) {
      float fres = mix(0.4, 0.8, smoothstep(0.0, SAK_WATER, pw.y));
      // By day a clear blue-green body under the sky's reflection.
      vec3 wc = mix(u_c0 * 0.07, vec3(0.02, 0.055, 0.07) + A * 0.06, W) + col * fres;
      // Wind slicks: patches where the surface roughens and the reflection dissolves.
      float slick = smoothstep(0.5, 0.8, vnoise(vec2(wu * 0.07 + 3.0, wv * 0.22 - t * 0.02)));
      wc = mix(wc, mix(hz * 0.3 + u_c0 * 0.05, H * 0.55 + A * 0.05, W), slick * 0.35);
      wc += mix(mix(hz, mt, 0.4) * 0.28, H * 0.22, W) * exp(-dyw / (2.0 * px));
      wc += kc * 0.03 * (1.0 + W) * smoothstep(0.62, 0.9, r2) * smoothstep(0.0, 0.04, dyw);
      // Glitter: crisp horizontal glints in a column under the moon (or the sun, wider when it is high).
      float gx = pm.x - mix(mc.x, (u_sun.x - 0.5) * a, sv);
      float wg = (0.012 + 0.22 * dyw) * (1.0 + 2.5 * max(u_sunElev, 0.0) * sv);
      float glit = exp(-gx * gx / (wg * wg)) * max(sc_nightVis(), sv);
      vec2 gs = gl_FragCoord.xy / vec2(7.0, 3.0);
      vec2 gid = floor(gs);
      float gh = hash21(gid);
      vec2 gf = fract(gs) - 0.5;
      float glint = step(0.9, gh) * smoothstep(0.5, 0.1, abs(gf.x) + abs(gf.y) * 1.5) * (0.5 + 0.5 * sin(t * (1.5 + 2.0 * gh) + gh * 40.0));
      wc += kc * glit * (0.05 + glint * (1.3 - 0.5 * sv) * smoothstep(0.35, 0.7, r2)) * smoothstep(0.0, 0.015, dyw);
      // Lantern light streaks: pagoda path and the stone lantern.
      float sx = pw.x - sak_pagodaX() - 0.02;
      wc += wm * exp(-sx * sx / 0.0015) * smoothstep(0.35, 0.8, r1) * exp(-dyw / 0.05) * 0.1 * lampE;
      float lx = xb - lanX;
      float ly = (lanY + 0.07) * ns - pn.y;
      if (ly > 0.0) {
        float lw = 0.006 + 0.05 * ly;
        wc += wm * exp(-lx * lx / (lw * lw)) * (0.1 + smoothstep(0.35, 0.85, r2) * 0.6) * exp(-ly / 0.07) * lampE;
      }
      vec2 pf6 = sc_world(uv, 0.6);
      // Floating petals, gathering into drifting rafts.
      vec2 pc = vec2(wu * 3.0 + t * 0.02, wv * 1.2);
      vec2 pid = floor(pc);
      vec2 ph = hash22(pid + 3.3);
      float praft = smoothstep(0.45, 0.8, vnoise(vec2(wu * 0.25 + t * 0.005, wv * 0.2)));
      if (ph.x < 0.04 + 0.5 * praft) {
        vec2 f = fract(pc) - 0.5 - (ph - 0.5) * 0.66;
        float pa = ph.y * 6.2831;
        f = mat2(cos(pa), sin(pa), -sin(pa), cos(pa)) * f;
        float pd = length(f * vec2(1.0, 1.6)) - 0.11;
        float pcv = smoothstep(0.025, -0.02, pd) * smoothstep(0.004, 0.03, dyw);
        wc = mix(wc, mix(bl * (0.35 + 0.25 * ph.x) + mt * 0.04, bD * (K * 0.55 + A * 0.9) * (0.8 + 0.25 * ph.x), W), pcv * 0.85);
      }
      // Lily pads in loose rafts along both sides of the pond, clear of the timer in the middle: one pad
      // per cell of a grid that shrinks with distance (cells keep their foreshortened shape at any depth).
      float e = dyw + 0.05;
      vec2 lq = vec2(pw.x / (0.2 * e), log(e) / 0.09);
      vec2 lid = floor(lq);
      vec2 lh = hash22(lid + 11.0);
      float raft = smoothstep(0.58, 0.8, sc_n1(lid.x * 0.33 + floor(lid.y * 0.5) * 7.1)) * smoothstep(0.2, 0.34, abs(pw.x)) * smoothstep(0.012, 0.03, dyw);
      if (lh.x < raft * 0.7) {
        vec2 lf = fract(lq) - 0.5 - (lh - 0.5) * 0.3;
        float lr = 0.29 + 0.12 * lh.y;
        float ld = length(lf);
        // Distance in world units (cells are 0.2e wide, 0.09e tall), for crisp edges at any depth.
        float gw = length(vec2(lf.x / 0.2, lf.y / 0.09)) / (max(ld, 1e-4) * e);
        float notch = step(0.0, lf.x * (lh.y - 0.5)) * smoothstep(0.34, 0.26, abs(lf.y) / (abs(lf.x) + 1e-3));
        float pcov = sak_fill((ld - lr) / gw) * (1.0 - notch);
        float edge = smoothstep(lr - 0.09, lr, ld);
        // Night: a soft dark shape on the water with a faint moonlit rim; day: fresh green, rim in the sun.
        vec3 padN = wc * 0.5 + mt * 0.06 * edge * step(0.0, lf.y);
        vec3 padD = vec3(0.13, 0.26, 0.08) * (0.8 + 0.4 * lh.y) * (K * (0.25 + 0.6 * L.y) + A * 0.9) + K * vec3(0.05, 0.07, 0.02) * edge;
        wc = mix(wc, mix(padN, padD, W), pcov * (0.7 + 0.3 * W));
        // Now and then a water lily in bloom at the pad's heart (closed and pale at night).
        vec3 flC = mix(bl * 0.4 + mt * 0.05, mix(bD, vec3(1.0), 0.45) * (K * 0.9 + A), W);
        wc = mix(wc, flC, sak_fill((ld - 0.1) / gw) * step(0.72, lh.y));
      }
      // Floating lanterns are set on the water as dusk falls.
      wc = sak_floaters(wc, pf6, t, smoothstep(0.3, 0.8, r2), (1.0 - 0.95 * kI) * smoothstep(0.05, 0.6, sak_gOn));
      col = wc;
    }

    // Torii gate standing in the water (its reflection comes from the same evaluation).
    vec2 pt = sc_world(uv, 0.55);
    float st = 0.15 * ns;
    vec2 qt = (pt - vec2(sak_toriiX(), SAK_TORII_Y)) / st;
    if (abs(qt.x) < 0.75 && abs(qt.y) < 1.05) {
      bool rt = qt.y < 0.0;
      vec2 qq = rt ? vec2(qt.x + rip * amp * 1.2 / st, -qt.y) : qt;
      float cap;
      float td = sak_torii(qq, cap);
      float cap2;
      // Lit edges: the offset copy picks the edges facing the light (moonlit rim at night, sun by day).
      float tdr = sak_torii(qq - mix(vec2(0.035, 0.02), -normalize(L.xy) * 0.04, W), cap2);
      float edge = smoothstep(-0.03, 0.0, tdr) * (1.0 - cap * 0.5);
      vec3 tc = mix(vec3(0.42, 0.06, 0.05), u_c0 * 0.3, 0.35);
      tc = mix(tc, u_c0 * 0.12, cap);
      tc += mix(mt, vec3(1.0, 0.6, 0.5), 0.3) * 0.12 * edge;
      // Day: vermilion lacquer with a black kasagi, sunlit along the edges that face the sun.
      vec3 tD = sak_sun(mix(vec3(0.78, 0.17, 0.07), vec3(0.05, 0.045, 0.05), cap), 0.25 + 0.5 * L.z, 1.0);
      tD += K * vec3(0.9, 0.45, 0.3) * (0.32 + 0.3 * sak_gG) * edge;
      tc = mix(tc, tD, W);
      tc *= 0.85 + 0.15 * smoothstep(0.0, 0.3, qq.y);
      float cov = sak_fill(td * st);
      if (rt) {
        col = mix(col, mix(u_c0 * 0.05 + tc * 0.35, tc * 0.5 + A * 0.03, W), cov * 0.8);
      } else {
        col = mix(col, tc, cov);
        // Little ripple rings where the pillars meet the water.
        float rr = length(vec2((abs(qt.x) - 0.3) * 0.5, qt.y * 2.5));
        col += kc * 0.1 * smoothstep(0.012, 0.0, abs(rr - 0.05)) * step(qt.y, 0.03) * (1.0 - cov);
      }
    }

    // Left bank beneath the big tree: grass tufts on its crest, fallen petals, the stone lantern.
    float hb = 0.19 - 0.52 * xb * xb + 0.01 * (sak_n3(xb * 12.0) - 0.5);
    float lean = 0.45 * sin(xb * 37.0) + 0.3 * sin(xb * 91.0 + 1.0);
    float gcx = (xb - max(yb - hb, 0.0) * lean) * 230.0;
    float gh2 = hash11(floor(gcx) * 1.7);
    float gu = max(1.0 - abs(fract(gcx) - 0.5 - (gh2 - 0.5) * 0.3) * 2.0, 0.0);
    float bh = (0.002 + 0.012 * gh2 * smoothstep(0.3, 0.75, sc_n1(xb * 34.0))) * step(0.3, gh2);
    float bs = bh * 6.0 * gu * gu * 230.0;
    float gnd = min(yb - hb, (yb - hb - bh * gu * gu * gu) / sqrt(1.0 + bs * bs));
    float lamp;
    float ld = sak_toro(ql, lamp);
    float crestB = smoothstep(-0.005, 0.0, gnd);
    vec3 gc = u_c0 * 0.07 + hz * 0.03;
    gc += mix(mt, bl, 0.4) * 0.1 * crestB;
    // Day: spring grass in soft blade strokes and patches, dappled by the big tree's shade (cast away
    // from the sun), the sunlit blade tips catching the light.
    float gt = vnoise(pn * vec2(260.0, 55.0));
    float gp = sc_n1(pn.x * 16.0 + pn.y * 23.0 + 5.0) * 0.6 + sc_n1(pn.x * 7.0 - pn.y * 31.0) * 0.4;
    vec3 gA = mix(vec3(0.2, 0.29, 0.1), vec3(0.3, 0.35, 0.12), gp) * (0.86 + 0.24 * gt);
    float shx = xb - 0.08 + L.x * 0.3;
    float shade = exp(-shx * shx / 0.025) * (0.85 - 0.6 * smoothstep(0.55, 0.75, gp)) * sak_gS;
    vec3 gD = gA * (K * (0.25 + 0.65 * L.y) * (1.0 - 0.7 * shade) + A * 0.8) * (0.85 + 0.15 * smoothstep(-0.12, -0.01, gnd));
    gD += K * vec3(0.3, 0.42, 0.14) * 0.3 * crestB * (1.0 - shade);
    // Fallen petals (and a few tiny white flowers by day), thicker toward the water's edge.
    vec2 sp = pn * vec2(1.0, 1.7) * 150.0;
    vec2 sid = floor(sp);
    vec2 sh2 = hash22(sid);
    float speck = step(0.9 - 0.25 * smoothstep(0.3, 0.6, xb), sh2.x) * smoothstep(0.24, 0.1, length((fract(sp) - 0.5 - (sh2.yx - 0.5) * 0.5) * vec2(1.0, 1.5)));
    speck *= smoothstep(-0.08, -0.005, gnd);
    vec3 petD = mix(bD, vec3(1.0, 0.97, 0.9), step(0.85, sh2.y)) * (K * 0.6 * (1.0 - 0.6 * shade) + A);
    gc += bl * (0.14 + 0.14 * sh2.y) * speck;
    gc = mix(gc, mix(gD, petD, speck), W);
    float lgp = length((vec2(xb, yb) - vec2(lanX, lanY)) * vec2(0.6, 1.4));
    gc += wm * 0.14 * exp(-lgp / 0.05) * lampE;
    col = mix(col, gc, sak_fill(gnd * ns));
    // The stone lantern: dark stone at night (lit window); weathered granite by day.
    float lsR = smoothstep(0.024, 0.036, ql.x);
    float lside = mix(max(-L.x, 0.0), max(L.x, 0.0), lsR);
    vec3 lc = u_c0 * 0.08 + hz * 0.06;
    lc += mix(mt, vec3(0.8), 0.3) * 0.05 * lsR;
    lc += wm * 0.14 * smoothstep(0.5, 0.0, abs(ql.y - 0.6)) * (1.0 - step(0.72, ql.y)) * sak_gOn;
    vec3 lD = sak_sun(vec3(0.33, 0.32, 0.3) * (0.8 + 0.3 * gt), 0.15 + 0.55 * lside + 0.2 * L.y, 0.7);
    lc = mix(lc, lD * (1.0 - 0.75 * lamp), W);
    float lcov = sak_fill(ld * 0.12 * ns);
    col = mix(col, lc, lcov);
    col += wm * lamp * lcov * 1.25 * lampE;
    float lg = length((ql - vec2(0.0, 0.6)) * vec2(1.0, 1.2));
    float fl = 0.9 + 0.1 * sin(t * 1.1) * sin(t * 1.7 + 1.0);
    col += wm * (exp(-lg / 0.25) * 0.2 + exp(-lg / 1.1) * 0.05) * lampE * fl * (1.0 - lamp);

    // Low bank with reeds in the lower right corner.
    float xr = (0.5 * a - pn.x) / ns;
    float hr = 0.065 - 0.6 * xr * xr + 0.008 * (sak_n3(xr * 16.0 + 3.0) - 0.5);
    float rcx = xr * 140.0;
    float rh = hash11(floor(rcx) * 2.3);
    float ru = max(1.0 - abs(fract(rcx) - 0.5) * 2.0, 0.0);
    float rhh = (0.01 + 0.03 * rh) * step(0.55, rh) * smoothstep(0.35, 0.1, xr);
    float rs = rhh * 4.0 * ru * ru * ru * 2.0 * 140.0;
    float rgnd = min(yb - hr, (yb - hr - rhh * ru * ru * ru * ru) / sqrt(1.0 + rs * rs));
    float rtip = smoothstep(-0.005, 0.0, rgnd);
    vec3 rc = u_c0 * 0.06 + mt * 0.05 * rtip;
    vec3 rD = mix(vec3(0.13, 0.19, 0.08), vec3(0.3, 0.33, 0.14), rtip) * sak_gT;
    col = mix(col, mix(rc, rD, W), sak_fill(rgnd * ns));
  }

  // The framing cherry: shadowed inner blossom, limbs with bark, then the lit clumps.
  if (treeZone) {
    vec3 cr = sak_crownG(q);
    float env = cr.z;
    // Light of the blossom masses as a whole (from the crown's own gradient and depth).
    float depth = smoothstep(0.0, 0.12, -env);
    vec3 mn = normalize(vec3(cr.xy / max(length(cr.xy), 1e-5) * (1.0 - 0.8 * depth), 0.3 + depth));
    float mlit = clamp(0.3 + 0.8 * dot(mn, mix(vec3(0.55, 0.66, 0.5), L, W)), 0.2, 1.05) * (1.0 - 0.3 * depth);
    vec4 br = sak_branches(q);
    float wcov = sak_fill(br.x * ns);
    if (wcov > 0.0) {
      vec3 n3 = vec3(br.yz, sqrt(max(1.0 - dot(br.yz, br.yz), 0.0)));
      float bl3 = clamp(dot(n3, mix(vec3(0.62, 0.42, 0.66), L, W)), 0.0, 1.0);
      // Cherry bark: dark, faintly striated along the limb, with short pale lenticel dashes across it.
      float across = length(br.yz) * sign(dot(br.yz, vec2(1.0, 0.3)));
      float lid = floor(br.w * 110.0);
      float lent = step(0.45, hash11(lid)) * smoothstep(0.5, 0.2, abs(fract(br.w * 110.0) - 0.5) * 3.0)
        * smoothstep(0.22, 0.12, abs(across - (hash11(lid + 7.0) - 0.5) * 1.3) - 0.12 * hash11(lid + 3.0));
      float bn = 0.8 + 0.4 * vnoise(vec2(br.w * 30.0, across * 3.0));
      vec3 bark = (u_c0 * 0.1 + vec3(0.03, 0.018, 0.022)) * bn * (0.5 + 0.75 * bl3);
      bark = mix(bark, sak_sun(vec3(0.17, 0.12, 0.11) * bn, bl3, 0.55), W);
      bark += mix(vec3(0.05, 0.043, 0.05), A * 0.25, W) * lent * (0.35 + 0.65 * bl3);
      bark += mix(mix(mt, bl, 0.35) * 0.13, K * 0.16, W) * smoothstep(0.5, 0.95, dot(br.yz, normalize(mix(vec2(0.8, 0.6), L.xy, W))));
      // Limbs inside the crown catch light scattered through the blossom.
      bark += mix(mix(bl, u_c1, 0.5) * 0.06, bD * A * 0.1, W) * smoothstep(0.55, 0.85, q.y) * (0.5 + 0.5 * bl3);
      col = mix(col, bark, wcov);
    }
    if (env < 0.02) {
      // Blossom colours for this time of day, shared by both clump layers. Night: moonlit pink. Day: the
      // blossom albedo in sky shade (lilac) up to full sun (pink-white), glowing near the sun disc.
      vec2 sd = pm - vec2((u_sun.x - 0.5) * a, u_sun.y);
      sak_cL = mix(vec3(0.5, 0.62, 0.6), L, W);
      sak_cDk = mix(mix(bl * 0.13, u_c1 * 0.3, 0.35), bD * (A * 0.72 + K * 0.1), W);
      sak_cBr = mix(bl, bD * (K * 0.78 + A * 0.85), W);
      sak_cRm = mix(mix(bl, vec3(1.0, 0.96, 0.98), 0.55), K * bD * (0.9 + 0.9 * sak_gG), W) * 0.3;
      sak_cCt = mix(mix(bl, vec3(0.8, 0.2, 0.35), 0.5), vec3(0.75, 0.2, 0.32) * (K * 0.5 + A), W);
      sak_cSg = bD * K * exp(-dot(sd, sd) / 0.02) * sv * W * 0.45;
      vec4 c1;
      vec4 c2;
      sak_clumps(q, c1, c2);
      if (c2.z > 0.0) col = sak_clump(col, q, c2, ns, mlit, 0.82);
      if (c1.z > 0.0) col = sak_clump(col, q, c1, ns, mlit, 1.0);
    }
  }
  return col;
}
`,
};
