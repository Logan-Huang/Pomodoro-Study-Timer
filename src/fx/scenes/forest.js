// Scene: Misty forest (theme: forest). Layered conifer ridges receding into drifting valley fog, a
// log cabin with a warm window and a thread of smoke on a near ridge (a deer grazing at the edge of
// its clearing by day), a fire lookout on a far crest, tall textured foreground spruces framing the
// right edge, and ferns, grass and fireweed along the bottom. It follows the time of day: a veiled
// moon and moonlit mist at night; lavender ridges, rose-lit crowns and glowing mist with god-rays
// from a low sun on the left at dawn; crisp sunlit canopies with blue-green shade, drifting cloud
// shadows, a few golden larches, birds and a circling hawk by day; and orange-gold crests over violet
// hollows, warm haze and silhouetted ridges at dusk. Every silhouette is anti-aliased analytically
// (~1 px) at full resolution. The ridges and the two spruces each share one loop body so the D3D
// compile stays small.
// GLSL rules: GLSL ES 1.00, every helper in this file is prefixed "for_", entry point scene_forest(uv, sky).
export default {
  key: 'forest',
  name: 'Misty forest',
  glsl: `
// ------------------------------------------------------------------ Misty forest (for_*)

// Time-of-day lighting shared by every layer, set once at the top of scene_forest.
float for_dw;   // daylight 0..1 (sunlit materials)
float for_gw;   // sunrise / sunset warmth 0..1
float for_hw;   // 0 night .. 1 day or sunrise / sunset: tones follow the real sky instead of the palette
float for_lx;   // key light side: -1 from the left (moon, morning sun) .. +1 from the right (evening sun)
float for_kf;   // front light: 0 with a low sun in frame (backlit silhouettes) .. 1 with the sun high
float for_pv;   // stand patches (screen-space noise, shared by every ridge's canopy)
float for_rows; // canopy rows drawn under each crest (more texture by day)
vec3 for_dkN;   // night tones from the theme palette: nearest foliage, haze, cool far haze
vec3 for_hzN;
vec3 for_hzF;
vec3 for_sh;    // daylight foliage: in shade (sky fill only) and the extra light where it faces the sun
vec3 for_li;
vec3 for_amb;   // ambient sky fill and direct key light (for the cabin's walls)
vec3 for_key;
vec3 for_hzC;   // cool shadowed air for the middle layers at sunrise / sunset
vec3 for_hzD;

// Half-width used to normalise the valley shapes (phones get a gentler rise).
float for_span() { return max(0.5 * sc_aspect(), 0.62); }

// Pick one of four per-ridge parameter sets by index.
vec4 for_pick(vec4 a, vec4 b, vec4 c, vec4 d, float i) { return i < 0.5 ? a : (i < 1.5 ? b : (i < 2.5 ? c : d)); }

float for_bump(float u, float c, float w) { float d = (u - c) / w; return exp(-d * d); }

// Two-octave smooth 1D noise, roughly 0..1.
float for_n2(float x) { return 0.65 * sc_n1(x) + 0.35 * sc_n1(x * 2.37 + 5.3); }

// Coverage below the line h with a 1 px anti-aliased edge.
float for_below(float y, float h, float px) { return clamp(0.5 + (h - y) / px, 0.0, 1.0); }

// The soft sky texture (no stars / sun disc): cheap haze samples.
vec3 for_skyAt(vec2 q) { vec3 v = texture2D(u_skyTex, clamp(q, 0.0, 1.0)).rgb; return 2.0 * v * v; }

// Lit foliage tone at aerial depth a (0 nearest .. 1 farthest). Night keeps the palette look (f picks
// the cooler far haze, nsh scales it); by day and at sunrise / sunset the foliage is lit by the sky
// fill plus the key light times ndl (how much it faces the sun), then fades into the real sky.
vec3 for_lit(float a, float f, float nsh, float ndl) {
  vec3 n = mix(for_dkN, mix(for_hzN, for_hzF, f), a) * nsh;
  vec3 d = mix((for_sh + for_li * max(ndl, 0.0)) * nsh, mix(for_hzC, for_hzD, a * a), a * a * (1.6 - 0.6 * a));
  return mix(n, d, for_hw);
}

// Ridge ground line at world x: base height, a valley envelope rising to the sides, two designed
// masses m = (amplitude, centre, width) in half-screen units and a gentle noise wobble. slope returns
// the gradient of the smooth part (trees stand upright on it, light-facing flanks are brighter).
float for_ground(float x, float base, float env, vec3 m1, vec3 m2, float wob, float seed, out float slope) {
  float span = for_span();
  float u = x / span;
  float au = min(abs(u), 1.25);
  float d1 = (u - m1.y) / m1.z;
  float d2 = (u - m2.y) / m2.z;
  float b1 = m1.x * exp(-d1 * d1);
  float b2 = m2.x * exp(-d2 * d2);
  slope = (env * 1.55 * pow(au, 0.55) * sign(u) * step(abs(u), 1.25) - 2.0 * (b1 * d1 / m1.z + b2 * d2 / m2.z)) / span;
  return base + env * pow(au, 1.55) + b1 + b2 + wob * (for_n2(x * 2.2 + seed * 13.7) - 0.5);
}

// One conifer standing at (cx, gy): height th, half-width w at its lowest skirt, n tiers of branch
// skirts that droop toward the outside. Sides and skirt undersides are anti-aliased analytically and
// the tier detail fades out once a tier is only a few pixels tall (no grain on distant ridges).
// rim returns the thin lit band just inside the edges facing the key light.
float for_tree(vec2 p, float cx, float gy, float th, float w, float n, out float rim) {
  rim = 0.0;
  float dx = p.x - cx;
  float ax = abs(dx);
  float s = (p.y - gy) / th;
  if (s < -0.3 || s > 1.02 || ax > w * 1.02) return 0.0;
  float px = 1.0 / u_res.y;
  float a = 0.55 * smoothstep(1.5, 5.0, th / (n * px));
  float env = w * max(1.0 - s, 0.0);
  float z = (s - 0.12) * n + 0.8 * ax / w;
  float zr = floor(z + 0.5);
  float e = z - zr;
  // Width of the tier above the nearest skirt line and of the tier below it.
  float js = cx * 17.3 + sign(dx) * 3.1;
  float hU = env * (1.0 - a * max(e, 0.0)) * (0.84 + 0.3 * hash11(zr * 7.3 + js));
  float hD = env * (1.0 - a * min(1.0 + e, 1.0)) * (0.84 + 0.3 * hash11(zr * 7.3 - 7.3 + js));
  float g = length(vec2(1.0 + env * a * 0.8 / w, (w + env * a * n) / th)) * px;
  float wz = clamp(0.5 + e * th / (n * px), 0.0, 1.0);
  float cov = mix(clamp(0.5 + (hD - ax) / g, 0.0, 1.0) * step(1.0, zr), clamp(0.5 + (hU - ax) / g, 0.0, 1.0) * step(0.0, zr), wz) * step(s, 1.0);
  float d = (mix(hD, hU, wz) - ax) / g;
  rim = cov * clamp(1.0 - d / 2.2, 0.0, 1.0) * (0.65 + 0.35 * sign(dx) * for_lx);
  return cov;
}

// The tree of stand cell c (see for_stand); cells inside the clearing (cl = centre, half-width) are empty.
float for_cellTree(vec2 p, float c, float gy, float slope, vec4 st, float seed, vec2 cl, out float rim) {
  float r1 = hash11(c * 1.37 + seed * 91.1);
  float r2 = fract(r1 * 31.7 + 0.29);
  float r3 = fract(r1 * 57.3 + 0.61);
  float cx = (c + 0.5 + (r1 - 0.5) * 0.45) / st.x;
  float th = st.y * (0.5 + 0.5 * r2) * (r3 > 0.86 ? 1.3 : (r3 < 0.16 ? 0.6 : 1.0)) * smoothstep(cl.y, cl.y + 0.02, abs(cx - cl.x));
  th *= 0.5 + 0.7 * sc_n1(cx * 3.1 + seed * 3.3);
  float w = min(th * st.z * (0.8 + 0.4 * r3), 0.7 / st.x);
  rim = 0.0;
  if (th < 0.002) return 0.0;
  return for_tree(p, cx, gy + slope * (cx - p.x) - 0.08 * th, th, w, st.w + floor(r2 * 3.0), rim);
}

// A stand of conifers along the ground line gy (slope = its gradient at p): the two trees nearest
// to p, rim-lit only on the outline of their union. st = (trees per unit, tallest, width factor, tiers).
// vr returns a random value for the visible tree (its foliage tint).
float for_stand(vec2 p, float gy, float slope, vec4 st, float seed, vec2 cl, out float rim, out float vr) {
  float xc = p.x * st.x;
  float c0 = floor(xc);
  float c1 = c0 + (fract(xc) > 0.5 ? 1.0 : -1.0);
  float ra;
  float rb;
  float a = for_cellTree(p, c0, gy, slope, st, seed, cl, ra);
  float b = for_cellTree(p, c1, gy, slope, st, seed, cl, rb);
  rim = max(ra * (1.0 - b), rb * (1.0 - a));
  vr = hash11((a >= b ? c0 : c1) * 4.71 + seed * 3.3);
  return max(a, b);
}

// Canopy on a ridge's slope below its crest stand: staggered rows of small conifer crowns that
// follow the ground line, lit on the flank facing the key light and sinking into shade toward their
// bases (so rows meet without seams), dark gaps between them. Loop-free. Returns (shade, lit):
// shade ~ -0.2..0.2 around the body colour, lit = lit crown amount for a rim tint. Fades out where
// the rows get only a few pixels tall (no grain on the farthest ridges) and in the clearing cl.
vec2 for_canopy(vec2 p, float g, vec4 st, float seed, vec2 cl, float px) {
  float rh = st.y * 0.42;
  float d = g - p.y - st.y * 0.12;
  if (d < 0.0 || d > rh * for_rows) return vec2(0.0);
  float rz = d / rh;
  float row = floor(rz);
  float fy = fract(rz);
  float cw = rh * 0.72;
  float xs = p.x / cw + row * 0.5 + seed * 3.7 + hash11(row * 7.13 + seed) * 0.37;
  float cell = floor(xs);
  float h = hash11(cell * 1.71 + row * 12.97 + seed * 5.3);
  float h2 = fract(h * 23.7 + 0.31);
  float dx = (fract(xs) - 0.5 - (h2 - 0.5) * 0.4) * cw;
  // Stands: blotches of denser, fresher growth and sparser, darker patches (open gaps by day).
  float pv = for_pv;
  // apexes drop by up to a third of a row (half by day) so the rows never read as straight lines
  float ay = (fy - mix(0.36, 0.5, for_hw) * h) * rh;
  float hw = ay * (0.3 + 0.12 * h2 + 0.1 * pv) * (1.0 + 0.4 * for_dw);
  // tiered flanks: shallow notches where the branch whorls step out
  hw *= 1.0 - 0.14 * fract(ay / rh * (2.6 + h));
  float crown = clamp(0.5 + (hw - abs(dx)) / (1.1 * px), 0.0, 1.0) * step(0.0, ay) * step(0.16 - 0.1 * for_dw + 0.9 * for_hw * (0.4 - pv), h);
  float side = clamp(0.5 + for_lx * dx / max(2.0 * hw, 1e-4), 0.0, 1.0);
  float base = smoothstep(0.3, 1.0, fy);
  float lit = crown * side * side * (1.0 - base);
  float shade = mix(-0.13 - 0.14 * for_hw, mix((0.2 + 0.1 * for_hw) * side + 0.1 * (h2 - 0.5) * for_dw, -0.13 - 0.06 * for_hw, base), crown)
              + 0.2 * (pv - 0.5) * for_hw;
  // By day the texture is strongest under a raking sun and just below the crest.
  float k = mix(1.0, mix(1.0, 0.55, for_kf) * mix(1.0, 0.25, smoothstep(1.5, 6.0, rz)) * smoothstep(0.012, 0.06, st.y), for_hw);
  // strongest just under the crest, fading over the rows; off where tree tops get tiny
  float vis = smoothstep(4.0 * px, 10.0 * px, rh) * smoothstep(0.0, 0.5 * rh, d) * (1.0 - smoothstep(for_rows - 2.0, for_rows, rz))
            * max(smoothstep(cl.y, cl.y + 0.03, abs(p.x - cl.x)), smoothstep(1.5, 2.5, rz));
  return vec2(shade, lit) * vis * k;
}

// One forested ridge on ground line g: a hazier back stand peeking between the trees of the front
// stand (bk = 1; pass a literal 0 to drop it on the farthest ridge), both rim-lit. cov returns the
// front coverage.
// tn = aerial depth (front, back) and night far-haze mix (front, back); add = extra light (moon glow).
vec3 for_ridge(vec3 col, vec2 p, float g, float slope, vec4 st, float seed, vec2 cl, vec4 tn, vec3 add, vec3 rimC, float bk, out float cov) {
  float px = 1.0 / u_res.y;
  // Flanks facing the key light are brighter.
  float fs = smoothstep(-0.25, 0.35, -slope * for_lx);
  float sh = 0.86 + 0.34 * fs;
  float nd = mix(fs * fs * 0.6, 0.3 + 0.7 * fs, for_kf);
  vec3 back = for_lit(tn.y, tn.w, sh, nd * 0.8) + add * 1.25;
  float rim;
  float vr;
  float hb = 0.3 * st.y;
  float fb = 0.0;
  if (bk > 0.5) {
    fb = for_below(p.y, g + hb, px);
    float cb = max(for_stand(p, g + hb, slope, vec4(st.x * 1.25, st.y * 0.8, st.z, st.w - 1.0), seed + 0.37, cl, rim, vr), fb);
    col = mix(col, back, cb);
    col += rimC * rim * 0.22 * (1.0 - fb);
  }
  float ff = for_below(p.y, g + 0.05 * st.y, px);
  float tr = for_stand(p, g, slope, st, seed, cl, rim, vr);
  cov = max(tr, ff);
  vec2 cn = for_canopy(p, g, st, seed, cl, px);
  float dz = smoothstep(g - 0.01, g - 0.16, p.y) * 0.7;
  vec3 body = for_lit(mix(tn.x, tn.y, dz), mix(tn.z, tn.w, dz), sh * (1.0 + cn.x), nd * (1.0 + 1.8 * cn.x) + cn.y * 0.6) + add * (1.0 + 0.36 * dz);
  // Trees vary: darker firs and fresher spruces, and by day the odd golden larch on the near ridges.
  vec3 tint = vec3(1.0 + (vr - 0.5) * mix(0.16, 0.45, for_dw));
  tint = mix(tint, vec3(2.0, 1.25, 0.55), smoothstep(0.91, 0.93, vr) * step(0.035, st.y) * for_dw);
  body *= mix(vec3(1.0), tint, tr * (1.0 - ff));
  col = mix(col, body + rimC * cn.y * 0.35, cov);
  col += rimC * rim * (1.0 - fb);
  return col;
}

// Drifting fog bank filling the valley up to about ref (valley fog lies level, so ridges rise out
// of it): a soft billowing top between ref and ref + thick, dense below, and a thin haze tail
// above. lit returns the shading: bright along the lit tops, softly mottled inside.
float for_fog(vec2 p, float ref, float thick, float seed, float spd, out float lit) {
  float t = u_time;
  float x = p.x * 2.4 + seed * 7.31 - t * spd;
  float top = ref + thick * (0.15 + for_n2(x));
  float h = (top - p.y) / (thick * 0.45);
  float d = smoothstep(-1.0, 1.4, h);
  d += 0.22 * exp(min(h, 0.0) * 0.6) * (1.0 - d);
  float n = sc_n1(p.x * 5.0 + p.y * 13.0 - t * spd * 1.7 + seed * 3.1);
  float bank = 0.4 + 0.6 * sc_n1(p.x * 1.3 + seed * 4.1 - t * spd * 0.5);
  lit = exp(-h * h * 0.5) * 0.7 + n * 0.3;
  return d * (0.75 + 0.25 * n) * bank;
}

// Moon with limb darkening, faint maria and a thin veil of cloud, plus a layered halo (vis fades it by day).
vec3 for_moon(vec3 col, vec2 dm, float md, vec3 tint, float px, float vis) {
  col += tint * (exp(-md / 0.035) * 0.2 + exp(-md / 0.12) * 0.11 + exp(-md / 0.4) * 0.05) * vis;
  if (md < 0.2 && vis > 0.0) {
    float r = 0.03;
    float disc = clamp(0.5 + (r - md) / px, 0.0, 1.0);
    float q = md / r;
    float maria = 0.8 + 0.2 * vnoise(dm / r * 2.2 + 4.0);
    vec3 face = tint * 1.55 * (1.0 - 0.3 * q * q) * maria;
    col += tint * exp(-max(md - r, 0.0) / 0.007) * 0.3 * (1.0 - disc) * vis;
    float veil = smoothstep(0.42, 0.85, vnoise(vec2(dm.x * 6.0 - u_time * 0.012, dm.y * 30.0 + 3.0)));
    col = mix(col, face, disc * (1.0 - 0.5 * veil) * vis);
    col += tint * veil * exp(-md / 0.06) * 0.1 * vis;
  }
  return col;
}

// A bird in flight at c (half-span s): two wing strokes from a small body; ph sets the wing beat
// (a hawk glides with ph fixed). Returns coverage.
float for_bird(vec2 p, vec2 c, float s, float ph, float px) {
  vec2 q = (p - c) / s;
  float ax = abs(q.x);
  if (ax > 1.1 || abs(q.y) > 0.9) return 0.0;
  float fl = sin(ph);
  float y = ax * (0.25 + 0.55 * fl) - ax * ax * (0.2 + 0.6 * fl);
  float k = s / px;
  float wing = clamp(0.5 + (0.13 * (1.0 - 0.7 * ax) - abs(q.y - y)) * k, 0.0, 1.0) * step(ax, 1.0);
  float body = clamp(0.5 + (0.13 - length(q * vec2(0.8, 1.7))) * k, 0.0, 1.0);
  return max(wing, body);
}

// Fire lookout on a far crest (q relative to its base, world units): splayed braced legs, a glazed
// cab and a pyramid roof. win = the cab's window band, lit = its side facing the key light.
float for_tower(vec2 q, float px, out float win, out float lit) {
  float ax = abs(q.x);
  float lw = mix(0.0085, 0.0042, clamp(q.y / 0.036, 0.0, 1.0));
  float below = step(q.y, 0.036);
  float legs = clamp(0.5 + (0.55 * px - abs(ax - lw)) / px, 0.0, 1.0) * below;
  float f = fract(q.y / 0.012);
  float brace = clamp(0.5 + (0.4 * px - abs(ax - lw * abs(2.0 * f - 1.0))) / px, 0.0, 1.0) * below * step(0.004, q.y);
  float cab = clamp(0.5 + (0.0066 - ax) / px, 0.0, 1.0) * clamp(0.5 + (q.y - 0.036) / px, 0.0, 1.0) * clamp(0.5 + (0.0462 - q.y) / px, 0.0, 1.0);
  float deck = clamp(0.5 + (0.0082 - ax) / px, 0.0, 1.0) * clamp(0.5 + (0.0012 - abs(q.y - 0.0366)) / px, 0.0, 1.0);
  float roof = clamp(0.5 + (0.0084 * (1.0 - (q.y - 0.046) / 0.0078) - ax) / px, 0.0, 1.0) * step(0.0455, q.y) * step(q.y, 0.054);
  win = clamp(0.5 + (0.0054 - ax) / px, 0.0, 1.0) * clamp(0.5 + (0.0021 - abs(q.y - 0.0414)) / px, 0.0, 1.0)
      * (1.0 - 0.7 * clamp(1.0 - abs(fract(q.x / 0.0027) - 0.5) * 0.0027 / (0.5 * px), 0.0, 1.0));
  lit = clamp(0.5 + q.x * for_lx * 800.0, 0.0, 1.0);
  return max(max(max(legs, brace), max(cab, deck)), roof);
}

// Log cabin seen gable-end on (q relative to the centre of its base, world units). Returns coverage;
// win = window light, lit = lit roof edge, wall = 1 on the log walls.
float for_cabin(vec2 q, float px, out float win, out float lit, out float wall) {
  float ax = abs(q.x);
  float roofTop = 0.044 - 0.9 * ax;
  float gRoof = px * 1.35;
  float roof = clamp(0.5 + (roofTop - q.y) / gRoof, 0.0, 1.0) * clamp(0.5 + (q.y - roofTop + 0.0075) / gRoof, 0.0, 1.0)
             * clamp(0.5 + (0.0265 - ax) / px, 0.0, 1.0);
  float body = clamp(0.5 + (0.0185 - ax) / px, 0.0, 1.0) * clamp(0.5 + (roofTop - q.y) / gRoof, 0.0, 1.0);
  float chim = clamp(0.5 + (0.0022 - abs(q.x - 0.011)) / px, 0.0, 1.0) * clamp(0.5 + (0.047 - q.y) / px, 0.0, 1.0);
  float base = clamp(0.5 + q.y / px + 1.0, 0.0, 1.0);
  lit = roof * clamp(1.0 - (roofTop - q.y) / (2.5 * px), 0.0, 1.0) * (0.65 + 0.35 * sign(q.x) * for_lx);
  wall = body * (1.0 - roof);
  // Window with a cross of muntins (left), a small attic window, the door (right) with light at its edge.
  vec2 w = q - vec2(-0.0085, 0.0105);
  float wm = clamp(0.5 + (0.0042 - abs(w.x)) / px, 0.0, 1.0) * clamp(0.5 + (0.0045 - abs(w.y)) / px, 0.0, 1.0);
  float muntH = clamp(1.0 - abs(w.y) / (0.6 * px), 0.0, 1.0);
  wm *= 1.0 - 0.85 * max(muntH, clamp(1.0 - abs(w.x) / (0.6 * px), 0.0, 1.0));
  vec2 at = q - vec2(0.0, 0.0285);
  float att = clamp(0.5 + (0.0026 - length(at)) / px, 0.0, 1.0);
  vec2 dq = q - vec2(0.0085, 0.0075);
  float door = clamp(0.5 + (0.0034 - abs(dq.x)) / px, 0.0, 1.0) * clamp(0.5 + (0.0075 - abs(dq.y)) / px, 0.0, 1.0);
  float crack = door * clamp(1.0 - abs(dq.x + 0.0026) / px, 0.0, 1.0);
  win = wm + att * 0.55 + crack * 0.6;
  return max(max(roof, body), chim) * base;
}

// Thin wisp of chimney smoke rising from b and bending away with the wind.
float for_smoke(vec2 p, vec2 b) {
  float t = u_time;
  float s = p.y - b.y;
  if (s < 0.0 || s > 0.22) return 0.0;
  float cx = b.x + s * 0.12 + s * s * 3.2 + 0.006 * sin(s * 28.0 - t * 0.5) * smoothstep(0.0, 0.05, s);
  float w = 0.003 + s * 0.18;
  float dx = (p.x - cx) / w;
  float plume = exp(-dx * dx);
  if (plume < 0.01) return 0.0;
  float n = vnoise(vec2(dx * 1.1 + s * 5.0, s * 12.0 - t * 0.3));
  return plume * smoothstep(0.0, 0.01, s) * exp(-s / 0.06) * (0.3 + 1.0 * n * n);
}

// One arching fern frond: leaves root at angle a0 (radians above horizontal) toward dir (+1 right,
// -1 left) and curls over along a circular arc that turns by sweep radians over its length len;
// wid = widest half-width. Slanted, pointed pinnae taper toward the tip. Returns coverage.
float for_frond(vec2 p, vec2 root, float dir, float a0, float sweep, float len, float wid, float px) {
  float rad = len / sweep;
  vec2 rr = vec2(-dir * sin(a0), cos(a0));
  vec2 v = p - (root - rr * rad);
  float dr = length(v) - rad;
  if (abs(dr) > wid + 2.0 * px) return 0.0;
  float sa = atan(-dir * (rr.x * v.y - rr.y * v.x), dot(rr, v)) * rad;
  float u = sa / len;
  if (u < 0.0 || u > 1.0) return 0.0;
  float W = wid * sin(3.14159 * pow(u, 0.75)) * smoothstep(0.04, 0.22, u);
  float sp = len / 19.0;
  float adr = abs(dr);
  float b = fract((sa - adr * 0.55) / sp) - 0.5;
  float hw = 0.42 * max(1.0 - adr / max(W, 1e-4), 0.0);
  float pin = clamp(0.5 + (hw - abs(b)) * sp / (1.3 * px), 0.0, 1.0);
  float rach = clamp(0.5 + (0.0012 * (1.0 - 0.7 * u) + 0.25 * px - adr) / px, 0.0, 1.0);
  return max(pin, rach);
}

// Ferns, grass, fireweed and low brush along the very bottom (coverage above the ground line g).
// fw returns the fireweed blossoms (magenta racemes on tall stems, only toward the sides).
float for_brush(vec2 p, float g, float px, out float fw) {
  float t = u_time;
  float cov = for_below(p.y, g + 0.004 * sc_n1(p.x * 60.0), px);
  // One fern clump per cell, smaller toward the centre so the controls stay clear.
  float dens = 4.0;
  float c = floor(p.x * dens);
  float r1 = hash11(c * 3.17 + 41.0);
  float r2 = hash11(c * 5.91 + 7.0);
  float cx = (c + 0.5 + (r1 - 0.5) * 0.14) / dens;
  float sz = (0.85 + 0.25 * r2) * mix(0.5, 1.0, smoothstep(0.2, 0.7, abs(cx) / (0.5 * sc_aspect())));
  float L = 0.125 * sz;
  float wd = 0.015 * sz;
  vec2 root = vec2(cx, g - 0.003);
  float sw = 0.03 * sin(t * 0.4 + c * 2.3);
  cov = max(cov, for_frond(p, root, 1.0, 0.95 + sw, 2.1, L, wd, px));
  cov = max(cov, for_frond(p, root, -1.0, 1.0 - sw, 2.0, L * 0.95, wd, px));
  cov = max(cov, for_frond(p, root, 1.0, 1.3 + sw, 1.7, L * 0.8, wd * 0.95, px));
  cov = max(cov, for_frond(p, root, -1.0, 1.35 - sw, 1.6, L * 0.75, wd * 0.95, px));
  cov = max(cov, for_frond(p, root, r1 > 0.5 ? 1.0 : -1.0, 1.55 + sw * 0.5, 1.1, L * 0.55, wd * 0.8, px));
  // Grass blades between the clumps.
  float gd = 64.0;
  float gc = floor(p.x * gd);
  for (int k = 0; k < 2; k++) {
    float cc = gc + float(k) - (fract(p.x * gd) < 0.5 ? 1.0 : 0.0);
    float q1 = hash11(cc * 1.93 + 3.0);
    float q2 = hash11(cc * 8.27 + 1.0);
    float hb = 0.008 + 0.03 * q1 * q1 * q1;
    float s = clamp((p.y - g) / hb, 0.0, 1.0);
    float lean = (q2 - 0.5) * 0.022 + 0.003 * sin(t * 0.5 + cc);
    float bx = (cc + 0.5 + (q2 - 0.5) * 0.8) / gd + lean * s * s;
    float wb = 0.0024 * (1.0 - s) + 0.2 * px;
    cov = max(cov, clamp(0.5 + (wb - abs(p.x - bx)) / px, 0.0, 1.0) * step(p.y, g + hb));
  }
  // Fireweed: a stem swaying a little at the top, the raceme of florets over its upper half
  // (widest low, tapering to buds at the tip).
  float fc = floor(p.x * 13.0);
  float f1 = hash11(fc * 4.13 + 9.0);
  float fh = (0.045 + 0.035 * fract(f1 * 13.7)) * step(0.4, f1) * smoothstep(0.34, 0.5, abs(p.x) / (0.5 * sc_aspect()));
  float sf = (p.y - g) / max(fh, 1e-4);
  float dxf = p.x - (fc + 0.2 + 0.6 * fract(f1 * 7.1)) / 13.0 - 0.004 * sin(t * 0.6 + fc * 1.3) * sf * sf;
  float stem = clamp(0.5 + (0.0007 + 0.3 * px - abs(dxf)) / px, 0.0, 1.0) * step(0.0, sf) * step(sf, 1.0);
  float bw = 0.0042 * smoothstep(1.02, 0.72, sf) * smoothstep(0.44, 0.6, sf) * (0.75 + 0.25 * step(0.4, fract(sf * 19.0 + step(0.0, dxf) * 0.5)));
  fw = clamp(0.5 + (bw - abs(dxf)) / px, 0.0, 1.0) * step(0.001, bw);
  return max(max(cov, stem), fw);
}

// Distance to the segment a-b.
float for_seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// A deer at the clearing's edge (q relative to its hooves, world units), facing the cabin; now and
// then it lowers its head to graze. Returns coverage.
float for_deer(vec2 q, float px) {
  if (abs(q.x) > 0.02 || q.y < -0.003 || q.y > 0.024) return 0.0;
  float gz = smoothstep(-0.3, 0.3, sin(u_time * 0.19));
  vec2 hd = mix(vec2(-0.0098, 0.0172), vec2(-0.0108, 0.0028), gz);
  float d = (length((q - vec2(0.0, 0.0098)) / vec2(0.0072, 0.0033)) - 1.0) * 0.0033;
  d = min(d, for_seg(q, vec2(-0.0056, 0.0108), hd) - 0.0014);
  d = min(d, length((q - hd - vec2(-0.0011, -0.0004) * (1.0 - 2.0 * gz)) * vec2(0.65, 1.0)) - 0.0012);
  d = min(d, for_seg(q, hd + vec2(0.0004, 0.0006), hd + vec2(0.0016, 0.0026 - 0.004 * gz)) - 0.0004);
  d = min(d, min(for_seg(q, vec2(-0.0052, 0.008), vec2(-0.0058 + 0.0006 * gz, 0.0)), for_seg(q, vec2(-0.0036, 0.008), vec2(-0.003, 0.0))) - 0.00055);
  d = min(d, min(for_seg(q, vec2(0.0046, 0.008), vec2(0.0052, 0.0)), for_seg(q, vec2(0.006, 0.0085), vec2(0.0068, 0.0))) - 0.00055);
  d = min(d, for_seg(q, vec2(0.0068, 0.0112), vec2(0.0078, 0.0098)) - 0.0007);
  return clamp(0.5 - d / px, 0.0, 1.0);
}

// One bough of the big spruce at height yk: dips from the trunk and lifts a little at the tip. Its
// edges are serrated with needle clusters leaning out toward the tip (deep below, shallow on top).
// up returns the distance (px) to the upper edge; tex the needle shading (lit toward the top of the
// bough, streaked by slanting needle strokes, varied per clump).
float for_bough(float ax, float y, float yk, float len, float th, float seed, float px, out float up, out float tex) {
  up = 1e3;
  tex = 0.0;
  float u = ax / len;
  if (u > 1.0) return 0.0;
  float yc = yk - len * (0.34 * u - 0.3 * u * u);
  float dy = y - yc;
  float taper = sqrt(1.0 - u);
  // Two or three drooping needle clumps along the bough (scalloped underside) ...
  float cf = fract(u * 2.4 + fract(seed * 0.37)) * 2.0 - 1.0;
  float clump = 1.0 - cf * cf;
  float dcl = 4.8 * abs(cf) / len;
  // ... serrated by needle teeth that lean out toward the tip.
  float F = 95.0 + 40.0 * fract(seed * 0.71);
  float tx = ax * F + seed * 3.7;
  float f = fract(tx);
  float tr = 0.35 + 0.65 * hash11(floor(tx) * 3.1 + seed * 13.0);
  float tooth = f < 0.75 ? f / 0.75 : (1.0 - f) / 0.25;
  float dt = (f < 0.75 ? 1.0 / 0.75 : 1.0 / 0.25) * F;
  float lo0 = th * taper * (0.35 + 0.65 * taper);
  float hi0 = th * 0.3 * taper;
  // A finer fringe of needles between the teeth.
  float f2 = fract(tx * 2.3 + 0.5);
  float fine = f2 < 0.7 ? f2 / 0.7 : (1.0 - f2) / 0.3;
  float dt2 = (f2 < 0.7 ? 1.0 / 0.7 : 1.0 / 0.3) * F * 2.3;
  float lo = lo0 * (0.4 + 0.3 * clump + 0.2 * tooth * tr + 0.1 * fine);
  float hi = hi0 * (0.6 + 0.2 * clump + 0.2 * tooth);
  float sLo = lo0 * (0.2 * tr * dt + 0.1 * dt2 + 0.3 * dcl) + 0.3;
  float sHi = hi0 * (0.2 * dt + 0.2 * dcl) + 0.3;
  float gLo = sqrt(1.0 + sLo * sLo);
  float gHi = sqrt(1.0 + sHi * sHi);
  up = (hi - dy) / (gHi * px);
  float v = clamp((dy + lo) / max(lo + hi, 1e-5), 0.0, 1.0);
  float sk = fract(tx * 2.3 - dy * F * 1.3);
  tex = v * v * (0.45 + 0.55 * clump * tr) * (0.65 + 0.35 * smoothstep(0.0, 0.45, sk) * smoothstep(1.0, 0.55, sk));
  return dy < 0.0 ? clamp(0.5 + (lo + dy) / (gLo * px), 0.0, 1.0) : clamp(0.5 + up, 0.0, 1.0);
}

// Tall foreground spruce: tapering trunk and alternating boughs. rim returns the lit upper edges,
// tex the needle shading of the visible bough.
float for_bigPine(vec2 p, float x0, float yb, float yt, float wmax, float seed, out float rim, out float tex) {
  rim = 0.0;
  tex = 0.0;
  float hgt = yt - yb;
  float s = (p.y - yb) / hgt;
  if (s > 1.03) return 0.0;
  float sc = clamp(s, 0.0, 1.0);
  float t = u_time;
  float sway = (sin(t * 0.31 + seed) * 0.6 + sin(t * 0.53 + 1.3 + seed) * 0.4) * 0.004 * sc * sc;
  float dx = p.x - x0 - sway;
  float ax = abs(dx);
  if (ax > wmax * 1.05) return 0.0;
  float px = 1.0 / u_res.y;
  float side = step(0.0, dx);
  float tw = wmax * 0.045 * (1.0 - 0.9 * sc) + 0.4 * px;
  float trunk = clamp(0.5 + (tw - ax) / px, 0.0, 1.0) * step(s, 1.0);
  // Dense tiered spire at the crown, ending in the leader.
  float srim;
  float spire = s > 0.68 ? for_tree(p, x0 + sway, yb + 0.71 * hgt, 0.3 * hgt, wmax * 0.2, 8.0, srim) : 0.0;
  float cov = max(trunk, spire);
  tex = 0.25 * trunk + spire * (0.3 + srim);
  float cb = 0.0;
  float sp = wmax * 0.2;
  float k0 = floor((p.y - yb) / sp - side * 0.5);
  for (int j = 0; j < 3; j++) {
    float k = k0 + float(j);
    float yk = yb + (k + side * 0.5) * sp;
    float sk = (yk - yb) / hgt;
    if (sk > 0.03 && sk < 0.985) {
      float r1 = hash11(k * 3.71 + side * 17.0 + seed * 5.0);
      float r2 = fract(r1 * 23.1 + 0.4);
      float len = wmax * pow(1.0 - sk, 0.85) * (0.5 + 0.6 * r2) + 0.006;
      float th = sp * (0.95 + 0.35 * r1) * (0.55 + 0.45 * smoothstep(0.99, 0.8, sk));
      float bob = 0.0012 * sin(t * 0.7 + k * 1.7 + seed) * sk;
      float up;
      float bt;
      float c = for_bough(ax, p.y, yk + bob, len, th, k * 1.3 + side * 3.0 + seed, px, up, bt);
      float r = c * (clamp(1.0 - up / 2.5, 0.0, 1.0) + 0.12 * exp(-up / 9.0)) * (1.0 - trunk) * mix(1.0, smoothstep(0.35, 0.95, ax / len), for_gw);
      rim = max(rim * (1.0 - c), r);
      tex = mix(tex, bt, c * (1.0 - spire));
      cb = max(cb, c);
    }
  }
  rim = max(rim * (1.0 - spire), srim * 1.4 * (1.0 - cb));
  float sg = for_lx < 0.0 ? 1.0 : -1.0;
  rim += trunk * (1.0 - spire) * (1.0 - cb) * clamp(1.0 - (sg * dx + tw) / (2.0 * px), 0.0, 1.0) * 0.3;
  cov = max(cov, cb);
  // rims all round by moonlight / high sun; only the sun-facing boughs catch a low sun
  float fsd = (2.0 * side - 1.0) * for_lx;
  rim *= mix(0.65 + 0.35 * fsd, 1.4 * step(0.0, fsd), for_gw * (1.0 - for_kf));
  return cov;
}

vec3 scene_forest(vec2 uv, vec3 sky) {
  float asp = sc_aspect();
  float px = 1.0 / u_res.y;
  float span = for_span();
  float energy = clamp(u_energy, 0.0, 1.0);
  float t = u_time;

  // Time of day, computed once: daylight, sunrise / sunset warmth, which light is the key
  // (hs: 0 the moon .. 1 the sun), the key colour, and the real sky just above the horizon.
  float dw = clamp(u_day, 0.0, 1.0);
  float gw = clamp(u_golden, 0.0, 1.0);
  float hw = clamp(dw + gw, 0.0, 1.0);
  float hs = smoothstep(0.0, 0.35, dw + gw);
  float nv = sc_nightVis();
  float lamps = sc_lights();
  vec3 K = sc_keyColor();
  vec3 H = for_skyAt(vec2(uv.x, 0.3));
  for_dw = dw;
  for_hw = hw;
  for_lx = mix(-1.0, clamp((u_sun.x - 0.5) * 5.0, -1.0, 1.0), hs);
  for_kf = smoothstep(0.02, 0.55, u_sunElev);
  for_rows = mix(3.0, 14.0, hw);
  for_pv = vnoise(vec2(uv.x * asp * 7.0, uv.y * 11.0));
  // Valley mist: thick at sunrise, burning off toward midday; a warm haze lingers at dusk.
  float fa = mix(1.0, mix(0.24, 1.05, u_dawn * (1.0 - smoothstep(0.12, 0.7, u_sunElev))) + 0.5 * gw, hw);

  // Palette (theme uniforms at night so focus / break / idle all work; sunlit materials by day).
  vec3 acc = mix(u_a0, u_a2, 0.5);
  vec3 base = mix(u_c1, u_c2, 0.5);
  vec3 moonTint = mix(vec3(0.84, 0.91, 1.0), u_a1, 0.1);
  vec3 hz = base * 0.55 + acc * 0.045;
  hz = mix(hz, vec3(sc_luma(hz)), 0.25) * (0.78 + 0.3 * energy);
  vec3 dark = u_c0 * 0.3 + base * 0.04;
  vec3 warm = vec3(1.0, 0.62, 0.3);
  for_dkN = dark;
  for_hzN = hz;
  // Distant ridges read cooler and paler through the moonlit air.
  for_hzF = mix(hz, vec3(sc_luma(hz)) * vec3(0.85, 1.0, 1.12), 0.35) + moonTint * 0.012;
  // Daylight foliage (lightly theme-tinted conifer green): blue-green in shade and fresh yellow-green
  // where it faces the sun by day. Around sunrise / sunset the shade turns violet (lavender at dawn)
  // and the sun-facing flanks, crowns and rims glow orange-gold at dusk or rose-peach at dawn.
  vec3 alb = mix(vec3(0.12, 0.2, 0.065), base * 1.4 + acc * 0.05, 0.1);
  float sunUp = smoothstep(-0.04, 0.1, u_sunElev);
  // Soft cloud shadows drifting over the hills by day.
  vec2 pc = sc_world(uv, 0.3);
  float cs = 1.0 - 0.5 * dw * smoothstep(0.45, 0.72, vnoise(vec2(pc.x * 2.6 - t * 0.011, pc.y * 7.0 + 3.0))) * step(uv.y, 0.6);
  // (gp: the sunrise / sunset colouring takes over quickly near the horizon, so a mid-morning sun
  // still reads as warm-tinted green rather than khaki)
  float gp = smoothstep(0.25, 0.85, gw);
  for_sh = mix(alb * vec3(0.32, 0.46, 1.0), mix(vec3(0.07, 0.04, 0.11), vec3(0.055, 0.055, 0.14), u_dawn), gp);
  for_li = mix(alb * mix(vec3(2.5, 2.3, 1.45), vec3(2.4, 1.9, 1.1), gw), mix(vec3(0.9, 0.42, 0.13), vec3(0.95, 0.56, 0.48), u_dawn), gp) * sunUp * cs;
  for_amb = mix(sc_ambient(), mix(vec3(0.42, 0.28, 0.42), vec3(0.34, 0.34, 0.56), u_dawn), gw * 0.7);
  for_key = K * sunUp * cs;
  for_gw = gw;
  // At sunrise / sunset the air glows warm toward the sun's side and turns mauve / lavender away from it.
  float hl = sc_luma(H);
  float sx = exp(-abs(uv.x - u_sun.x) * 2.2) * gw * hs;
  for_hzD = H * mix(0.9, 0.8, dw) + (H - hl) * 0.7 * gw + K * sx * 0.4;
  for_hzC = mix(H * mix(0.66, 0.8, dw), hl * mix(vec3(1.0, 0.72, 1.0), vec3(0.84, 0.8, 1.22), u_dawn), gw * 0.9) + K * sx * 0.1;

  // Moon high on the left; soft rays fan from the key light (the moon at night, the sun by day).
  vec2 pm = sc_world(uv, 0.05);
  vec2 mc = vec2(-0.33 * asp, 0.79 + 0.05 * (1.0 - smoothstep(0.6, 1.2, asp)));
  vec2 dm = pm - mc;
  float md = length(dm);
  float ml = exp(-md * 1.7) * nv;
  vec2 sunW = vec2((u_sun.x - 0.5) * asp, u_sun.y);
  vec2 dr = pm - (hs > 0.5 ? sunW : mc);
  float mr = length(dr);
  float ang = atan(dr.y, dr.x);
  float ray = 0.6 * sc_n1(ang * 11.0 + t * 0.03) + 0.4 * sc_n1(ang * 29.0 + 7.0 - t * 0.04);
  float amp = (2.0 * hs - 1.0) * (2.0 * hs - 1.0) * mix(1.0, 0.3 + 1.1 * gw, hs);
  // down from the moon at night; by day fanning sideways from a low sun, steeper as it climbs
  float rs = -dr.y / max(mr, 1e-3);
  ray = smoothstep(0.4, 0.95, ray) * mix(smoothstep(0.05, 0.45, rs), smoothstep(-0.3, 0.05, rs) * smoothstep(mix(0.8, 1.6, for_kf), mix(0.4, 1.2, for_kf), rs), hs)
      * smoothstep(0.03, 0.25, mr) * exp(-mr * mix(1.1, 0.8, hs)) * amp;
  // Sunlight glowing through the mist around a low sun.
  vec3 sg = K * exp(-length(pm - sunW) * 2.2) * hs * (0.1 + 0.6 * gw);
  // Mist: moonlit silver at night, sky-white by day; around sunrise / sunset it glows warm toward
  // the sun and turns lavender (dawn) or rose (dusk) away from it.
  vec3 fogG = mix(hl * mix(vec3(1.12, 0.8, 0.98) * 1.3, vec3(1.05, 0.9, 1.16) * 1.6, u_dawn), K * 0.75 + H * 0.35, min(sx * 1.5, 1.0));
  vec3 fogCol = mix(mix(hz * 1.75, vec3(sc_luma(hz * 1.75)) * vec3(0.88, 1.0, 1.08), 0.3) + moonTint * (0.025 + ml * 0.13),
                    mix(H * 0.8 + K * 0.22, fogG, gw * 0.85), hw);
  vec3 rimCol = mix(hz * 0.8 + acc * 0.05 + moonTint * (0.03 + ml * 0.16), K * (0.16 + 0.6 * gw), hw);

  vec3 col = sky;
  float mist = smoothstep(0.62, 0.3, uv.y);
  col = mix(col, mix(hz * 1.3 + moonTint * (0.02 + ml * 0.07), H * 1.05 + K * (0.04 + 0.25 * sx), hw), mist * mix(0.6, 0.3, hw) * fa);
  // (strongest through the morning mist)
  ray *= 1.0 + 1.2 * u_dawn * gw * hs;
  col += mix(moonTint, K * 0.6, hs) * ray * (0.022 + 0.07 * mist) * (1.0 + 2.5 * gw * hs);
  col = for_moon(col, dm, md, moonTint, px, nv);

  // Birds by day: a small flock crossing now and then and a hawk circling over the left woods.
  float bv = smoothstep(0.1, 0.5, dw + 0.5 * gw);
  if (bv > 0.0 && uv.y > 0.55) {
    vec2 pb = sc_world(uv, 0.1);
    float ph = fract(t / 140.0 + 0.8);
    vec2 fc = vec2((ph * 1.9 - 0.62) * asp, 0.74 + 0.02 * sin(t * 0.21));
    float bc = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 o = vec2(-0.034 * fi + 0.012 * sin(fi * 2.7), 0.013 * sin(fi * 1.9 + 0.5) + 0.002 * sin(t * 0.8 + fi));
      bc = max(bc, for_bird(pb, fc + o, 0.0062 - 0.0006 * fi, t * (6.5 + fi * 0.9) + fi * 1.7, px));
    }
    float ha = t * 0.33;
    vec2 hc = vec2(-0.26 * asp + 0.05 * cos(ha), 0.69 + 0.016 * sin(ha));
    bc = max(bc * step(ph, 0.63), for_bird(pb, hc, 0.017, 0.35 + 0.12 * sin(ha * 2.0), px));
    col = mix(col, vec3(0.04, 0.045, 0.06) + H * 0.2, bc * bv);
  }

  // Foreground spruces on the right edge (only the edge one on narrow screens, so the inner one
  // never crosses the timer ring on phones).
  vec2 pp = sc_world(uv, 1.0);
  bool narrow = asp < 1.0;
  float pw = 0.17 * clamp(asp / 1.6, 0.45, 1.0);
  float px0 = 0.5 * asp - (narrow ? 0.03 : 0.05);
  float px1 = px0 - pw * 1.15;
  bool nearPine = pp.x > (narrow ? px0 - pw * 1.1 : px1 - pw * 0.8);

  if (uv.y < 0.6) {
    vec2 p0 = sc_world(uv, 0.04);
    vec2 p5 = sc_world(uv, 0.85);
    float cabX = -min(0.5, (0.5 * asp - 0.12) / span) * span;
    vec2 noClear = vec2(-9.0, 0.0);

    // Ground lines (designed masses: far dome right, shoulder left, a spur falling in from the
    // right, a near shoulder on the left with the cabin clearing).
    float s0;
    float g0 = for_ground(p0.x, 0.39, 0.05, vec3(0.05, 0.45, 0.25), vec3(0.06, -0.6, 0.3), 0.06, 0.3, s0);
    float g5 = 0.03 + 0.06 * pow(min(abs(p5.x / span), 1.25), 1.55) + 0.05 * for_bump(p5.x / span, 1.0, 0.3)
             + 0.016 * (for_n2(p5.x * 3.1 + 67.0) - 0.5);

    float cv;
    float lit;
    float fd;
    // Distant range, barely there, with a fine fuzz of forest on its crest.
    col = mix(col, mix(for_lit(1.0, 1.0, 1.1, 0.5), fogCol, 0.45), for_below(p0.y, g0 + 0.003 * sc_n1(p0.x * 420.0), px) * mix(0.3, 0.5, hw));

    // The four forested ridges, far to near, each behind a drifting fog bank (one loop body keeps
    // the compile small). Per ridge: G = (base, valley rise, wobble, parallax depth), A / B.xy = its
    // two designed masses (amplitude, centre, width), B.zw / C = fog (level, level mix, thickness,
    // drift, density, lit tops), D = (fog god-ray gain, moon glow, rim gain, back stand), ST = stand
    // (trees per unit, tallest, width, tiers), TN = aerial depths (see for_ridge).
    float gc = for_ground(cabX, 0.105, 0.09, vec3(0.17, -1.0, 0.38), vec3(0.06, 0.42, 0.2), 0.035, 4.0, s0);
    vec2 p4 = p0;
    float g4 = 0.0;
    float wglow = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec4 G = for_pick(vec4(0.35, 0.06, 0.04, 0.12), vec4(0.3, 0.04, 0.045, 0.25), vec4(0.2, 0.05, 0.04, 0.42), vec4(0.105, 0.09, 0.035, 0.62), fi);
      vec4 A = for_pick(vec4(0.06, 0.62, 0.35, 0.04), vec4(0.15, -0.72, 0.36, 0.03), vec4(0.2, 1.05, 0.6, 0.035), vec4(0.17, -1.0, 0.38, 0.06), fi);
      vec4 B = for_pick(vec4(-0.8, 0.3, 0.0, 0.0), vec4(0.4, 0.25, 0.3, 0.75), vec4(-0.12, 0.16, 0.235, 0.75), vec4(0.42, 0.2, 0.13, 0.7), fi);
      vec4 C = for_pick(vec4(0.0), vec4(0.04, 0.010, 0.65, 0.35), vec4(0.06, 0.013, 0.88, 0.4), vec4(0.05, 0.017, 0.72, 0.35), fi);
      vec4 D = for_pick(vec4(0.0, 0.04, 0.3, 0.0), vec4(1.4, 0.03, 0.4, 1.0), vec4(2.2, 0.02, 0.36, 1.0), vec4(1.4, 0.0, 0.6, 1.0), fi);
      vec4 ST = for_pick(vec4(150.0, 0.018, 0.3, 5.0), vec4(100.0, 0.028, 0.27, 6.0), vec4(66.0, 0.04, 0.25, 7.0), vec4(42.0, 0.065, 0.24, 8.0), fi);
      vec4 TN = for_pick(vec4(0.66, 0.76, 1.0, 1.0), vec4(0.48, 0.58, 0.6, 1.0), vec4(0.31, 0.41, 0.0, 0.0), vec4(0.17, 0.27, 0.0, 0.0), fi);
      float nearR = step(2.5, fi);
      vec2 p = sc_world(uv, G.w);
      float sl;
      float g = for_ground(p.x, G.x, G.y, A.xyz, vec3(A.w, B.xy), G.z, fi + 1.0, sl);
      // The near ridge levels out into the cabin's clearing.
      float kd = (p.x - cabX) / 0.05;
      g = mix(g, gc, exp(-kd * kd) * nearR);
      float wg = exp(-length((p - vec2(cabX - 0.0085, gc + 0.0105)) * vec2(0.7, 1.0)) / 0.05) * lamps * nearR;
      if (fi > 0.5) {
        fd = for_fog(p, mix(g - 0.01, B.z, B.w), C.x, fi, C.y, lit);
        col = mix(col, fogCol * (0.8 + C.w * lit + ray * D.x) + sg + warm * wg * 0.12, min(fd * C.z * fa, 1.0));
      }
      // Fire lookout on the far crest, standing behind the ridge's front trees (a warm window at night).
      if (fi > 0.5 && fi < 1.5) {
        float tX = max(-0.72 * span, 0.1 - 0.5 * asp);
        float gT = for_ground(tX, 0.3, 0.04, vec3(0.15, -0.72, 0.36), vec3(0.03, 0.4, 0.25), 0.045, 2.0, s0);
        vec2 tq = p - vec2(tX, gT - 0.006);
        if (abs(tq.x) < 0.012 && tq.y > -0.01 && tq.y < 0.056) {
          float tw;
          float tl;
          float tc = for_tower(tq, px, tw, tl);
          col = mix(col, for_lit(0.36, 0.6, 0.8, (0.25 + 0.6 * tl) * for_kf) * vec3(0.8, 0.72, 0.68) + rimCol * tl * 0.25, tc);
          col = mix(col, mix(for_lit(0.3, 0.6, 1.0, 0.0) + H * 0.12, warm * 1.1, lamps), tw);
        }
      }
      col = for_ridge(col, p, g, sl, ST, fi + 1.0, mix(noClear, vec2(cabX, 0.034), nearR), TN, moonTint * ml * D.y,
                      rimCol * D.z + warm * wg * 0.25, D.w, cv);
      p4 = p;
      g4 = g;
      wglow = wg;
    }

    // The cabin in the near ridge's clearing.
    vec3 R4 = for_lit(0.17, 0.0, 1.0, 0.5 * for_kf);
    // Light pool on the ground in front of the cabin.
    vec2 lp = vec2((p4.x - cabX + 0.004) / 0.045, (p4.y - gc + 0.004) / 0.01);
    col += warm * exp(-dot(lp, lp)) * 0.12 * cv * lamps;
    vec2 q = vec2(p4.x - cabX, p4.y - gc);
    if (abs(q.x) < 0.2 && q.y > -0.02 && q.y < 0.3) {
      float win;
      float rl;
      float wall;
      float cab = for_cabin(q, px, win, rl, wall);
      float fl = 0.9 + 0.1 * sin(t * 1.3) * sin(t * 0.71 + 1.0);
      vec3 wallC = mix(mix(R4 * 0.8, vec3(0.05, 0.035, 0.025), 0.35), vec3(0.13, 0.095, 0.07) * (for_amb + for_key * 0.6 * for_kf), dw)
                 * (0.8 + 0.2 * sin(q.y * 1800.0));
      // (by day a weathered, mossy shingle roof)
      col = mix(col, mix(mix(R4 * 0.75, vec3(0.1, 0.1, 0.075) * (for_amb + for_key * 0.8 * for_kf), dw), wallC, wall), cab);
      col += rimCol * rl * 0.7;
      col = mix(col, mix(vec3(0.02, 0.025, 0.03) + H * 0.1, warm * 1.35 * fl, lamps), clamp(win, 0.0, 1.0));
      col += warm * wglow * 0.06 * fl;
      // A deer grazing at the clearing's edge from first light to dusk.
      float deer = for_deer(vec2(q.x - 0.042, p4.y - g4 + 0.0015), px) * smoothstep(0.08, 0.4, hw);
      col = mix(col, vec3(0.3, 0.18, 0.1) * (for_amb * 0.6 + for_key * 0.55) + rimCol * 0.15, deer);
      float sm = for_smoke(p4, vec2(cabX + 0.011, gc + 0.047));
      col = mix(col, fogCol * 1.15 + moonTint * 0.03 * nv, clamp(sm, 0.0, 1.0) * 0.55);
    }
    fd = for_fog(p5, mix(g5, 0.05, 0.6), 0.06, 4.0, 0.022, lit);
    col = mix(col, fogCol * (0.8 + 0.3 * lit + ray * 1.2) + sg, min(fd * 0.55 * fa, 1.0));

    // Foreground bank with ferns and grass (fern tops catch the light by day).
    if (p5.y < g5 + 0.1) {
      float fwc;
      float c5 = for_brush(p5, g5, px, fwc);
      // Mossy mottling and, by day, sun flecks on the ferns.
      float mo = vnoise(p5 * vec2(90.0, 150.0) + vec2(t * 0.03, 0.0));
      float up5 = smoothstep(g5, g5 + 0.09, p5.y);
      vec3 bank = for_lit(0.0, 0.0, mix(0.5, mix(0.45, 0.85, for_kf), hw) * (1.0 + 0.25 * (mo - 0.5) * hw),
                          (0.4 + 0.9 * up5 + 0.7 * smoothstep(0.62, 0.78, mo) * smoothstep(0.0, 0.2, up5)) * for_kf);
      col = mix(col, bank, c5);
      col = mix(col, vec3(0.82, 0.24, 0.56) * (for_amb * 0.5 + for_key * (0.2 + 0.5 * for_kf)) + rimCol * 0.2, fwc * smoothstep(0.1, 0.5, hw));
    }
  }

  if (nearPine) {
    // The two spruces share one loop body (inner one first; phones show only the edge one).
    float ta = 0.45;
    for (int i = 0; i < 2; i++) {
      float fr = float(i);
      if (fr < 0.5 && narrow) continue;
      float pr;
      float ptx;
      float pc = for_bigPine(sc_world(uv, 0.9 + 0.1 * fr), mix(px1, px0, fr), -0.02 - 0.01 * fr, mix(0.7, 0.97, fr), pw * mix(0.72, 1.0, fr), 4.0 - 3.0 * fr, pr, ptx);
      if (pc > 0.0) {
        float back = clamp(sc_luma(col) * 7.0, 0.2, 1.0);
        float nsh = mix(mix(1.0, mix(0.6, 1.0, for_kf), hw), mix(0.3, mix(0.4, 0.8, for_kf), hw), fr);
        col = mix(col, for_lit(0.1 - 0.1 * fr, 0.0, nsh * (1.0 + ta * (ptx - 0.35)), (0.1 - 0.05 * fr + 1.1 * ptx) * mix(0.2, 1.0, for_kf)), pc);
        col += rimCol * pr * (0.8 + 0.3 * fr) * back;
      }
    }
  }
  return col;
}
`,
};
