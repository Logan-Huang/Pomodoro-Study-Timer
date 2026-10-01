// Scene: Alpine lake (theme: aurora). Northern lights over a snowy alpine lake, lit for the time of day.
// Layers far -> near: sculpted snow peaks, forested range (avalanche chutes, a slender waterfall), shore
// pines + log cabin with a jetty and a canoe, mirror lake (a pair of loons with their wake, rising-fish
// rings), framing granite + spruces at the corners (grass tufts in the snow), hawks in the daytime sky.
// The foreground frame is drawn from ONE call site in scene_alpine (it is the largest function).
// Time of day: alp_setLight() derives the shared lighting ONCE per pixel (sun colour, sky fill, which
// side the light comes from, the sun's shadow line that lets alpenglow climb the peaks at sunset, dawn
// mist). Every layer keeps its night palette look and blends toward sunlit natural materials by alp_dm.
// Compile-time budget (D3D inlines every call and unrolls every loop): the land is evaluated at ONE
// call site (lake pixels pass the mirrored coordinate), and the massif's height and slope come from
// one analytic pass instead of finite differences; the leaning ridge axis reuses the dominant peak
// found in that pass instead of a second envelope evaluation.
// GLSL rules: GLSL ES 1.00, every helper in this file is prefixed "alp_", entry point scene_alpine(uv, sky).
export default {
  key: 'alpine',
  name: 'Alpine lake',
  glsl: `
// ------------------------------------------------------------------ alpine lake (alp_*)
const float alp_L = 0.262;      // lake level / far shoreline in uv.y
const float alp_cabX = -0.40;   // lakeside cabin, world x at shore depth

// Time-of-day lighting shared by every layer (set once per pixel by alp_setLight).
float alp_dm;    // 0 = night look (palette + aurora light) .. 1 = sunlit natural materials
float alp_lx;    // key light side: -1 = from the left .. +1 = from the right
float alp_shY;   // the sun's shadow line (world y): direct sun only above it
float alp_fill;  // a high sun softens the shadows
float alp_mist;  // extra valley mist around dawn
float alp_on;    // cabin lights
vec3 alp_K;      // direct sunlight: colour * intensity
vec3 alp_A;      // sky fill light

void alp_setLight() {
  float g = clamp(u_golden, 0.0, 1.0);
  float e = u_sunElev;
  alp_dm = smoothstep(0.0, 0.35, u_day + g * 0.6);
  // The light swings from left to right over the hour or so around solar noon.
  alp_lx = mix(-1.0, clamp((u_sun.x - 0.5) * 12.0, -1.0, 1.0), smoothstep(0.0, 0.15, u_day + g * 0.4));
  // Sun near / below the horizon: the lower land falls into shadow first, the summits glow last.
  alp_shY = alp_L - 0.05 + (0.1 - e) * 1.2;
  alp_fill = 0.2 * smoothstep(0.35, 0.95, e);
  alp_mist = u_dawn * smoothstep(-0.4, -0.1, e) * (1.0 - smoothstep(0.1, 0.45, e));
  alp_on = sc_lights();
  // Sun: white by day, gold at golden hour, rose as it touches the horizon (pinker at dawn).
  vec3 kg = mix(vec3(1.0, 0.32, 0.38), vec3(1.0, 0.50, 0.22), smoothstep(-0.06, 0.12, e));
  kg = mix(kg, vec3(1.0, 0.48, 0.70), u_dawn * 0.4);
  float gk = smoothstep(0.0, 0.55, g);
  alp_K = mix(vec3(1.0, 0.95, 0.88) * 1.25, kg * 1.35, gk) * smoothstep(-0.16, -0.03, e);
  // Sky fill: blue by day, dimmer at golden hour so the warm light and long shadows read.
  alp_A = mix(sc_ambient() * vec3(0.88, 1.0, 1.14), vec3(0.34, 0.33, 0.54), u_dawn * g * 0.5) * (1.0 - 0.35 * gk) + u_a1 * 0.02;
}

float alp_sunV(float y) { return smoothstep(alp_shY - 0.012, alp_shY + 0.012, y); }

// Sunlit material: albedo * (sky fill * occlusion + sun * lambert above the shadow line at height y).
vec3 alp_lit(vec3 alb, float amb, float lam, float y) {
  return alb * (alp_A * amb + alp_K * (mix(lam, 1.0, alp_fill) * alp_sunV(y)));
}

float alp_bright() {
  return (0.55 + 0.55 * clamp(u_energy, 0.0, 1.0)) * (0.55 + 0.55 * u_intensity);
}

// Light cast by the aurora / horizon glow, varying across the sky like the sky's own horizon tint.
vec3 alp_aurLight(float x) {
  vec3 c = mix(u_a0, u_a1, smoothstep(-0.7, 0.7, x + 0.15 * sin(u_time * 0.07)));
  return mix(c, u_a2, 0.12);
}

// 1D value noise with its derivative (x: value 0..1, y: d/dx).
vec2 alp_n1d(float x) {
  float i = floor(x);
  float f = x - i;
  float a = hash11(i);
  float b = hash11(i + 1.0);
  return vec2(mix(a, b, f * f * (3.0 - 2.0 * f)), (b - a) * 6.0 * f * (1.0 - f));
}

// Piecewise-linear noise (angular crags) with its derivative.
vec2 alp_l1d(float x) {
  float i = floor(x);
  float a = hash11(i);
  float b = hash11(i + 1.0);
  return vec2(mix(a, b, x - i), b - a);
}

// Adds one cusp-shaped peak (concave flanks, separate left/right widths) to the envelope
// e = (height, slope, peak dominance) with a polynomial smooth max, whose slope is exactly
// mix(slopes); k tracks the dominant peak (centre, height, left width, right width) the same way.
vec3 alp_pk(vec3 e, inout vec4 k, float x, float c, float hgt, float wl, float wr) {
  float dx = x - c;
  float s = sqrt(dx * dx + 0.00004);
  float w = dx < 0.0 ? wl : wr;
  float h = hgt * exp(-s / w);
  float m = clamp(0.5 + 25.0 * (h - e.x), 0.0, 1.0);
  k = mix(k, vec4(c, hgt, wl, wr), m);
  return vec3(mix(e.x, h, m) + 0.02 * m * (1.0 - m), mix(e.y, -h * dx / (s * w), m), mix(e.z, 1.0, m));
}

// Designed far massif (height above the lake, slope): low saddle behind the timer, big asymmetric
// summits toward the sides, more peaks out to ultrawide edges (mirrored beyond |x| = 1.45).
// Also returns the dominant peak k and how much the peaks dominate the base (dom).
vec2 alp_env(float x, out vec4 k, out float dom) {
  float x0 = x;
  float ax = abs(x);
  float fold = 1.0;
  if (ax > 1.45) { x = sign(x) * (2.9 - ax); ax = abs(x); fold = -1.0; }
  float s = clamp((ax - 0.12) / 0.83, 0.0, 1.0);
  vec3 e = vec3(0.045 + 0.05 * s * s * (3.0 - 2.0 * s), 0.36 * s * (1.0 - s) * sign(x), 0.0);
  k = vec4(x, 0.0, 1.0, 1.0);
  e = alp_pk(e, k, x, -1.30, 0.205, 0.11, 0.10);
  e = alp_pk(e, k, x, -1.15, 0.150, 0.07, 0.09);
  e = alp_pk(e, k, x, -1.00, 0.190, 0.12, 0.16);
  e = alp_pk(e, k, x, -0.86, 0.140, 0.08, 0.07);
  e = alp_pk(e, k, x, -0.72, 0.170, 0.09, 0.07);
  e = alp_pk(e, k, x, -0.60, 0.235, 0.10, 0.19);
  e = alp_pk(e, k, x, -0.47, 0.150, 0.06, 0.09);
  e = alp_pk(e, k, x, -0.33, 0.120, 0.07, 0.10);
  e = alp_pk(e, k, x, -0.17, 0.105, 0.10, 0.07);
  e = alp_pk(e, k, x, -0.06, 0.070, 0.05, 0.06);
  e = alp_pk(e, k, x,  0.11, 0.125, 0.06, 0.10);
  e = alp_pk(e, k, x,  0.24, 0.085, 0.07, 0.08);
  e = alp_pk(e, k, x,  0.37, 0.160, 0.12, 0.07);
  e = alp_pk(e, k, x,  0.47, 0.120, 0.05, 0.08);
  e = alp_pk(e, k, x,  0.63, 0.228, 0.17, 0.10);
  e = alp_pk(e, k, x,  0.75, 0.170, 0.06, 0.09);
  e = alp_pk(e, k, x,  0.86, 0.150, 0.08, 0.08);
  e = alp_pk(e, k, x,  0.99, 0.200, 0.13, 0.13);
  e = alp_pk(e, k, x,  1.16, 0.160, 0.08, 0.10);
  e = alp_pk(e, k, x,  1.31, 0.195, 0.10, 0.12);
  dom = e.z;
  if (fold < 0.0) k = vec4(sign(x0) * 2.9 - k.x, k.y, k.w, k.z);
  return vec2(e.x, e.y * fold);
}

// Crest detail on top of the envelope: ridged buttresses plus angular crags (value, slope).
vec2 alp_crag(float x) {
  vec2 r = vec2(0.0);
  float xx = x * 4.6 + 2.0;
  float fq = 4.6;
  float amp = 0.055;
  for (int i = 0; i < 4; i++) {
    vec2 n = alp_n1d(xx);
    float s = n.x * 2.0 - 1.0;
    float rr = 1.0 - abs(s);
    r += amp * vec2(rr * rr - 0.3, -4.0 * rr * sign(s) * n.y * fq);
    xx = xx * 2.13 + 31.7;
    fq *= 2.13;
    amp *= 0.42;
  }
  vec2 l = alp_l1d(x * 61.0 + 3.0);
  r += vec2(l.x - 0.5, l.y * 61.0) * 0.010;
  l = alp_l1d(x * 157.0);
  r += vec2(l.x - 0.5, l.y * 157.0) * 0.0034;
  return r;
}

// Layer 1: the far snow massif - lit and shadowed faces around each ridge axis, spurs and couloirs,
// rock ribs and strata bands, wind flutes, snow-crust glints and a thin rim on the crest.
vec3 alp_far(vec2 uv, vec3 col, vec3 aL, vec3 hz, float br, float full) {
  vec2 p = sc_world(uv, 0.12);
  if (p.y > alp_L + 0.30) return col;
  float x = p.x;
  vec4 K;
  float dom;
  vec2 E = alp_env(x, K, dom);
  vec2 C = alp_crag(x);
  float amp = 0.3 + 2.6 * E.x;
  float hC = alp_L + E.x + C.x * amp;
  float cov = sc_below(p.y, hC);
  if (cov <= 0.0) return col;
  float slope = E.y + C.y * amp + C.x * 2.6 * E.y;
  float pix = 1.0 / u_res.y;
  float D = max(hC - p.y, 0.0);
  float Hs = p.y - alp_L;

  // Main faces: which way the massif falls around its leaning, wandering ridge axis; the faces
  // turned toward the key light (aurora glow on the left at night, the sun by day) are lit.
  float lean = (sc_n1(x * 2.2 + 4.0) - 0.5) * 1.8;
  float wob = lean * D + (sc_n1(Hs * 14.0 + x * 2.0) - 0.5) * 0.035 * clamp(D * 5.0, 0.0, 1.0);
  // Slope at the leaning ridge axis, from the dominant peak alone (no second envelope pass).
  float dxw = x + wob - K.x;
  float sww = dxw < 0.0 ? K.z : K.w;
  float sW = mix(E.y, -K.y * exp(-abs(dxw) / sww) * sign(dxw) / sww, dom);
  float lxa = abs(alp_lx);
  float mainF = mix(1.0 - 0.75 * smoothstep(0.15, 1.1, abs(sW)), smoothstep(-0.12, 0.12, -alp_lx * sW), lxa);
  float dir = clamp(sW * 25.0, -1.0, 1.0);

  // Bold planar facets (Firewatch-like): straight-ish wedges radiating from the crest, each spur
  // split into a lit and a shaded plane with its own brightness, crisp anti-aliased edges.
  float u = x + dir * (D * 0.75 + D * D * 1.2) + (sc_n1(Hs * 40.0 + x * 9.0) - 0.5) * 0.006;
  float ph = u * 7.0 + sc_n1(u * 2.7 + 5.0) * 2.5;
  float cell = floor(ph);
  float fr = ph - cell;
  float split = 0.30 + 0.40 * hash11(cell * 7.31 + 2.0);
  float hb = hash11(cell * 3.17 + 9.0);
  float fa = 12.0 * pix;
  float spur = smoothstep(0.0, fa, fr) * (1.0 - smoothstep(split - fa, split + fa, fr));
  float deep = smoothstep(0.003, 0.02, D);
  float light = mainF * mix(0.4 + 0.2 * hb, 1.0 - 0.1 * hb, spur) + (1.0 - mainF) * mix(0.03, 0.16 + 0.14 * hb, spur);
  light *= 0.68 + 0.32 * exp(-D / 0.06);
  // Crest facets right under the ridge line follow the crest's own slope.
  float cr = mix(1.0 - 0.6 * smoothstep(0.2, 1.2, abs(slope)), smoothstep(-0.5, 0.5, -alp_lx * slope), lxa);
  light = mix(0.08 + 0.85 * cr, light, deep);
  // Wind-carved flutes on the steep upper snow.
  float flute = abs(fract(u * 64.0 + sc_n1(u * 11.0) * 2.0) - 0.5) * 2.0;
  light *= 1.0 - 0.07 * flute * deep * (1.0 - smoothstep(0.03, 0.09, D)) * smoothstep(0.4, 1.2, abs(sW));

  // Exposed rock: buttresses on the steep flank just past each spur crest and scattered outcrops
  // low on the faces, both stretched along the fall line; rocky ground near the valley floor.
  float rn = vnoise(vec2(u * 30.0, Hs * 8.0));
  float ribW = 0.06 + 0.22 * clamp(D * 5.0, 0.0, 1.0);
  float rib = smoothstep(split + fa, split + 3.0 * fa, fr) * (1.0 - smoothstep(split + ribW * 0.5, split + ribW, fr));
  float rock = rib * smoothstep(0.42, 0.62, rn) * smoothstep(0.015, 0.05, D);
  rock = max(rock, smoothstep(0.58, 0.78, rn) * smoothstep(0.05, 0.11, D) * (0.4 + 0.6 * (1.0 - spur)));
  rock = max(rock, 1.0 - smoothstep(0.02, 0.05, Hs + (rn - 0.5) * 0.03));

  // Night: palette snow lit by the aurora.
  float glow = 0.72 + 0.8 * sc_n1(x * 1.4 + u_time * 0.035) * sc_n1(x * 0.6 - u_time * 0.02 + 3.0);
  vec3 litS = (vec3(0.62, 0.67, 0.80) * 0.28 + aL * 0.28 * glow) * br;
  vec3 shdS = mix(u_c1, u_c2, 0.5) * 0.55 + aL * 0.03 * br;
  vec3 c = mix(shdS, litS, light);
  vec3 rockC = u_c0 * 0.28 + mix(u_c1, u_c2, 0.5) * 0.06;
  vec3 rk = rockC * mix(1.0, 1.9, light) + aL * 0.025 * br * light;
  // Day: white snow with sky-blue shadows; warm-grey rock banded with strata.
  // Day: white snow whose faces turned from the sun are lit by the blue sky alone; warm-grey rock
  // banded with strata.
  // Cloud shadows drifting slowly across the sunlit faces.
  float cs = 1.0 - 0.6 * u_day * smoothstep(0.56, 0.74, vnoise(vec2(x * 2.2 - u_time * 0.012, p.y * 7.0 - x * 1.5)));
  float lamD = smoothstep(0.1, 0.75, light) * cs;
  c = mix(c, alp_lit(vec3(0.90, 0.93, 0.98), 0.72 + 0.3 * light, lamD, p.y), alp_dm);
  float strata = 0.8 + 0.2 * sin(Hs * 260.0 + rn * 6.0 + u * 14.0);
  rk = mix(rk, alp_lit(vec3(0.25, 0.225, 0.21) * strata, 0.75, lamD, p.y), alp_dm);
  c = mix(c, rk, rock * (0.85 + 0.15 * rn));

  float sv = alp_sunV(p.y);
  // Sparse snow-crust glints on lit snow.
  if (full > 0.5) {
    vec2 sg = vec2(x, p.y) * 240.0;
    vec2 sid = floor(sg);
    float hs = hash21(sid + 3.7);
    vec2 so = fract(sg) - 0.5 - (hash22(sid) - 0.5) * 0.5;
    float gl = smoothstep(0.28, 0.0, length(so)) * step(0.975, hs) * light * (1.0 - rock) * deep;
    gl *= 0.5 + 0.5 * sin(u_time * (0.7 + 1.8 * hs) + hs * 60.0);
    c += mix((aL * 0.5 + vec3(0.45)) * 0.45 * br, alp_K * (0.8 * sv), alp_dm) * gl;
  }

  // Crest rim: aurora light at night; by day sunlit, glowing where the sun sits behind the ridge.
  float back = exp(-abs(x - (u_sun.x - 0.5) * sc_aspect()) * 2.5);
  vec3 rimC = mix((aL * 0.8 + vec3(0.18)) * (0.25 + 0.5 * cr) * br, alp_K * (sv * (0.1 + 0.25 * cr + 0.9 * u_golden * back)), alp_dm);
  c += rimC * exp(-D / (1.4 * pix));
  c = mix(c, hz, 0.1 + 0.1 * alp_dm + 0.6 * exp(-Hs / 0.055));
  return mix(col, c, cov);
}

// Layer 2: nearer, darker forested range (height, slope).
vec2 alp_midH(float x) {
  float s = clamp((abs(x) - 0.1) / 0.85, 0.0, 1.0);
  vec2 h = vec2(alp_L - 0.012 + 0.085 * s * s * (3.0 - 2.0 * s), 0.6 * s * (1.0 - s) * sign(x));
  float xx = x * 2.1 + 11.0;
  float fq = 2.1;
  float a = 0.0375;
  for (int i = 0; i < 4; i++) {
    vec2 n = alp_n1d(xx);
    h += a * vec2(n.x, n.y * fq);
    xx = xx * 2.07 + 17.3;
    fq *= 2.07;
    a *= 0.5;
  }
  return h;
}

vec3 alp_mid(vec2 uv, vec3 col, vec3 aL, vec3 hz, float br) {
  vec2 p = sc_world(uv, 0.35);
  if (p.y > alp_L + 0.17) return col;
  float x = p.x;
  vec2 H = alp_midH(x);
  float hc = H.x + sc_pines(x, 170.0, 0.010, 2.0);
  float cov = sc_below(p.y, hc);
  if (cov <= 0.0) return col;
  float pix = 1.0 / u_res.y;
  float D = max(H.x - p.y, 0.0);
  // Broad slope light plus soft spurs.
  float sl = mix(1.0 - 0.6 * smoothstep(0.1, 0.5, abs(H.y)), smoothstep(-0.25, 0.25, -alp_lx * H.y), abs(alp_lx));
  float dir = clamp(H.y * 6.0, -1.0, 1.0);
  float u = x + dir * D * 0.9;
  float fr = fract(u * 9.0 + sc_n1(u * 2.3 + 1.0) * 2.0);
  float sub = smoothstep(0.0, 0.08, fr) * (1.0 - smoothstep(0.47, 0.55, fr));
  float lit = sl * mix(0.55, 1.0, sub) + (1.0 - sl) * 0.25 * sub;
  // Canopy: staggered rows of tiny conifers, snow showing between them and in the clearings.
  vec2 g = vec2(x * 210.0, (p.y - alp_L) * 125.0);
  float row = floor(g.y);
  g.x += hash11(row * 1.7 + 3.0) * 9.0;
  float ci = floor(g.x);
  float rh = hash11(ci * 3.7 + row * 1.9);
  float rp = hash11(ci * 1.31 + row * 7.7);
  vec2 f = vec2(fract(g.x) - 0.5 - (rp - 0.5) * 0.5, fract(g.y) - rh * 0.22);
  float tw = (0.56 + 0.2 * rh - f.y) * 0.5;
  float cn = vnoise(vec2(u * 14.0, p.y * 40.0));
  float clear = smoothstep(0.5, 0.75, cn);
  // A few narrow avalanche chutes down the fall line, widest under the crest, dying out in the forest.
  float cq = u * 30.0 + (sc_n1(D * 16.0 + x * 3.0) - 0.5) * 0.3;
  float ch = hash11(floor(cq) * 5.3 + 1.0);
  float cw = (0.05 + 0.08 * ch) * (1.0 - smoothstep(0.01, 0.03 + 0.03 * ch, D));
  float chute = step(0.86, ch) * (1.0 - smoothstep(cw - 0.06, cw, abs(fract(cq) - 0.5))) * smoothstep(0.003, 0.008, D);
  // A slender waterfall left of the cabin (the lake mirrors it too): a straight drop from a notch,
  // fanning out a little as it falls; no chute crosses it.
  float wy = p.y - alp_L;
  float wfx = x + 0.515;
  float wfw = 0.0008 + 0.0017 * smoothstep(0.066, 0.0, wy);
  float wf = (1.0 - smoothstep(wfw, wfw + 1.5 * pix, abs(wfx))) * smoothstep(0.0, 0.003, 0.066 - wy) * smoothstep(0.016, 0.024, D);
  chute *= smoothstep(0.012, 0.03, abs(wfx));
  float hasT = step(clear * 0.85 + 0.1, rp);
  float tree = smoothstep(-0.18, 0.18, tw - abs(f.x)) * step(0.0, f.y) * hasT * smoothstep(0.0, 0.004, D) * (1.0 - chute) * (1.0 - wf);
  float side = clamp(0.5 + f.x * alp_lx * 6.0, 0.0, 1.0);
  float crest = 1.0 - smoothstep(0.0, 0.006, D);
  float snowA = max(clear, chute);
  // By day a dusting of snow shows between the trees, a little more in the clearings (kept soft and
  // low-contrast so they read as thinner forest, not blobs); the chutes are the only bright snow.
  float glade = max(0.24 + 0.3 * clear, chute);
  // Night palette.
  vec3 base = u_c0 * 0.26 + mix(u_c1, u_c2, 0.5) * 0.07;
  vec3 snowG = mix(u_c1, u_c2, 0.5) * 0.42 + aL * 0.10 * br * lit;
  vec3 ground = mix(base * 0.9, snowG, (0.35 + 0.65 * snowA) * (0.3 + 0.7 * lit));
  vec3 treeC = base * (0.55 + 0.5 * lit) * (0.8 + 0.4 * side * lit);
  vec3 c = mix(ground, treeC, tree);
  c = mix(c, base * (0.6 + 0.6 * lit), crest);
  // Day: spruce greens (a little varied tree to tree), sunlit crowns warmer, snow in the gaps,
  // clearings and chutes.
  vec3 pine = mix(vec3(0.030, 0.078, 0.050), vec3(0.072, 0.100, 0.036), rh);
  vec3 gD = alp_lit(mix(pine * 0.6, vec3(0.86, 0.90, 0.97), glade), 0.8, lit * (0.3 + 0.7 * glade), p.y);
  vec3 cD = mix(gD, alp_lit(pine, 0.9, (0.2 + 0.8 * side) * lit, p.y), tree);
  cD = mix(cD, alp_lit(pine, 0.8, 0.6 * lit, p.y), crest);
  c = mix(c, cD, alp_dm);
  // Waterfall: pale spray streaks, catching the sun by day, a faint silver thread at night.
  float fall = 0.7 + 0.3 * sin(wy * 700.0 + u_time * 5.0 + sin(x * 3000.0) * 2.0);
  c = mix(c, mix(snowG * 1.2 + aL * 0.06 * br, alp_lit(vec3(0.82, 0.88, 0.93), 1.0, 0.8, p.y), alp_dm) * fall, wf * 0.9);
  // Crest rim: aurora light at night; sunlit by day, glowing gold toward a low sun.
  float gRim = u_golden * exp(-abs(x - (u_sun.x - 0.5) * sc_aspect()) * 1.8);
  c += mix(aL * (0.03 + 0.06 * lit) * br, alp_K * ((0.06 * lit + 0.35 * gRim) * alp_sunV(p.y)), alp_dm) * exp(-max(hc - p.y, 0.0) / (1.5 * pix));
  c = mix(c, hz, 0.28 - 0.14 * alp_dm + (0.35 - 0.08 * alp_dm) * exp(-(p.y - alp_L) / 0.03));
  return mix(col, c, cov);
}

// Shoreline conifers: (height above base, signed x in half-widths of the winning tree, its height).
vec3 alp_pines(float x, float density, float h, float seed) {
  float cell = floor(x * density);
  vec3 best = vec3(0.0, 0.0, h);
  for (int k = -1; k <= 1; k++) {
    float c = cell + float(k);
    float r1 = hash11(c * 1.37 + seed * 91.1);
    float r2 = hash11(c * 7.13 + seed * 17.9);
    float cx = (c + 0.5 + (r1 - 0.5) * 0.7) / density;
    float th = h * mix(0.5, 1.0, r2);
    float dn = (x - cx) / (th * 0.25);
    float u = 1.0 - abs(dn);
    float tiers = floor(th * 150.0) + 3.0;
    float saw = fract(u * tiers + r1);
    float hh = th * (u - 0.5 * saw / tiers * (1.0 - 0.45 * u)) * step(0.0, u);
    if (hh > best.x) best = vec3(hh, dn, th);
  }
  return best;
}

// Log cabin on the far shore: snowy gable roof, two windows (warm when lit), stone chimney with a slow plume.
vec3 alp_cabin(vec2 p, vec3 col, vec3 aL, vec3 hz, float br, float full) {
  float dx = p.x - alp_cabX;
  float y = p.y - alp_L;
  if (abs(dx) > 0.10 || y > 0.15) return col;
  float t = u_time;
  float aa = sc_aa();
  vec3 warm = vec3(1.0, 0.60, 0.28);
  float flick = (0.92 + 0.08 * sin(t * 1.3 + sin(t * 0.7) * 2.0)) * alp_on;
  // Chimney smoke drifting downwind (pale wood smoke by day).
  float sy = y - 0.043;
  if (full > 0.5 && sy > 0.0) {
    float cxs = -0.013 + sy * 0.5 + sin(sy * 45.0 - t * 0.35) * 0.004 * sy / 0.05;
    float sk = (dx - cxs) / (0.0025 + sy * 0.25);
    float dens = exp(-sk * sk) * exp(-sy / 0.05) * smoothstep(0.0, 0.008, sy);
    dens *= 0.5 + 0.5 * vnoise(vec2(dx * 110.0, sy * 60.0 - t * 0.45));
    vec3 smk = mix(hz * 1.6 + aL * 0.04 * br, alp_lit(vec3(0.80, 0.82, 0.86), 0.9, 0.6, p.y), alp_dm);
    col = mix(col, smk, clamp(dens * 0.4, 0.0, 1.0));
  }
  // Warm light spilling into the air and onto the snow bank.
  vec2 wv = vec2(dx - 0.008, y - 0.008);
  col += warm * exp(-length(wv * vec2(0.8, 1.5)) / 0.013) * 0.08 * br * flick;

  float ax = abs(dx);
  // Walls of stacked logs; the side walls' round log ends stick out on alternate courses.
  float lY = y / 0.0034;
  float course = floor(lY);
  float lf = fract(lY);
  float roundEnd = sqrt(max(1.0 - (2.0 * lf - 1.0) * (2.0 * lf - 1.0), 0.0));
  float bw = 0.023 + 0.0024 * roundEnd * mod(course, 2.0);
  float wall = (1.0 - smoothstep(bw - aa, bw + aa, ax)) * step(-0.002, y) * (1.0 - smoothstep(0.019 - aa, 0.019 + aa, y));
  // Gable roof seen end-on: fascia boards under a thick snow cap that overhangs the eaves.
  float yTop = 0.037 - 0.0207 * ax / 0.029;
  float gable = step(ax, 0.023) * (1.0 - smoothstep(yTop - 0.0022 - aa, yTop - 0.0022 + aa, y)) * step(0.0, y);
  float eaveCut = 1.0 - smoothstep(0.0295 - aa, 0.0295 + aa, ax);
  float fascia = eaveCut * smoothstep(yTop - 0.0036 - aa, yTop - 0.0036 + aa, y) * (1.0 - smoothstep(yTop - aa, yTop + aa, y));
  float snowT = 0.0028 + 0.0018 * (1.0 - ax / 0.03) + 0.0006 * sin(dx * 900.0);
  float sEnd = 1.0 - smoothstep(0.0305 - aa, 0.0305 + aa, ax + 0.0015 * smoothstep(yTop, yTop + snowT, y));
  float roofSnow = sEnd * smoothstep(yTop - 0.0004 - aa, yTop - 0.0004 + aa, y) * (1.0 - smoothstep(yTop + snowT - aa, yTop + snowT + aa, y));
  // Stone chimney with a snow cap.
  float chim = (1.0 - smoothstep(0.0028 - aa, 0.0028 + aa, abs(dx + 0.013))) * (1.0 - smoothstep(0.043 - aa, 0.043 + aa, y)) * step(0.02, y);
  float chimSnow = chim * smoothstep(0.0405, 0.0415, y);
  float cov = max(max(wall, gable), max(max(fascia, roofSnow), chim));
  if (cov <= 0.0) return col;

  vec3 wood = mix(mix(u_c0 * 0.12, vec3(0.045, 0.030, 0.024), 0.6), alp_lit(vec3(0.34, 0.20, 0.11), 0.75, 0.5, p.y), alp_dm);
  vec3 c = wood * (0.75 + 0.25 * lf);
  c *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.18, lf));
  c += warm * 0.05 * exp(-length(wv) / 0.01) * br * flick;
  c = mix(c, wood * 0.55, fascia);
  vec3 snowC = mix((vec3(0.62, 0.67, 0.80) * 0.20 + aL * 0.22) * br, alp_lit(vec3(0.9, 0.93, 0.98), 0.85, 0.75, p.y), alp_dm);
  float sLit = smoothstep(yTop, yTop + snowT, y) * 0.35 + 0.65;
  c = mix(c, snowC * sLit, roofSnow);
  vec3 stone = mix(u_c0 * 0.16 + vec3(0.02), alp_lit(vec3(0.30, 0.29, 0.28), 0.7, 0.5, p.y), alp_dm);
  c = mix(c, stone * (0.8 + 0.4 * step(0.5, fract(y * 520.0 + step(0.0, dx + 0.013) * 0.5))), chim * (1.0 - roofSnow));
  c = mix(c, snowC, chimSnow);
  // Windows: a four-pane front window and a small loft window; dark glass catching the sky by day.
  float win = step(abs(dx - 0.009), 0.0048) * step(abs(y - 0.0095), 0.0042);
  float mull = step(abs(dx - 0.009), 0.0005) + step(abs(y - 0.0095), 0.0005);
  float loft = step(abs(dx), 0.0026) * step(abs(y - 0.0245), 0.0024);
  vec3 glass = hz * 0.35 + alp_A * 0.08;
  vec3 wl = mix(glass, warm * (1.15 + 0.35 * smoothstep(0.014, 0.005, y)), flick);
  c = mix(c, wl, (win * (1.0 - clamp(mull, 0.0, 1.0) * 0.8) + loft * 0.85) * (1.0 - roofSnow));
  // Plank door.
  float door = step(abs(dx + 0.010), 0.0042) * step(y, 0.0135) * step(0.0, y);
  c = mix(c, wood * (0.55 + 0.25 * step(0.5, fract(dx * 700.0))), door);
  return mix(col, c, cov);
}

// Layer 3: dense conifers and a snowy bank along the far shore, plus the cabin.
vec3 alp_shore(vec2 uv, vec3 col, vec3 aL, vec3 hz, float br, float full) {
  vec2 p = sc_world(uv, 0.6);
  if (p.y > alp_L + 0.15) return col;
  float x = p.x;
  float pix = 1.0 / u_res.y;
  if (p.y < alp_L + 0.09) {
    float clump = sc_n1(x * 3.1 + 21.0) * 0.65 + sc_n1(x * 7.3 + 4.0) * 0.35;
    float th = 0.022 + 0.045 * smoothstep(0.35, 0.8, clump) + 0.018 * smoothstep(0.15, 0.85, abs(x));
    th *= mix(0.2, 1.0, smoothstep(0.035, 0.085, abs(x - alp_cabX)));
    vec3 tr = alp_pines(x, 105.0, th, 5.0);
    float bank = alp_L + 0.0022 + 0.0014 * sc_n1(x * 60.0) + 0.004 * (1.0 - smoothstep(0.02, 0.07, abs(x - alp_cabX)));
    float h = max(bank, alp_L + 0.002 + tr.x);
    float cov = sc_below(p.y, h);
    if (cov > 0.0) {
      float D = max(h - p.y, 0.0);
      float tip = 1.0 - smoothstep(0.0012, 0.0038, D);
      float lSide = smoothstep(-0.35, 0.6, tr.y * alp_lx);
      float tall = smoothstep(0.012, 0.03, tr.z);
      vec3 c = u_c0 * 0.12 + mix(u_c1, u_c2, 0.5) * 0.03;
      c += (vec3(0.55, 0.6, 0.7) * 0.10 + aL * 0.10) * br * tip * (0.3 + 0.7 * lSide) * tall;
      c += aL * exp(-D / (1.2 * pix)) * 0.05 * br;
      // Day: dark spruce greens, the sun side of each tree catching light.
      vec3 pine = mix(vec3(0.045, 0.10, 0.075), vec3(0.075, 0.115, 0.06), fract(tr.z * 911.0));
      vec3 cD = alp_lit(pine, 0.8, (0.15 + 0.85 * lSide) * (0.45 + 0.55 * tip), p.y);
      c = mix(c, cD, alp_dm);
      // Snow bank at the waterline, warmed near the cabin when its lights are on.
      float bk = sc_below(p.y, bank);
      float bSh = 0.6 + 0.4 * smoothstep(bank - 0.003, bank, p.y);
      vec3 bankC = (vec3(0.6, 0.65, 0.78) * 0.10 + aL * 0.10) * br * bSh;
      bankC = mix(bankC, alp_lit(vec3(0.88, 0.91, 0.97), 0.8, 0.7 * bSh, p.y), alp_dm);
      bankC += vec3(1.0, 0.6, 0.28) * 0.10 * br * alp_on * exp(-abs(x - alp_cabX - 0.008) / 0.02);
      c = mix(c, bankC, bk);
      c = mix(c, hz, 0.10 + 0.1 * alp_dm);
      col = mix(col, c, cov);
    }
  }
  return alp_cabin(p, col, aL, hz, br, full);
}

// All land above the shoreline over the given sky: called once, with the mirrored coordinate for
// lake pixels (full = 0 there, which only skips the tiniest details).
vec3 alp_land(vec2 uv, vec3 sky, vec3 aL, vec3 hz, float br, float full) {
  if (uv.y > alp_L + 0.31) return sky;
  float t = u_time;
  vec3 col = alp_far(uv, sky, aL, hz, br, full);
  float x = (uv.x - 0.5) * sc_aspect();
  // Valley fog drifting between the far peaks and the forested range (thicker around dawn).
  float drift = vnoise(vec2(x * 2.2 - t * 0.02, uv.y * 9.0 + t * 0.01)) * 0.65 + vnoise(vec2(x * 5.3 + t * 0.015, uv.y * 21.0)) * 0.35;
  float vf = exp(-max(uv.y - alp_L - 0.03, 0.0) / (0.03 + 0.02 * alp_mist));
  col = mix(col, hz * 1.2, vf * (0.25 + 0.35 * drift) * (0.7 + 0.35 * alp_mist));
  col = alp_mid(uv, col, aL, hz, br);
  // Low mist hugging the tree line.
  float lm = exp(-abs(uv.y - alp_L - 0.014) / 0.012);
  col = mix(col, hz * 1.1, lm * (0.16 + 0.2 * drift) * (1.0 + 1.6 * alp_mist));
  return alp_shore(uv, col, aL, hz, br, full);
}

// A few hawks soaring in slow circles in the daytime sky, off to the sides of the timer (no loops:
// one bird per grid cell, and its circle stays inside the cell).
vec3 alp_birds(vec2 uv, vec3 col) {
  float vis = clamp(u_day * 1.5 + u_golden * 0.5, 0.0, 1.0) * smoothstep(0.17, 0.25, abs(uv.x - 0.5));
  if (vis <= 0.0 || uv.y < 0.6 || uv.y > 0.9) return col;
  vec2 w = vec2((uv.x - 0.5) * sc_aspect(), uv.y);
  vec2 cs = vec2(0.11, 0.075);
  vec2 id = floor(w / cs);
  float h = hash21(id + 4.3);
  if (h < 0.84) return col;
  float a = u_time * (0.09 + 0.05 * h) * (h > 0.92 ? 1.0 : -1.0) + h * 40.0;
  vec2 f = w - (id + 0.5 + vec2(cos(a), sin(a) * 0.4) * 0.22) * cs;
  float s = 0.0042 + 0.0025 * fract(h * 13.0);
  float flap = sin(u_time * 9.0 + h * 50.0) * smoothstep(0.6, 0.9, sin(u_time * 0.5 + h * 17.0));
  float ax = abs(f.x) / s;
  float yw = s * (ax * (0.85 + 0.5 * flap) - ax * ax * (0.65 + 0.3 * flap));
  float th = (0.25 + 0.75 * (1.0 - ax) * (1.0 - ax)) / u_res.y;
  float b = (1.0 - smoothstep(th, th + 1.1 / u_res.y, abs(f.y - yw))) * (1.0 - smoothstep(0.85, 1.0, ax));
  return mix(col, mix(vec3(0.05, 0.06, 0.09), vec3(0.09, 0.05, 0.07), u_golden), b * vis * 0.85);
}

// Wooden jetty below the cabin with a red canoe moored beside it, drawn on the water with short
// reflections. x: world x relative to the cabin (shore depth), d: depth below the shoreline (uv).
vec3 alp_jetty(vec3 col, float x, float d, float br) {
  float aa = sc_aa();
  float jx = x - 0.050;
  // Deck seen at a grazing angle: widening toward the viewer, planks across it.
  float hw = 0.0030 + d * 0.12;
  float deck = (1.0 - smoothstep(hw - aa, hw + aa, abs(jx))) * (1.0 - smoothstep(0.0112 - aa, 0.0112 + aa, d));
  float plank = 0.8 + 0.2 * step(0.35, fract(d * 1300.0));
  // Posts under the far end, standing in their own reflections.
  float pd = d - 0.0112;
  float post = (1.0 - smoothstep(0.0005, 0.0005 + aa, abs(abs(jx) - hw * 0.72))) * step(0.0, pd) * (1.0 - smoothstep(0.0024, 0.004, pd));
  // Canoe: slim hull with upturned ends, waterline at d = 0.0082; mirrored below it.
  float cu = (x - 0.071) / 0.0135;
  float dy = 0.0082 - d;
  float top = 0.0015 + 0.0017 * cu * cu * cu * cu;
  float hull = step(abs(cu), 1.0) * (1.0 - smoothstep(top - aa, top + aa, abs(dy))) * (1.0 - smoothstep(0.8, 1.0, abs(cu)) * step(0.0, -dy));
  float gun = smoothstep(top - 3.0 * aa, top - aa, dy);
  vec3 warm = vec3(1.0, 0.6, 0.28) * 0.08 * br * alp_on;
  vec3 wood = mix(vec3(0.04, 0.03, 0.028) + warm, alp_lit(vec3(0.40, 0.29, 0.18), 0.85, 0.75, alp_L), alp_dm);
  vec3 red = mix(vec3(0.05, 0.02, 0.02) + warm * 0.5, alp_lit(vec3(0.60, 0.13, 0.06), 0.8, 0.65, alp_L), alp_dm);
  col = mix(col, wood * plank, deck);
  col = mix(col, wood * 0.3, post * 0.85);
  // A lantern on a post at the end of the jetty, lit with the cabin, and its reflection.
  float lpx = jx - 0.0036;
  col = mix(col, wood * 0.3, (1.0 - smoothstep(0.00045, 0.00045 + aa, abs(lpx))) * step(0.0065, d) * step(d, 0.0112));
  float lg = exp(-length(vec2(lpx, d - 0.0065)) / 0.0011);
  float rg = exp(-length(vec2(lpx + sin(d * 2500.0 - u_time * 2.0) * 0.0006, (d - 0.0159) * 0.35)) / 0.0012) * step(0.0112, d);
  col += vec3(1.0, 0.62, 0.30) * (lg * 1.3 + rg * 0.5) * alp_on * br;
  col = mix(col, mix(red * (1.0 + 0.5 * gun), col * 0.6 + red * 0.35, step(dy, 0.0)), hull);
  return col;
}

// A loon at screen-world offset w from its waterline centre (sz = perspective scale, hs = heading
// -1 left .. +1 right): (bird coverage, reflection coverage, light catching its back).
vec3 alp_loon(vec2 w, float sz, float hs) {
  float aa = sc_aa();
  float bl = 0.16 * sz;
  float bh = 0.048 * sz;
  float body = smoothstep(aa, -aa, (length(vec2((w.x + hs * 0.25 * bl) / bl, abs(w.y) / bh)) - 1.0) * bh);
  vec2 hd = w - vec2(hs * 0.74 * bl, 1.6 * bh);
  float head = smoothstep(aa, -aa, length(hd * vec2(0.75, 1.0)) - 0.62 * bh);
  float bill = smoothstep(aa, -aa, abs(hd.y + 0.1 * bh) - 0.12 * bh) * step(0.0, hd.x * hs) * step(hd.x * hs, 1.5 * bh);
  float neck = smoothstep(aa, -aa, abs(w.x - hs * 0.64 * bl) - 0.34 * bh) * step(w.y, 1.6 * bh);
  float up = max(max(body, head), max(neck, bill)) * step(0.0, w.y);
  return vec3(up, body * step(w.y, 0.0), body * smoothstep(0.45, 0.9, w.y / bh));
}

// Foreground rock outcrop rising toward the screen edge (e = distance from the edge) plus a low
// boulder: (height, slope d/de), angular from piecewise-linear noise.
vec2 alp_rockTop(float e, float s) {
  vec2 a = alp_l1d(e * 8.0 + s * 7.0);
  vec2 b = alp_l1d(e * 21.0 + s * 3.0);
  vec2 c = alp_l1d(e * 55.0 + s);
  float r = a.x * 0.6 + b.x * 0.3 + c.x * 0.1;
  float dr = a.y * 4.8 + b.y * 6.3 + c.y * 5.5;
  float ea = exp(-e / 0.16);
  float A = -0.06 + 0.25 * ea;
  float bw = e - 0.25 - 0.03 * s;
  float B = 0.07 - 3.2 * bw * bw;
  vec2 m = A > B ? vec2(A, -1.5625 * ea) : vec2(B, -6.4 * bw);
  return vec2(m.x + (r - 0.5) * 0.055, m.y + dr * 0.055);
}

// Big foreground spruce in the corner frame q (aa = anti-alias width in that frame).
// Returns (coverage, snow on the whorls, edge light, inner shade).
vec4 alp_spruce(vec2 q, float cx, float y0, float y1, float seed, float aa) {
  float hgt = y1 - y0;
  float v = (y1 - q.y) / hgt;
  if (v < -0.02 || v > 1.2) return vec4(0.0);
  float t = u_time;
  float vc = clamp(v, 0.0, 1.0);
  float sway = (sin(t * 0.33 + seed * 4.0) + 0.4 * sin(t * 0.71 + seed)) * 0.004 * (1.0 - vc) * (1.0 - vc);
  float dx = q.x - cx - sway;
  float adx = abs(dx);
  float side = step(0.0, dx);
  float W = hgt * 0.19 * pow(max(v, 0.0), 0.9);
  float an = adx / max(W, 0.0001);
  float tiers = 16.0 + floor(hash11(seed) * 4.0);
  // Whorl phase: branch tips droop outward; rounded needle clumps hang from each whorl's lower edge.
  float lq = adx * 115.0 + seed * 3.1 + side * 0.5;
  float lf = fract(lq) * 2.0 - 1.0;
  float lobe = (1.0 - lf * lf) * (0.4 + 0.6 * hash11(floor(lq) + seed * 7.0));
  float tv = v * tiers + side * 0.45 - an * 0.9 * (0.5 + 0.5 * vc) - lobe * 0.12 * smoothstep(0.2, 0.5, an);
  float tier = floor(tv);
  float fr = tv - tier;
  float rw = hash11(tier * 3.3 + seed * 11.0 + side * 5.0);
  float wsc = W * (0.74 + 0.46 * rw);
  float w = wsc * (0.52 + 0.48 * pow(fr, 0.6));
  float cov = (1.0 - smoothstep(w - aa, w + aa, adx)) * smoothstep(-0.02, 0.0, v);
  float tk = 0.0055 * smoothstep(0.0, 0.12, v);
  cov = max(cov, (1.0 - smoothstep(tk - aa, tk + aa, adx)) * step(0.0, v));
  // Snow hugging the slanted upper edge of every whorl: a lumpy band with a crisp lower edge
  // (some whorls carry more, a few are bare).
  float frE = pow(clamp((adx / wsc - 0.52) / 0.48, 0.0, 1.0), 1.667);
  float tr = hash11(tier * 5.7 + seed * 3.0 + side * 2.0);
  float st = (0.09 + 0.22 * sc_n1(adx * 90.0 + seed * 5.0 + tier * 1.7)) * smoothstep(0.12, 0.4, an) * (1.0 - smoothstep(0.5, 0.9, frE));
  st *= step(0.18, tr) * (0.55 + 0.6 * tr);
  float fe = tiers * aa / hgt;
  float snow = (1.0 - smoothstep(frE + st - fe, frE + st + fe, fr)) * smoothstep(0.04, 0.14, vc) * smoothstep(0.02, 0.06, st);
  float rim = smoothstep(w - 0.006, w, adx) * (1.0 - smoothstep(0.55, 0.9, fr));
  float shade = mix(0.5, 1.0, smoothstep(0.0, 0.8, an)) * mix(1.0, 0.65, smoothstep(0.5, 1.0, fr));
  shade *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.12, fr - frE - st)) * (1.0 - snow);
  return vec4(cov, snow * cov, rim * cov, shade);
}

// Foreground frame scale: full size on desktop, uniformly smaller on narrow screens.
float alp_fgScale() {
  return clamp(0.5 * sc_aspect() / 0.89, 0.55, 1.1);
}

// Layer 5: framing foreground at the far left and right edges (rocks + spruces), drawn in a frame
// anchored to each bottom corner so it never reaches the centre.
vec3 alp_fg(vec2 uv, vec3 col, float br) {
  float halfW = 0.5 * sc_aspect();
  vec2 p = sc_world(uv, 1.0);
  float fs = alp_fgScale();
  vec2 q = vec2(halfW - abs(p.x), p.y) / fs;
  float e = q.x;
  if (e > 0.42) return col;
  float aa = sc_aa() / fs;
  float s = p.x < 0.0 ? 0.0 : 1.0;
  float sg = 1.0 - 2.0 * s;   // screen direction of +q.x
  vec3 aL = alp_aurLight(p.x);
  vec3 dark = u_c0 * 0.07 + vec3(0.004, 0.005, 0.008);
  vec3 snowLit = (vec3(0.60, 0.65, 0.78) * 0.17 + aL * 0.16) * br;

  // Spruces rooted well below the rock line (the inner one only where there is room).
  float c1 = 0.055 + 0.02 * s;
  float c2 = 0.175 - 0.03 * s;
  vec4 tA = alp_spruce(q, c1, alp_rockTop(c1, s).x - 0.05, 0.80 - 0.06 * s, 1.0 + s, aa);
  vec4 tB = alp_spruce(q, c2, alp_rockTop(c2, s).x - 0.05, 0.56 - 0.07 * s, 3.0 + s, aa);
  tB *= step(0.55, halfW);
  bool wA = tA.x >= tB.x;
  vec4 tr = wA ? tA : tB;
  // Which half of the winning tree faces the sun.
  float sideL = smoothstep(-0.012, 0.012, (q.x - (wA ? c1 : c2)) * sg * alp_lx);

  // Rock outcrop: angular facets, cracks, a snow cap with a crisp wavy edge, rim light.
  vec2 R = alp_rockTop(e, s);
  float rc = 1.0 - smoothstep(R.x - aa, R.x + aa, q.y);
  float D = max(R.x - q.y, 0.0);
  float u = e + D * 0.6 + D * D * 2.0;
  float ph = u * 7.0 + alp_l1d(u * 2.5 + s * 9.0).x * 2.5;
  float fr = fract(ph);
  float sp = 0.3 + 0.35 * hash11(floor(ph) + s * 3.0);
  float pa = 7.0 * aa * 1.5;
  float lit = smoothstep(0.0, pa, fr) * (1.0 - smoothstep(sp - pa, sp + pa, fr));
  float topLit = smoothstep(-0.3, 0.3, -alp_lx * R.y * sg);
  lit = mix(lit, topLit, 1.0 - smoothstep(0.004, 0.02, D)) * (1.0 - smoothstep(0.0, 0.14, D));
  float crack = (1.0 - smoothstep(0.0, pa * 1.6, fr)) * smoothstep(0.01, 0.03, D);
  // Joints split every facet into blocks (staggered facet to facet), each a little different.
  float fc = floor(ph);
  float jq = D * 15.0 + hash11(fc * 5.1 + s * 2.0) * 0.8;
  float jf = fract(jq);
  float blk = hash11(floor(jq) * 7.7 + fc * 1.3 + s * 5.0);
  float jaa = 15.0 * aa * 1.5;
  float joint = (1.0 - smoothstep(0.0, jaa, jf)) * smoothstep(0.02, 0.04, D);
  crack = max(crack, joint * 0.8);
  vec3 rock = dark * mix(0.9, 1.9, lit) * (1.0 - 0.5 * crack) + aL * 0.012 * lit * br;
  // Day: speckled granite, lichen patches (sage and rust) and a snow ledge on some block tops.
  float lich = vnoise(q * vec2(420.0, 300.0) + s * 13.0);
  float lp = vnoise(q * vec2(70.0, 48.0) + s * 3.0 + fc);
  vec3 gran = vec3(0.22, 0.212, 0.20) * (0.85 + 0.3 * lich) * (0.82 + 0.3 * blk);
  gran = mix(gran, mix(vec3(0.27, 0.28, 0.20), vec3(0.32, 0.25, 0.16), step(0.5, blk)), smoothstep(0.64, 0.72, lp) * (0.25 + 0.35 * lich));
  gran *= 1.0 - 0.6 * crack;
  rock = mix(rock, alp_lit(gran, 0.6 + 0.25 * lit, 0.3 + 0.7 * lit, p.y), alp_dm);
  float ledge = (1.0 - smoothstep(0.1 + 0.25 * blk - jaa, 0.1 + 0.25 * blk, jf)) * step(0.55, blk) * smoothstep(0.03, 0.05, D) * (1.0 - smoothstep(0.1, 0.16, D));
  float capN = vnoise(vec2(e * 38.0 + s * 7.0, q.y * 11.0));
  float capD = 0.005 + 0.013 * capN;
  float cap = 1.0 - smoothstep(capD - aa, capD + aa, D);
  float capL = 0.62 + 0.38 * smoothstep(capD, 0.0, D);
  cap = max(cap, ledge * (1.0 - joint));
  rock = mix(rock, mix(snowLit * capL, alp_lit(vec3(0.9, 0.93, 0.98), 0.75 * capL, 0.3 + 0.6 * topLit, p.y), alp_dm), cap);
  rock += mix(aL * 0.06 * br, alp_K * (0.1 * topLit * alp_sunV(p.y)), alp_dm) * exp(-D / (2.0 * aa));
  // Dry grass tufts poking through the snow along the rock tops, in clumps.
  float gx = e * 230.0;
  float gh = hash11(floor(gx) * 1.7 + s * 31.0);
  float gcl = smoothstep(0.45, 0.8, sc_n1(e * 11.0 + s * 5.0));
  float by = (q.y - R.x + 0.003) / (0.003 + 0.013 * gh * gh * gcl);
  float bx = fract(gx) - 0.5 - (gh - 0.5) * 0.9 * by * by;
  float bw = 0.3 * (1.0 - by);
  float gaa = 230.0 * aa;
  float grass = step(0.0, by) * (1.0 - smoothstep(bw - gaa, bw + gaa, abs(bx))) * step(0.05, gcl) * step(0.25, gh);
  vec3 grassC = mix(dark * 1.3 + aL * 0.03 * br * by, alp_lit(vec3(0.42, 0.34, 0.17) * (0.75 + 0.5 * gh), 0.7, 0.35 + 0.65 * by, p.y), alp_dm);

  vec3 needles = dark * tr.w + mix(u_c1, u_c2, 0.5) * 0.05 * tr.w * tr.w + aL * 0.035 * br * tr.z;
  vec3 tree = mix(needles, snowLit * (0.55 + 0.45 * tr.w), tr.y);
  // Day: deep spruce green, the sun side brighter; the snow on the whorls sunlit.
  vec3 nD = alp_lit(vec3(0.045, 0.095, 0.060), 0.5 + 0.45 * tr.w, (0.1 + 0.7 * sideL) * tr.w + 0.3 * tr.z * sideL, p.y);
  vec3 sD = alp_lit(vec3(0.9, 0.93, 0.98), 0.55 + 0.35 * tr.w, 0.2 + 0.75 * sideL, p.y);
  tree = mix(tree, mix(nD, sD, tr.y), alp_dm);
  // Backlight: a low sun behind the frame spruces glows through their ragged edges.
  float bk = exp(-length(p - vec2((u_sun.x - 0.5) * sc_aspect(), u_sun.y)) / 0.1) * clamp(u_golden * 1.5, 0.0, 1.0);
  tree += alp_K * bk * (0.08 + 0.9 * tr.z) * alp_dm;
  col = mix(col, rock, rc);
  col = mix(col, grassC, grass);
  float drape = 0.006 + 0.012 * capN;
  col = mix(col, tree, tr.x * (1.0 - rc * smoothstep(drape, drape + 0.004, D)));
  return col;
}

// Everything below the far peaks' top: the land, and the lake mirroring it.
vec3 alp_low(vec2 uv, vec3 sky, float br) {
  float t = u_time;
  float xs = (uv.x - 0.5) * sc_aspect();
  vec3 aL = alp_aurLight(xs);
  vec3 hz = mix(u_c1, u_c2, smoothstep(-0.6, 0.8, xs)) * 0.42 + mix(u_c3, u_c0, 0.5) * 0.12 + aL * 0.05 * br;
  // By day the haze is the real sky just above the horizon, so distant layers melt into it.
  vec3 hs = texture2D(u_skyTex, vec2(uv.x, alp_L + 0.035)).rgb;
  hz = mix(hz, 1.85 * hs * hs, clamp(u_day * 1.6 + u_golden, 0.0, 1.0));
  float pix = 1.0 / u_res.y;

  // Lake pixels sample the land at the mirrored coordinate, wobbled by ripples whose screen-space
  // slope stays below 1 so the reflection bends smoothly instead of breaking into stair steps.
  bool water = uv.y < alp_L;
  float d = max(alp_L - uv.y, 0.0);
  float zd = d + 0.004;
  float Z = 1.0 / zd;
  float X = xs * Z;
  float vis = smoothstep(9.0 * pix, 22.0 * pix, zd * zd);
  float vis2 = smoothstep(24.0 * pix, 50.0 * pix, zd * zd);
  float w1 = vnoise(vec2(X * 0.25, Z * 0.35 - t * 0.05));
  float ph = Z * 9.0 - t * 0.7 + w1 * 5.0;
  float ph2 = Z * 23.0 - t * 1.3 + X * 0.9 + w1 * 3.0;
  // By day, breeze patches (cat's paws) ruffle the water between glassy stretches.
  float wamp = mix(1.0, 0.35 + 1.3 * smoothstep(0.35, 0.75, w1), alp_dm);
  vec2 m = uv;
  vec3 base = sky;
  if (water) {
    float dy = (sin(ph) * 0.055 * vis + sin(ph2) * 0.015 * vis2) * zd * zd * wamp;
    float dxr = sin(ph * 0.5 + X * 0.4 + t * 0.3) * 0.012 * zd * zd * vis * wamp;
    m = vec2(uv.x + dxr, max(2.0 * alp_L - uv.y + dy, alp_L));
    base = skyColor(m);
  }
  vec3 col = alp_land(m, base, aL, hz, br, water ? 0.0 : 1.0);

  if (water) {
    // Water: dimmed reflection (stronger toward the far shore), ripple facet shading, glitter.
    // By day a clearer mirror over deep blue-green water that turns turquoise in the shallows.
    float fres = mix(0.80, 0.45, smoothstep(0.0, alp_L, d));
    vec3 body = mix(vec3(0.02, 0.07, 0.10), vec3(0.02, 0.21, 0.20), smoothstep(0.03, 0.2, d)) * (alp_A + alp_K * 0.3);
    col = mix(u_c0 * 0.06 + hz * 0.06 + col * fres, body + col * mix(0.9, 0.62, smoothstep(0.0, alp_L, d)), alp_dm);
    col *= 1.0 - 0.10 * vis * (0.5 + 0.5 * sin(ph + 0.6));
    float crest = pow(max(sin(ph + 1.9), 0.0), 24.0) * vis;
    float dash = smoothstep(0.58, 0.88, vnoise(vec2(X * 7.0, Z * 2.2 + t * 0.1)));
    col += (col * 1.3 + aL * 0.04 * br) * crest * dash * (0.6 + 0.4 * sin(t * 0.9 + X * 2.0));
    // Sun glitter path under a low sun that is clear of the peaks.
    float gw = 0.025 + d * 0.9;
    float gx = (xs - (u_sun.x - 0.5) * sc_aspect()) / gw;
    float path = exp(-gx * gx) * (0.6 + 0.6 * u_golden) * smoothstep(0.38, 0.5, u_sun.y) * (1.0 - 0.6 * smoothstep(0.45, 0.9, u_sunElev));
    float spk = pow(max(sin(ph2 + w1 * 4.0), 0.0), 10.0) * vis2 * (0.4 + 0.6 * dash);
    col += alp_K * path * (crest * dash * 3.0 + spk * 1.2 + 0.08) * alp_dm;
    // Bright waterline and a soft shimmer along the far shore.
    float sh = 0.55 + 0.45 * vnoise(vec2(xs * 40.0 - t * 0.3, t * 0.2));
    col += mix(mix(aL, vec3(0.8), 0.3) * br, alp_A * 0.5 + alp_K * 0.15, alp_dm) * (exp(-d / (1.3 * pix)) * 0.10 + exp(-d / 0.004) * 0.05 * sh);
    // Warm window light trailing across the water.
    float wx0 = sc_world(uv, 0.6).x - alp_cabX;
    float wx = wx0 - 0.009 + sin(ph) * 0.002 * zd * 4.0;
    float streak = exp(-abs(wx) / (0.0025 + d * 0.02)) * exp(-d / 0.06);
    col += vec3(1.0, 0.62, 0.30) * streak * (0.55 + 0.45 * abs(sin(ph))) * 0.10 * br * alp_on;
    // Rising fish: now and then rings spread over the water (circles in the lake plane, kept about a
    // pixel thick on screen), off to the sides of the timer.
    vec2 fid = floor(vec2(X, Z) * 0.5);
    float fh = hash21(fid + 7.1);
    float fcy = t / (6.0 + 6.0 * fh) + fh * 9.0;
    float fage = fract(fcy);
    vec2 frel = vec2(X, Z) - (fid + 0.35 + 0.3 * hash22(fid + floor(fcy))) * 2.0;
    float fgr = 2.0 * length(vec2(frel.x * Z, frel.y * Z * Z)) + 1e-5;
    float rr = (0.06 + 0.5 * fage);
    float fr2 = dot(frel, frel);
    float rings = 1.0 - smoothstep(0.3 * pix, 1.4 * pix, abs(fr2 - rr * rr) / fgr);
    rings += 0.6 * step(0.3, fage) * (1.0 - smoothstep(0.3 * pix, 1.4 * pix, abs(fr2 - rr * rr * 0.36) / fgr));
    rings *= step(0.75, fh) * (1.0 - fage) * (1.0 - fage) * smoothstep(0.8 * pix, 2.5 * pix, rr / (Z * Z)) * smoothstep(0.1, 0.22, abs(uv.x - 0.5));
    col = mix(col, col * 1.4 + mix(aL * 0.04 * br, alp_A * 0.2, alp_dm), clamp(rings, 0.0, 1.0) * 0.7);
    // A pair of loons paddling a slow loop off the left shore, trailing a V wake.
    float la = t * 0.011 + 1.0;
    vec2 lh = normalize(vec2(-1.3 * sin(la), cos(la)));
    vec2 lp = vec2(-7.3, 14.0) + vec2(1.3 * cos(la), sin(la));
    vec2 lr = vec2(X, Z) - lp;
    float along = -dot(lr, lh);
    vec2 ln = vec2(-lh.y, lh.x);
    float lat = dot(lr, ln);
    vec2 gg = sign(lat) * ln + 0.36 * lh;
    float wake = 1.0 - smoothstep(0.6 * pix, 2.0 * pix, abs(abs(lat) - 0.36 * along) / length(vec2(gg.x * Z, gg.y * Z * Z)));
    col = mix(col, col * 1.6 + hz * 0.2, wake * smoothstep(0.0, 0.15, along) * exp(-max(along, 0.0) / 2.4) * 0.9);
    float hs = clamp(lh.x * 3.0, -1.0, 1.0);
    vec2 lp2 = lp - lh * 0.55 + ln * 0.22;
    // Only the nearer bird is drawn at each pixel (one call site; they never overlap much).
    bool first = abs(xs - lp.x / lp.y) < abs(xs - lp2.x / lp2.y);
    vec2 lq = first ? lp : lp2;
    vec3 L = alp_loon(vec2(xs - lq.x / lq.y, uv.y - alp_L - 0.004 + 1.0 / lq.y), (first ? 1.0 : 0.9) / lq.y, hs);
    col *= 1.0 - 0.55 * L.y;
    col = mix(col, mix(u_c0 * 0.04 + aL * 0.02 * br, alp_lit(vec3(0.03, 0.035, 0.04), 0.8, 0.4, alp_L), alp_dm), L.x);
    col += mix(aL * 0.05 * br, alp_K * 0.14, alp_dm) * L.z;
    // Mist banks drifting low over the far water (thicker around dawn).
    float mn = vnoise(vec2(xs * 3.0 - t * 0.03, d * 30.0 + t * 0.01)) * 0.6 + vnoise(vec2(xs * 7.0 + t * 0.02, d * 70.0)) * 0.4;
    col = mix(col, hz * 1.15, exp(-d / (0.035 + 0.02 * alp_mist)) * (0.3 + 0.7 * smoothstep(0.3, 0.75, mn)) * (0.3 + 0.25 * alp_mist));
    if (d < 0.02 && abs(wx0 - 0.062) < 0.03) col = alp_jetty(col, wx0, d, br);
  }
  return col;
}

vec3 scene_alpine(vec2 uv, vec3 sky) {
  alp_setLight();
  float halfW = 0.5 * sc_aspect();
  float e = (halfW - abs(sc_world(uv, 1.0).x)) / alp_fgScale();
  bool nearEdge = e < 0.42;
  float br = alp_bright();
  vec3 col = sky;
  if (uv.y > alp_L + 0.31) {
    col = alp_birds(uv, sky);
    if (!nearEdge || uv.y > 0.9) return col;
  } else {
    col = alp_low(uv, sky, br);
  }
  // One call site for the (large) foreground frame: D3D inlines every call.
  if (nearEdge) col = alp_fg(uv, col, br);
  return col;
}
`,
};
