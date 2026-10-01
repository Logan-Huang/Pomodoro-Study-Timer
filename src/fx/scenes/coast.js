// Scene: Moonlit coast (theme: ocean).
// A sea seen from the shore that follows the clock: perspective swells rolling in in sets that
// reflect the living sky (a glittering moon path by night, the sun's glitter path by day, a warm
// sheen once it drops behind the headland), turquoise shallows, whitecaps trailing foam streaks,
// hazy islands with sunlit and shaded flanks, a sloop on the horizon and a small fishing boat at
// anchor (masthead lamp and lit wheelhouse by night), a stratified headland with sea stacks, a
// nearer buttress and thrift in its turf, a striped lighthouse (its lantern and slow sweeping beam
// come on at dusk) and a keeper's cottage with a smoking chimney, gulls and a distant skein of
// birds by day, surf and spray at the cliff foot, faceted lichen-crusted foreground boulders
// washed by foam lace, and drifting sea mist. Lighting blends from palette moonlight to sunlit
// materials through one set of shared factors. Every helper is prefixed "cst_"; entry point
// scene_coast.
export default {
  key: 'coast',
  name: 'Moonlit coast',
  glsl: `
// ------------------------------------------------------------------ scene: coast (cst_*)
const float cst_HOR = 0.30;   // horizon, uv.y
const float cst_F = 1.0;      // focal length in screen heights
const float cst_CAMH = 1.0;   // camera height above the sea (world units)
const float cst_YA = 0.262;   // waterline of the headland
const float cst_YC = 0.045;   // waterline of the foreground boulders
const float cst_SB = 0.0165;  // rock strata band thickness (unscaled)
const float cst_ZB = 22.0;    // distance of the fishing boat (camera heights)

// Time-of-day light, set once at the top of scene_coast and shared by every layer.
vec3 cst_L;     // key light direction, camera space (x right, y up, z into the scene)
vec3 cst_sun;   // direct sunlight (0 once the sun is down)
vec3 cst_amb;   // daylight sky fill: blue by day, rose / lavender at sunset / sunrise
float cst_dk;   // 0 palette-lit night .. 1 naturally lit materials

// A naturally lit material: albedo under the sky fill plus sunlight at Lambert factor lam.
vec3 cst_lit(vec3 alb, float lam) { return alb * (cst_amb + cst_sun * lam); }
float cst_lam(vec3 n) { return max(dot(n, cst_L), 0.0); }

// 0 on phones .. 1 on desktop.
float cst_k() { return smoothstep(0.55, 1.5, sc_aspect()); }
float cst_hs() { return mix(0.80, 1.0, cst_k()); }

// Screen-anchored placements (world x) so phones still frame moon and lighthouse.
vec2 cst_moonPos() {
  float k = cst_k();
  return vec2((mix(0.21, 0.18, k) - 0.5) * sc_aspect(), mix(0.80, 0.78, k));
}
float cst_headX() {
  return (mix(0.87, 0.785, smoothstep(0.5, 1.8, sc_aspect())) - 0.5) * sc_aspect();
}

// Anti-aliased inside test for a box-like distance d (< 0 inside) with AA half-width a, and that
// distance for |x| < hx inside the band y0..y1: one smoothstep per shape keeps the compile lean.
float cst_in(float d, float a) { return smoothstep(a, -a, d); }
float cst_rect(float x, float hx, float y, float y0, float y1) { return max(abs(x) - hx, max(y0 - y, y - y1)); }
float cst_band(float v, float a, float b) {
  float aa = sc_aa();
  return smoothstep(a - aa, a + aa, v) * smoothstep(b + aa, b - aa, v);
}
float cst_blob(vec2 q, vec2 c, float r) {
  vec2 d = q - c;
  return exp(-dot(d, d) / (r * r));
}

// One island hump: keeps the tallest so far in r = (height, offset from its crown in half-widths).
void cst_bump(float x, float c, float w, float h, inout vec2 r) {
  float d = (x - c) / w;
  float q = sqrt(max(1.0 - d * d, 0.0));
  float y = h * q * sqrt(q);
  r = y > r.x ? vec2(y, d) : r;
}
// Distant islands sitting on the horizon: (height above the horizon, offset from the crown).
vec2 cst_islands(float x, float mx) {
  float y = x * 16.0 + 1.0;
  float n = 0.65 + 0.8 * (0.5 * sc_n1(y) + 0.25 * sc_n1(y * 2.07 + 17.3) + 0.125 * sc_n1(y * 4.28 + 52.1));
  vec2 r = vec2(0.0);
  cst_bump(x, -0.165, 0.085, 0.019 * n, r);
  cst_bump(x, -0.300, 0.150, 0.008 * n, r);
  cst_bump(x, -0.095, 0.030, 0.011, r);
  cst_bump(x, 0.085, 0.035, 0.008, r);
  cst_bump(x, 0.130, 0.010, 0.013, r);
  cst_bump(x, mx + 0.055, 0.045, 0.010 * (0.8 + 0.4 * sc_n1(x * 30.0)), r);
  return r;
}
// Far coastline receding behind the headland toward the horizon.
float cst_capeH(float u) {
  float r = smoothstep(-0.46, -0.04, u);
  float n = 0.5 * sc_n1(u * 11.0 + 5.0) + 0.25 * sc_n1(u * 22.8 + 22.3) + 0.14 * sc_n1(u * 47.1 + 63.6);
  return r * r * 0.058 + (0.010 * (n - 0.40) + 0.002) * r;
}

// Anisotropic glint lobe: residual slope r against per-axis slope variance sv.
float cst_lobe(vec2 r, vec2 sv) {
  return exp(-0.5 * (r.x * r.x / sv.x + r.y * r.y / sv.y)) / (6.2831853 * sqrt(sv.x * sv.y));
}
// Glint toward the light direction Ld for the view ray rd over waves of mean slope g.
float cst_glint(vec3 Ld, vec3 rd, vec2 g, vec2 sv) {
  vec3 H = normalize(Ld - rd);
  return cst_lobe(-H.xz / max(H.y, 0.05) - g, sv);
}

// A gull in flight about c (half-span sz): two cambered wings, flap -1 (down) .. 1 (up).
// Returns coverage; tip = 1 on the dark wingtips.
float cst_gull(vec2 p, vec2 c, float sz, float fl, float aa, out float tip) {
  vec2 q = (p - c) / sz;
  float a = aa / sz;
  float ax = abs(q.x);
  float y = (0.20 + 0.45 * fl) * ax - (0.28 + 0.14 * fl) * ax * ax;
  float th = 0.10 * (1.0 - 0.75 * ax) + 0.025;
  float wing = smoothstep(th + a, th - a, abs(q.y - y)) * smoothstep(1.0 + a, 1.0 - a, ax);
  float body = smoothstep(1.0 + 6.0 * a, 1.0 - 6.0 * a, length((q - vec2(0.0, -0.03)) / vec2(0.27, 0.09)));
  tip = smoothstep(0.70, 0.84, ax);
  return max(wing, body);
}

// Headland plateau height above the waterline (unscaled), noise-free: exact under the buildings.
float cst_plat(float u) {
  float gq = (u - 0.150) / 0.045;
  return 0.150 + 0.026 * smoothstep(-0.05, 0.10, u) - 0.020 * exp(-gq * gq) + 0.090 * smoothstep(0.17, 0.60, u);
}
// Top line: plateau + rolling turf (calm around the buildings), rounded over the seaward edge.
float cst_top(float u) {
  float busy = 1.0 - smoothstep(-0.098, -0.088, u) * (1.0 - smoothstep(-0.020, -0.008, u));
  float n = 0.022 * (sc_fbm1(u * 7.0 + 2.3) - 0.5) + 0.0015 * sc_n1(u * 90.0);
  float sh = 1.0 - smoothstep(-0.112, -0.083, u);
  return cst_plat(u) + n * busy - 0.011 * sh * sh;
}
// Grass tufts in clumps along the turf edge (two interleaved blade rows). bs = |slope| for AA.
float cst_blades(float x, out float bs) {
  float clump = 0.15 + 0.85 * smoothstep(0.30, 0.70, sc_n1(x * 70.0 + 3.0));
  float c1 = x / 0.0024;
  float f1 = fract(c1) - 0.5;
  float r1 = hash11(floor(c1) * 3.17 + 0.3);
  float a1 = max(1.0 - abs(f1) * 2.0, 0.0);
  float b1 = a1 * a1 * (0.0012 + 0.0026 * r1);
  float c2 = x / 0.0037 + 0.41;
  float f2 = fract(c2) - 0.5;
  float r2 = hash11(floor(c2) * 5.11 + 9.0);
  float a2 = max(1.0 - abs(f2) * 2.0, 0.0);
  float b2 = a2 * a2 * (0.0008 + 0.0040 * r2 * r2);
  bs = clump * (b1 > b2 ? 4.0 * a1 * (0.0012 + 0.0026 * r1) / 0.0024 : 4.0 * a2 * (0.0008 + 0.0040 * r2 * r2) / 0.0037);
  return max(b1, b2) * clump;
}

// Seaward face of the headland (local x) at height w: an irregular, slightly leaning wall with
// shallow strata steps and a wave-cut notch at the waterline. s = strata coordinate, o = protrusion.
float cst_face(float w, float u, float e, out float s, out float o) {
  s = (w - 0.06 * u) / cst_SB + 0.22 * sc_n1(u * 48.0 + 4.0);
  float bi = floor(s);
  o = mix(hash11(bi * 7.31 - 5.61), hash11(bi * 7.31 + 1.7), smoothstep(0.0, e, fract(s))) - 0.5;
  return -0.117 + 0.045 * w + 0.012 * (sc_n1(w * 11.0 + 1.3) - 0.5) + 0.0032 * o + 0.010 * exp(-max(w, 0.0) / 0.0055);
}
// Sea stack g = (centre, base half-width, top half-width, height), tapering, with a slanted top.
void cst_stack(float u, float w, float o, float bl, vec4 g, float aa, float aaw,
               inout float m, inout float dl, inout float tp, inout float wd) {
  float hw = mix(g.y, g.z, clamp(w / g.w, 0.0, 1.0)) + 0.0012 * o + 0.0012 * sin(w * 150.0 + g.x * 90.0);
  float top = g.w + 0.16 * (u - g.x) + bl;
  float mm = smoothstep(-aa, aa, hw - abs(u - g.x)) * smoothstep(top + aaw, top - aaw, w);
  bool bt = mm > m;
  dl = bt ? u - g.x + hw : dl;
  tp = bt ? top : tp;
  wd = bt ? 2.0 * hw : wd;
  m = max(m, mm);
}
// Headland + sea stacks at (u, w): coverage; dl = distance from the seaward edge, tp = local top,
// wd = rock width (stacks), s/o = strata coordinate and band protrusion.
float cst_head(float u, float w, float topB, float bl, float aa, float aaw, float e,
               out float dl, out float tp, out float wd, out float s, out float o) {
  float fx = cst_face(w, u, e, s, o);
  float m = smoothstep(fx - aa, fx + aa, u) * smoothstep(topB + aaw, topB - aaw, w);
  dl = u - fx;
  tp = topB;
  wd = 1.0;
  cst_stack(u, w, o, bl, vec4(-0.151, 0.0130, 0.0086, 0.066), aa, aaw, m, dl, tp, wd);
  cst_stack(u, w, o, 0.0, vec4(-0.131, 0.0070, 0.0048, 0.030), aa, aaw, m, dl, tp, wd);
  cst_stack(u, w, o, 0.0, vec4(-0.177, 0.0066, 0.0040, 0.016), aa, aaw, m, dl, tp, wd);
  return m;
}
// A nearer buttress overlapping the headland's flank: coverage, distance from its left edge dl
// and its top tp.
float cst_front(float u, float w, float o, float aa, float aaw, out float dl, out float tp) {
  float x1 = 0.030 + 0.07 * w + 0.010 * (sc_n1(w * 14.0 + 3.0) - 0.5) + 0.0025 * o;
  tp = 0.062 + 0.075 * smoothstep(0.02, 0.38, u) + 0.012 * (sc_n1(u * 30.0 + 1.0) - 0.5) + 0.004 * (sc_n1(u * 120.0) - 0.5);
  dl = u - x1;
  return smoothstep(x1 - aa, x1 + aa, u) * smoothstep(tp + aaw, tp - aaw, w);
}

// Silhouette of the headland, its stacks (x) and the buttress (y) for the mirror image in the
// sea (no strata detail). dl / dlF = distance from their left edges; tpF = buttress top.
vec2 cst_headR(float u, float w, float topW, float tpF, float aa, float aaw, out float dl, out float dlF) {
  float fx = -0.117 + 0.045 * w + 0.012 * (sc_n1(w * 11.0 + 1.3) - 0.5) + 0.010 * exp(-max(w, 0.0) / 0.0055);
  float m = smoothstep(fx - aa, fx + aa, u) * smoothstep(topW + aaw, topW - aaw, w);
  dl = u - fx;
  vec3 c = vec3(-0.151, -0.131, -0.177);
  vec3 hw = mix(vec3(0.0130, 0.0070, 0.0066), vec3(0.0086, 0.0048, 0.0040), clamp(w / vec3(0.066, 0.030, 0.016), 0.0, 1.0));
  vec3 d = hw - abs(u - c);
  vec3 top = vec3(0.066, 0.030, 0.016) + 0.16 * (u - c);
  vec3 ms = smoothstep(-aa, aa, d) * smoothstep(top + aaw, top - aaw, vec3(w));
  m = max(m, max(ms.x, max(ms.y, ms.z)));
  dl = mix(dl, 1.0, max(ms.x, max(ms.y, ms.z)));
  float x1 = 0.030 + 0.07 * w + 0.010 * (sc_n1(w * 14.0 + 3.0) - 0.5);
  dlF = u - x1;
  return vec2(m, smoothstep(x1 - aa, x1 + aa, u) * smoothstep(tpF + aaw, tpF - aaw, w));
}

// One faceted boulder: convex polygon top (min of four lines). g = (centre, half-width, height,
// apex offset in half-widths), k = slopes (left flank, left top, right top, right flank) in
// heights per half-width. ox shifts x back to world space. r = (top, slope, stone height, apex x)
// of the tallest stone so far.
void cst_stone(float x, vec4 g, vec4 k, float ox, inout vec4 r) {
  float xa = g.x + g.w * g.y;
  vec4 sl = vec4(k.x, k.y, -k.z, -k.w) * (g.z / g.y);
  vec4 yy = vec4(sl.x * (x - g.x + g.y), g.z + sl.y * (x - xa), g.z + sl.z * (x - xa), sl.w * (x - g.x - g.y));
  float y = min(min(yy.x, yy.y), min(yy.z, yy.w));
  float s = y == yy.x ? sl.x : (y == yy.y ? sl.y : (y == yy.z ? sl.z : sl.w));
  r = y > r.x ? vec4(y, s, g.z, xa + ox) : r;
}
// Fallen blocks at the foot of the headland (local x, heights unscaled above the waterline).
vec4 cst_foot(float u) {
  vec4 r = vec4(0.0);
  cst_stone(u, vec4(-0.106, 0.020, 0.014, -0.35), vec4(2.6, 0.25, 0.35, 2.8), 0.0, r);
  cst_stone(u, vec4(-0.083, 0.012, 0.007, 0.20), vec4(2.4, 0.15, 0.45, 2.2), 0.0, r);
  cst_stone(u, vec4(-0.141, 0.008, 0.005, 0.00), vec4(2.4, 0.20, 0.40, 2.4), 0.0, r);
  cst_stone(u, vec4(0.024, 0.018, 0.010, 0.10), vec4(2.6, 0.20, 0.40, 2.4), 0.0, r);
  cst_stone(u, vec4(0.050, 0.010, 0.005, -0.10), vec4(2.4, 0.25, 0.45, 2.6), 0.0, r);
  cst_stone(u, vec4(0.200, 0.024, 0.012, 0.00), vec4(2.6, 0.25, 0.35, 2.2), 0.0, r);
  cst_stone(u, vec4(0.300, 0.030, 0.016, 0.20), vec4(2.8, 0.20, 0.40, 2.0), 0.0, r);
  return r;
}
// Foreground boulders in both bottom corners (desktop widths only), heights above cst_YC.
vec4 cst_fore(float x) {
  float xr = x - 0.5 * sc_aspect();
  float xl = x + 0.5 * sc_aspect();
  vec4 r = vec4(0.0);
  cst_stone(xr, vec4(-0.020, 0.085, 0.100, -0.30), vec4(2.0, 0.30, 0.55, 2.6), 0.5 * sc_aspect(), r);
  cst_stone(xr, vec4(-0.128, 0.052, 0.056, 0.15), vec4(2.3, 0.22, 0.75, 2.0), 0.5 * sc_aspect(), r);
  cst_stone(xr, vec4(-0.198, 0.026, 0.022, -0.1), vec4(1.8, 0.25, 0.60, 2.2), 0.5 * sc_aspect(), r);
  cst_stone(xl, vec4(0.040, 0.078, 0.060, 0.25), vec4(2.4, 0.25, 0.45, 1.7), -0.5 * sc_aspect(), r);
  cst_stone(xl, vec4(0.148, 0.036, 0.028, -0.15), vec4(2.0, 0.35, 0.60, 2.4), -0.5 * sc_aspect(), r);
  cst_stone(xl, vec4(0.222, 0.019, 0.012, 0.0), vec4(1.8, 0.30, 0.50, 2.2), -0.5 * sc_aspect(), r);
  return r;
}

// Shared shading for the headland's rock masses. dl = distance from the seaward edge, below =
// depth under the local top (uv units), s = strata coordinate, fw = lit-face width, n = broad
// texture 0..1, pS = one pixel in strata units, turfK = 1 where the top carries turf.
// Light: frontC = flank colour, faceA / faceK = seaward face fill / key, rimC = edge highlights,
// lf = seaward-rim weight (key from the left), tg = crest-rim boost (sun behind the crest).
vec3 cst_rockShade(float dl, float below, float s, float fw, float n, float px, float pS, float aa,
                   float gth, float turfK, vec3 frontC, vec3 faceA, vec3 faceK, vec3 rimC, vec3 grassC,
                   vec2 pl, float lf, float tg) {
  float bi = floor(s);
  float bf = fract(s);
  float tone = hash11(bi * 3.71 + 0.2);
  float lit = smoothstep(fw + aa, fw - aa, dl);
  // by day the strata read as cream, ochre and grey sedimentary layers
  vec3 band = mix(vec3(1.0), mix(vec3(1.13, 0.99, 0.82), vec3(0.84, 0.89, 0.98), tone) * (0.88 + 0.24 * hash11(bi * 1.37 + 4.1)), cst_dk);
  vec3 front = frontC * band * (0.72 + 0.35 * n) * pl.x + rimC * 0.18 * pl.y;
  // fractured facets: slanted cracks split each stratum into planes of differing brightness
  float cw = 0.0085 * (0.7 + 0.6 * tone);
  float cx = (dl + (tone - 0.5) * 1.3 * bf * cst_SB) / cw + tone * 7.0;
  float ci = floor(cx);
  float cf = fract(cx);
  float ft = hash11(ci * 1.93 + bi * 7.31);
  float crack = smoothstep(1.2 * px, 0.3 * px, min(cf, 1.0 - cf) * cw) * step(0.35, hash11(ci * 5.1 + bi * 1.7));
  vec3 face = (faceA + faceK * (0.5 + ft + 0.58 * (cf - 0.5) * (ft - 0.5)) * (0.85 + 0.3 * n)) * band;
  float ledgeK = smoothstep(0.3, 0.8, hash11(bi * 2.3 + 0.7));
  float ledge = smoothstep(1.0 - 2.4 * pS, 1.0 - 0.8 * pS, bf) * ledgeK;
  float under = smoothstep(3.0 * pS, 0.6 * pS, bf) * (0.3 + 0.7 * ledgeK);
  face *= 1.0 - 0.5 * crack * smoothstep(0.0, 0.15, bf) * smoothstep(1.0, 0.85, bf);
  face = mix(face, face * 0.55, under);
  face += rimC * 0.5 * ledge * (0.4 + 0.6 * ft);
  // strata carry on across the shadowed flank (fainter away from the lit edge): per-band tone,
  // lit ledge lips and dark undercuts, so the big face reads as layered rock, not a flat slab
  float fade = (0.45 + 0.55 * exp(-dl / 0.06)) * n;
  front *= 0.9 + 0.2 * tone;
  front += rimC * 0.145 * ledge * fade;
  front *= 1.0 - (0.3 + 0.25 * cst_dk) * under * fade;
  vec3 c = mix(front, face, lit);
  // crisp rim on the seaward edge and along the arete
  c += rimC * lf * exp(-dl / (1.3 * px));
  c += rimC * 0.23 * exp(-abs(dl - fw) / (1.2 * px)) * lit;
  // turf cap (by day also tufts of thrift and grass on some ledges) and a rim along the top
  float turf = smoothstep(gth + aa, gth - aa, below) * turfK;
  turf = max(turf, ledge * step(0.62, hash11(ci * 3.3 + bi * 1.1)) * cst_dk);
  c = mix(c, grassC * (0.8 + 0.4 * n), turf);
  // sea pinks: little cushions of thrift flowering in the turf by day
  c = mix(c, grassC * vec3(3.3, 1.25, 3.4), step(0.92, hash21(floor(vec2(dl, below) / (2.2 * px)))) * turf * cst_dk * 0.85);
  c += rimC * 0.59 * tg * exp(-below / (1.5 * px));
  // short lit ledges scattered over the shadowed flank
  c += rimC * 0.2 * ledge * step(0.72, ft) * (1.0 - lit) * (1.0 - turf);
  return c;
}

// Foam lace on the sea plane: thin meandering rings that widen (and fade to a mean) with the
// pixel footprint fp so they never shimmer.
float cst_lace(vec2 P, float fp, float t, float dens) {
  vec2 q = P * vec2(9.0, 6.5) + vec2(t * 0.10, -t * 0.20);
  float wn = vnoise(q * 0.5 + 3.0);
  q += 0.9 * vec2(wn, sc_n1(q.x * 0.5 + q.y * 0.35 + 9.0)) + 0.3 * sin(q.yx * 0.7);
  // cellular foam: distance to the nearest cell border (2x2 Voronoi search)
  vec2 b = floor(q - 0.5);
  float d1 = 9.0;
  float d2 = 9.0;
  for (int k = 0; k < 4; k++) {
    vec2 c = b + vec2(mod(float(k), 2.0), floor(float(k) * 0.5));
    vec2 o = c + 0.5 + (hash22(c) - 0.5) * 0.9 - q;
    float d = dot(o, o);
    d2 = min(d2, max(d, d1));
    d1 = min(d1, d);
  }
  float edge = sqrt(d2) - sqrt(d1);
  float g = 6.5 * fp;
  // strands thicken toward the rocks (dens), holes stay rounded; widened by the pixel footprint
  float wd = (0.03 + 0.42 * dens) * (0.5 + 1.0 * wn) + 0.6 * g;
  float ln = smoothstep(wd + 0.7 * g + 0.02, wd - 0.7 * g - 0.02, edge);
  float patches = smoothstep(0.25, 0.60, vnoise(q * 0.35 + 7.0) + 0.3 * dens);
  return mix(ln * patches, 0.25 * dens + 0.1, smoothstep(0.25, 0.7, g));
}

vec3 scene_coast(vec2 uv, vec3 sky) {
  float t = u_time;
  float aa = sc_aa();
  float px = 1.0 / u_res.y;
  float hs = cst_hs();
  float asp = sc_aspect();
  vec3 moonCol = mix(vec3(0.86, 0.92, 1.0), u_a1, 0.16);
  vec3 lampCol = vec3(1.0, 0.74, 0.40);
  vec3 dark = mix(u_c0, u_c3, 0.30);

  // ---- time of day: one set of light factors for every layer (blended, never branched)
  float gold = clamp(u_golden, 0.0, 1.0);
  float dk = clamp(u_day + 0.5 * gold, 0.0, 1.0);
  float nv = sc_nightVis();
  float lampOn = sc_lights();
  float sunUp = smoothstep(-0.07, 0.06, u_sunElev);
  vec3 goldC = mix(vec3(1.0, 0.56, 0.30), vec3(1.0, 0.70, 0.62), u_dawn);
  cst_dk = dk;
  cst_sun = mix(vec3(1.0, 0.95, 0.86), goldC, gold * 0.9) * sunUp;
  cst_amb = mix(vec3(0.28, 0.37, 0.52), mix(vec3(0.46, 0.31, 0.42), vec3(0.40, 0.39, 0.58), u_dawn), gold * 0.75) * (0.28 + 0.47 * u_day);
  // key direction: the moon upper-left in front by night; by day the sun's side and height, from
  // a little behind the viewer so faces read sunlit (raking, then backlit, as it sets)
  float sunSd = clamp((u_sun.x - 0.5) * 2.6, -1.0, 1.0);
  cst_L = normalize(mix(vec3(-0.62, 0.48, 0.62), vec3(sunSd, 0.25 + 0.8 * max(u_sunElev, 0.0), mix(-0.55, 0.40, smoothstep(0.15, 0.6, gold))), sunUp));
  vec3 Ldir = cst_L;
  float lft = mix(1.0, clamp(0.5 - 0.8 * sunSd, 0.0, 1.0), sunUp);
  float lamS = cst_lam(vec3(-0.893, 0.050, -0.447)); // the headland's seaward face
  float lamF = cst_lam(vec3(0.148, 0.098, -0.984));  // faces turned toward us
  float lamT = max(cst_L.y, 0.0);                     // tops and turf
  vec3 rimC = mix(moonCol * 0.11, cst_sun * (0.05 + 0.42 * gold), dk);
  vec3 foamD = (cst_amb * 0.9 + cst_sun * 0.75) * 0.95;
  vec3 albR = mix(vec3(0.60, 0.51, 0.40), u_a1 * 0.55, 0.07);   // sandstone
  vec3 albC = mix(vec3(0.33, 0.33, 0.32), u_a1 * 0.40, 0.05);   // granite boulders
  vec3 albS0 = albR * (1.0 - 0.45 * gold);                       // sandstone seen against the light
  vec2 sunW = vec2((u_sun.x - 0.5) * asp, u_sun.y);
  float xH = cst_headX();
  float k = cst_k();
  // the sun disc in view, or slipped behind the headland (then no glitter path, a warm sheen instead)
  float uS = sunW.x - xH;
  float sunHid = sunUp * step(-0.118, uS) * smoothstep(-0.03, 0.01, cst_YA + hs * cst_plat(uS) - u_sun.y);
  // low sun glow scattering through the air around it (afterglow lingers once it has set)
  float glowK = gold * smoothstep(-0.16, 0.0, u_sunElev);
  vec3 sunGC = mix(vec3(1.0, 0.96, 0.88), goldC, gold);

  // ---- moon, high over the open sea: opaque disc (hides the stars) with its familiar maria
  vec2 pm = sc_world(uv, 0.08);
  vec2 mc = cst_moonPos();
  vec2 dm = pm - mc;
  float md = length(dm);
  float mr = 0.034;
  vec3 col = sky + moonCol * (exp(-md / 0.24) * 0.040 + exp(-md / 0.075) * 0.050 + exp(-max(md - mr, 0.0) / 0.010) * 0.09) * nv;
  if (md < mr + 2.0 * px && nv > 0.001) {
    vec2 q = dm / mr;
    float disc = smoothstep(mr + 0.8 * px, mr - 0.8 * px, md);
    float mu = sqrt(max(1.0 - dot(q, q), 0.0));
    float br = vnoise(q * 4.5 + 11.0) * 0.6 + vnoise(q * 11.0 + 3.0) * 0.4;
    float mare = cst_blob(q, vec2(-0.50, 0.08), 0.36) + cst_blob(q, vec2(-0.22, 0.42), 0.26)
               + cst_blob(q, vec2(0.18, 0.44), 0.16) + cst_blob(q, vec2(0.34, 0.12), 0.20)
               + cst_blob(q, vec2(0.68, 0.34), 0.09) + cst_blob(q, vec2(0.55, -0.16), 0.13)
               + cst_blob(q, vec2(-0.22, -0.36), 0.19) + cst_blob(q, vec2(0.34, -0.30), 0.09);
    float mm = smoothstep(0.18, 0.95, mare + (br - 0.5) * 0.60);
    float tycho = exp(-length(q - vec2(-0.14, -0.70)) / 0.04);
    vec3 surf = moonCol * (1.38 - 0.26 * mm + 0.10 * (br - 0.5) + 0.35 * tycho) * (0.78 + 0.22 * mu);
    col = mix(col, surf, disc * nv);
  }

  // ---- gulls wheeling off the headland by day, one far out over the open sea, and a loose skein
  //      of distant birds high on the left; silhouettes against the sunset
  if (dk > 0.02 && uv.y > 0.40) {
    vec2 pg = sc_world(uv, 0.3);
    vec3 gullC = mix(cst_lit(vec3(0.88, 0.89, 0.92), 0.45 + 0.45 * lamT) + 0.04, vec3(0.06, 0.05, 0.07), gold * 0.7);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float sz = (0.0135 - 0.0022 * fi) * hs;
      vec2 c = fi < 1.5 ? vec2(xH - 0.20 + 0.085 * fi + 0.02 * sin(fi * 2.3), mix(0.82, 0.60, k) + 0.05 * sin(fi * 2.6 + 0.4))
                        : vec2((mix(0.22, 0.11, k) - 0.5) * asp, mix(0.86, 0.50, k));
      c += vec2(0.030 * sin(t * 0.045 + fi * 1.7), 0.010 * sin(t * 0.08 + fi * 2.9));
      vec2 dq = pg - c;
      if (abs(dq.x) < sz * 1.1 && abs(dq.y) < sz * 0.8) {
        float glide = smoothstep(-0.2, 0.5, sin(t * 0.31 + fi * 1.3));
        float fl = mix(0.35, sin(t * (4.6 + 0.6 * fi) + fi * 2.0), glide);
        float tip;
        float gc = cst_gull(pg, c, sz, fl, aa, tip);
        col = mix(col, gullC * (1.0 - 0.8 * tip * (1.0 - gold)), gc * dk);
      }
    }
    // the skein: tiny flapping ticks, soft and dark against the bright sky
    vec2 sk = pg - vec2((mix(0.36, 0.24, k) - 0.5) * asp + 0.03 * sin(t * 0.045), mix(0.86, 0.74, k) + 0.01 * sin(t * 0.08));
    if (abs(sk.x) < 0.06 && abs(sk.y) < 0.04) {
      vec3 skC = mix(col * 0.55, vec3(0.05, 0.04, 0.06), 0.35 + 0.5 * gold);
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float fb = fi - 1.5;
        vec2 dq = (sk - vec2(0.021 * fb + 0.004 * sin(t * 0.21 + fi * 2.0), -0.011 * abs(fb) + 0.003 * sin(fi * 3.7 + t * 0.17))) / (0.0038 * hs);
        float ax = abs(dq.x);
        float bird = smoothstep(0.30, 0.08, abs(dq.y - (0.35 + 0.35 * sin(t * 5.5 + fi * 2.1)) * ax + 0.2 * ax * ax)) * step(ax, 1.0);
        col = mix(col, skC, bird * dk * 0.8);
      }
    }
  }

  // ---- headland (layer A) coordinates, lighthouse geometry and the lamp
  vec2 pA = sc_world(uv, 0.45);
  float u = pA.x - xH;
  float v = pA.y;
  float uL = -0.072;
  float tb = cst_YA + hs * cst_plat(uL) - 0.002;
  float th = 0.070 * hs;
  float tt = tb + th;
  vec2 lamp = vec2(uL, tt + 0.0095 * hs);
  float zTip = cst_CAMH * cst_F / (cst_HOR - cst_YA);

  // Rotating beam: closest approach between the view ray and the beam axis (3D, camera space).
  float ang = t * 0.31415927 + 1.3;
  vec3 D = normalize(vec3(cos(ang), -0.012, sin(ang)));
  vec3 rdH = normalize(vec3(pA.x, v - cst_HOR, cst_F));
  vec3 Lp = vec3(xH + uL, lamp.y - cst_HOR, cst_F) * (zTip / cst_F);
  float bb = dot(rdH, D);
  float dd = dot(rdH, -Lp);
  float ee = dot(D, -Lp);
  float den = max(1.0 - bb * bb, 1e-4);
  float sR = (bb * ee - dd) / den;
  float sB = (ee - bb * dd) / den;
  float beam = 0.0;
  if (sB > 0.0 && sR > 0.0 && lampOn > 0.001) {
    float dist = length(-Lp + sR * rdH - sB * D);
    float wid = 0.26 + 0.085 * sB;
    beam = exp(-dist * dist / (wid * wid)) * exp(-sB / 22.0) * smoothstep(0.0, 1.5, sB);
  }
  // keep the beam out of the digits band in the middle of the screen
  vec2 rc = vec2((uv.x - 0.5) * asp, uv.y);
  beam *= 1.0 - 0.9 * smoothstep(0.34, 0.16, abs(rc.x)) * smoothstep(0.40, 0.47, rc.y) * smoothstep(0.70, 0.62, rc.y);
  float flash = pow(max(dot(D, normalize(-Lp)), 0.0), 10.0);
  vec3 beamCol = mix(lampCol, vec3(1.0), 0.45) * 0.12 * (0.6 + 0.4 * u_intensity) * lampOn;

  float ld = length(vec2(u - lamp.x, v - lamp.y));
  vec3 lampGlow = lampCol * (exp(-ld / 0.0035) * 0.9 + exp(-ld / 0.018) * 0.16 + exp(-ld / 0.08) * 0.05) * (0.85 + 0.9 * flash) * lampOn;

  if (uv.y > lamp.y + 0.05) return col + beamCol * beam + lampGlow;

  // the soft sky without stars, for tinting terrain, foam and mist (stars must not show through)
  vec3 skyT = texture2D(u_skyTex, clamp(uv, 0.0, 1.0)).rgb;
  vec3 sky0 = 2.0 * skyT * skyT;
  vec3 foamCol = mix(moonCol * 0.46 + sky0 * 0.2, foamD, dk);

  // ---- distant islands (depth 0.15) and the far cape (depth 0.3), above the horizon
  vec2 ps = sc_world(uv, 0.15);
  float s = ps.y - cst_HOR;
  float foreFade = smoothstep(1.05, 1.45, asp);
  float boatX = xH - 0.255;
  float bob = 0.85 + 0.15 * sin(t * 0.9);
  vec3 landD = vec3(0.27, 0.33, 0.22) * (cst_amb + cst_sun * 0.5);
  vec3 rimI = mix(moonCol, cst_sun * 1.4, dk);
  vec2 isl = cst_islands(ps.x, mc.x);
  if (s > -2.0 * aa && s < 0.09) {
    float ih = cst_HOR + hs * isl.x;
    float im = sc_below(ps.y, ih);
    // by day: a sunlit flank and a shaded one, pale cliffs at the waterline under turf, and all of
    // it melting into the horizon haze
    float litI = smoothstep(-0.2, 0.2, isl.y * sc_sunSide(uv.x) + 0.05);
    float hfI = (ps.y - cst_HOR) / max(ih - cst_HOR, 1e-4) + 0.25 * (sc_n1(ps.x * 900.0) - 0.5);
    vec3 albI = mix(vec3(0.60, 0.55, 0.47), vec3(0.25, 0.33, 0.18), smoothstep(0.22, 0.34, hfI));
    vec3 dayI = mix(albI * (cst_amb + cst_sun * mix(0.10, 0.85 + 1.3 * gold, litI)), sky0, 0.42 - 0.16 * gold * litI);
    vec3 icol = mix(mix(sky0, dark * 0.35, 0.42), dayI, dk) + rimI * 0.035 * exp(-(ih - ps.y) / (2.0 * px));
    col = mix(col, icol, im);
    vec2 pc = sc_world(uv, 0.3);
    float uc = pc.x - xH;
    if (uc > -0.5) {
      float ch = cst_HOR + hs * cst_capeH(uc);
      float cm = sc_below(pc.y, ch);
      vec3 ccol = mix(mix(sky0, dark * 0.30, 0.62), mix(landD * (0.7 + 0.8 * lamS), sky0, 0.5), dk) + rimI * 0.04 * exp(-(ch - pc.y) / (2.0 * px));
      col = mix(col, ccol, cm);
      // a few cottages on the far shore: lit windows by night, whitewashed specks by day
      float vl = exp(-length(vec2(uc + 0.300, pc.y - cst_HOR - 0.0045 * hs)) / 0.0007)
               + 0.7 * exp(-length(vec2(uc + 0.283, pc.y - cst_HOR - 0.0060 * hs)) / 0.0006)
               + 0.6 * exp(-length(vec2(uc + 0.205, pc.y - cst_HOR - 0.0150 * hs)) / 0.0006);
      col += lampCol * vl * 0.9 * cm * lampOn;
      col = mix(col, cst_lit(vec3(0.92, 0.90, 0.84), 0.7), clamp(vl, 0.0, 1.0) * cm * dk * 0.7);
    }
    // the sloop: sails catch the sun by day; masthead and cabin lights by night
    float bx = ps.x - boatX;
    float by = ps.y - cst_HOR;
    if (dk > 0.01 && abs(bx) < 0.009 && by < 0.0145) {
      bx /= 1.3;
      by /= 1.3;
      float a2 = aa * 0.6;
      float mainS = cst_in(max(max(0.0002 - bx, bx - 0.0036 * (1.0 - (by - 0.0013) / 0.0072)), max(0.0013 - by, by - 0.0085)), a2);
      float jib = cst_in(max(max(-0.0029 * (1.0 - (by - 0.0012) / 0.0064) - bx, bx + 0.0003), max(0.0012 - by, by - 0.0076)), a2);
      float hull = cst_in(max(max(-0.0005 - by, by - 0.0010), abs(bx - 0.0004) + (0.0010 - by) * 1.3 - 0.0042), a2);
      float mast = cst_in(cst_rect(bx, 0.35 * px, by, 0.0008, 0.0089), 0.2 * px);
      vec3 bc = mix(cst_lit(vec3(0.10, 0.14, 0.22), 0.4), cst_lit(vec3(0.96, 0.95, 0.91), 0.55 + 0.35 * sunSd), mainS);
      bc = mix(bc, cst_lit(vec3(0.93, 0.92, 0.88), 0.55 - 0.35 * sunSd), jib);
      bc = mix(bc, vec3(0.05), mast * (1.0 - max(mainS, jib)));
      col = mix(col, mix(bc, sky0, 0.22), max(max(mainS, jib), max(hull, mast)) * dk * foreFade);
      bx *= 1.3;
      by *= 1.3;
    }
    float bd1 = length(vec2(bx, by - 0.0114));
    float bd2 = length(vec2(bx - 0.0039, by - 0.0018));
    col += lampCol * foreFade * bob * lampOn * (exp(-bd1 / 0.0010) * 0.9 + exp(-bd1 / 0.010) * 0.05 + exp(-bd2 / 0.0009) * 0.45);
  }

  // ---- headland (A: face, stacks, turf with grass tufts), a nearer buttress (F) and fallen
  //      blocks at the foot (P)
  float w = (v - cst_YA) / hs;
  float aaw = aa / hs;
  float e = aaw / cst_SB;
  float topW = cst_top(u);
  float bsl;
  float sway = 0.30 + 0.15 * sin(t * 0.7 + u * 40.0);
  float bl = cst_blades(u - (w - topW) * sway, bsl) * smoothstep(-0.099, -0.093, u);
  float topB = topW + bl;
  float dlA = 1.0;
  float tpA = topB;
  float wdA = 1.0;
  float sA = 0.0;
  float oA = 0.0;
  float mA = 0.0;
  float dlF = 1.0;
  float tpF = 0.0;
  float mF = 0.0;
  vec4 rP = vec4(0.0);
  float mP = 0.0;
  float inA = step(-0.2, u) * step(w, 0.36);
  if (inA > 0.5) {
    float wv = smoothstep(-aaw, aaw, w);
    mA = cst_head(u, w, topB, bl, aa, aaw * sqrt(1.0 + bsl * bsl), e, dlA, tpA, wdA, sA, oA) * wv;
    mF = cst_front(u, w, oA, aa, aaw, dlF, tpF) * wv;
    rP = cst_foot(u);
    float nlP = sqrt(1.0 + rP.y * rP.y);
    mP = smoothstep(aaw * nlP, -aaw * nlP, w - rP.x) * step(0.0003, rP.x) * wv;
  }

  // ---- foreground boulders (C)
  vec2 pC = sc_world(uv, 1.0);
  vec4 rC = vec4(0.0);
  float mC = 0.0;
  if (foreFade > 0.0 && pC.y < 0.17) {
    rC = cst_fore(pC.x) * vec4(foreFade, foreFade, foreFade, 1.0);
    float nlC = sqrt(1.0 + rC.y * rC.y);
    mC = smoothstep(aa * nlC, -aa * nlC, pC.y - cst_YC - rC.x) * step(0.0005, rC.x) * smoothstep(cst_YC - aa, cst_YC + aa, pC.y);
  }
  float cover = max(max(max(mA, mF), mP), mC);

  // ---- the sea
  float seaM = sc_below(ps.y, cst_HOR) * (1.0 - cover);
  if (seaM > 0.001) {
    float sN = min(s, -0.0006);
    vec3 rd = normalize(vec3(ps.x, sN, cst_F));
    float Z = cst_F * cst_CAMH / -sN;
    vec2 P = vec2(ps.x * Z / cst_F, Z);
    float fpz = Z * Z / (cst_F * cst_CAMH) * px;
    float fpx = Z / cst_F * px;

    // swell sets: groups of bigger swells rolling in toward the shore between calmer lulls
    float sets = 0.80 + 0.42 * smoothstep(-0.4, 0.9, sin(P.y * 0.40 + P.x * 0.05 + t * 0.32 + 2.5 * sc_n1(P.x * 0.05 + 3.0)));
    float m1 = mix(1.0, (0.45 + 1.1 * vnoise(P * vec2(0.10, 0.05) + vec2(t * 0.03, 3.0))) * sets, 1.0 - smoothstep(2.0, 8.0, fpz));
    float m2 = mix(1.0, 0.55 + 0.9 * vnoise(P * vec2(0.35, 0.20) - vec2(t * 0.05, 1.0)), 1.0 - smoothstep(0.5, 2.0, fpz));
    vec2 g = vec2(0.0);
    vec2 sv = vec2(0.0);
    float L = 3.6;
    for (int i = 0; i < 7; i++) {
      if (u_time < -1.0e9) break; // never taken: keeps D3D from unrolling this body
      float fi = float(i);
      float kk = 6.2831853 / L;
      float an = (fi < 2.0 ? 0.2 : 0.55) * sin(fi * 2.39 + 0.7);
      vec2 dir = vec2(sin(an), cos(an));
      // crests bend and break up instead of running as straight lines across the bay
      float ph2 = kk * dot(dir, P) + 0.55 * sqrt(kk) * t + fi * 1.93
                + 1.4 * sin(dot(P, vec2(0.33, 0.05)) * (1.0 + 0.45 * fi) + fi * 2.1);
      float sl = (fi < 2.0 ? 0.10 : 0.075) * (fi < 3.0 ? m1 : m2);
      float fp = (abs(dir.x) * fpx + abs(dir.y) * fpz) / L;
      float res = 1.0 - smoothstep(0.07, 0.28, fp);
      // trochoidal profile: sharp crests, broad troughs
      float q = fi < 2.0 ? 0.25 : 0.42;
      g += dir * (sl * (1.0 - 0.5 * q) * cos(ph2) / (1.0 - q * sin(ph2)) * res);
      sv += dir * dir * (sl * sl * 0.5 * (1.0 - res));
      L *= 0.64;
    }
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 R = reflect(rd, n);
    float cosO = max(dot(n, -rd), 0.03);
    float Fr = 0.02 + 0.98 * pow(1.0 - cosO, 5.0);
    float geo = 1.0 / (4.0 * max(cosO, 0.16));

    // Sky reflection.
    float rz = max(R.z, 0.2);
    vec2 ruv = vec2(0.5 + (R.x / rz * cst_F) / asp, cst_HOR + max(R.y, 0.001) / rz * cst_F);
    // (the soft sky only: stars and the sun disc are lost in the ripples, the glitter carries the sun)
    vec3 refl = texture2D(u_skyTex, clamp(ruv, 0.0, 1.0)).rgb;
    refl = 1.7 * refl * refl;
    float pert = clamp(ruv.y - (2.0 * cst_HOR - ps.y), -0.05, 0.05) * 0.2;

    // Islands mirrored right at the horizon.
    if (s > -0.03) {
      float ih2 = hs * isl.x;
      float yr = ruv.y - cst_HOR;
      refl = mix(refl, mix(refl, mix(dark * 0.2, mix(landD, sky0, 0.4) * 0.8, dk), 0.5), smoothstep(ih2 + 0.002, ih2 - 0.002, yr) * step(0.0005, ih2));
    }

    // Water body: palette-dark by night; by day ultramarine offshore, turquoise over the near
    // shallows and where wave faces turn to us (muted in the low golden light).
    float shal = (1.0 - smoothstep(3.0, 12.0, Z)) * (1.0 - 0.9 * gold);
    vec3 deep = mix(mix(u_c0, u_c2, 0.5) * 0.30, mix(vec3(0.012, 0.085, 0.21), vec3(0.03, 0.20, 0.24), shal) * (cst_amb + cst_sun * 0.5), dk);
    vec3 turq = vec3(0.03, 0.26, 0.24) * (cst_amb + cst_sun * 0.6) * dk * (1.0 - 0.85 * gold);
    vec3 body = deep + turq * (0.5 + 0.4 * shal) * smoothstep(0.0, 0.15, g.y);
    vec3 wc = body * (1.0 - Fr) + refl * Fr;

    // Glitter: anisotropic lobes toward the moon and the sun over resolved slopes; unresolved
    // ripples become crisp sparkles.
    vec3 M = normalize(vec3(mc.x, mc.y - cst_HOR, cst_F));
    float unres = clamp((sv.x + sv.y) * 40.0, 0.0, 1.0);
    vec2 sp = uv * u_res / vec2(4.0, 2.0);
    vec2 sid = floor(sp);
    vec2 sf = fract(sp) - 0.5 - (hash22(sid + 3.7) - 0.5) * 0.5;
    float sh1 = hash21(sid);
    float flick = pow(max(sin(t * (1.2 + 2.2 * sh1) + sh1 * 40.0), 0.0), 6.0);
    float spark = flick * exp(-(sf.x * sf.x * 7.0 + sf.y * sf.y * 16.0)) * step(0.45, hash21(sid + 7.1));
    float gw = geo * mix(1.0, 0.30 + 9.0 * spark, unres) * Fr;
    vec2 svG = sv * vec2(0.32, 1.0) + 0.0011;
    // One glitter path toward the key light: the moon by night, the sun by day (a crisp path under a
    // visible sun; once it is behind the headland, a broad warm sheen of its glow). In the brief
    // twilight overlap the path glides from one to the other.
    vec3 S = normalize(vec3(sunW.x, u_sun.y - cst_HOR, cst_F));
    float hid = sunHid / max(sunUp, 1e-3);
    float wS = mix(0.22, 0.10, hid) * sunUp;
    float wM = 0.05 * nv;
    float aS = wS / max(wS + wM, 1e-5);
    vec3 glit = mix(moonCol, sunGC, aS) * (wS + wM) * gw
              * cst_glint(normalize(mix(M, S, aS)), rd, g, mix(svG, mix(svG * 1.4, svG * 5.0 + 0.006, hid), aS));
    float rockHere = 0.0;

    // Mirrored headland: rock, lit faces and the lantern's warm streak, broken by ripples.
    float dyA = cst_YA - v;
    if (inA > 0.5 && v < cst_YA) {
      float wr = (dyA + pert * mix(0.6, 1.3, dk)) / hs;
      float ur = u + g.x * 0.003;
      float dlR;
      float dlR2;
      vec2 mRh = cst_headR(ur, wr, topW, tpF, aa * 2.0, aaw * 2.0, dlR, dlR2);
      float mR = mRh.x;
      float mRF = mRh.y;
      float mRP = smoothstep(aaw * 2.0, -aaw * 2.0, wr - rP.x) * step(0.0003, rP.x);
      rockHere = max(max(mR, mRF), mRP);
      float litR = max(smoothstep(0.020, 0.010, dlR) * mR, smoothstep(0.020, 0.010, dlR2) * mRF);
      // a dark mirror image by night; by day the sunlit cliff seen in the water over the sea body,
      // strong at grazing angles and fading toward us (Fresnel), broken up by the ripples
      vec3 rr = mix(dark * 0.09 + refl * 0.05 + moonCol * 0.030 * litR,
                    body * (1.0 - Fr) + albS0 * (cst_amb + cst_sun * (lamF + lamS * litR)) * (0.55 + 0.35 * hash11(floor(wr / cst_SB) * 3.71 + 0.2)) * Fr, dk);
      wc = mix(wc, rr, rockHere * 0.88);
      // lamp's warm streak
      if (lampOn > 0.001) {
        vec3 Pw = rd * (cst_CAMH / max(-rd.y, 1e-3));
        vec3 Hl = normalize(normalize(Lp - Pw) - rd);
        vec2 needL = -Hl.xz / max(Hl.y, 0.05);
        float lg = cst_lobe(needL - g, sv + 0.0008) * geo;
        wc += lampCol * lg * Fr * 0.010 * (0.8 + 0.8 * flash) * lampOn;
      }
      // surf: broken foam hugging the rock line, then lace drifting off it; turquoise shallows by day
      float surge = 0.5 + 0.5 * sin(t * 0.45 - u * 22.0);
      float reach = (0.0022 + 0.0050 * surge) * hs;
      float fn = vnoise(vec2(u * 95.0 + t * 0.12, dyA * 420.0 - t * 0.5));
      float along = smoothstep(0.2, 0.7, sc_n1(u * 30.0 + t * 0.08));
      float foam = rockHere * along * smoothstep(reach, reach * 0.25, dyA) * smoothstep(0.44, 0.56, fn + 0.55 * (1.0 - dyA / reach));
      float lz = rockHere * exp(-dyA / (0.010 * hs)) * (0.3 + 0.7 * surge) * (0.3 + 0.7 * along);
      wc += turq * rockHere * exp(-dyA / (0.016 * hs)) * 0.9;
      foam = max(foam, (0.25 * lz + 0.1) * lz * 0.6);
      wc = mix(wc, foamCol, clamp(foam, 0.0, 1.0) * 0.6);
    }
    // glitter over the water (a visible sun still glints across the cliff's reflection)
    wc += glit * (1.0 - rockHere * (1.0 - 0.6 * (sunUp - sunHid)));
    // low sun raking across the swell: the slopes turned toward it catch warm light
    vec2 sdir = normalize(vec2(sunW.x - ps.x, 1.0));
    wc += sunGC * glowK * (1.0 - rockHere) * exp(-abs(uv.x - u_sun.x) * 2.2)
        * smoothstep(0.0, 0.12, -dot(g, sdir)) * 0.28;

    // Foreground boulders: dark reflections, foam wash at their feet and lace spreading around them.
    if (foreFade > 0.0 && pC.y < 0.12) {
      float nearC = smoothstep(0.0, 0.012, rC.x);
      float surgeC = 0.5 + 0.5 * sin(t * 0.35 + pC.x * 9.0);
      float xr = pC.x - 0.5 * asp;
      float xl = pC.x + 0.5 * asp;
      float zone = smoothstep(-0.27, -0.17, xr) + 1.0 - smoothstep(0.17, 0.28, xl);
      float dyz = (pC.y - cst_YC) / (0.010 + 0.012 * surgeC);
      float ld = foreFade * zone * exp(-dyz * dyz) * (0.45 + 0.55 * surgeC);
      float edgeF = 0.0;
      if (pC.y < cst_YC) {
        float dy = cst_YC - pC.y;
        float refC = smoothstep(rC.x + 0.004, rC.x - 0.004, dy + pert * 0.5) * step(0.0005, rC.x);
        wc = mix(wc, mix(dark * 0.08 + refl * 0.04, albC * (cst_amb + cst_sun * 0.4) * 0.30 + refl * 0.06, dk), refC * 0.85);
        float brk = sc_n1(pC.x * 70.0 + t * 0.25);
        float reach = (0.0015 + 0.0035 * surgeC) * (0.4 + 1.2 * brk);
        edgeF = nearC * smoothstep(reach + 1.2 * px, reach - 0.4 * px, dy) * smoothstep(0.15, 0.35, brk);
        ld = max(ld, nearC * exp(-dy / (0.012 + 0.010 * surgeC)));
      }
      wc += turq * ld * 0.6;
      float lace = cst_lace(P, fpz, t, ld) * ld;
      wc = mix(wc, foamCol, clamp(edgeF * 0.7 + lace * 0.6, 0.0, 1.0));
    }

    // Whitecaps: short breaking crests scattered over the open water that flare, then fade and
    // leave a thin streak of foam drawn out along the crest. Out to mid-distance they are kept at
    // least a pixel tall (and dimmed to match), so the open sea stays alive without shimmering.
    if (fpz < 0.5) {
      vec2 cq = P * vec2(0.34, 0.55) + vec2(0.0, t * 0.05);
      vec2 cid = floor(cq);
      vec2 ch = hash22(cid + 5.3);
      float life = fract(t * 0.045 + ch.x * 9.0);
      float wy0 = 0.05 + 0.05 * life;
      float wy = max(wy0, 0.9 * fpz);
      vec2 co = fract(cq) - 0.5 - (ch - 0.5) * vec2(0.5, 0.4);
      vec2 cd = co / vec2(0.10 + 0.20 * life, wy);
      float wcap = exp(-dot(cd, cd)) * smoothstep(0.0, 0.06, life) * (1.0 - life) * (1.0 - life);
      wcap *= smoothstep(-0.2, 0.6, sin(P.x * 9.0 + ch.x * 20.0 + t * 0.3) * sin(P.y * 23.0 + ch.y * 9.0) + 0.5 * (1.0 - life));
      float trail = exp(-co.x * co.x / 0.09 - (co.y + 0.04 * life) * (co.y + 0.04 * life) / (wy * wy * 0.5)) * life * (1.0 - life) * 0.9
                  * smoothstep(0.35, 0.65, sc_n1(P.x * 7.0 + ch.x * 9.0));
      wcap = (wcap + trail * mix(0.25, 0.55, dk)) * step(0.52 - 0.12 * dk, ch.y) * wy0 / wy;
      wc = mix(wc, foamCol, clamp(wcap * 1.8, 0.0, 1.0) * mix(0.30, 0.85, dk) * (1.0 - smoothstep(0.25, 0.5, fpz)));
    }

    // Beam over the water (only where it passes in front of the surface).
    float tw = cst_CAMH / max(-rd.y, 1e-3);
    wc += beamCol * beam * smoothstep(tw * 1.05, tw * 0.95, sR);

    // The boat's broken reflection: lights by night, a white flicker of sail by day.
    if (foreFade > 0.0 && s > -0.035) {
      float bx = ps.x - boatX - g.x * (-s) * 0.4;
      float brf = exp(-abs(bx) / 0.0014) * exp(s / 0.011) * smoothstep(0.25, 0.75, vnoise(vec2(ps.x * 300.0, s * 1600.0 + t * 0.7)));
      wc += lampCol * brf * 0.35 * foreFade * bob * lampOn;
      wc = mix(wc, cst_lit(vec3(0.9), 0.55), brf * foreFade * dk * 0.35 * step(-0.012, s));
    }

    // Sea mist hugging the horizon.
    wc = mix(wc, sky0, exp(s / 0.006) * 0.5);
    col = mix(col, wc, seaM);
  }

  // ---- a small fishing boat riding at anchor: white hull with a red strake, a wheelhouse, a mast
  //      and its stay by day; by night a dark shape with a lit wheelhouse and a masthead lamp.
  //      Boat units (~camera heights) about its waterline centre, heaving and pitching.
  float bsz = hs / cst_ZB;
  vec2 qb = (sc_world(uv, 0.2) - vec2((mix(0.40, 0.31, k) - 0.5) * asp, cst_HOR - 1.0 / cst_ZB)) / bsz;
  qb.y -= 0.035 * sin(t * 1.1) + 0.03 * qb.x * sin(t * 1.1 + 1.2);
  if (abs(qb.x) < 1.0 && qb.y > -1.1 && qb.y < 0.0 && seaM > 0.001) {
    // its reflection, broken into streaks by the ripples: the white hull by day, the wheelhouse
    // and masthead lamps by night
    float rq = -qb.y;
    float brk = smoothstep(0.3, 0.7, sc_n1(rq * 20.0 + qb.x * 0.7 - t * 0.8));
    float hr = smoothstep(0.66, 0.56, abs(qb.x + 0.02)) * smoothstep(0.34, 0.20, rq) * brk;
    float lr = (exp(-abs(qb.x + 0.30) / 0.05) * smoothstep(1.1, 0.3, rq) + 0.6 * exp(-abs(qb.x - 0.19) / 0.06) * smoothstep(0.6, 0.3, rq)) * brk;
    col = mix(col, mix(dark * 0.05, cst_lit(vec3(0.80), 0.3 + 0.6 * lamF) * 0.6, dk), hr * 0.45 * seaM);
    col += lampCol * lr * 0.20 * lampOn * seaM;
  }
  if (abs(qb.x) < 1.0 && qb.y > -0.03 && qb.y < 1.2) {
    float ab = px / bsz;
    float tp = 0.20 + 0.12 * smoothstep(-0.2, -0.75, qb.x);
    float hull = cst_in(max(max(-0.66 - 0.45 * qb.y - qb.x, qb.x - 0.62 - 0.05 * qb.y), max(qb.y - tp, -0.01 - qb.y)), ab);
    float strake = cst_in(abs(qb.y - tp + 0.055) - 0.02, ab);
    float cab = cst_in(max(cst_rect(qb.x - 0.24, 0.16, qb.y, tp - 0.01, 0.50), 0.08 + 0.12 * (qb.y - tp) - qb.x), ab);
    float roofB = cst_in(cst_rect(qb.x - 0.245, 0.195, qb.y, 0.49, 0.54), ab);
    float win = cst_in(cst_rect(qb.x - 0.195, 0.055, qb.y, 0.35, 0.44), ab);
    vec2 sa = qb - vec2(-0.30, 1.02);
    vec2 sbv = vec2(-0.42, -0.72);
    float sd = length(sa - sbv * clamp(dot(sa, sbv) / dot(sbv, sbv), 0.0, 1.0));
    float rig = max(smoothstep(1.3 * ab, 0.4 * ab, abs(qb.x + 0.30)) * step(qb.y, 1.05), smoothstep(1.0 * ab, 0.3 * ab, sd) * 0.55) * step(tp, qb.y);
    vec3 white = cst_lit(vec3(0.90, 0.90, 0.88), 0.25 + 0.75 * lamF) * (1.0 - 0.4 * gold);
    vec3 hullC = mix(dark * 0.12 + moonCol * 0.03, white * (0.82 + 0.18 * smoothstep(0.0, 0.14, qb.y)), dk);
    hullC = mix(hullC, mix(dark * 0.09, cst_lit(vec3(0.62, 0.13, 0.10), 0.25 + 0.75 * lamF), dk), strake);
    vec3 cabC = mix(dark * 0.14 + moonCol * 0.035, white * 0.92, dk);
    cabC = mix(cabC, mix(vec3(0.04, 0.05, 0.07) + sky0 * 0.2, lampCol * 1.1, lampOn), win);
    float mB = 1.0 - mC;
    col = mix(col, mix(dark * 0.10, vec3(0.07, 0.07, 0.08), dk), rig * mB);
    col = mix(col, cabC, cab * mB);
    col = mix(col, mix(dark * 0.10, cst_lit(vec3(0.24, 0.30, 0.36), 0.3 + 0.7 * lamT), dk), roofB * mB);
    col = mix(col, hullC, hull * mB);
    // lace of foam where the hull meets the water, and the masthead lamp
    col = mix(col, foamCol, smoothstep(0.70, 0.55, abs(qb.x + 0.02)) * exp(-abs(qb.y) / 0.02)
              * smoothstep(0.35, 0.7, sc_n1(qb.x * 14.0 + t * 0.6)) * mix(0.25, 0.6, dk) * mB);
    float dlb = length(qb - vec2(-0.30, 1.08));
    col += lampCol * lampOn * mB * (exp(-dlb / 0.03) + exp(-dlb / 0.3) * 0.05);
  }

  // ---- headland rock (A) and the nearer buttress (F)
  float ucx = -0.034;
  float cb = cst_YA + hs * cst_plat(ucx) - 0.0015;
  vec2 winP = vec2(ucx - 0.0052 * hs, cb + 0.0055 * hs);
  vec3 grassC = mix(dark * 0.42 + vec3(0.010, 0.021, 0.017), cst_lit(vec3(0.20, 0.32, 0.10), 0.25 + 0.75 * lamT), dk);
  if (max(mA, mF) > 0.001) {
    float pS = px / (cst_SB * hs);
    float nT = vnoise(vec2(u * 46.0, w * 5.0 + 3.0));
    vec3 amb = mix(dark, sky0, 0.40) * 0.58;
    // shadowed rock takes the sky's colour in the low golden light (mauve, not muddy brown)
    // (and, backlit by a sun low behind the headland, sees less of the bright sky)
    vec3 albS = mix(albR, vec3(0.50, 0.46, 0.52), 0.6 * gold) * (1.0 - 0.45 * gold);
    vec3 frontC = mix(amb, albS * cst_amb + albR * cst_sun * lamF, dk);
    vec3 faceA = mix(amb * 1.1, albS * cst_amb, dk);
    vec3 faceK = mix(moonCol * 0.06, albR * cst_sun * lamS, dk);
    float gth = (0.0042 + 0.0026 * sc_n1(u * 140.0)) * hs;
    float hf = 0.70 + 0.35 * clamp(w / 0.2, 0.0, 1.0);
    float surgeR = 0.5 + 0.5 * sin(t * 0.45 - u * 22.0);
    float wash = smoothstep((0.002 + 0.006 * surgeR) * hs, 0.0, w * hs)
               * smoothstep(0.35, 0.8, vnoise(vec2(u * 110.0, w * 300.0 - t * 0.6)) + 0.3 * (1.0 - w / 0.008))
               * smoothstep(0.2, 0.6, sc_n1(u * 30.0 + t * 0.08));
    vec3 foamR = mix(moonCol * 0.42 + sky0 * 0.15, foamD, dk);
    // the crest glows where the low sun sits behind it, and the air around the sun veils the rock
    float sunD = length(pA - sunW);
    float tg = 1.0 + 6.0 * glowK * exp(-sunD / 0.20);
    // big slanted rock planes on the shadowed flank, faint lit crests, weathering streaks
    float pq = (u + 0.30 * w) / 0.055 + 0.35 * sc_n1(w * 9.0 + 2.0);
    float pf = fract(pq);
    float ph = hash11(floor(pq) * 5.7 + 0.9);
    float streak = sc_n1(u * 170.0 + w * 3.0);
    vec2 pl = vec2((0.82 + 0.30 * ph) * (1.0 - 0.20 * smoothstep(0.55, 1.0, pf)) * (0.90 + 0.20 * streak),
                   smoothstep(0.0, 0.025, pf) * smoothstep(0.10, 0.025, pf) * step(0.35, ph) * clamp(w / 0.12, 0.0, 1.0) * (1.0 + 2.0 * gold));
    // tide zone: darker, weed-stained rock near the waterline
    vec3 tide = mix(vec3(1.0), vec3(0.62, 0.66, 0.50), dk * (1.0 - smoothstep(0.004, 0.022, w)));
    // One shading pass for whichever rock mass is in front here (the buttress F or the headland A
    // behind it); the other only fills the 1-2 px seam along the buttress edge, with a flat tone.
    float fF = step(0.5, mF);
    float kF = 1.0 - 0.15 * fF;
    float fw = (0.010 - 0.002 * fF) + (0.012 - 0.002 * fF) * sc_n1(w * (20.0 + 4.0 * fF) + 7.0 - 5.0 * fF) + 0.002 * oA;
    fw = min(fw, mix(0.45 * wdA, 1.0, fF));
    vec3 rock = cst_rockShade(mix(dlA, dlF, fF), (mix(tpA, tpF, fF) - w) * hs, sA + 0.5 * fF, fw, nT, px, pS, aa,
                              gth * (1.0 - 0.2 * fF), mix(step(0.02, wdA), 1.0, fF),
                              frontC * hf * kF, faceA * hf * kF, faceK * (1.0 - 0.1 * fF), rimC, grassC * kF, pl, lft, tg);
    rock *= (0.50 + 0.50 * smoothstep(0.0, 0.035 - 0.005 * fF, w)) * tide;
    rock = mix(rock, foamR, wash * 0.5);
    // warm light from the lantern and the cottage window
    float belowA = (tpA - w) * hs;
    rock += lampCol * lampOn * (1.0 - fF) * (0.06 * exp(-length(vec2(u - uL, v - tt)) / 0.022) * exp(-belowA / 0.012)
          + 0.10 * exp(-length((vec2(u, v) - winP) * vec2(0.6, 1.3)) / 0.007) * smoothstep(0.008, 0.003, belowA));
    rock = mix(rock, sky0 * 0.85, exp(-w / 0.022) * (0.22 - 0.04 * fF));
    rock += sunGC * 0.10 * glowK * exp(-sunD / 0.22);
    vec3 other = frontC * hf * (0.72 + 0.35 * nT) * pl.x * (0.85 + 0.15 * fF) * tide;
    col = mix(mix(col, mix(rock, other, fF), mA), mix(other, rock, fF), mF);
  }

  // ---- keeper's cottage: gabled roof, chimney, two windows (warm at night), door
  float cw = 0.0125 * hs;
  float wallH = 0.0105 * hs;
  if (abs(u - ucx) < 0.02 * hs && v > cb - 0.003 && v < cb + 0.028 * hs) {
    float cdx = u - ucx;
    float walls = cst_in(cst_rect(cdx, cw, v, cb, cb + wallH), aa);
    float rh = 0.0090 * hs;
    float ry = (v - cb - wallH) / rh;
    float rw = (cw + 0.0016 * hs) * (1.0 - ry);
    float roof = cst_in(cst_rect(cdx, rw, v, cb + wallH - 0.0008 * hs, cb + wallH + rh), aa);
    float chim = cst_in(cst_rect(cdx - 0.0062 * hs, 0.0015 * hs, v, cb + wallH, cb + wallH + 0.0092 * hs), aa);
    float wx1 = abs(u - winP.x);
    float wx2 = abs(cdx - 0.0048 * hs);
    float wy = abs(v - winP.y);
    float wwi = 0.0021 * hs;
    float wwh = 0.0024 * hs;
    float win = cst_in(max(min(wx1, wx2) - wwi, wy - wwh), aa * 0.5);
    float bar = max(smoothstep(0.9 * px, 0.2 * px, min(wx1, wx2)), smoothstep(0.9 * px, 0.2 * px, wy));
    float door = cst_in(cst_rect(cdx + 0.0003 * hs, 0.0016 * hs, v, cb, cb + 0.0072 * hs), aa * 0.5);
    float side = clamp(-cdx / cw, -1.0, 1.0);
    vec3 wallN = moonCol * (0.070 + 0.030 * side) + dark * 0.2 + moonCol * 0.08 * smoothstep(-cw + 2.0 * px, -cw, cdx);
    vec3 wallD = cst_lit(vec3(0.88, 0.86, 0.80), lamF * (1.0 - 0.2 * side * sunSd) + 0.08)
               + cst_sun * 0.12 * smoothstep(-cw + 2.0 * px, -cw, cdx) * lft;
    vec3 wallC = mix(wallN, wallD, dk);
    wallC = mix(wallC, mix(dark * 0.25, cst_lit(vec3(0.30, 0.16, 0.10), lamF), dk), door);
    vec3 winC = mix(mix(vec3(0.05, 0.07, 0.10) + sky0 * 0.12, wallD, bar),
                    lampCol * (1.25 - 0.25 * abs(v - winP.y) / wwh) * (1.0 - 0.75 * bar), lampOn);
    wallC = mix(wallC, winC, win);
    col = mix(col, wallC, walls);
    // roof: slate by night catching the moon on its left slope; red tiles by day, crisp ridge
    float lRoof = step(cdx, 0.0);
    float rimRoof = exp(-(rw - abs(cdx)) / (1.2 * px));
    vec3 roofC = mix(dark * 0.20 + moonCol * (0.025 + 0.050 * lRoof) + moonCol * 0.10 * rimRoof * lRoof,
                     cst_lit(vec3(0.50, 0.21, 0.15), cst_lam(vec3(0.55 - 1.1 * lRoof, 0.78, -0.30))) + cst_sun * 0.06 * rimRoof, dk);
    col = mix(col, roofC, max(roof, chim) * (1.0 - walls));
    col += lampCol * 0.05 * lampOn * exp(-length(vec2(u, v) - winP) / 0.006) * (1.0 - walls) * (1.0 - roof);
  }
  // ---- a thread of chimney smoke leaning away downwind
  float chX = ucx + 0.0062 * hs;
  float chT = cb + wallH + 0.0092 * hs;
  if (u > chX - 0.006 && u < chX + 0.06 && v > chT && v < chT + 0.05) {
    float hgt = v - chT;
    float sx = chX + hgt * hgt * 16.0 + hgt * 0.15 + 0.0015 * sin(hgt * 150.0 - t * 1.2);
    float swd = (0.0011 + 0.0007 * dk) * hs + hgt * 0.24;
    float sm = exp(-(u - sx) * (u - sx) / (swd * swd)) * smoothstep(0.0, 0.003, hgt) * exp(-hgt / 0.020);
    sm *= 0.7 + 0.5 * sin(hgt * 260.0 - t * 1.4 + (u - sx) * 500.0);
    vec3 smC = mix(moonCol * 0.16 + sky0 * 0.45, cst_lit(vec3(0.82, 0.82, 0.84), 0.6) * 0.9 + sky0 * 0.15, dk);
    col = mix(col, smC, clamp(sm, 0.0, 1.0) * (0.42 - 0.16 * dk));
  }

  // ---- lighthouse: tapered striped tower, gallery and railing, lantern, domed cap
  if (abs(u - uL) < 0.012 * hs && v > tb - 0.003 && v < tt + 0.032 * hs) {
    float dx = u - uL;
    float yy = (v - tb) / th;
    float hw = mix(0.0090, 0.0062, clamp(yy, 0.0, 1.0)) * hs;
    float tower = cst_in(cst_rect(dx, hw, v, tb, tt), aa);
    float nx = clamp(dx / hw, -1.0, 1.0);
    float nz = sqrt(1.0 - nx * nx);
    float pyy = px / th;
    float tri = abs(fract(yy * 2.0 + 0.5) - 0.5);
    float stripe = smoothstep(0.25 - 2.0 * pyy, 0.25 + 2.0 * pyy, tri);
    vec3 paint = mix(vec3(0.92, 0.93, 0.96), vec3(0.62, 0.20, 0.18), stripe);
    float dM = max(dot(vec3(nx, 0.0, -nz), Ldir), 0.0);
    vec3 lightT = mix(moonCol * (0.050 + 0.045 * nz + 0.42 * dM * dM), cst_amb * (0.55 + 0.45 * nz) + cst_sun * dM, dk)
                + lampCol * 0.20 * lampOn * exp(-(tt - v) / (0.006 * hs)) * (0.4 + 0.6 * nz);
    vec3 tcol = paint * lightT;
    // door at the foot, two small windows up the tower (one lit on the stair at night)
    float door = cst_in(cst_rect(dx + 0.0008 * hs, 0.0019 * hs, v, tb, tb + 0.0095 * hs), aa * 0.5);
    float win1 = cst_in(cst_rect(dx + 0.0012 * hs, 0.0011 * hs, v, tb + 0.40 * th, tb + 0.40 * th + 0.0036 * hs), aa * 0.5);
    float win2 = cst_in(cst_rect(dx + 0.0012 * hs, 0.0011 * hs, v, tb + 0.66 * th, tb + 0.66 * th + 0.0032 * hs), aa * 0.5);
    vec3 darkT = mix(dark * 0.18, vec3(0.05, 0.06, 0.08), dk);
    tcol = mix(tcol, darkT, max(door, win2));
    tcol = mix(tcol, mix(darkT, lampCol * 0.9, lampOn), win1);
    col = mix(col, tcol, tower);

    float g1 = tt + 0.0022 * hs;
    float r1 = tt + 0.0064 * hs;
    float lw = 0.0054 * hs;
    float l0 = tt + 0.0040 * hs;
    float l1 = tt + 0.0152 * hs;
    float gw = 0.0096 * hs;
    // pedestal and deck
    float ped = cst_in(min(cst_rect(dx, lw, v, g1 - 0.0004 * hs, l0), cst_rect(dx, gw, v, tt, g1)), aa);
    vec3 ironC = mix(dark * 0.18 + moonCol * 0.05 * smoothstep(0.0, -gw, dx), cst_lit(vec3(0.11, 0.12, 0.12), 0.3 + lamF), dk) + lampCol * 0.06 * lampOn;
    col = mix(col, ironC, ped);
    // lantern glass with mullions following the cylinder; the lamp core burns after dusk
    float glass = cst_in(cst_rect(dx, lw, v, l0, l1), aa);
    float xg = clamp(dx / lw, -1.0, 1.0);
    float gA = xg * (1.0 + 0.5708 * xg * xg); // ~asin: mullions crowd toward the cylinder's edges
    float mdist = abs(fract(gA / 0.7854) - 0.5) * 0.7854 * lw * sqrt(1.0 - xg * xg);
    float mull = max(smoothstep(0.9 * px, 0.25 * px, mdist), smoothstep(0.9 * px, 0.25 * px, abs(v - (l0 + l1) * 0.5 - 0.0020 * hs)));
    vec2 cq = vec2(dx / (0.0020 * hs), (v - lamp.y) / (0.0030 * hs));
    float core = exp(-dot(cq, cq));
    vec3 glassN = lampCol * (1.05 + 0.35 * sqrt(max(1.0 - nx * nx, 0.0))) * (1.0 - 0.7 * mull) + vec3(1.0, 0.92, 0.78) * core * (0.9 + 0.8 * flash);
    vec3 glassD = (vec3(0.07, 0.09, 0.11) + sky0 * 0.30 + cst_sun * 0.30 * exp(-abs(nx + 0.5 * sunSd) / 0.2)) * (1.0 - 0.6 * mull) + vec3(0.9, 0.85, 0.7) * core * 0.15;
    col = mix(col, mix(glassD, glassN, lampOn), glass);
    // railing in front: top rail and posts
    float rail = cst_in(abs(dx) - gw, aa) * max(
        smoothstep(1.1 * px, 0.3 * px, abs(v - r1)),
        smoothstep(0.9 * px, 0.2 * px, max(abs(fract(clamp(dx / gw, -1.0, 1.0) * (1.0 + 0.5708 * dx * dx / (gw * gw)) / 0.5236) - 0.5) * 0.5236 * gw, 2.0 * px * (step(r1, v) + step(v, g1)))));
    col = mix(col, ironC * 0.9, rail * 0.9);
    // domed cap, ventilator ball and lightning rod
    float rhh = 0.0072 * hs;
    float rq = clamp((v - l1) / rhh, 0.0, 1.0);
    float rwd = (lw + 0.0013 * hs) * sqrt(max(1.0 - rq * rq, 0.0));
    float cap = cst_in(min(min(cst_rect(dx, rwd, v, l1, l1 + rhh), length(vec2(dx, v - l1 - rhh - 0.0010 * hs)) - 0.0012 * hs),
                           cst_rect(dx, 0.4 * px, v, l1 + rhh, l1 + rhh + 0.0050 * hs)), aa);
    float capK = pow(clamp(-dx * mix(1.0, -sunSd, sunUp) / max(rwd, 1e-4), 0.0, 1.0), 3.0);
    vec3 capC = mix(dark * 0.20 + moonCol * (0.03 + 0.11 * capK), cst_lit(vec3(0.12, 0.13, 0.13), 0.3 + 0.7 * lamT) + cst_sun * 0.10 * capK, dk)
              + lampCol * 0.10 * lampOn * exp(-(v - l1) / (0.0015 * hs));
    col = mix(col, capC, cap);
  }
  col += lampGlow * (1.0 - mC);

  // ---- grass tufts stand in front of the cottage and tower feet
  if (mA > 0.001 && u > -0.09 && u < -0.015) {
    float blm = smoothstep(topB + aaw, topB - aaw, w) * smoothstep(topW - 0.0012 - aaw, topW - 0.0012 + aaw, w);
    vec3 bladeC = mix(dark * 0.5 + vec3(0.014, 0.026, 0.022), grassC * 1.1, dk) + rimC * 0.45 * exp(-(topB - w) * hs / (1.5 * px));
    col = mix(col, bladeC, blm * mA);
  }

  // ---- drifting sea mist between the far and near layers (thicker, lower banks at dawn)
  float dawnM = gold * u_dawn;
  float my = (ps.y - cst_HOR - 0.015 + 0.012 * dawnM) / (0.035 + 0.02 * dawnM);
  float mb = exp(-my * my);
  if (mb > 0.03) {
    vec2 mq = vec2(ps.x * 2.4 + t * 0.012, ps.y * 16.0 - t * 0.006);
    float mf = 0.5 * vnoise(mq) + 0.25 * vnoise(mq * 2.03 + 11.7) + 0.1;
    vec3 mistCol = sky0 * 1.05 + mix(u_a1, moonCol, 0.5) * 0.05;
    col = mix(col, mistCol, mb * smoothstep(0.3, 0.8, mf) * (0.36 * (1.0 - 0.4 * u_day) + 0.34 * dawnM));
  }

  // ---- fallen blocks at the cliff foot: faceted, rim-lit, wet
  if (mP > 0.001) {
    float belowP = (rP.x - w) * hs;
    float dTP = max(dot(normalize(vec3(-rP.y, 1.0, -0.35)), Ldir), 0.0);
    vec3 albP = albC * 1.1;
    vec3 stn = mix(dark * 0.15 + sky0 * 0.05, albP * cst_amb, dk);
    stn += mix(moonCol * 0.07 * dTP * dTP, albP * cst_sun * dTP, dk) * exp(-belowP / (0.7 * rP.z * hs + 0.001))
         + mix(moonCol * 0.14, cst_sun * 0.06, dk) * dTP * exp(-belowP / (1.3 * px));
    stn *= 0.6 + 0.4 * smoothstep(0.0, 0.006, w);
    float surgeP = 0.5 + 0.5 * sin(t * 0.45 - u * 22.0);
    float sprayP = smoothstep((0.002 + 0.005 * surgeP) * hs, 0.0, w * hs)
                 * smoothstep(0.4, 0.8, vnoise(vec2(u * 130.0, w * 320.0 - t * 0.6)));
    stn = mix(stn, mix(moonCol * 0.42 + sky0 * 0.15, foamD, dk), sprayP * 0.45);
    col = mix(col, stn, mP);
  }

  // ---- spray: slow bursts against the big stack and the cliff face
  if (u > -0.2 && u < -0.08 && v > cst_YA - 0.002 && v < cst_YA + 0.07) {
    float spr = 0.0;
    float ph1 = fract(t * 0.071);
    float ph2 = fract(t * 0.071 + 0.47);
    float e1 = sin(3.14159 * ph1);
    float e2 = sin(3.14159 * ph2);
    vec2 d1 = vec2((u + 0.166) / (0.004 + 0.012 * ph1), w / (0.050 * e1 + 0.001));
    vec2 d2 = vec2((u + 0.108) / (0.004 + 0.010 * ph2), w / (0.036 * e2 + 0.001));
    spr += exp(-dot(d1, d1)) * (1.0 - ph1) * e1;
    spr += exp(-dot(d2, d2)) * (1.0 - ph2) * e2;
    float sn = vnoise(vec2(u * 380.0, w * 260.0 - t * 1.5));
    col = mix(col, mix(moonCol * 0.50 + sky0 * 0.2, foamD * 1.05, dk), clamp(spr * (0.35 + 0.9 * sn), 0.0, 1.0) * 0.55);
  }

  // ---- foreground boulders (C): faceted, lit facets and rims, mottled faces, lichen, wet feet
  if (mC > 0.001) {
    float below = cst_YC + rC.x - pC.y;
    vec3 nT = normalize(vec3(-rC.y, 1.0, -0.35));
    float dT = max(dot(nT, Ldir), 0.0);
    float mott = vnoise(pC * vec2(70.0, 52.0) + rC.w * 3.0);
    vec3 base = mix(dark * 0.13 + sky0 * 0.035, albC * cst_amb, dk);
    // facets run down from the silhouette's corners; light fades into the shadowed front
    float fall = exp(-below / (0.45 * rC.z + 0.004));
    vec3 rcol = base * (0.70 + 0.55 * mott) * mix(0.70, 1.0, smoothstep(cst_YC, cst_YC + rC.z, pC.y));
    rcol += mix(moonCol * (0.035 + 0.11 * dT * dT), albC * cst_sun * (0.15 + 0.85 * dT), dk) * fall * (0.8 + 0.4 * mott);
    // a ridge runs down from the apex: the plane facing the key light lit, the other shadowed
    float side = pC.x - rC.w - (cst_YC + rC.z - pC.y) * 0.32;
    float lp = smoothstep(aa, -aa, side);
    lp = mix(1.0 - lp, lp, lft);
    rcol *= mix(0.78, 1.12, lp);
    rcol += mix(moonCol * 0.030, albC * cst_sun * 0.30, dk) * lp * (1.0 - fall) * (0.8 + 0.4 * mott);
    rcol += rimC * 0.27 * exp(-abs(side) / (1.1 * px)) * smoothstep(0.0, 0.012, below);
    rcol += mix(moonCol * 0.22, cst_sun * 0.10, dk) * dT * exp(-below / (1.3 * px));
    // lichen crusts on the dry upper stone by day
    float wet = exp(-(pC.y - cst_YC) / 0.012);
    rcol = mix(rcol, rcol * vec3(1.55, 1.30, 0.62), smoothstep(0.52, 0.66, mott) * smoothstep(0.50, 0.72, vnoise(pC * vec2(300.0, 240.0))) * dk * (1.0 - wet) * 0.7);
    // wet, glossy feet reflecting the sky, then foam spray on the surge
    rcol = mix(rcol, rcol * 0.6 + sky0 * 0.14, wet * 0.6);
    float surgeC = 0.5 + 0.5 * sin(t * 0.35 + pC.x * 9.0);
    float spray = smoothstep(0.004 + 0.014 * surgeC, 0.0, pC.y - cst_YC)
                * smoothstep(0.4, 0.75, vnoise(vec2(pC.x * 90.0, (pC.y - cst_YC) * 140.0 - t * 0.4)));
    rcol = mix(rcol, mix(moonCol * 0.40, foamD, dk), spray * 0.4);
    col = mix(col, rcol, mC);
  }

  col += beamCol * beam * (1.0 - cover) * (1.0 - seaM);
  return col;
}
`,
};
