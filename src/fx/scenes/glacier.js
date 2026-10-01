// Scene: Moonlit glacier (theme: midnight) — snowy peaks under a silver moon, following the clock.
// GLSL rules: GLSL ES 1.00, every helper in this file is prefixed "gla_", entry point scene_glacier(uv, sky).
//
// Layers, far to near: silver moon with maria, rayed craters, halo and a faint corona (upper left, night
// only) and a few alpine choughs by day -> hazy far range with a lone central peak -> two glaciated
// massifs framing the valley (lit and shadowed flanks from a leaning arete, ridged spurs and couloirs,
// rock ribs with snowy strata, a bergschrund above glaciers with crevasse arcs and serac icefalls,
// streaming spindrift, a roped team of three on a ridge with headlamps at night) -> sea of cloud in the
// valley -> moraines with clustered spruce stands and erratic boulders -> sculpted snow drifts (lit lips,
// cornice shadows, sastrugi, crust sparkle) with a climbers' tent, a line of bootprints and a skier's
// linked turns -> snow-laden spruces at the right edge.
//
// Time of day: one key light (the moon up-left at night, the sun while it is up) and one set of
// materials whose parameters blend with daylight, so every layer is shaded once. At sunrise / sunset
// the valley sinks into the mountains' shadow while the summits catch alpenglow; in the blue hour the
// moon takes over as the key under a still-bright sky; by day the snow is sunlit with crisp blue
// shadows; at night it is the original silver moonlight. Lights (tent lantern, headlamps) follow
// sc_lights().
//
// Compile budget: D3D inlines every call and unrolls every loop, so looping helpers are called from as
// few sites as possible and the silhouettes carry analytic slopes instead of extra evaluations.
export default {
  key: 'glacier',
  name: 'Moonlit glacier',
  glsl: `
// ------------------------------------------------------------------ scene: Moonlit glacier (gla_*)
// Lighting state, set once at the top of scene_glacier(). gla_L = key light direction (x right, y up,
// z toward the viewer): the moon up and to the left at night, the sun by day. gla_L2 = the key in the
// silhouette plane (for 2D profiles); gla_lx = 1 when the key lights left-facing slopes .. -1 right-facing;
// gla_X = daylight exposure; gla_W = moon 0 .. sun 1 as the key; gla_rim = crest rim strength;
// gla_shY = height of the mountains' shadow line when the sun is low; gla_sunX = the sun's world x.
vec3 gla_L;
vec2 gla_L2;
float gla_lx;
float gla_X;
float gla_W;
float gla_rim;
float gla_shY;
float gla_sunX;
float gla_vl;

// Smooth max of two (value, slope) pairs; the blended slope is exact inside the blend band.
vec2 gla_smaxD(vec2 a, vec2 b, float k) {
  float h = clamp(0.5 + 0.5 * (a.x - b.x) / k, 0.0, 1.0);
  return vec2(mix(b.x, a.x, h) + k * h * (1.0 - h), mix(b.y, a.y, h));
}

// A designed peak (value, slope): concave flanks, steep near the summit; sl / sr = left / right steepness.
vec2 gla_peakD(float x, float ax, float ay, float sl, float sr) {
  float dx = x - ax;
  float s = dx < 0.0 ? sl : sr;
  float a = abs(dx) + 1e-4;
  float pw = pow(a, 0.85);
  return vec2(ay - s * pw, -0.85 * s * pw / a * sign(dx));
}

// Envelope of the two glaciated massifs (value, slope) at world x.
vec2 gla_envD(float x) {
  float w = x + 0.012 * sin(x * 9.0 + 1.3);
  float dw = 1.0 + 0.108 * cos(x * 9.0 + 1.3);
  vec2 h = vec2(0.176 + 0.012 * sin(w * 3.1 + 1.0), 0.0372 * cos(w * 3.1 + 1.0));
  h = gla_smaxD(h, gla_peakD(w, 0.52, 0.525, 0.92, 0.66), 0.02);
  h = gla_smaxD(h, gla_peakD(w, 0.33, 0.360, 0.95, 0.34), 0.008);
  h = gla_smaxD(h, gla_peakD(w, 0.87, 0.425, 0.78, 0.45), 0.008);
  h = gla_smaxD(h, gla_peakD(w, -0.60, 0.488, 0.66, 0.88), 0.02);
  h = gla_smaxD(h, gla_peakD(w, -0.40, 0.350, 0.34, 1.00), 0.008);
  h = gla_smaxD(h, gla_peakD(w, -0.88, 0.392, 0.80, 0.60), 0.008);
  return vec2(h.x, h.y * dw);
}

// Envelope of the far range with its lone central peak (value only).
float gla_farEnv(float x) {
  float h = 0.200 + 0.018 * sin(x * 5.3 + 2.0) + 0.012 * sin(x * 11.0 + 0.4);
  h = gla_smaxD(vec2(h, 0.0), gla_peakD(x, 0.03, 0.325, 0.62, 0.78), 0.025).x;
  return gla_smaxD(vec2(h, 0.0), gla_peakD(x, -0.075, 0.278, 0.9, 0.5), 0.02).x;
}

// Ridged 1D noise with its derivative (value, d/dx): crisp gendarmes and notches along the crests.
vec2 gla_ridgeD(float x) {
  vec2 v = vec2(0.0);
  float a = 0.5;
  float w = 1.0;
  float f = 1.0;
  for (int i = 0; i < 6; i++) {
    float i0 = floor(x);
    float fr = fract(x);
    float h0 = hash11(i0);
    float h1 = hash11(i0 + 1.0);
    float m = 2.0 * mix(h0, h1, fr * fr * (3.0 - 2.0 * fr)) - 1.0;
    float dm = 12.0 * (h1 - h0) * fr * (1.0 - fr);
    float sa = sqrt(m * m + 0.003);
    float r = 1.0 - sa;
    v += a * w * vec2(r * r, -2.0 * r * m / sa * dm * f);
    w = clamp(r * r * 1.7, 0.35, 1.0);
    x = x * 2.11 + 31.7;
    f *= 2.11;
    a *= 0.52;
  }
  return v;
}

// Faceted spur profile across the fall line (cells of width 1 in x): a triangle wave with a random
// crest position per cell and heights that swell and fade along the fall line (v). Planar faces, crisp
// crests and V couloirs, the slope blended over w cells so the creases are anti-aliased.
// Returns (height 0..1, slope, crest line 0..1).
vec3 gla_tri(float x, float v, float w) {
  float i = floor(x);
  float f = x - i;
  float p0 = 0.3 + 0.4 * hash11(i * 3.1 - 3.1);
  float p1 = 0.3 + 0.4 * hash11(i * 3.1);
  float p2 = 0.3 + 0.4 * hash11(i * 3.1 + 3.1);
  float h0 = 0.2 + 0.8 * sc_n1(v + hash11(i - 1.0) * 37.0);
  float h1 = 0.2 + 0.8 * sc_n1(v + hash11(i) * 37.0);
  float h2 = 0.2 + 0.8 * sc_n1(v + hash11(i + 1.0) * 37.0);
  float sl = mix(h1 / p1, -h1 / (1.0 - p1), smoothstep(p1 - w, p1 + w, f));
  sl = mix(-h0 / (1.0 - p0), sl, smoothstep(-w, w, f));
  sl = mix(sl, h2 / p2, smoothstep(1.0 - w, 1.0 + w, f));
  float h = h1 * (f < p1 ? f / p1 : (1.0 - f) / (1.0 - p1));
  return vec3(h, sl, (1.0 - smoothstep(w, 2.5 * w, abs(f - p1))) * h1);
}

// Ridge lean: crest features descend outward from each massif and converge into the central valley;
// the hero aretes themselves slant (right massif down-right, left massif down-left).
float gla_lean(float x) {
  // Right massif: sub-peak 0.33 leans down-left, the hero 0.52 down-right, 0.87 gently down-left.
  float r = mix(0.30, -0.22, smoothstep(0.36, 0.50, x));
  r = mix(r, 0.12, smoothstep(0.74, 0.90, x));
  // Left massif: hero -0.60 leans down-left, sub-peak -0.40 down-right, -0.88 down-right.
  float l = mix(-0.30, 0.16, smoothstep(-0.46, -0.58, x));
  l = mix(l, -0.10, smoothstep(-0.76, -0.90, x));
  return mix(l, r, smoothstep(-0.15, 0.10, x));
}

// Shade a pixel inside the massifs. top / slope = silhouette height and slope above it, eTop = the
// smooth envelope there (sets the glacier level), glow = alpenglow colour (0 outside sunrise / sunset).
vec3 gla_shadeMassif(vec2 p, float top, float slope, float eTop, vec3 lit, vec3 fill, vec3 rock, vec3 haze, vec3 glow) {
  float aa = sc_aa();
  float x = p.x;
  float d = max(top - p.y, 0.0);
  float X = gla_X;
  // Big faces: which side of the leaning, wandering arete this pixel is on (finite difference over
  // ~1.5 px so the arete line itself is anti-aliased).
  float wob = (sc_n1(p.y * 9.0 + x * 3.0) - 0.5) * 0.07 + (sc_n1(p.y * 23.0 - x * 5.0) - 0.5) * 0.025;
  float xw = x + gla_lean(x) * d + wob * clamp(d * 6.0, 0.0, 1.0);
  float e = max(aa, 0.0008);
  vec2 Ea = gla_envD(xw - e);
  vec2 Eb = gla_envD(xw + e);
  float sW = (Eb.x - Ea.x) / (2.0 * e);
  // Inside the ~2 px arete transition the fall-line frame flips; fade the facet detail there so the
  // arete stays one clean line.
  float det = 1.0 - smoothstep(0.25, 0.7, abs(Ea.y - Eb.y));
  // Fall-line coordinates: spurs branch down and outward from the arete like a herringbone, following
  // the envelope slope (continuous through the cols, so no seams where two peaks meet).
  float sC = clamp(sW, -1.2, 1.2);
  float u = x + sC * d * 0.95;
  vec2 gv = vec2(1.0, -sC * 0.95);
  float gl = length(gv);
  vec2 gu = gv / gl;
  float pw = 1.2 / u_res.y * gl;
  float me = sc_n1(d * 5.0 + u * 3.0) - 0.5;
  vec3 T1 = gla_tri(u * 11.0 + 3.0 + 0.45 * me, d * 6.0, pw * 11.0);
  vec3 T2 = gla_tri(u * 27.0 + 11.0 + 0.6 * me, d * 12.0 + 5.0, pw * 27.0);

  // Glaciers fill the cirques between the big spurs: the bergschrund dips in a U across each cirque
  // and climbs toward the bounding ridges, which stay bare rock.
  float yB = mix(eTop, 0.205, 0.56) + 0.03 * T1.x * T1.x + 0.012 * (sc_n1(u * 9.0 + 4.0) - 0.5);
  float gz = yB - p.y;
  float glac = smoothstep(-aa, aa, gz);
  float rib = smoothstep(0.35, 0.7, T1.z) * (1.0 - 0.45 * glac * smoothstep(0.0, 0.05, gz)) * det;

  // Facet normal: flank side + spur tilt across the fall line (flattened on the glaciers, which also
  // face up more).
  vec2 tilt = gu * (T1.y * 11.0 + T2.y * 27.0 * 0.35) * 0.05 * mix(1.0, 0.32, glac) * smoothstep(0.0, 0.02, d) * det;
  vec3 n = normalize(vec3(-0.95 * clamp(sW * 1.8, -1.0, 1.0) - tilt.x, mix(0.26, 0.95, glac) - tilt.y, 1.0));
  float light = smoothstep(mix(-0.15, -0.06, X), mix(1.0, 0.72, X), dot(n, gla_L));
  // Right under the crest the light follows the detailed silhouette (each gendarme lit on its key side).
  float cr = smoothstep(-0.45, 0.45, slope * gla_lx);
  light = mix(cr, light, smoothstep(0.002, 0.009, d));
  // Low sun: the lower slopes already lie in the shadow of the range opposite; the shadow line climbs
  // (ragged along the spurs) as the sun sets, leaving only the summits in the light.
  float shl = smoothstep(gla_shY - 0.012, gla_shY + 0.02, p.y + 0.03 * (T1.x - 0.4));
  light *= mix(1.0, shl, gla_W);

  // Snow colours: brighter with altitude, blue fill in the shade.
  float alt = smoothstep(0.20, 0.46, p.y);
  vec3 litS = lit * (mix(0.22, 0.50, X) + mix(0.36, 0.20, X) * alt);
  vec3 shdS = fill * (mix(0.24, 0.22, X) + 0.14 * alt) + lit * 0.012;
  vec3 col = mix(shdS, litS, light);

  // Rock: thin ribs along the spur crests and ridges breaking through the glacier head, plus a few
  // thin cliff bands on the headwalls running along the contours.
  float nB = vnoise(vec2(u * 16.0 + 5.0, d * 110.0));
  float band = smoothstep(0.68, 0.84, nB) * (1.0 - glac) * smoothstep(0.02, 0.05, d) * (0.4 + 0.6 * T1.x);
  float rockAmt = max(rib, band) * smoothstep(0.003, 0.012, d);
  vec3 rk = mix(rock * 0.62, rock * 1.55 + lit * 0.05, light);
  // By day the rock shows strata: faint darker streaks running down the fall line.
  rk *= 1.0 - 0.25 * X * smoothstep(0.4, 1.0, sin(u * 420.0 + nB * 9.0));
  col = mix(col, rk, clamp(rockAmt, 0.0, 1.0));

  // Glacier structure: sparse crevasse arcs bending around the spurs (dark crack under a lit lip);
  // they crowd together into icefalls in places.
  float pxz = 110.0 / u_res.y;
  // Crevasses: tapered, smile-shaped arcs (bowing downstream between the ridges), only in the icefalls.
  float icefall = smoothstep(0.52, 0.60, sc_n1(u * 6.0 + 2.0));
  float sx = u * 60.0;
  float sxi = floor(sx);
  float sxf = fract(sx);
  float cz = (0.2 - p.y) * 110.0 + 2.4 * T1.x + hash11(sxi * 1.3 + 0.7) * 0.8;
  float ci = floor(cz);
  float cf = fract(cz) - 0.5;
  float seg = step(mix(0.80, 0.48, icefall), hash21(vec2(ci, sxi)));
  float hw = pxz * 0.9 * smoothstep(0.0, 0.35, sxf) * smoothstep(1.0, 0.65, sxf);
  float field = smoothstep(0.004, 0.010, gz) * (1.0 - smoothstep(0.05, 0.10, gz)) * glac * (1.0 - rib);
  float crack = 1.0 - smoothstep(hw, hw + pxz, abs(cf));
  float lipL = 1.0 - smoothstep(hw, hw + pxz, abs(cf + hw + 1.4 * pxz));
  // Crack interiors: near-black at night, glowing glacier-ice blue by day.
  vec3 ice = mix(mix(fill * 0.10, lit * 0.03, 0.3), vec3(0.03, 0.15, 0.30), X);
  // Ogives: faint wave bands across the glacier below the icefalls.
  col *= 1.0 - 0.05 * glac * smoothstep(0.01, 0.03, gz) * (0.5 + 0.5 * sin(gz * 70.0 + 3.0 * T1.x + 1.3)) * (0.4 + 0.6 * icefall);
  col = mix(col, ice, crack * seg * field * (0.45 + 0.35 * light));
  col += lit * lipL * seg * field * light * 0.06;
  // Bergschrund: a broken dark crack across the head of the glacier, with a lit upper lip.
  float bz = p.y - yB;
  float bk = step(0.3, sc_n1(u * 55.0)) * (1.0 - rib) * smoothstep(0.012, 0.03, d) * smoothstep(0.34, 0.14, T1.x);
  col = mix(col, ice, (1.0 - smoothstep(0.35 * aa, 1.1 * aa, abs(bz + 0.0012))) * bk * 0.85);
  col += lit * (1.0 - smoothstep(0.3 * aa, 1.0 * aa, abs(bz - 0.0004))) * bk * light * 0.07;

  // Crest rim light, strongest on the key-facing crest facets.
  float rimD = exp(-d / max(0.0020, aa));
  col += lit * rimD * (0.05 + 0.32 * cr) * (0.35 + 0.65 * alt) * gla_rim;
  // Alpenglow: rose light on the upper slopes around sunrise / sunset (lingering after the sun is
  // down), and a hot rim where the low sun sits right behind a ridge.
  col += glow * alt * smoothstep(gla_shY - 0.02, gla_shY + 0.07, p.y) * (0.45 + 0.55 * light);
  col += glow * rimD * 3.0 * exp(-abs(x - gla_sunX) * 4.0);
  // Keep the middle calm, fade the bases into valley haze.
  col *= mix(0.58, 1.0, smoothstep(0.08, 0.45, abs(p.x)));
  return mix(col, haze, 0.06 + 0.42 * smoothstep(0.30, 0.19, p.y));
}

vec3 gla_shadeFar(vec2 p, float top, vec3 lit, vec3 fill, vec3 haze, vec3 glow) {
  float d = max(top - p.y, 0.0);
  float x = p.x;
  float e = max(sc_aa(), 0.0008);
  float xw = x + (0.25 * clamp((x - 0.03) * -6.0, -1.0, 1.0) - 0.16 - 0.22 * exp(-pow((x + 0.075) / 0.05, 2.0))) * d
           + (sc_n1(p.y * 14.0 + x * 3.0) - 0.5) * 0.02 * clamp(d * 8.0, 0.0, 1.0);
  float sW = (gla_farEnv(xw + e) - gla_farEnv(xw - e)) / (2.0 * e);
  float side = smoothstep(-0.2, 0.2, sW * gla_lx);
  float sC = clamp(sW, -1.2, 1.2);
  vec2 gv = vec2(1.0, -sC);
  float gl = length(gv);
  vec3 T = gla_tri((x + sC * d) * 30.0 + 7.0, d * 9.0, 1.2 / u_res.y * gl * 30.0);
  vec2 tilt = gv / gl * T.y * 0.35 * smoothstep(0.0, 0.01, d);
  vec3 n = normalize(vec3(-0.95 * clamp(sW * 1.8, -1.0, 1.0) - tilt.x, 0.3 - tilt.y, 1.0));
  float light = smoothstep(-0.15, 1.0, dot(n, gla_L));
  light *= mix(1.0, smoothstep(gla_shY - 0.01, gla_shY + 0.02, p.y), gla_W);
  vec3 col = mix(fill * 0.36, lit * mix(0.19, 0.40, gla_X), light);
  col += lit * exp(-d / max(0.0022, sc_aa())) * (0.03 + 0.07 * side) * gla_rim;
  col += glow * 0.6 * smoothstep(0.22, 0.32, p.y);
  return mix(col, haze, mix(0.45, 0.38, gla_X) + 0.40 * smoothstep(0.27, 0.20, p.y));
}

// Spindrift streaming off a summit to the right: a veil that leaves the crest with a crisp upper edge,
// fans out downwind and breaks into fine wind-combed streaks. q = position relative to the summit.
float gla_plume(vec2 q, float len, float t) {
  if (q.x < -0.012 || q.x > len || q.y < -0.06 || q.y > 0.07) return 0.0;
  float u = max(q.x, 0.0) / len;
  // Centre line lifts off the summit, then sags and undulates downwind.
  float c = 0.018 * u + 0.010 * u * u - 0.030 * u * u * u + 0.005 * u * sin(q.x * 12.0 - t * 0.4);
  float w = 0.006 + 0.045 * u;
  float a = (q.y - c) / w;
  float band = exp(-a * a * (a > 0.0 ? 1.2 : 0.5));
  // Torn, wind-combed wisps (about 4:1 along the wind), finer detail riding on larger tufts.
  vec2 fq = vec2(q.x * 9.0 - t * 0.35, (q.y - c) * 38.0 + t * 0.03);
  float n = vnoise(fq) * 0.55 + vnoise(fq * 2.3 + 7.0) * 0.30 + vnoise(fq * 5.1 + 3.0) * 0.15;
  float torn = smoothstep(0.28, 0.78, n + 0.22 * (1.0 - u) - 0.08);
  return band * (0.15 + 0.85 * torn) * smoothstep(-0.012, 0.006, q.x)
       * pow(max(1.0 - u, 0.0), 1.3) * (1.0 + 1.3 * exp(-max(q.x, 0.0) / 0.02));
}

// Rounded billows (cloud tops): 0..1 semicircular bumps of random height, cells of width 1/freq.
float gla_billow(float x, float seed) {
  float c = floor(x);
  float f = fract(x) * 2.0 - 1.0;
  float h = 0.45 + 0.55 * hash11(c * 3.7 + seed);
  return sqrt(max(1.0 - f * f, 0.0)) * h;
}
// The same with how much it faces left (for lighting): (height, left-facing slope).
vec2 gla_billowD(float x, float seed) {
  float c = floor(x);
  float f = fract(x) * 2.0 - 1.0;
  float h = 0.45 + 0.55 * hash11(c * 3.7 + seed);
  float sq = sqrt(max(1.0 - f * f, 0.0));
  return vec2(sq * h, 0.32 * h * f / max(sq, 0.3) * smoothstep(1.0, 0.8, abs(f)));
}

// Moraines (depth 0.62): low in the middle, rolling up toward the massifs.
float gla_hills(float x) {
  float ax = abs(x);
  return 0.122 + 0.020 * sin(x * 4.3 + 0.6) + 0.012 * sin(x * 9.7 + 2.1) + 0.005 * sin(x * 23.0 + 1.0)
       + 0.012 * (sc_n1(x * 6.0 + 2.0) - 0.5) + 0.055 * smoothstep(0.15, 0.62, ax) + 0.03 * smoothstep(0.55, 1.0, ax);
}

// Clustered spruce stands on the moraines: height of the tree line above its base at x (trees come in
// irregular groups with gaps, varied heights, drooping tiers). y = the tallest tree's local offset.
vec2 gla_pines(float x) {
  float dens = 80.0;
  float cell = floor(x * dens);
  vec2 best = vec2(0.0, 1.0);
  for (int k = -1; k <= 1; k++) {
    float c = cell + float(k);
    float r1 = hash11(c * 1.37 + 4.0);
    float r2 = hash11(c * 7.13 + 9.0);
    float stand = sc_n1(c * 0.16 + 3.0) * 1.2 + (sc_n1(c * 0.7) - 0.5) * 0.5;
    float th = 0.032 * mix(0.40, 1.0, r2 * r2) * (0.6 + 0.4 * stand) * step(r1 * 0.5 + 0.32, stand);
    float cx = (c + 0.5 + (r1 - 0.5) * 0.75) / dens;
    float w = th * mix(0.19, 0.30, r2) + 1e-5;
    float dd = (x - cx) / w;
    if (abs(dd) < 1.0) {
      float uu = 1.0 - abs(dd);
      float tiers = 6.0 + floor(r1 * 4.0);
      float hh = th * (uu - 0.62 * fract(uu * tiers + r2) / tiers * (1.0 - uu * 0.6));
      if (hh > best.x) best = vec2(hh, dd);
    }
  }
  return best;
}

// Snow drift profiles at world x: k 0 = back .. 2 = front, laid diagonally.
float gla_swell(float x, float k) {
  if (k < 0.5) return 0.112 + 0.016 * sin(x * 3.1 + 0.5) + 0.012 * sc_n1(x * 4.0 + 7.0) + 0.005 * sc_n1(x * 11.0 + 3.0) + 0.075 * smoothstep(0.30, 1.05, x) + 0.02 * smoothstep(0.45, 1.0, -x);
  if (k < 1.5) return 0.040 + 0.085 * smoothstep(0.30, -0.95, x) + 0.018 * sin(x * 2.3 + 1.2) + 0.011 * sc_n1(x * 5.0 + 19.0) + 0.004 * sc_n1(x * 13.0 + 5.0);
  return 0.002 + 0.066 * smoothstep(-0.10, 0.95, x) + 0.014 * sin(x * 3.3 + 4.0) + 0.010 * sc_n1(x * 5.0 + 31.0) + 0.004 * sc_n1(x * 12.0 + 8.0);
}

// A snow drift (k, silhouette top, its slope sl): key-lit wind-facing slopes, a crisp lit lip with a
// cornice shadow under it, sastrugi ripples running along the surface and a soft blue base. By day the
// face is sunlit, fading to blue shade toward its base.
vec3 gla_shadeDrift(vec2 pg, float k, float top, float sl, vec3 lit, vec3 fill, vec3 haze, float sheen, float calm) {
  float aa = sc_aa();
  float X = gla_X;
  float d = max(top - pg.y, 0.0);
  float litM = smoothstep(0.30, 0.80, (-gla_L2.x * sl * 2.5 + gla_L2.y) / sqrt(1.0 + sl * sl * 6.25));
  float crest = exp(-d / (0.028 + 0.012 * k));
  float lm = mix(crest * (0.32 + 0.68 * litM),
                 smoothstep(0.26, 0.56, (0.22 + 0.78 * exp(-d / (0.055 + 0.02 * k))) * mix(0.32 + 0.68 * litM, 0.75, smoothstep(0.0, 0.05, d))), X) * gla_vl;
  vec3 gc = mix(fill * mix(0.20 + 0.03 * k, 0.30, X), lit * mix(0.17 + 0.03 * k, 0.46, X) * calm, lm);
  // Cornice: the lip overhangs on the lee stretches and throws a thin shadow.
  float lee = 1.0 - litM;
  float cn = sc_n1(pg.x * 9.0 + k * 7.0);
  float cdep = (0.0035 + 0.004 * cn) * (0.4 + 0.6 * lee);
  float cq = (d - cdep) / (0.0025 + 0.002 * cn);
  gc *= 1.0 - 0.38 * exp(-cq * cq) * smoothstep(0.35, 0.7, cn + 0.3 * lee);
  // Sastrugi: fine wind ripples parallel to the crest, breaking up and fading downslope (the low sun
  // rakes them into relief).
  float rw = sc_n1(pg.x * 7.0 + k * 5.0);
  float rp = d * (330.0 - 70.0 * k) + pg.x * 4.0 + 2.5 * rw + 1.5 * sc_n1(pg.x * 23.0 + k);
  float rip = pow(abs(sin(rp)), 6.0);
  float ripM = smoothstep(0.006, 0.02, d) * exp(-d / mix(0.05, 0.08, X)) * smoothstep(0.3, 0.7, rw);
  gc += lit * 0.03 * rip * ripM * (0.3 + 0.7 * litM);
  gc *= 1.0 - mix(0.10, 0.16, X) * pow(abs(sin(rp + 0.9)), 6.0) * ripM;
  // Lit lip.
  gc += lit * exp(-d / max(0.0016, aa * 0.9)) * (0.08 + 0.16 * litM) * gla_rim;
  gc += lit * sheen * crest * 0.06;
  return mix(gc, haze, 0.10 * smoothstep(0.03, 0.14, pg.y));
}

// Snow-laden spruce. Returns (coverage, snow, snow light, key-side rim) for a tree based at (bx, by)
// with height th: drooping tiers offset between the two sides, a lumpy snow pad on each tier with a
// dark gap under the tier above, needle tufts fringing the outline.
vec4 gla_spruce(vec2 p, float bx, float by, float th, float seed) {
  float v = (by + th - p.y) / th;
  if (v < -0.03 || v > 1.06) return vec4(0.0);
  float aa = sc_aa();
  float vc = clamp(v, 0.0, 1.0);
  float dx = p.x - bx;
  float adx = abs(dx);
  float side = smoothstep(-th * 0.02, th * 0.02, dx);
  float tiers = 10.0 + floor(seed * 4.0);
  float tv = (vc + 0.010 * sin(vc * 29.0 + seed * 5.0)) * tiers + side * 0.22 - adx / th * 2.3;
  float ti = floor(tv);
  float fr = fract(tv);
  float tierW = 0.78 + 0.44 * hash11(ti * 3.3 + seed * 11.0 + step(0.0, dx) * 5.0);
  float w = th * 0.20 * pow(vc, 0.82) * (0.30 + 0.70 * pow(fr, 0.55)) * tierW;
  float nt = sc_n1(p.y / th * 170.0 + seed * 13.0 + side * 7.0);
  w *= 0.90 + 0.20 * nt * smoothstep(0.3, 0.8, fr);
  float cov = (1.0 - smoothstep(w - aa, w + aa, adx)) * smoothstep(-0.03, 0.0, v);
  float trunk = (1.0 - smoothstep(th * 0.016 - aa, th * 0.016 + aa, adx)) * step(0.9, v);
  // The foot of the tree is buried in drifted snow: a crisp, slightly wavy snow line.
  cov = max(cov, trunk) * smoothstep(1.0 + aa / th, 1.0 - aa / th, v + 0.03 * nt - 0.002);
  float aT = aa * tiers / th;
  float clump = sc_n1(dx / th * 38.0 + seed * 9.0 + ti * 7.3);
  float rel = adx / max(w, 1e-4);
  float sEdge = (0.26 + 0.30 * clump) * (1.0 - 0.40 * rel * rel);
  float snow = (1.0 - smoothstep(sEdge - aT, sEdge + aT, fr)) * smoothstep(0.0, aT * 1.5, fr - 0.02);
  snow *= smoothstep(0.02, 0.07, vc);
  snow = max(snow, (1.0 - smoothstep(0.03, 0.09, vc)) * 0.85);
  float padLight = 1.0 - fr / max(sEdge, 0.05) * 0.6;
  float rim = smoothstep(0.45, 1.0, rel) * mix(side, 1.0 - side, 0.5 + 0.5 * gla_lx);
  return vec4(cov, snow * (1.0 - trunk), padLight, rim);
}

// Dry grass stalks poking through the snow in tufts: thin curved blades leaning downwind, darker at
// the base, their tips catching the light. base = snow line height at p.x. Returns (coverage, tip).
vec2 gla_grass(vec2 p, float base, float t) {
  float dens = 260.0;
  float c0 = floor(p.x * dens);
  vec2 g = vec2(0.0);
  float aa = sc_aa();
  for (int k = -1; k <= 1; k++) {
    float c = c0 + float(k);
    float r1 = hash11(c * 3.71 + 1.3);
    float r2 = hash11(c * 1.93 + 7.1);
    float tuft = smoothstep(0.45, 0.7, sc_n1(c * 0.09 + 2.0));
    float h = (0.009 + 0.020 * r2 * r2) * step(0.45, r1) * tuft;
    float v = (p.y - base + 0.002) / max(h, 1e-5);
    if (h > 0.0 && v > 0.0 && v < 1.0) {
      float lean = (r1 - 0.35) * 0.9 + 0.12 * sin(t * 0.6 + c) ;
      float bx = (c + 0.2 + 0.6 * r2) / dens + lean * h * v * v;
      float wd = aa * mix(0.55, 0.25, v);
      float m = 1.0 - smoothstep(wd, wd + aa * 0.8, abs(p.x - bx));
      if (m > g.x) g = vec2(m, v);
    }
  }
  return g;
}

// An angular rock poking through the drift, cut like the mountains: a convex outline of four
// planes, a lit left face and a shadowed right face split by a leaning ridge, a lumpy snow cap
// on the top planes, the base swallowed by a snow apron. q = (p - centre) / half-size, px = one pixel
// in q units. Returns (coverage, snow cap, left face, crease).
vec4 gla_rock(vec2 q, float px, float seed) {
  if (abs(q.x) > 1.3 || abs(q.y) > 1.3) return vec4(0.0);
  float e0 = dot(q, vec2(-0.94, 0.34)) - 0.78;
  float e1 = dot(q, vec2(-0.26, 0.97)) - 0.60 - 0.04 * seed;
  float e2 = dot(q, vec2(0.50, 0.87)) - 0.58;
  float e3 = dot(q, vec2(0.97, 0.26)) - 0.82;
  float sd = max(max(e0, e1), max(e2, e3));
  float apron = -0.40 + 0.09 * sin(q.x * 4.0 + seed * 3.0) + 0.05 * sin(q.x * 11.0 + seed) + 0.22 * q.x * q.x;
  float cov = smoothstep(px, -px, sd) * smoothstep(apron - px, apron + px, q.y);
  float rx = 0.08 + 0.30 * q.y + 0.10 * seed;
  float litF = smoothstep(rx + px, rx - px, q.x);
  float t = 0.30 + 0.08 * sin(q.x * 9.0 + seed * 5.0) + 0.05 * sin(q.x * 23.0 + seed);
  float cap = smoothstep(-t - px, -t + px, max(e1, e2));
  float crease = (1.0 - smoothstep(0.4 * px, 1.6 * px, abs(q.x - rx))) * (1.0 - cap);
  crease = max(crease, (1.0 - smoothstep(0.4 * px, 1.6 * px, abs(q.y + 0.35 * q.x - 0.02))) * (1.0 - cap) * step(rx, q.x) * 0.7);
  return vec4(cov, cap, litF, crease);
}

// Distant alpine choughs wheeling as a loose flock (p relative to the flock centre): at most one bird
// per grid cell so each pixel evaluates a single bird; wings beat or glide. Returns coverage.
float gla_birds(vec2 p, float t) {
  vec2 cs = vec2(0.052, 0.040);
  vec2 cid = floor(p / cs);
  vec2 cc = (cid + 0.5) * cs;
  float h = hash21(cid + 17.0);
  vec2 fk = cc / vec2(0.15, 0.07);
  float live = step(h, 0.62 * exp(-dot(fk, fk)));
  float h2 = hash21(cid + 5.3);
  vec2 bp = cc + (vec2(h, h2) - 0.5) * cs * 0.3 + 0.007 * vec2(sin(t * 0.21 + h * 30.0), cos(t * 0.17 + h2 * 20.0));
  vec2 q = p - bp;
  float s = 0.0080 * (0.75 + 0.5 * h2);
  float ax = min(abs(q.x) / s, 1.05);
  float aa = sc_aa();
  // Wing line with a bend at the wrist: a V on the up-stroke, an M while gliding, drooping on the
  // down-stroke (some birds glide).
  float flap = sin(t * (3.0 + 3.0 * h2) + h * 40.0) * step(0.3, h2);
  float wy = s * ((0.30 + 0.50 * flap) * min(ax, 0.45) + (-0.10 + 0.70 * flap) * max(ax - 0.45, 0.0));
  float th = aa * (0.55 - 0.35 * ax);
  float cov = (1.0 - smoothstep(th, th + aa * 0.8, abs(q.y - wy))) * (1.0 - smoothstep(0.85, 1.05, ax));
  vec2 bq = (q - vec2(0.0, -s * 0.03)) / vec2(s * 0.22, s * 0.11);
  return max(cov, 1.0 - smoothstep(0.6, 1.2, length(bq))) * live;
}

// The moon's face at q (unit-disc coordinates): bright highlands, hand-placed near-side maria,
// rayed Tycho, bright Copernicus / Kepler / Aristarchus and small crater pits.
float gla_blob(vec2 q, vec2 c, vec2 r) {
  vec2 k = (q - c) / r;
  return exp(-1.4 * dot(k, k));
}
float gla_moonFace(vec2 q) {
  vec2 w = q + 0.11 * (vec2(vnoise(q * 3.1 + 2.0), vnoise(q * 3.1 + 8.5)) - 0.5);
  // Gaussian blobs summed so neighbouring maria merge into the familiar connected chain.
  float m = gla_blob(w, vec2(-0.28, 0.42), vec2(0.30, 0.26));
  m += gla_blob(w, vec2(0.12, 0.42), vec2(0.17, 0.16));
  m += gla_blob(w, vec2(0.30, 0.13), vec2(0.21, 0.18));
  m += gla_blob(w, vec2(-0.62, 0.02), vec2(0.24, 0.46));
  m += gla_blob(w, vec2(-0.20, -0.36), vec2(0.19, 0.15));
  m += gla_blob(w, vec2(-0.52, -0.42), vec2(0.10, 0.10));
  m += gla_blob(w, vec2(0.70, 0.30), vec2(0.12, 0.10));
  m += gla_blob(w, vec2(0.55, -0.12), vec2(0.13, 0.17));
  m += gla_blob(w, vec2(0.35, -0.27), vec2(0.09, 0.09));
  m += gla_blob(w, vec2(-0.05, 0.73), vec2(0.36, 0.06));
  m += 0.6 * gla_blob(w, vec2(0.0, 0.18), vec2(0.09, 0.08));
  float mar = smoothstep(0.28, 0.70, m + 0.20 * (vnoise(q * 6.0 + 1.0) - 0.5));
  float tn = vnoise(q * 11.0 + 5.0);
  float tone = (1.0 - 0.24 * mar * (0.80 + 0.20 * tn)) * (0.965 + 0.035 * tn);
  // A few distinct craters: bright rims, slightly darker floors.
  vec2 k1 = (q - vec2(0.36, -0.52)) / 0.075;
  vec2 k2 = (q - vec2(0.10, -0.62)) / 0.055;
  vec2 k3 = (q - vec2(-0.40, -0.66)) / 0.06;
  float r1 = length(k1);
  float r2 = length(k2);
  float r3 = length(k3);
  tone *= 1.0 - 0.06 * (smoothstep(1.0, 0.6, r1) + smoothstep(1.0, 0.6, r2) + smoothstep(1.0, 0.6, r3));
  tone += 0.07 * (exp(-pow((r1 - 1.0) * 5.0, 2.0)) + exp(-pow((r2 - 1.0) * 5.0, 2.0)) + exp(-pow((r3 - 1.0) * 5.0, 2.0)));
  // Rayed Tycho, bright Copernicus / Kepler / Aristarchus.
  vec2 ty = q - vec2(-0.14, -0.70);
  float ang = atan(ty.y, ty.x);
  float ray = max(sin(ang * 7.0 + 1.0) * 0.5 + sin(ang * 17.0 + 1.3) * 0.3 + sin(ang * 29.0 + 0.7) * 0.2, 0.0);
  tone += 0.07 * ray * ray * exp(-length(ty) * 3.0) + 0.22 * exp(-dot(ty, ty) / 0.0016);
  vec2 cp = q - vec2(-0.30, 0.04);
  tone += 0.16 * exp(-dot(cp, cp) / 0.0022);
  vec2 kp = q - vec2(-0.56, 0.10);
  tone += 0.10 * exp(-dot(kp, kp) / 0.0012);
  vec2 ar = q - vec2(-0.70, 0.30);
  tone += 0.20 * exp(-dot(ar, ar) / 0.0008);
  return tone;
}

vec3 scene_glacier(vec2 uv, vec3 sky) {
  float t = u_time;
  float aspect = sc_aspect();
  float aa = sc_aa();
  float li = 0.78 + 0.3 * u_intensity;

  // ---- time of day: one key light and one set of blended materials for every layer
  float D = clamp(u_day, 0.0, 1.0);
  float G = clamp(u_golden, 0.0, 1.0);
  float nv = sc_nightVis();
  // W: the sun is the key while it is up (the moon takes over again in the blue hour after sunset);
  // X: daylight materials; Xf: sky fill, which stays bright through twilight.
  float W = smoothstep(-0.07, 0.05, u_sunElev) * smoothstep(0.0, 0.5, D + 0.6 * G);
  float X = smoothstep(0.0, 0.9, D + 0.3 * G);
  float Xf = smoothstep(0.0, 0.9, D + 0.6 * G);
  float kI = smoothstep(-0.10, 0.08, u_sunElev);
  float se = clamp(u_sunElev, 0.0, 1.0);
  float sxs = clamp((u_sun.x - 0.5) * 2.6, -1.0, 1.0);
  vec3 Ls = normalize(vec3(sxs * (1.0 - 0.4 * se) - 0.22 * se, 0.14 + 0.85 * se, -0.12 + 0.55 * se));
  gla_L = normalize(mix(vec3(-0.72, 0.50, 0.48), Ls, W));
  gla_L2 = mix(vec2(-0.80, 0.60), normalize(Ls.xy), W);
  gla_lx = clamp(-gla_L.x * 1.6, -1.0, 1.0);
  gla_X = X;
  gla_W = W;
  gla_rim = 1.0 - 0.7 * X + 0.5 * G;
  gla_shY = 0.36 - 0.9 * u_sunElev;
  gla_sunX = (u_sun.x - 0.5) * aspect;

  // Sunlight: white by day, gold at sunset, rosier at sunrise, lightly theme-tinted.
  vec3 sunC = mix(vec3(1.0, 0.96, 0.90), mix(vec3(1.0, 0.50, 0.26), vec3(1.0, 0.58, 0.56), u_dawn * 0.7), smoothstep(0.0, 0.75, G));
  sunC = mix(sunC, u_a2, 0.08);
  vec3 moonTint = mix(vec3(0.93, 0.95, 1.0), u_a2, 0.45);
  vec3 lit = mix(mix(u_a2, u_a0, 0.28) * li, sunC * (2.0 - 0.4 * G) * kI, W);
  // Shade: palette-dark at night, sky blue by day, violet / lavender around sunset / sunrise and
  // through the blue hour.
  vec3 fillD = mix(vec3(0.95, 1.32, 2.15), mix(vec3(0.95, 0.72, 1.30), vec3(0.80, 0.82, 1.50), u_dawn), G) + u_a1 * 0.08;
  vec3 fill = mix((u_c1 * 0.9 + u_c2 * 0.45 + u_a1 * 0.03 + u_a0 * 0.05) * 0.85, fillD, Xf);
  vec3 rock = mix(u_c0 * 0.45 + u_c1 * 0.18, vec3(0.17, 0.155, 0.15) + u_c1 * 0.3, X);
  // Haze: by day the real sky just above the horizon, so distant layers melt into it.
  vec3 hz = texture2D(u_skyTex, vec2(uv.x, 0.27)).rgb;
  vec3 haze = mix(mix(u_c1, u_c2, 0.5) * 0.9 + mix(u_a0, u_a2, 0.5) * 0.06, 2.0 * hz * hz * 0.92, Xf);
  // Alpenglow colour: rose at dawn, coral at dusk, strongest as the sun touches the horizon.
  vec3 glow = mix(vec3(0.55, 0.20, 0.24), vec3(0.62, 0.26, 0.20), 1.0 - u_dawn) * G * (1.0 - 0.45 * kI * X);

  // ---- sky: moon with a soft halo and a faint corona ring (night only)
  vec2 pm = sc_world(uv, 0.05);
  vec2 mc = vec2((0.165 - 0.5) * aspect, 0.785);
  float mr = 0.042;
  float md = length(pm - mc);
  vec3 col = sky;
  col += moonTint * (exp(-md / 0.24) * 0.055 + exp(-md / 0.08) * 0.12 + exp(-max(md - mr, 0.0) / 0.014) * 0.16) * li * nv;
  // Faint corona: a lavender ring just outside the glow.
  float coq = (md - mr * 3.1) / (mr * 0.7);
  col += mix(u_a0, u_a1, 0.3) * exp(-coq * coq) * 0.035 * li * nv;
  if (md < mr + 2.0 * aa && nv > 0.001) {
    vec2 mq = (pm - mc) / mr;
    float disc = smoothstep(mr + aa * 0.8, mr - aa * 0.8, md);
    float limb = 0.86 + 0.14 * sqrt(max(1.0 - dot(mq, mq), 0.0));
    col = mix(col, moonTint * 1.95 * gla_moonFace(mq) * limb, disc * nv);
  }
  // Where the key light sits along the horizon (moon by night, sun by day).
  float keyX = mix(mc.x, gla_sunX, W);

  // A flock of choughs wheeling above the left massif by day (dark specks against the bright sky).
  float bV = smoothstep(0.30, 0.70, D + 0.5 * G);
  if (bV > 0.01 && uv.y > 0.60 && uv.y < 0.84) {
    vec2 bp = vec2((uv.x - 0.26) * aspect + 0.05 * sin(t * 0.013), uv.y - 0.705 - 0.01 * sin(t * 0.021));
    float b = gla_birds(bp, t);
    col = mix(col, mix(vec3(0.05, 0.055, 0.08), haze, 0.25), b * bV * 0.9);
  }

  // Early-out: nothing but sky (and the moon) above the highest plume.
  if (uv.y > 0.63) return col;

  float sq = mix(1.0, 1.55, smoothstep(1.3, 0.6, aspect));
  vec2 pf = sc_world(uv, 0.12); pf.x *= sq;
  vec2 pM = sc_world(uv, 0.35); pM.x *= sq;
  vec2 ph = sc_world(uv, 0.62); ph.x *= sq;
  vec2 pg = sc_world(uv, 0.92);
  float s0 = gla_swell(pg.x, 0.0);
  float gCov = sc_below(pg.y, s0);
  float hTop = gla_hills(ph.x);
  vec2 pn = gla_pines(ph.x);
  float grove = smoothstep(0.10, 0.28, abs(ph.x));
  float hSil = hTop + pn.x * grove;
  float hCov = sc_below(ph.y, hSil);
  float behind = min(1.0 - gCov, 1.0 - hCov);
  // Low sun: how much of the key the valley floor still gets (it falls into the mountains' shadow).
  float valleyLit = mix(1.0, 0.5 + 0.5 * smoothstep(0.12, 0.30, u_sunElev), W);
  gla_vl = valleyLit;

  if (behind > 0.0) {
    // ---- far range and massifs
    float fTop = gla_farEnv(pf.x) + 0.028 * (gla_ridgeD(pf.x * 6.0 + 11.0).x - 0.32);
    float fCov = sc_below(pf.y, fTop);
    vec2 E = gla_envD(pM.x);
    vec2 R = gla_ridgeD(pM.x * 5.2 + 3.0);
    float ramp = 0.05 * (0.2 + 0.8 * smoothstep(0.18, 0.42, E.x));
    float mTop = E.x + ramp * (R.x - 0.32);
    float mCov = sc_below(pM.y, mTop);
    if (fCov > 0.0 && mCov < 1.0) col = mix(col, gla_shadeFar(pf, fTop, lit, fill, haze, glow), fCov);
    if (mCov > 0.0) col = mix(col, gla_shadeMassif(pM, mTop, E.y + ramp * R.y * 5.2, E.x, lit, fill, rock, haze, glow), mCov);

    // A rope team of three on the gentle west ridge of the left massif's sub-peak, heading for its
    // summit: small figures against the sky by day, a string of headlamps at night (an alpine start).
    float rq = pM.x + 0.432;
    float fy = pM.y - mTop;
    if (abs(rq) < 0.024 && fy > -0.003 && fy < 0.014) {
      float px1 = 1.0 / u_res.y;
      float ci = clamp(floor(rq / 0.0095 + 0.5), -1.0, 1.0);
      float fx = rq - ci * 0.0095 - fy * 0.20;
      // Body (with a pack on the downhill side) and head; feet planted on the crest below.
      float sdB = length(vec2(fx, fy - clamp(fy, 0.0003, 0.0038))) - 0.00085;
      sdB = min(sdB, length(vec2(fx + 0.0009, fy - 0.0032)) - 0.0010);
      float sdH = length(vec2(fx - 0.0002, fy - 0.0053)) - 0.00072;
      float fig = smoothstep(px1, -px1, min(sdB, sdH));
      // The rope between them, sagging between waists.
      float rf = fract(rq / 0.0095 + 0.5);
      float ropeY = 0.0024 - 0.0014 * rf * (1.0 - rf) * 4.0;
      float rope = (1.0 - smoothstep(0.35 * px1, 1.1 * px1, abs(fy - ropeY))) * step(abs(rq), 0.0095) * 0.7;
      vec3 jacket = ci < -0.5 ? vec3(0.62, 0.10, 0.06) : (ci < 0.5 ? vec3(0.75, 0.52, 0.06) : vec3(0.08, 0.22, 0.55));
      vec3 figC = mix(vec3(0.02, 0.022, 0.035), jacket * (0.25 + 0.45 * lit.r * kI) + lit * 0.02, X * step(0.0007, fy) * step(sdB, sdH));
      col = mix(col, figC, max(fig, rope * (1.0 - fig)) * (0.35 + 0.65 * max(X, 1.0 - sc_lights())));
      // Headlamps.
      vec2 hl = vec2(fx - 0.0009, fy - 0.0054);
      col += vec3(1.0, 0.90, 0.72) * (smoothstep(1.4 * px1, 0.3 * px1, length(hl)) * 1.6 + exp(-length(hl) / 0.0028) * 0.10) * sc_lights();
    }

    // Spindrift streaming off the two highest summits: silver at night, white by day, rose at sunset.
    if (uv.y > 0.38) {
      float right = step(0.0, pM.x);
      vec2 apex = mix(vec2(-0.600, 0.484), vec2(0.520, 0.521), right);
      float pl = gla_plume(pM - apex, mix(0.20, 0.30, right), t + 13.0 * (1.0 - right)) * mix(0.75, 1.0, right);
      col += mix(moonTint * 0.30 * li, (sunC * 0.40 + glow * 0.6) * max(kI, 0.35), W) * pl;
    }

    // A sea of cloud filling the valley in three receding rows of billows; the lone far peak rises
    // out of it. Lit on the key-facing shoulders, glowing toward the moon / sun.
    if (uv.y < 0.28) {
      vec2 fp = sc_world(uv, 0.45); fp.x *= sq;
      float drift = t * 0.004;
      float fn = fbm(vec2(fp.x * 3.0 - t * 0.01, fp.y * 12.0 + t * 0.003));
      float mq2 = (fp.x - keyX * sq) / 0.40;
      vec3 cloudTop = mix(mix(haze * 1.6, fill * 0.5, X * 0.5), lit * mix(0.42, 0.52, X) * valleyLit + glow * 0.5, 0.55) * (1.0 + 0.30 * exp(-mq2 * mq2));
      float side = 0.012 * smoothstep(0.1, 0.6, abs(fp.x));
      for (int r = 0; r < 3; r++) {
        float fr = float(r);
        float bx1 = fp.x * (4.2 + fr * 0.9) + fr * 3.1 - drift * (4.2 + fr * 0.9);
        float bx2 = fp.x * 11.0 + fr * 1.7 + 0.3 - drift * 11.0;
        float bx3 = fp.x * 27.0 + fr * 5.3 - drift * 27.0;
        vec2 B1 = gla_billowD(bx1, 1.0 + fr);
        float ftop = 0.196 - fr * 0.016 + side + 0.008 * (fn - 0.5)
                   + 0.022 * B1.x + 0.008 * gla_billow(bx2, 5.0 + fr) + 0.0025 * gla_billow(bx3, 9.0 + fr);
        float fd = ftop - fp.y;
        float cov = smoothstep(-0.0015, 0.004, fd);
        if (cov > 0.0) {
          // Billows are lit on their key-facing shoulders.
          float lb = B1.y;
          float glw = exp(-max(fd, 0.0) / (mix(0.011, 0.018, X) + 0.003 * fr)) * (0.70 + 0.45 * clamp(lb * gla_L2.x * 2.5, -0.5, 1.0));
          vec3 cc = mix(mix(haze * (0.80 - 0.12 * fr), fill * (0.40 - 0.05 * fr) + haze * 0.2, X), cloudTop * (1.0 - 0.16 * fr), clamp(glw, 0.0, 1.0) * (0.75 + 0.25 * fn));
          col = mix(col, cc * 0.88, cov * 0.95);
        }
      }
      // Loose wisps hanging just above the cloud tops (thicker valley mist at dawn).
      float wisp = fbm(vec2(fp.x * 5.0 - t * 0.02, fp.y * 30.0));
      float wq = (fp.y - 0.222 - side) / (0.014 + 0.012 * u_dawn * G);
      col += (haze * 0.35 + lit * 0.035) * smoothstep(0.5, 0.8, wisp) * exp(-wq * wq) * (1.0 + 1.5 * u_dawn * G);
    }
  }

  // ---- moraines with spruce stands
  if (hCov > 0.0 && gCov < 1.0) {
    float d = max(hTop - ph.y, 0.0);
    float s = (gla_hills(ph.x + 0.01) - gla_hills(ph.x - 0.01)) / 0.02;
    float litM = smoothstep(0.45, 0.78, (-gla_L2.x * s * 1.6 + gla_L2.y) / sqrt(1.0 + s * s * 2.56));
    vec3 lh = lit * valleyLit;
    vec3 hc = mix(fill * mix(0.36, 0.30, X), lit * mix(0.15, 0.40, X), mix(litM * exp(-d / 0.02), mix(litM, 0.55, smoothstep(0.0, 0.03, d)) * (1.0 - 0.3 * smoothstep(0.0, 0.05, d)), X) * valleyLit);
    hc += lh * exp(-d / max(0.002, aa)) * 0.09 * gla_rim;
    hc *= 1.0 - mix(0.5, 0.2, X) * smoothstep(0.0, 0.04, d);
    // Erratic boulders strewn over the moraines (fewer in the middle): snow-capped, key side lit.
    float bxs = ph.x * 22.0;
    float bi = floor(bxs);
    float bh = hash11(bi * 5.17 + 2.0);
    if (bh < 0.42 * grove && d > 0.002) {
      float bw = 0.0045 + 0.005 * hash11(bi * 3.3 + 1.0);
      vec2 bq = vec2(ph.x - (bi + 0.25 + 0.5 * bh / 0.42) / 22.0, ph.y - hTop + 0.006 + 0.028 * hash11(bi * 1.91 + 7.0)) / vec2(bw, bw * 0.72);
      bq.x += 0.25 * bq.y;
      float bm = smoothstep(1.0, 0.78, length(bq) + 0.08 * sin(atan(bq.y, bq.x) * 3.0 + bh * 9.0)) * smoothstep(-0.55, -0.35, bq.y);
      vec3 bc = mix(rock * 0.40, rock * 1.25 + lh * 0.05, smoothstep(-0.25, 0.25, -bq.x * gla_lx + bq.y * 0.4));
      bc = mix(bc, hc * 1.12 + lh * 0.04, smoothstep(0.42, 0.55, bq.y + 0.12 * sin(bq.x * 6.0 + bh * 20.0)));
      hc = mix(hc, bc, bm);
    }
    // Trees: near-black needles at night, deep spruce green by day, a lit key-side edge.
    float tr = step(0.0005, ph.y - hTop);
    vec3 tc = mix(rock * 0.42, vec3(0.045, 0.080, 0.070), X) + lh * mix(0.075, 0.05, X) * smoothstep(0.25, 0.95, -pn.y * gla_lx);
    hc = mix(hc, tc, tr);
    hc = mix(hc, haze, 0.10);
    col = mix(col, hc, hCov);
  }

  // ---- foreground: snow drifts with lit crests
  vec3 lf = lit * valleyLit;
  // Cast shadows on the snow fall to the sky-lit shade colour (blue by day, never a darkened gold).
  vec3 shd = fill * mix(0.16, 0.27, X);
  if (gCov > 0.0) {
    float shq = (pg.x - keyX) / 0.28;
    float sheen = exp(-shq * shq);
    // By day the middle of the snowfield (behind the timer controls) stays a calm mid-tone.
    float calm = 1.0 - 0.30 * X * exp(-pg.x * pg.x / 0.10);
    float s1 = gla_swell(pg.x, 1.0);
    float s2 = gla_swell(pg.x, 2.0);
    float c1 = sc_below(pg.y, s1);
    float c2 = sc_below(pg.y, s2);
    // Only the front-most drift is shaded; across its anti-aliased top edge it blends into a cheap
    // shade of the drift behind (that drift's lower, bluer part), or into the scene behind.
    float k = c2 > 0.0 ? 2.0 : (c1 > 0.0 ? 1.0 : 0.0);
    float top = k > 1.5 ? s2 : (k > 0.5 ? s1 : s0);
    float cf = k > 1.5 ? c2 : (k > 0.5 ? c1 : gCov);
    if (k > 0.5) {
      float kB = (k > 1.5 && pg.y < s1) ? 1.0 : 0.0;
      float dB = max((kB > 0.5 ? s1 : s0) - pg.y, 0.0);
      float lmB = mix(exp(-dB / (0.028 + 0.012 * kB)) * 0.66, smoothstep(0.26, 0.56, (0.22 + 0.78 * exp(-dB / (0.055 + 0.02 * kB))) * 0.75), X);
      col = mix(fill * mix(0.20 + 0.03 * kB, 0.30, X), lit * mix(0.17 + 0.03 * kB, 0.46, X) * calm, lmB * valleyLit);
    }
    float sR = k > 1.5 ? gla_swell(pg.x + 0.05, 2.0) : (k > 0.5 ? gla_swell(pg.x + 0.05, 1.0) : gla_swell(pg.x + 0.05, 0.0));
    float sl = (sR - top) / 0.05;
    col = mix(col, gla_shadeDrift(pg, k, top, sl, lit, fill, haze, sheen, calm), cf);

    // A line of bootprints wandering down the middle drift from the tent: small dimples, shaded on
    // their upper wall, with a lit lower lip.
    if (pg.x > -0.415 && pg.x < -0.20 && pg.y < s1 && pg.y > s2) {
      float fi = floor((pg.x + 0.415) / 0.0105 + 0.5);
      float xs = -0.415 + fi * 0.0105;
      float dpath = 0.003 + (xs + 0.415) * 0.20 + 0.004 * sin(xs * 23.0) + (mod(fi, 2.0) - 0.5) * 0.0028;
      float sz = 1.0 + 6.0 * (s1 - pg.y);
      vec2 fq = vec2((pg.x - xs) / (0.0024 * sz), ((s1 - pg.y) - dpath) / (0.0010 * sz));
      float fpr = (1.0 - smoothstep(0.55, 1.0, length(fq))) * smoothstep(-0.412, -0.405, pg.x);
      col = mix(col, fill * mix(0.14, 0.24, X), fpr * clamp(0.55 - 0.35 * fq.y, 0.0, 0.8));
      col += lf * 0.05 * fpr * smoothstep(0.1, 0.8, fq.y);
    }

    // A skier's twin tracks linking S-turns down the back drift from the spruces on the right,
    // widening toward the viewer (grooves: a thin shadow line on each side of the track).
    if (k < 0.5 && pg.x > 0.22 && pg.x < 0.78) {
      float dS = s0 - pg.y;
      float ph2 = dS * 230.0 + 0.6;
      float A = 0.007 + 0.20 * dS;
      float xp = 0.71 - dS * 3.2 + A * sin(ph2);
      float fp = -3.2 + 0.20 * sin(ph2) + A * 230.0 * cos(ph2);
      float nrm = sqrt(1.0 + fp * fp);
      float gdx = abs(abs(pg.x - xp) / nrm - 0.0010 - 0.022 * dS);
      float gw = 0.0003 + 0.006 * dS;
      col = mix(col, shd, 0.25 * (1.0 - smoothstep(gw, gw + aa, gdx)) * smoothstep(0.003, 0.010, dS) * smoothstep(0.075, 0.05, dS));
    }

    // Angular rocks poking through the snow on the left, each casting a soft blue shadow down and
    // away from the key light.
    if (pg.x < -0.40 && pg.y < 0.17) {
      vec2 sa = (pg - vec2(-0.72 + 0.06 * gla_lx, 0.066)) / vec2(0.10, 0.018);
      vec2 sb2 = (pg - vec2(-0.53 + 0.035 * gla_lx, 0.060)) / vec2(0.055, 0.011);
      col = mix(col, shd, 0.36 * (exp(-dot(sa, sa)) + exp(-dot(sb2, sb2))) * gCov);
      float big = step(pg.x, -0.60);
      vec2 bc = mix(vec2(-0.530, 0.072), vec2(-0.720, 0.086), big);
      vec2 br = mix(vec2(0.032, 0.026), vec2(0.060, 0.046), big);
      vec4 bo = gla_rock((pg - bc) / br, aa / br.y, big);
      if (bo.x > 0.0) {
        float lfc = mix(1.0 - bo.z, bo.z, 0.5 + 0.5 * gla_lx);
        vec3 grey = mix(rock, vec3(sc_luma(rock)), 0.5);
        vec3 rc = mix(grey * 0.45, grey * 0.95 + lf * 0.05, lfc);
        rc = mix(rc, rock * 0.20, bo.w * 0.75);
        vec3 capc = mix(fill * mix(0.40, 0.30, X) + lf * 0.05, lf * mix(0.32, 0.42, X), lfc);
        col = mix(col, mix(rc, capc, bo.y), bo.x);
      }
    }

    // Tufts of dry grass along the lit crest of the middle drift on the left (straw-coloured by day).
    if (pg.x < -0.30 && abs(pg.y - s1) < 0.03 && pg.y > s2) {
      vec2 gr = gla_grass(pg, s1, t);
      vec3 grc = mix(mix(rock * 0.30, rock * 0.8 + lf * 0.10, gr.y * gr.y), mix(vec3(0.16, 0.12, 0.07), vec3(0.62, 0.50, 0.30), gr.y), X);
      col = mix(col, grc, gr.x * 0.9);
    }

    // Crust sparkle: sparse pixel-sized ice glints near the crests, twinkling slowly (and with
    // pointer parallax); more of them in sunshine.
    float d = max(top - pg.y, 0.0);
    float crest = exp(-d / (0.03 + 0.014 * k));
    vec2 gcell = pg.xy * vec2(120.0, 150.0);
    vec2 gid = floor(gcell);
    float gh = hash21(gid + 7.0 + k * 13.0);
    if (gh > 0.972 - 0.03 * sheen - 0.012 * X) {
      vec2 go = hash22(gid) * 0.7 + 0.15;
      vec2 gd = (fract(gcell) - go) / vec2(120.0, 150.0) * u_res.y;
      float gl = smoothstep(1.1, 0.0, length(gd)) + smoothstep(2.6, 0.0, length(gd)) * 0.12;
      float tw = pow(0.5 + 0.5 * sin(t * (0.5 + 1.1 * hash21(gid + 3.3)) + gh * 60.0 + u_mouse.x * 9.0), 4.0);
      col += mix(moonTint, sunC * 1.2 * valleyLit, W) * gl * (0.08 + 1.1 * tw) * (0.7 + 0.4 * u_energy) * mix(crest, 0.6, X) * smoothstep(0.003, 0.01, d) * gCov;
    }
  }

  // ---- a climbers' tent pitched on the back drift at the left: orange by day, glowing from its
  // lantern at night, with guy lines and a warm pool of light on the snow.
  vec2 tq = pg - vec2(-0.43, s0 - 0.0015);
  if (abs(tq.x) < 0.06 && tq.y > -0.03 && tq.y < 0.03) {
    float lamp = sc_lights() * (0.92 + 0.08 * sin(t * 2.3) * sin(t * 3.7));
    vec3 warm = vec3(1.0, 0.62, 0.30);
    col += warm * exp(-length(tq * vec2(1.0, 2.2)) / 0.02) * 0.16 * lamp;
    // Its shadow on the snow, thrown away from the key light.
    vec2 tsq = (tq - vec2(0.016 * gla_lx, -0.002)) / vec2(0.034, 0.005);
    col = mix(col, shd, 0.40 * X * exp(-dot(tsq, tsq)) * gCov);
    float th = 0.0165;
    float hw = 0.0175;
    float ax = abs(tq.x);
    vec2 en = normalize(vec2(th, hw));
    float sd = dot(vec2(ax, tq.y - th), en);
    float cov = smoothstep(aa, -aa, sd) * smoothstep(-aa, aa, tq.y);
    // Guy lines from the ridge to pegs in the snow.
    vec2 ga = vec2(ax, tq.y) - vec2(0.0, th);
    vec2 gb = vec2(hw * 2.1, 0.0) - vec2(0.0, th);
    float gt = clamp(dot(ga, gb) / dot(gb, gb), 0.0, 1.0);
    float guy = (1.0 - smoothstep(0.3 * aa, 1.1 * aa, length(ga - gb * gt))) * 0.55;
    col = mix(col, mix(rock * 0.5, vec3(0.30, 0.28, 0.27), X), guy * (1.0 - cov));
    float sideR = smoothstep(-aa, aa, tq.x);
    float kl = mix(sideR, 1.0 - sideR, 0.5 + 0.5 * gla_lx);
    // Door: a darker triangle, half zipped open.
    float dsd = dot(vec2(ax, tq.y - th * 0.66), normalize(vec2(th * 0.66, hw * 0.32)));
    float door = smoothstep(aa, -aa, dsd);
    vec3 tc = vec3(0.78, 0.30, 0.10) * (lf * (0.12 + 0.36 * kl) + fill * 0.16) * (1.0 - 0.65 * door);
    tc += warm * lamp * mix(0.55, 1.25, door) * (0.75 + 0.25 * smoothstep(0.0, th, tq.y));
    // Snow piled along the base of the walls.
    tc = mix(tc, fill * mix(0.26, 0.34, X) + lf * 0.12, (1.0 - smoothstep(0.0, 0.0025, tq.y)) * (1.0 - door));
    col = mix(col, tc, cov);
  }

  // Dawn mist pooled over the moraines.
  float mist = u_dawn * G * smoothstep(0.0, 0.03, uv.y - 0.10) * exp(-pow((uv.y - 0.155) / 0.035, 2.0));
  if (mist > 0.001) {
    float mn = vnoise(vec2(pg.x * 6.0 - t * 0.01, uv.y * 40.0));
    col = mix(col, haze * 0.95 + glow * 0.2, mist * (0.35 + 0.45 * mn) * (1.0 - gCov * 0.5));
  }

  // ---- snow-laden spruce cluster at the right edge
  float edge = 0.5 * aspect;
  float scl = clamp(aspect / 1.78, 0.55, 1.0);
  if (pg.x > edge - 0.48 * scl && uv.y < 0.54) {
    vec3 needles = mix(rock * 0.32 + u_c2 * 0.05, vec3(0.040, 0.075, 0.065) + u_c2 * 0.1, X);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float off = fi == 0.0 ? 0.30 : (fi == 1.0 ? 0.215 : (fi == 2.0 ? 0.15 : (fi == 3.0 ? 0.08 : 0.02)));
      float th = fi == 0.0 ? 0.10 : (fi == 1.0 ? 0.15 : (fi == 2.0 ? 0.24 : (fi == 3.0 ? 0.19 : 0.31)));
      float bx = edge - off * scl;
      th *= mix(0.85, 1.0, scl);
      float by = 0.112 + 0.016 * sin(bx * 3.1 + 0.5) + 0.075 * smoothstep(0.30, 1.05, bx) - 0.012;
      float sw = 0.003 * sin(t * 0.35 + fi * 1.7) * smoothstep(0.3, 1.0, (pg.y - by) / th);
      vec2 cs = (pg - vec2(bx + th * (0.06 + 0.2 * G) * gla_lx, by + th * 0.01)) / vec2(th * (0.34 + 0.3 * G), th * 0.045);
      col = mix(col, shd, 0.38 * exp(-dot(cs, cs)) * gCov);
      vec4 tr = gla_spruce(pg - vec2(sw, 0.0), bx, by, th, hash11(fi * 7.3 + 1.0));
      if (tr.x > 0.0) {
        float keySide = smoothstep(-0.02, 0.03, -(pg.x - sw - bx) * gla_lx);
        vec3 tc = needles + lf * 0.07 * tr.w;
        vec3 sc = mix(fill * mix(0.38, 0.30, X) + lf * 0.04, lf * (0.22 + 0.20 * tr.z) * mix(1.0, 1.2, X), 0.2 + 0.8 * keySide);
        tc = mix(tc, sc, tr.y);
        col = mix(col, tc, tr.x);
      }
    }
  }
  return col;
}
`,
};
