// Scene: Desert dusk (theme: sunset) — sculpted red-rock mesas and sweeping dunes under the real sky.
// GLSL rules: GLSL ES 1.00, every helper in this file is prefixed "des_", entry point scene_desert(uv, sky).
// Rendered at full device resolution: every edge is anti-aliased against its true (slope-aware)
// distance and fine detail (strata, cracks, ripples, cactus ribs) fades out before it gets sub-pixel.
// Time of day: one key light (the shared sun by day, a crescent moon at night) with a colour, strength
// and height, plus a sky-fill colour, all computed once per pixel in scene_desert() and blended
// continuously from u_day / u_golden / u_sunElev / u_sun — every layer shades with the same factors.
export default {
  key: 'desert',
  name: 'Desert dusk',
  glsl: `
// ------------------------------------------------------------------ Desert dusk (des_*)
const float des_HZ = 0.236;               // far desert floor / horizon line (uv.y)
vec2 des_sun;                             // key light (far-layer world coords): the sun by day, the moon at night
vec2 des_sunW;                            // the real sun (can be below the horizon or above the screen)
float des_px;                             // one pixel in world units
float des_gap;                            // world x of the open valley the sun sets into
float des_D;                              // daylight 0..1
float des_G;                              // sunrise / sunset warmth 0..1
float des_N;                              // night-only sky objects (moon, milky way)
float des_kI;                             // direct key light on the terrain (0 once the sun is down)
float des_hi;                             // key height: 0 low and raking (backlit forms) .. 1 high (faces lit)
float des_rim;                            // backlit rim-light strength
float des_lr;                             // 0 light from the left .. 1 from the right (dune slopes)
float des_ls;                             // -1 light from the left .. +1 from the right (sun / moon at infinity)
float des_gc;                             // how tightly the horizon glow gathers around the sun
float des_gI;                             // horizon glow strength
vec3 des_key;                             // key light colour
vec3 des_amb;                             // sky fill (shadow) colour
vec3 des_rimC;                            // rim light colour

// Amber accent pushed slightly toward red, so darkened yellows (break palette) fall to amber, not olive.
vec3 des_amber() { return u_a0 * vec3(1.0, 0.80, 0.66); }

// Violet night-sky light (the palette's shadow colour).
vec3 des_skyL() { return mix(u_c3, u_c1, 0.4) + u_a2 * 0.06; }

// Light over the horizon: hot amber band gathered around the low sun (a faint even band at night),
// coral above, faint magenta higher, a soft bloom round the sun, and pale dusty haze by day.
vec3 des_glow(vec2 p, float bk) {
  float h = max(p.y - des_HZ, 0.0);
  float nr = mix(0.30, exp(-abs(p.x - des_sunW.x) * 1.5), des_gc);
  vec3 c = des_amber() * exp(-h / (0.028 + 0.045 * nr)) * (0.16 + 0.95 * nr * nr);
  c += u_a1 * exp(-h / (0.075 + 0.07 * nr)) * (0.08 + 0.30 * nr);
  c += u_a2 * exp(-h / 0.22) * (0.04 + 0.06 * nr);
  float d = length(vec2((p.x - des_sunW.x) * 0.75, p.y - des_sunW.y));
  vec3 bloom = mix(u_a0, vec3(1.0, 0.86, 0.62), 0.3) * exp(-d / 0.07) * 0.55 + u_a1 * exp(-d / 0.24) * 0.16;
  c = c * des_gI + bloom * des_G * bk;
  c += mix(des_amber(), vec3(1.0, 0.72, 0.38), 0.5) * exp(-h / 0.14) * des_G * (0.10 + 0.45 * nr) * des_gc;
  c += vec3(0.66, 0.56, 0.48) * exp(-h / 0.08) * 0.32 * des_D;
  return c * (0.65 + 0.35 * clamp(u_energy, 0.0, 1.0)) * (0.75 + 0.3 * u_intensity);
}

// Sky pass texel (decoded like skyColor() does, without stars or sun).
vec3 des_tex(vec2 q) {
  vec3 v = texture2D(u_skyTex, clamp(q, 0.0, 1.0)).rgb;
  return 2.0 * v * v;
}

// Two thin strands of stratus low over the horizon, drifting across the setting / rising sun:
// dusky mauve away from it, molten gold (lit undersides, glowing edges) as they cross it.
vec4 des_clouds(vec2 p, float t) {
  vec4 acc = vec4(0.0);
  float dx = p.x - des_sunW.x;
  float nr = exp(-abs(dx) * 5.0);
  vec3 body = mix(u_c1, u_a2, 0.2) * 0.45 + des_amb * 0.25;
  vec3 gold = mix(u_a0, vec3(1.0, 0.88, 0.66), 0.45);
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float x = p.x * (1.0 + 0.4 * fi) + t * (0.0012 + 0.0008 * fi) + fi * 7.3;
    float n = vnoise(vec2(x * 3.2, fi * 3.7));
    float m = vnoise(vec2(x * 11.0, fi * 5.1 + 2.0));
    float th = (0.0095 - 0.0035 * fi) * smoothstep(0.25, 0.65, n) * (0.7 + 0.3 * m) * exp(-dx * dx / (0.05 - 0.02 * fi));
    float dy = p.y - (0.270 + 0.030 * fi + 0.0015 * (m - 0.5) + 0.015 * dx * (fi - 0.5));
    float thc = max(th, 1e-4);
    float a = smoothstep(thc, thc * 0.15, abs(dy)) * smoothstep(0.0015, 0.004, th) * (0.75 - 0.15 * fi);
    float under = smoothstep(thc * 0.2, -thc * 0.9, dy);
    vec3 c = mix(body, gold * 1.3, nr * 0.55) + gold * (0.10 + 1.1 * nr) * under;
    acc.rgb += (1.0 - acc.a) * a * c;
    acc.a += (1.0 - acc.a) * a;
  }
  return acc * des_G;
}

// A few birds riding thermals over the left mesas (day and golden hour): gull-winged silhouettes that
// foreshorten as they bank round their circles and flap now and then. Returns coverage.
float des_birds(vec2 p, float t) {
  float cov = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ph = t * (0.16 - 0.03 * fi) + fi * 2.4;
    vec2 c = vec2(-0.66 + 0.19 * fi, 0.60 + 0.06 * fi) + vec2(cos(ph), 0.30 * sin(ph)) * (0.05 + 0.03 * fi);
    float sz = 0.0115 - 0.003 * fi;
    vec2 q = (p - c) / sz;
    if (abs(q.x) < 1.2 && abs(q.y) < 0.8) {
      q.x = abs(q.x) / (0.45 + 0.55 * abs(sin(ph)));
      float flap = 0.35 * sin(t * 7.0 + fi * 1.7) * smoothstep(0.7, 0.9, sin(t * 0.9 + fi * 2.0));
      float y = (0.30 + flap) * q.x - (0.55 + flap) * q.x * q.x;
      float th = 0.11 * (1.0 - q.x) + 0.03;
      float a = des_px / sz;
      float w = smoothstep(th + a, th - a, abs(q.y - y)) * smoothstep(1.0 + a, 1.0 - a, q.x);
      w = max(w, smoothstep(0.16 + a, 0.16 - a, length(q * vec2(1.0, 1.6))));
      cov = max(cov, w);
    }
  }
  return cov;
}

// A hot-air balloon that climbs out of the valley after sunrise, drifts high through the day and sinks
// back behind the mesas at dusk (cy = its height): a striped envelope in the theme's colours, shaded
// round toward the sun (a glowing rim when the sun is low), and a tiny basket. Premultiplied + coverage.
vec4 des_balloon(vec2 p, float t, float cy) {
  float R = 0.020;
  vec2 q = (p - vec2(-0.44 + 0.03 * sin(t * 0.021), cy + 0.006 * sin(t * 0.29))) / R;
  if (abs(q.x) > 1.3 || q.y > 1.2 || q.y < -2.2) return vec4(0.0);
  float a = des_px / R;
  // Envelope half-width: a sphere above, tapering to the throat.
  bool top = q.y > -0.35;
  float w = top ? sqrt(max(1.0 - q.y * q.y, 0.0)) : mix(0.94, 0.26, clamp((-0.35 - q.y) / 1.05, 0.0, 1.0));
  float env = smoothstep(a, -a, max(top ? length(q) - 1.0 : abs(q.x) - w, -1.40 - q.y));
  float bsk = smoothstep(a, -a, max(abs(q.x) - 0.17, abs(q.y + 1.85) - 0.13));
  float rope = smoothstep(a * 1.2, 0.0, abs(abs(q.x) - 0.2 - 0.05 * (q.y + 1.4))) * step(-1.72, q.y) * step(q.y, -1.40);
  float u = asin(clamp(q.x / max(w, 0.05), -1.0, 1.0));
  float gore = step(0.5, fract(u * 2.55 + 0.25));
  vec3 alb = mix(mix(u_a0, vec3(0.95, 0.90, 0.82), gore), u_a1, step(abs(q.y + 0.52), 0.12));
  float ls = des_ls;
  vec2 n = vec2(sin(u), q.y * 0.6);
  float dif = clamp(0.5 + 0.55 * dot(n, normalize(vec2(ls, 1.4 * des_hi + 0.1))), 0.0, 1.0);
  vec3 col = alb * (des_amb * 0.55 + des_key * (0.10 + 0.75 * dif));
  col += des_rimC * pow(max(sin(u) * ls, 0.0), 6.0) * 0.8 * (1.0 - des_hi);
  vec3 dark = vec3(0.22, 0.14, 0.10) * (des_amb + des_key * 0.3);
  float cov = max(env, max(bsk, rope * 0.7));
  return vec4(mix(dark, col, env) * cov, cov);
}

// A dust devil wandering the valley floor in the heat of the day: a thin twisting funnel of dust that
// leans downwind, lit on the sun side. p = valley-floor layer coords. Premultiplied colour + alpha.
vec4 des_devil(vec2 p, float t) {
  float y = p.y - 0.176;
  float rx = p.x - (des_gap - 0.13 + 0.06 * sin(t * 0.011) + y * 0.30 + 0.004 * sin(y * 70.0 - t * 1.7));
  float dx = rx / (0.0035 + y * 0.28);
  float a = (exp(-dx * dx) * (0.6 + 0.4 * sin(dx * 2.5 + y * 260.0 - t * 9.0)) * (1.0 - smoothstep(0.04, 0.13, y)) + exp(-rx * rx / 0.00015 - y / 0.006)) * step(0.0, y) * 0.62;
  return vec4(vec3(0.96, 0.70, 0.46) * (des_amb * 0.45 + des_key * (0.42 + 0.40 * clamp(dx * des_ls, 0.0, 1.0))) * a, a);
}

// ---- mesas
// Smoothstep with its derivative: (value, d/du).
vec2 des_ss(float a, float b, float u) {
  float t = clamp((u - a) / (b - a), 0.0, 1.0);
  return vec2(t * t * (3.0 - 2.0 * t), 6.0 * t * (1.0 - t) / (b - a));
}

// Mesa flank over u = distance past the caprock rim, in units of height: caprock lip, sheer upper
// cliff, a narrow bench, a lower cliff band, then a concave talus apron. Returns (height 1..0, d/du).
vec2 des_flank(float u, float s) {
  float a = 0.010 + 0.010 * s;
  float b = a + 0.035 + 0.030 * s;
  float c = b + 0.05 + 0.09 * s;
  float e = c + 0.030;
  float ex = exp(-max(u - e, 0.0) * 2.4);
  vec2 r = vec2(1.0, 0.0) - 0.10 * des_ss(0.0, a, u) - 0.34 * des_ss(a, b, u) - 0.08 * des_ss(b, c, u) - 0.16 * des_ss(c, e, u);
  return r - 0.32 * vec2(1.0 - ex, 2.4 * ex * step(e, u));
}

// Flat-topped mesa centred at c, caprock half-width w, height H: (height above its base, |dh/dx|).
vec2 des_mesa(float x, float c, float w, float H, float seed) {
  float dx = x - c;
  float s = hash11(seed * 3.3 + step(0.0, dx) * 7.1);
  float u = max(abs(dx) - w, 0.0) / H;
  vec2 f = des_flank(u, s);
  float top = 1.0 - 0.016 * sc_n1(x * 90.0 + seed * 5.0) * (1.0 - smoothstep(0.0, 0.03, u));
  return vec2(H * f.x * top, abs(f.y));
}

// Far plateaus are only a few px tall: a caprock cliff and a talus apron are all that read.
vec2 des_mesaF(float x, float c, float w, float H) {
  float u = max(abs(x - c) - w, 0.0) / H;
  vec2 cl = des_ss(0.0, 0.08, u);
  float ex = exp(-max(u - 0.08, 0.0) * 2.4);
  return vec2(H * (1.0 - 0.62 * cl.x - 0.38 * (1.0 - ex)), 0.62 * cl.y + 0.91 * ex * step(0.08, u));
}

// Two-octave value noise (~0..1) for the gently undulating foot lines (cheaper than sc_fbm1).
float des_n2(float x) { return 0.64 * sc_n1(x) + 0.34 * sc_n1(x * 2.07 + 17.3); }

void des_pick(vec2 m, vec3 k, inout vec2 best, inout vec3 info) {
  if (m.x > best.x) { best = m; info = k; }
}

// Far range: low hazy plateaus along the horizon; kept low round the sunset valley, where one low
// plateau takes the last of the sun.
vec2 des_farH(float x) {
  float base = des_HZ + 0.005 * (des_n2(x * 7.0 + 3.0) - 0.5);
  vec2 best = des_mesaF(x, des_gap + 0.035, 0.06, 0.022);
  float dens = 2.6;
  float cell = floor(x * dens);
  for (int k = -1; k <= 1; k++) {
    float c = cell + float(k);
    float cx = (c + 0.25 + 0.5 * hash11(c * 3.17 + 1.0)) / dens;
    float w = 0.02 + 0.10 * hash11(c * 5.31 + 2.0);
    float H = (0.012 + 0.032 * hash11(c * 1.91 + 3.0)) * (0.55 + 0.45 * smoothstep(0.05, 0.5, abs(cx)));
    if (abs(cx - des_gap) < 0.16) H = min(H, 0.012);
    vec2 m = des_mesaF(x, cx, w, H);
    if (m.x > best.x) best = m;
  }
  return vec2(base + best.x, best.y);
}

// Mid range: the hero mesas, buttes and a "mitten" spire; on the right they frame the valley the sun
// sets into (placed from the screen's aspect so the gap stays open). info = (centre, half-width, height).
vec2 des_midH(float x, out vec3 info) {
  float base = 0.198 + 0.010 * des_n2(x * 2.5 + 11.0);
  vec2 best = vec2(0.0);
  info = vec3(0.0, 0.1, 0.1);
  float cs = des_gap - 0.14;
  float cb = des_gap + 0.19;
  des_pick(des_mesa(x, -0.64, 0.14, 0.165, 1.0), vec3(-0.64, 0.14, 0.165), best, info);
  des_pick(des_mesa(x, -0.33, 0.028, 0.11, 2.0), vec3(-0.33, 0.028, 0.11), best, info);
  des_pick(des_mesa(x, -0.283, 0.005, 0.088, 8.0), vec3(-0.283, 0.005, 0.088), best, info);
  des_pick(des_mesaF(x, -0.06, 0.045, 0.030), vec3(-0.06, 0.045, 0.030), best, info);
  des_pick(des_mesaF(x, 0.16, 0.075, 0.05), vec3(0.16, 0.075, 0.05), best, info);
  des_pick(des_mesa(x, cs, 0.011, 0.085, 5.0), vec3(cs, 0.011, 0.085), best, info);
  des_pick(des_mesa(x, cb, 0.10, 0.14, 6.0), vec3(cb, 0.10, 0.14), best, info);
  return vec2(base + best.x, best.y);
}

// Near range: a towering mesa wall on the left edge and a tall butte left of the sunset valley.
vec2 des_nearH(float x, out vec3 info) {
  float base = 0.128 + 0.010 * des_n2(x * 2.0 + 21.0);
  vec2 best = vec2(0.0);
  info = vec3(0.0, 0.1, 0.1);
  float cn = des_gap - 0.36;
  des_pick(des_mesa(x, -1.00, 0.20, 0.27, 11.0), vec3(-1.00, 0.20, 0.27), best, info);
  des_pick(des_mesa(x, cn, 0.05, 0.19, 12.0), vec3(cn, 0.05, 0.19), best, info);
  return vec2(base + best.x, best.y);
}

// Red-rock shading. Three light planes: the flank turned to the key light, the front face (lit only
// by a high sun, otherwise in sky-fill shadow with warm bounce from the sand) and the flank turned
// away. Beds with lit ledges and shadowed lips (buff and maroon beds show by day), blocky joints and
// cracks, varnish streaks from the rim, a paler caprock, a talus apron with gullies, a crisp rim light,
// haze and fog (dawn mist) pooled at the foot. sc = detail scale of the layer.
vec3 des_rock(vec2 p, vec2 hs, vec3 info, float base, float strata, float sc, float haze, float dark, vec3 hz) {
  float px = des_px;
  float c = info.x;
  float w = info.y;
  float H = info.z;
  float d = max(hs.x - p.y, 0.0);
  float ny = inversesqrt(1.0 + hs.y * hs.y);
  float dp = d * ny;
  float yy = (p.y - base) / H;
  float ls = des_ls;
  float lr = 0.5 + 0.5 * ls;
  float dxm = p.x - c;
  float lx = dxm * ls;
  float nr = mix(exp(-abs(c - des_sun.x) * 1.2), 1.0, des_hi * 0.8);

  // Beds: continuous across the layer, gently warped; seams blended over ~1.5 px. Only some beds
  // form ledges (a lit top edge over a shadowed lip); the rest differ only in tone.
  float sy = (p.y - base) * strata + 0.30 * sc_n1(p.x * 3.0 + c * 2.0);
  float id = floor(sy);
  float fr = fract(sy);
  float e = strata * px * 1.5;
  float bedPx = 1.0 / (strata * px);
  float h0 = hash11(id * 1.7 + 3.0);
  float hb = mix(h0, hash11(id * 1.7 + 4.7), smoothstep(1.0 - e, 1.0, fr));
  float tone = 0.82 + 0.28 * hb;
  float lk = step(0.60, h0) * smoothstep(5.0, 12.0, bedPx);
  tone *= 1.0 + lk * ((0.34 - 0.12 * des_D) * smoothstep(1.0 - 2.5 * e, 1.0 - 0.6 * e, fr) - 0.30 * (1.0 - smoothstep(0.0, 3.0 * e, fr)));

  // Vertical fluting, long dark desert-varnish streaks from the rim, and a few long joint cracks.
  float fq = 110.0 * sc;
  tone *= 0.93 + 0.14 * sc_n1(p.x * fq + 0.8 * sc_n1(p.y * 24.0 * sc + c)) * smoothstep(3.0, 8.0, 1.0 / (fq * px));
  float vs = smoothstep(0.45, 0.85, sc_n1(p.x * 46.0 * sc + c * 7.0)) + 0.6 * smoothstep(0.6, 0.9, sc_n1(p.x * 130.0 * sc + c * 3.0));
  float varn = min(vs, 1.0) * exp(-d / (H * (0.30 + 0.35 * sc_n1(p.x * 17.0 * sc + c)))) * smoothstep(0.0, H * 0.04, d);
  tone *= 1.0 - 0.42 * varn;
  float cq = p.x * 36.0 * sc + c * 11.0 + 0.06 * sc_n1(p.y * 40.0 * sc);
  float crack = (1.0 - smoothstep(0.0, 36.0 * sc * px * 1.2, abs(fract(cq) - 0.5))) * step(0.64, hash11(floor(cq) + 0.5))
              * smoothstep(0.35, 0.6, sc_n1(p.y * 22.0 * sc + floor(cq) * 3.1));
  tone *= 1.0 - 0.32 * crack * smoothstep(6.0, 14.0, bedPx);

  // Talus apron: its top edge scalloped by scree fans, gullies running down and outward.
  float tt = 0.33 + 0.07 * sc_n1(p.x * 24.0 * sc / (0.4 + H) + c * 3.0) + 0.012 * sc_n1(p.x * 70.0 * sc);
  float ey = 1.5 * px / H;
  float cliff = smoothstep(tt - 2.0 * ey, tt + 2.0 * ey, yy);
  float gully = sc_n1(dxm * 70.0 * sc + (p.y - base) * 40.0 * sc * sign(dxm) + c * 5.0);
  float rubble = 0.84 + 0.30 * gully;

  // Caprock: the top band is a paler, harder rock with a shadowed lip beneath it.
  float capT = H * 0.085;
  float capZ = step(0.62, yy);
  float cap = smoothstep(capT + px, capT - px, d) * capZ;
  float lip = exp(-abs(d - capT - 1.5 * px) / (1.6 * px)) * capZ;

  // Light planes: the corner between the front and each flank is organic (it wanders and steps with
  // the beds); the lit corner catches a thin highlight; the terrain's shadow climbs the lit face.
  float corner = w * 0.3 + (hb - 0.5) * min(w, 0.02) * 0.25 + min(w, 0.03) * 0.35 * (sc_n1(p.y * 40.0 * sc + c * 9.0) - 0.5)
               + 0.002 * (sc_n1(p.y * 150.0 * sc + c) - 0.5);
  float sR = smoothstep(corner - px, corner + px, dxm);
  float sL = smoothstep(corner - px, corner + px, -dxm);
  float side = mix(sL, sR, lr);
  float away = mix(sR, sL, lr);
  float edgeL = mix(exp(-max(-dxm - corner, 0.0) / (1.6 * px)) * sL, exp(-max(dxm - corner, 0.0) / (1.6 * px)) * sR, lr);
  float tl = 0.30 + 0.16 * sc_n1(p.x * 30.0 * sc + c * 4.0);
  side *= 0.35 + 0.65 * smoothstep(tl - 3.0 * px / H, tl + 3.0 * px / H, yy);

  // Albedo: palette-tinted red rock at night; sunlit sandstone by day with buff and maroon beds.
  vec3 albN = mix(vec3(0.74, 0.33, 0.20), u_c1 * 2.2, 0.22);
  albN = mix(albN, albN * vec3(0.86, 0.80, 0.92), step(0.7, hb));
  vec3 albD = mix(vec3(0.86, 0.33, 0.15), u_a0 * 0.85, 0.08);
  albD = mix(albD, vec3(0.92, 0.62, 0.40), step(0.80, hb) * 0.6) * (1.0 - 0.22 * step(hb, 0.16));
  vec3 alb = mix(albN, albD, des_D);

  vec3 K = des_key * des_kI;
  float ao = 0.70 + 0.30 * smoothstep(0.1, 0.9, yy);
  vec3 eS = des_amb * (0.55 + 0.30 * des_D) + K * (0.05 * (1.0 - yy) + 0.12 * des_D);
  vec3 eF = eS + K * 0.42 * des_hi;
  vec3 eL = eS * 0.5 + K * (0.30 + 0.48 * nr);
  vec3 E = mix(mix(eF, eS, away * (0.25 + 0.75 * des_hi)), eL, side);
  vec3 capC = mix(alb, mix(vec3(0.62, 0.52, 0.50), vec3(0.88, 0.70, 0.54), des_D), 0.4);
  vec3 col = mix(alb * E, capC * (E * 1.05 + K * 0.25 * des_hi), cap) * tone * ao;
  col += K * edgeL * (0.03 + 0.20 * nr) * tone;
  col += des_amb * 0.07 * des_D;                 // skylight scattered into the shade: blue-violet shadows by day
  col *= 1.0 - 0.45 * lip;

  vec3 tal = alb * (des_amb * 0.62 + K * (0.03 + 0.12 * nr * smoothstep(-0.2 * w - 0.01, 0.3 * w + 0.01, lx) + 0.40 * des_hi)) * rubble * (0.75 + 0.35 * yy / max(tt, 0.01));
  col = mix(tal, col, cliff);
  col *= 1.0 - 0.35 * exp(-abs(yy - tt) / (3.0 * ey)) * smoothstep(0.02, 0.2, yy);
  col *= dark;

  // Rim light: a crisp line along cliffs and caprock, strongest on edges facing the light.
  float rimK = smoothstep(base + H * 0.30, base + H * 0.62, hs.x) * (0.35 + 0.65 * smoothstep(-w, w * 0.4 + 0.01, lx));
  col += des_rimC * (exp(-dp / (1.2 * px)) * 0.9 * (0.3 + 0.7 * ny) + exp(-dp / (7.0 * px)) * 0.2 * ny * ny) * (0.05 + 0.75 * nr) * rimK * des_rim;

  float ground = smoothstep(base + 0.004, base - 0.004, p.y);
  col = mix(col, mix(vec3(0.84, 0.52, 0.34), vec3(0.88, 0.52, 0.30), des_D) * (des_amb * (0.30 + 0.28 * des_D) + K * (0.06 + 0.40 * des_hi + 0.18 * des_D)) * dark, ground);
  float fog = smoothstep(base + 0.05, base - 0.01, p.y) * (0.12 + 0.28 * sc_n1(p.x * 2.2 + u_time * 0.035 + base * 40.0)) * (1.0 + 1.5 * des_G * u_dawn - 0.8 * des_D);
  return mix(col, hz, clamp(haze + (1.0 - haze) * fog, 0.0, 1.0));
}

// ---- dunes
float des_cp(float cell, float seed) { return 0.22 + 0.16 * hash11(cell * 7.3 + seed); }

// One dune period f in 0..1: steep slip face up to the sharp crest at cp, long windward slope after.
float des_prof(float f, float cp) {
  if (f < cp) { float g = f / cp; return g * sqrt(g); }
  float g = (f - cp) / (1.0 - cp);
  return 1.0 - 0.2 * g - 0.8 * g * g * (3.0 - 2.0 * g);
}

float des_dune(float x, float freq, float seed, float amp) {
  float s = x * freq + seed;
  float cell = floor(s);
  float a = amp * (0.55 + 0.45 * hash11(cell * 3.7 + seed * 5.0));
  return a * des_prof(fract(s), des_cp(cell, seed));
}

// Foreground and middle dune lines (a low bowl in the centre, rising toward the sides).
float des_h2(float x) { return 0.020 + 0.060 * smoothstep(0.2, 0.95, abs(x + 0.05)) + 0.008 * sc_n1(x * 3.0 + 2.0) + des_dune(x, 1.3, 0.35, 0.05); }
float des_h1(float x) { return 0.118 + 0.045 * smoothstep(0.1, 0.85, abs(x)) + 0.008 * sc_n1(x * 2.3 + 5.0) + des_dune(x, 2.1, 1.7, 0.034); }

// Dune field below the silhouette h: shadowed slip faces and lit windward slopes (swapped when the
// light comes from the left; a high sun lights both) split by crisp crest lines that sweep toward the
// viewer, a knife-edge highlight on each crest, wind ripples whose spacing opens up toward the viewer,
// and drifting cloud shadows by day.
vec3 des_sand(vec2 p, float h, float freq, float seed, float ripK, float ripAmt, float haze, vec3 hz) {
  float px = des_px;
  float d = max(h - p.y, 0.0);
  float dsk = 1.1 + 14.0 * d;
  float s = (p.x - (d * 1.1 + d * d * 7.0)) * freq + seed;
  float cell = floor(s);
  float f = fract(s);
  float cp = des_cp(cell, seed);
  float e = px * freq * sqrt(1.0 + dsk * dsk) * 1.1;
  float g = clamp((f - cp) / (1.0 - cp), 0.0, 1.0);
  float on = smoothstep(cp - e, cp + e, f);
  float lit = mix((1.0 - on) * 0.75, on * pow(1.0 - g, 0.8), des_lr);
  float nr = mix(exp(-abs(p.x - des_sun.x) * 1.1), 1.0, des_hi * 0.8);

  vec3 alb = mix(mix(vec3(0.86, 0.54, 0.36), u_a0, 0.12), mix(vec3(0.86, 0.48, 0.28), u_a0, 0.08), des_D);
  float cs = smoothstep(0.52, 0.72, vnoise(vec2(p.x * 2.4 - u_time * 0.004, p.y * 16.0 + seed)));
  vec3 K = des_key * des_kI * (1.0 - 0.6 * cs * des_D);
  vec3 col = alb * des_amb * (0.26 + 0.22 * exp(-d / 0.025) + 0.28 * des_D);
  col += des_amb * 0.06 * des_D * (1.0 - lit);
  col += alb * K * (lit * (0.16 + 0.32 * nr) + des_hi * (0.30 + 0.22 * on) + alb * 0.22 * des_D);

  // Wind ripples: asymmetric (soft stoss, crisp lee edge), curving with the dune.
  float ph = ripK * log(1.0 + d * 12.0) / 12.0 + 0.45 * sc_n1(p.x * 26.0 + cell * 4.0) + 1.8 * (f - cp);
  float perPx = (1.0 + d * 12.0) / (ripK * px);
  float r = fract(ph);
  float rip = smoothstep(0.0, 1.6 / perPx, r) * (1.0 - r) - 0.45;
  col *= 1.0 + ripAmt * rip * smoothstep(3.5, 8.0, perPx) * (0.5 + 0.5 * lit);

  float rk = 0.3 + 0.7 * des_rim;
  col += K * on * exp(-max(f - cp, 0.0) / (e * 1.3)) * (0.05 + 0.30 * nr) * rk;
  col += des_rimC * (exp(-d / (1.2 * px)) * 0.8 + exp(-d / (8.0 * px)) * 0.15) * (0.04 + 0.30 * nr) * des_rim;
  return mix(col, hz, haze);
}

// Distant low dunes on the valley floor: lit and shadowed faces split by crisp crests, a glint on each
// crest (ripples and cloud shadows would be sub-pixel out there).
vec3 des_sandF(vec2 p, float h, float haze, vec3 hz) {
  float d = max(h - p.y, 0.0);
  float s = (p.x - d * 1.1) * 3.4 + 4.3;
  float cell = floor(s);
  float f = fract(s);
  float cp = des_cp(cell, 4.3);
  float on = smoothstep(cp - des_px * 7.0, cp + des_px * 7.0, f);
  float lit = mix((1.0 - on) * 0.75, on * (1.0 - 0.6 * (f - cp) / (1.0 - cp)), des_lr);
  float nr = mix(exp(-abs(p.x - des_sun.x) * 1.1), 1.0, des_hi * 0.8);
  vec3 alb = mix(mix(vec3(0.86, 0.54, 0.36), u_a0, 0.12), mix(vec3(0.86, 0.48, 0.28), u_a0, 0.08), des_D);
  vec3 col = alb * (des_amb * (0.26 + 0.22 * exp(-d / 0.025) + 0.28 * des_D) + des_key * des_kI * (lit * (0.16 + 0.32 * nr) + des_hi * (0.30 + 0.22 * on) + 0.19 * des_D));
  col += des_rimC * exp(-d / (1.2 * des_px)) * (0.04 + 0.30 * nr) * des_rim * 0.8;
  return mix(col, hz, haze);
}

// ---- saguaro cactus (signed distance, world units)
// Capsule axis: xy = offset from the nearest point on the axis, z = its length.
vec3 des_seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  vec2 o = pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec3(o, length(o));
}
// Smooth union that carries the (radius-normalized) cross-section offset along, for shading.
vec3 des_smin(vec3 a, vec3 b, float k) {
  float h = clamp(0.5 + 0.5 * (b.z - a.z) / k, 0.0, 1.0);
  return vec3(mix(b.xy, a.xy, h), mix(b.z, a.z, h) - k * h * (1.0 - h));
}
vec3 des_arm(vec2 q, float y, float x, float top, float ra, float H) {
  vec3 a = des_seg(q, vec2(0.0, y), vec2(x, y + H * 0.04));
  vec3 b = des_seg(q, vec2(x, y + H * 0.04), vec2(x, top));
  return des_smin(vec3(a.xy / ra, a.z - ra), vec3(b.xy / ra, b.z - ra), ra * 0.9);
}
// Trunk and two upturned arms: (cross-section offset / radius, signed distance).
vec3 des_saguaro(vec2 q, float H, float seed) {
  float r = H * 0.072;
  vec3 s = des_seg(q, vec2(0.0, -H * 0.3), vec2(0.0, H - r));
  vec3 d = vec3(s.xy / r, s.z - r);
  float ra = r * 0.8;
  d = des_smin(d, des_arm(q, H * (0.36 + 0.12 * hash11(seed + 1.0)), H * 0.18, H * (0.66 + 0.12 * hash11(seed + 2.0)), ra, H), r * 0.5);
  d = des_smin(d, des_arm(q, H * (0.26 + 0.14 * hash11(seed + 3.0)), -H * 0.16, H * (0.50 + 0.14 * hash11(seed + 4.0)), ra, H), r * 0.5);
  return d;
}

// Saguaro colour (premultiplied) and coverage: a ribbed sage-green body, lit round the side facing a
// high sun, a deep silhouette against a low one; a thin rim on the light side whose ribs catch it, a
// faint sky sheen on top, and a one-pixel glow of backlit spines.
vec4 des_cactus(vec2 p, vec2 b, float H, float seed, float rimK) {
  float px = des_px;
  vec3 s = des_saguaro(p - b, H, seed);
  float cov = smoothstep(px, -px, s.z);
  vec2 v = s.xy;
  float vl = length(v);
  vec2 n = v / max(vl, 1e-4);
  float ls = des_ls;
  float rPx = H * 0.072 / px;
  float ribs = cos(asin(clamp(v.x, -1.0, 1.0)) * 11.0 + seed) * smoothstep(0.95, 0.6, vl) * smoothstep(0.45, 0.15, abs(v.y)) * smoothstep(4.0, 10.0, rPx);
  float sv = max(v.x * ls, 0.0);
  float diff = clamp(0.55 + 0.60 * v.x * ls, 0.0, 1.0);
  // High sun: wraps round the facing side. Low sun / moon: a lit crescent on the side toward it.
  vec3 E = des_amb * (0.85 + 0.25 * v.y) + des_key * des_kI * (des_hi * diff * 0.75 + (1.0 - des_hi) * (smoothstep(0.45, 0.95, sv) * 0.55 + 0.05));
  vec3 col = mix(vec3(0.21, 0.34, 0.21), vec3(0.36, 0.50, 0.32), des_D) * E * (1.0 + (0.10 + 0.25 * sv + 0.45 * des_D) * ribs);
  float rim = pow(min(sv, 1.0), 4.0) * (0.7 + 0.3 * cos(asin(min(sv, 1.0)) * 11.0 + seed) * smoothstep(4.0, 10.0, rPx));
  col += des_rimC * rim * 0.75 * rimK * des_rim;
  col += des_amb * 0.14 * pow(max(v.y, 0.0), 4.0);
  float halo = exp(-max(s.z, 0.0) / (0.9 * px)) * (1.0 - cov) * pow(max(n.x * ls, 0.0), 2.0) * rimK * 0.45 * des_rim;
  return vec4(col * cov + des_rimC * halo, cov);
}

// Desert scrub (creosote, brittlebush) dotted over a dune face below its crest line h: small domed,
// knobbly clumps sitting on the sand, lit on top, with a soft shadow on the side away from the light.
// k = clumps per world unit (the face is foreshortened, so cells are flatter than wide).
vec3 des_scrub(vec3 col, vec2 p, float h, float k, float seed) {
  float d = h - p.y;
  vec2 g = vec2(p.x * k, d * k * 1.8);
  vec2 id = floor(g);
  float r = hash21(id + seed);
  if (r > 0.24 || d < 0.004) return col;
  vec2 c = (id + vec2(0.3 + 0.4 * hash21(id + seed + 1.7), 0.62)) / vec2(k, k * 1.8);
  float R = (0.10 + 0.14 * hash21(id + seed + 5.3)) / k * (0.8 + 4.0 * d);
  vec2 q = vec2(p.x - c.x, c.y - d);
  float px = des_px;
  float bump = R * (0.84 + 0.16 * sin(q.x / R * 5.0 + r * 40.0) * sin(q.x / R * 11.0 + r * 9.0));
  float sd = max(length(vec2(q.x, max(q.y, 0.0) * 1.35)) - bump, -q.y - R * 0.25);
  float cov = smoothstep(px, -px, sd);
  float sh = smoothstep(R * 1.3, R * 0.5, length(vec2(q.x + (des_lr * 2.0 - 1.0) * R * 1.1, (q.y + R * 0.2) * 3.2))) * (1.0 - cov);
  vec3 bc = mix(vec3(0.34, 0.26, 0.22), mix(vec3(0.42, 0.40, 0.26), vec3(0.46, 0.36, 0.24), step(0.5, fract(r * 13.0))), des_D);
  vec3 bush = bc * (des_amb * 0.75 + des_key * des_kI * (0.25 + 0.45 * des_hi) * smoothstep(-0.6, 1.0, q.y / R + q.x / R * (des_lr * 2.0 - 1.0) * 0.6));
  return mix(col * (1.0 - 0.35 * sh * (0.4 + 0.6 * des_kI)), bush, cov);
}

// A small camp in the dune hollow: an A-frame tent (canvas by day, glowing from inside at night) and a
// campfire that lights up from dusk, with a thin smoke wisp by day. Premultiplied colour + coverage,
// plus additive firelight in .rgb of glow (out). p = mid-dune layer coords.
vec4 des_camp(vec2 p, float h, float t, float lights, out vec3 glow) {
  float px = des_px;
  vec4 acc = vec4(0.0);
  vec3 fire = vec3(1.0, 0.55, 0.20);
  float fl = 0.80 + 0.20 * sin(t * 11.0) * sin(t * 7.3 + 1.0);
  // tent
  float tx = -0.372;
  vec2 q = p - vec2(tx, 0.1337);                 // des_h1(tx) - 0.003
  float hw = 0.019;
  float th = 0.021;
  float ax = abs(q.x - 0.002 * q.y / th);
  float e = max((ax * th + q.y * hw - th * hw) * inversesqrt(th * th + hw * hw), -q.y);
  float cov = smoothstep(px, -px, e);
  float door = smoothstep(px, -px, max((ax * th + q.y * hw * 0.34 - th * hw * 0.34 * 0.62) * inversesqrt(th * th + hw * hw * 0.12), -q.y));
  float lit = smoothstep(-0.004, 0.004, q.x * (des_lr * 2.0 - 1.0));
  vec3 canvas = vec3(0.86, 0.78, 0.62) * (0.45 + 0.55 * des_D) * (des_amb * (0.25 + 0.35 * des_D) + des_key * des_kI * (0.25 + 0.5 * lit) * (0.4 + 0.6 * des_hi + 0.5 * (1.0 - des_hi) * lit));
  canvas += fire * lights * (0.10 + 0.25 * smoothstep(0.0, hw, q.x)) * fl;
  vec3 dcol = mix(vec3(0.05, 0.04, 0.04), fire * 1.3 * fl, lights);
  vec3 tc = mix(canvas, dcol, door);
  acc = vec4(tc * cov, cov);
  // fire: a tiny flickering flame on a ring of stones, and its light
  float fx = tx + 0.036;
  vec2 f = p - vec2(fx, h - 0.0015);
  float fh = 0.0085 * fl;
  float w = 0.0030 * sqrt(max(1.0 - f.y / fh, 0.0)) * smoothstep(-0.0015, 0.0015, f.y);
  float flame = smoothstep(px, -px, abs(f.x + 0.0007 * sin(t * 9.0 + f.y * 700.0)) - w) * step(f.y, fh) * lights;
  float stones = smoothstep(px, -px, length(vec2(f.x, (f.y + 0.0005) * 2.2)) - 0.0055) * step(f.y, 0.0005);
  vec3 fc = mix(fire, vec3(1.0, 0.92, 0.6), smoothstep(fh * 0.7, 0.0, f.y) * smoothstep(w, 0.0, abs(f.x)));
  acc.rgb = acc.rgb * (1.0 - stones) + vec3(0.07, 0.05, 0.05) * (des_amb + fire * lights * 0.8) * stones;
  acc.a = max(acc.a, stones);
  acc.rgb = mix(acc.rgb, fc * 2.2, flame);
  acc.a = max(acc.a, flame);
  // smoke: a thin wisp leaning downwind, grey by day, lit warm from below at night
  float sy = f.y;
  if (sy > 0.0 && sy < 0.12) {
    float sway = sin(sy * 60.0 - t * 0.8) * 0.004 * smoothstep(0.0, 0.04, sy) + sy * sy * 3.0;
    float sw = 0.0012 + sy * 0.07;
    float sm = exp(-pow((f.x - sway) / sw, 2.0)) * exp(-sy / 0.045) * smoothstep(0.004, 0.012, sy) * 0.30 * (1.0 - acc.a);
    acc.rgb += sm * (des_amb * 0.9 + des_key * des_kI * 0.35 + fire * lights * exp(-sy / 0.008) * 0.3) * (1.0 - 0.6 * lights);
    acc.a += sm;
  }
  glow = fire * lights * fl * (exp(-length(f * vec2(1.0, 1.6)) / 0.008) * 0.30 + exp(-length(f * vec2(1.0, 2.2)) / 0.020) * 0.12);
  return acc;
}

vec3 scene_desert(vec2 uv, vec3 sky) {
  float t = u_time;
  float aa = sc_aa();
  des_px = 1.0 / u_res.y;
  float en = clamp(u_energy, 0.0, 1.0);
  float asp = sc_aspect();
  des_gap = 0.405 * asp;

  // ---- lighting for this moment (shared by every layer)
  float el = u_sunElev;
  des_D = u_day;
  des_G = clamp(u_golden, 0.0, 1.0);
  des_N = sc_nightVis();
  des_sunW = vec2((u_sun.x - 0.5) * asp, u_sun.y);
  vec2 moonW = vec2(0.30 * asp, 0.70);
  float ws = smoothstep(-0.22, -0.02, el);
  des_sun = mix(moonW, des_sunW, ws);
  des_kI = mix(0.95 * des_N, smoothstep(-0.10, 0.02, el), ws);
  des_hi = mix(0.28, smoothstep(0.06, 0.70, el), ws);
  des_rim = mix(0.55, 1.0 - 0.75 * smoothstep(0.10, 0.55, el), ws);
  des_lr = clamp(0.5 + des_sun.x * 0.9, 0.0, 1.0);
  des_ls = clamp(des_sun.x * 3.0, -1.0, 1.0);
  des_gc = smoothstep(-0.45, -0.08, el);
  des_gI = mix(0.55, 1.25, des_G) * (1.0 - des_D * (1.0 - des_G));
  // Key: violet-silver moonlight · hot white sun · molten orange at sunset (rosier gold at sunrise).
  vec3 kN = mix(vec3(0.72, 0.74, 1.0), des_amber(), 0.45) * 1.05;
  vec3 kG = mix(mix(vec3(1.0, 0.44, 0.14), des_amber(), 0.30) * 1.95, vec3(1.0, 0.60, 0.46) * 1.7, u_dawn * 0.55);
  des_key = mix(mix(kN, vec3(1.0, 0.92, 0.78) * 1.3, des_D), kG, des_G);
  // Fill: the palette's violet night · deep desert-sky blue by day · rose-violet (lavender at dawn).
  vec3 aG = mix(vec3(0.48, 0.28, 0.46), vec3(0.42, 0.36, 0.60), u_dawn * 0.7);
  des_amb = mix(mix(des_skyL(), vec3(0.24, 0.36, 0.66), des_D), mix(des_skyL() * 1.2, aG, 0.6), des_G * 0.75);
  des_rimC = mix(mix(u_a0, vec3(1.0, 0.9, 0.75), 0.3), vec3(0.80, 0.80, 1.0), des_N * 0.35);

  vec2 pF = sc_world(uv, 0.1);
  // Smooth the faint aurora's fine vertical striations into a soft glow (they read as streaks over the
  // desert sky); only at night, when there is aurora. Offsets in world units (same on every aspect).
  vec3 t0 = des_tex(uv);
  vec3 base = t0;
  if (des_D < 0.98) {
    vec2 o1 = vec2(0.012 / asp, 0.0);
    vec2 o2 = vec2(0.030 / asp, 0.0);
    vec3 tb = t0 + des_tex(uv + o1) + des_tex(uv - o1) + des_tex(uv + o2) + des_tex(uv - o2);
    base = mix(t0, tb * 0.2, 0.9 * (1.0 - des_D));
  }
  // Theme grade (night and twilight): keep the sky's brightness but steer its hue along a designed
  // gradient (rose above the amber band, mauve, a deep violet zenith) so every palette reads clean.
  float sx = exp(-abs(pF.x - des_sunW.x) * 1.4) * des_gc;
  vec3 tint = mix(mix(u_a1, des_amber() + vec3(0.0, 0.10, 0.05), des_G * sx * 0.7), u_a2, smoothstep(0.26, 0.55, uv.y) - 0.25 * sx);
  tint = mix(tint, vec3(0.34, 0.26, 0.70) + u_c3, smoothstep(0.50, 0.95, uv.y));
  base = mix(base, tint * (sc_luma(base) / max(sc_luma(tint), 0.01)), 0.75 * (1.0 - des_D) * smoothstep(0.22, 0.34, uv.y));
  vec3 skyG = base + (sky - t0) + des_glow(pF, 1.0);
  // Golden hour: saturate the lower sky toward molten orange round the sun (rosier at sunrise).
  skyG *= mix(vec3(1.0), mix(vec3(1.20, 0.84, 0.62), vec3(1.12, 0.84, 0.90), u_dawn), des_G * exp(-max(pF.y - des_HZ, 0.0) / 0.24) * (0.45 + 0.55 * sx));

  // Designed sky: a rosy twilight belt, the evening star, a crescent moon and the Milky Way at night,
  // soaring birds by day.
  if (pF.y > 0.27) {
    skyG += mix(u_a1, u_a2, 0.45) * 0.030 * exp(-pow((pF.y - 0.40) / 0.11, 2.0)) * (0.6 + 0.4 * en) * (1.0 - des_D);
    vec2 vp = vec2(des_gap - 0.26, 0.47);
    float vd = length(pF - vp);
    skyG += vec3(1.0, 0.95, 0.86) * (smoothstep(2.2 * des_px, 0.3 * des_px, vd) * 0.9 + exp(-vd / 0.005) * 0.10 + exp(-vd / 0.02) * 0.03) * (1.0 - smoothstep(0.08, 0.40, des_D));
    if (des_N > 0.01) {
      // Crescent moon, lit from below-right (the long-set sun), earthshine on the dark limb.
      vec2 mq = pF - moonW;
      float md = length(mq);
      float mr = 0.022;
      if (md < 0.2) {
        float disc = smoothstep(mr + des_px, mr - des_px, md);
        float lit = smoothstep(-des_px, des_px, length(mq - vec2(-0.30, 0.20) * mr) - mr * 0.96);
        float mar = 0.88 + 0.12 * vnoise(mq / mr * 2.6 + 4.0);
        vec3 mc = mix(vec3(1.0, 0.95, 0.86), u_a1, 0.12);
        skyG += (mc * disc * (0.05 + 1.1 * lit * mar) + mc * exp(-max(md - mr, 0.0) / 0.03) * 0.10) * des_N;
      }
      // Now and then a meteor streaks down one side of the sky (~0.8 s, at most one every 9 s).
      float mi = floor(t / 9.0);
      float mf = t - mi * 9.0;
      if (mf < 0.8 && hash11(mi * 1.73) > 0.4) {
        float msd = hash11(mi * 5.3) > 0.5 ? 1.0 : -1.0;
        vec2 mdir = normalize(vec2(-msd, -0.55));
        vec2 mo = pF - vec2(msd * (0.38 + 0.45 * hash11(mi * 7.1)), 0.66 + 0.26 * hash11(mi * 3.9)) - mdir * mf * 0.30;
        float mal = dot(mo, mdir);
        float ms = smoothstep(1.3 * des_px, 0.2 * des_px, abs(dot(mo, vec2(-mdir.y, mdir.x)))) * smoothstep(-0.11, 0.0, mal) * step(mal, 0.0) * (1.0 + mal / 0.11);
        skyG += vec3(0.90, 0.93, 1.0) * ms * sin(mf * 3.927) * des_N * 1.2;
      }
      vec2 o = pF - vec2(-0.55, 0.62);
      float al = dot(o, vec2(0.80, 0.60));
      float ac = dot(o, vec2(-0.60, 0.80)) + 0.03 * sin(al * 3.1 + 1.0);
      float wb = 0.08 + 0.03 * al;
      float band = exp(-ac * ac / (wb * wb)) * smoothstep(0.30, 0.52, pF.y) * smoothstep(0.20, 0.46, length(pF - vec2(0.0, 0.54))) * des_N;
      if (band > 0.01) {
        float n = vnoise(vec2(al * 8.0, ac * 14.0) + 3.0);
        float n2 = vnoise(vec2(al * 21.0, ac * 30.0) + 11.0);
        float dust = smoothstep(0.35, 0.72, n * 0.6 + n2 * 0.4) * exp(-pow((ac - 0.01) / (wb * 0.45), 2.0));
        float glow = band * (0.5 + 0.5 * n) * (1.0 - 0.8 * dust);
        skyG += mix(vec3(0.80, 0.78, 0.95), u_a2, 0.25) * glow * 0.075 * (0.7 + 0.3 * en);
        vec2 g = pF * 190.0;
        vec2 id = floor(g);
        if (hash21(id + 71.0) < glow * 0.26) {
          float sd = length(fract(g) - 0.25 - 0.5 * hash22(id + 5.0));
          skyG += vec3(0.95, 0.92, 1.0) * smoothstep(0.22, 0.02, sd) * (0.06 + 0.7 * pow(hash21(id + 9.0), 3.0));
        }
      }
    }
    if (pF.y > 0.45 && pF.x < -0.2) {
      float bv = 1.0 - des_N;
      if (bv > 0.01) {
        float bc = des_birds(pF, t);
        skyG = mix(skyG, des_amb * 0.25 + des_key * 0.04, bc * bv * 0.9);
      }
    }
  }

  float rise = smoothstep(0.22, 0.7, des_D);
  if (rise > 0.001 && pF.x < -0.35 && pF.x > -0.53) {
    vec4 bl = des_balloon(pF, t, 0.12 + 0.625 * sqrt(rise));
    skyG = skyG * (1.0 - bl.a) + bl.rgb;
  }

  // Crepuscular rays fanning up from the sun near the horizon, drifting very slowly.
  vec2 rv = pF - des_sunW;
  float rd = length(rv);
  if (des_G > 0.01 && rd < 0.55 && rv.y > -0.02) {
    float ang = atan(rv.y, rv.x);
    float ray = sc_n1(ang * 7.0 + 3.0 + t * 0.012) * (0.6 + 0.4 * sc_n1(ang * 17.0 - t * 0.017 + 7.0));
    ray = smoothstep(0.15, 0.75, ray);
    skyG += mix(u_a0, u_a1, 0.5) * ray * exp(-rd / 0.17) * smoothstep(0.035, 0.09, rd)
          * smoothstep(-0.02, 0.03, rv.y) * 0.10 * (0.6 + 0.4 * en) * u_intensity * des_G;
  }
  if (des_G > 0.01 && abs(pF.y - 0.285) < 0.035 && abs(rv.x) < 0.5) {
    vec4 cl = des_clouds(pF, t);
    skyG = skyG * (1.0 - cl.a) + cl.rgb;
  }
  if (uv.y > 0.47) return skyG;

  // Haze: the palette's dusk haze at night / twilight, the real pale horizon sky (plus dust) by day.
  vec3 hz = des_glow(vec2(pF.x, max(pF.y, des_HZ)), 0.12) * 0.55;
  hz += mix(mix(u_c3, u_c1, 0.5) * 0.22, mix(des_tex(vec2(uv.x, des_HZ + 0.03)), vec3(0.90, 0.72, 0.56), 0.42) * 0.95, des_D);
  // Low sun: light scattered in the dusty air veils the terrain on the sun side.
  vec3 ins = mix(des_amber(), vec3(1.0, 0.78, 0.50), 0.4) * des_G * des_gc * exp(-length(rv * vec2(0.55, 1.0)) / 0.30) * 0.30;

  vec3 acc = vec3(0.0);
  float rem = 1.0;
  float cov;
  vec3 col;

  // ---- foreground dune + big saguaro (depth 1.0)
  vec2 p2 = sc_world(uv, 1.0);
  float h2 = des_h2(p2.x);
  float cx = max(-0.76, -0.5 * asp + 0.10);
  if (abs(p2.x - cx) < 0.08 && p2.y < 0.36) {
    vec4 cc = des_cactus(p2, vec2(cx, des_h2(cx) - 0.012), 0.27, 3.0, 0.6);
    float clip = smoothstep(h2 - 0.012 - aa, h2 - 0.012 + aa, p2.y);
    acc += rem * cc.rgb * clip;
    rem *= 1.0 - cc.a * clip;
  }
  cov = sc_below(p2.y, h2);
  if (cov > 0.0) {
    col = des_sand(p2, h2, 1.3, 0.35, 95.0, 0.32, 0.03, hz) * mix(0.60, 0.66, des_D);
    acc += rem * cov * col;
    rem *= 1.0 - cov;
    if (rem < 0.004) return acc + ins;
  }

  // ---- mid dunes + two smaller saguaros (depth 0.72)
  vec2 p1 = sc_world(uv, 0.72);
  if (p1.y < 0.30) {
    float h1 = des_h1(p1.x);
    if (abs(p1.x + 0.345) < 0.075) {
      vec3 fg;
      vec4 cp = des_camp(p1, h1, t, sc_lights(), fg);
      float clipc = smoothstep(h1 - 0.004 - aa, h1 - 0.004 + aa, p1.y);
      acc += rem * (cp.rgb * clipc + fg);
      rem *= 1.0 - cp.a * clipc;
    }
    if (abs(p1.x + 0.535) < 0.09) {
      float big = step(p1.x, -0.535);
      float cx1 = mix(-0.47, -0.60, big);
      float cH = mix(0.068, 0.105, big);
      vec4 c1 = des_cactus(p1, vec2(cx1, mix(0.1513, 0.1746, big)), cH, mix(11.0, 7.0, big), 0.75);   // des_h1(cx1) - sink
      float clip1 = smoothstep(h1 - 0.006 - aa, h1 - 0.006 + aa, p1.y);
      acc += rem * c1.rgb * clip1;
      rem *= 1.0 - c1.a * clip1;
    }
    cov = sc_below(p1.y, h1);
    if (cov > 0.0) {
      col = des_scrub(des_sand(p1, h1, 2.1, 1.7, 140.0, 0.22, 0.14, hz) * mix(0.76, 0.85, des_D), p1, h1, 26.0, 3.0);
      acc += rem * cov * col;
      rem *= 1.0 - cov;
      if (rem < 0.004) return acc + ins;
    }
  }

  // ---- rock layers: near mesas (depth 0.5) and mid mesas and buttes (depth 0.3). Only the frontmost
  // rock layer at a pixel gets the full rock shading (one call keeps the program small); where a near
  // edge's anti-aliasing fringe overlaps a mid mesa, that 1-2 px sliver uses the mid layer's flat tone.
  vec2 pn = sc_world(uv, 0.5);
  vec2 pm = sc_world(uv, 0.3);
  vec3 infoN = vec3(0.0, 0.1, 0.1);
  vec3 infoM = infoN;
  vec2 hn = vec2(0.0);
  vec2 hm = vec2(0.0);
  float covN = 0.0;
  float covM = 0.0;
  if (pn.y < 0.45) {
    hn = des_nearH(pn.x, infoN);
    covN = smoothstep(aa, -aa, (pn.y - hn.x) * inversesqrt(1.0 + hn.y * hn.y));
  }
  if (pm.y < 0.38 && covN < 0.999) {
    hm = des_midH(pm.x, infoM);
    covM = smoothstep(aa, -aa, (pm.y - hm.x) * inversesqrt(1.0 + hm.y * hm.y));
  }
  vec3 rock = vec3(0.0);
  if (covN + covM > 0.0) {
    bool nh = covN > 0.0;
    rock = des_rock(nh ? pn : pm, nh ? hn : hm, nh ? infoN : infoM, nh ? 0.128 : 0.198, nh ? 24.0 : 34.0, nh ? 1.0 : 1.6,
                    nh ? 0.10 : 0.34 - 0.12 * des_G - 0.14 * des_D, nh ? mix(0.62, 0.90, max(des_D, des_G)) : 1.0, hz);
  }
  if (covN > 0.0) {
    acc += rem * covN * rock;
    rem *= 1.0 - covN;
    if (rem < 0.004) return acc + ins;
  }

  // ---- distant low dune field on the valley floor (depth 0.42)
  vec2 p0 = sc_world(uv, 0.42);
  if (p0.y < 0.21) {
    float h0 = 0.163 + 0.012 * smoothstep(0.1, 0.7, abs(p0.x)) + des_dune(p0.x, 3.4, 4.3, 0.017);
    cov = sc_below(p0.y, h0);
    if (cov > 0.0) {
      col = des_scrub(des_sandF(p0, h0, 0.34 - 0.20 * des_D, hz) * mix(0.88, 0.95, des_D), p0, h0, 60.0, 9.0);
      acc += rem * cov * col;
      rem *= 1.0 - cov;
      if (rem < 0.004) return acc + ins;
    }
  }

  // ---- a dust devil spinning up now and then on hot afternoons (between the valley dunes and mesas)
  float dv = des_D * (1.0 - des_G) * smoothstep(0.2, 0.8, sin(t * 0.045));
  if (dv > 0.01 && p0.y > 0.17 && p0.y < 0.29) {
    vec4 dd = des_devil(p0, t) * dv;
    acc += rem * dd.rgb;
    rem *= 1.0 - dd.a;
  }

  // ---- mid mesas and buttes (depth 0.3)
  if (covM > 0.0) {
    col = covN > 0.0 ? mix(vec3(0.74, 0.36, 0.22) * (des_amb * 0.6 + des_key * des_kI * (0.12 + 0.3 * des_hi)), hz, 0.34) : rock;
    acc += rem * covM * col;
    rem *= 1.0 - covM;
    if (rem < 0.004) return acc + ins;
  }

  // ---- far plateaus on the horizon (depth 0.1), with a heat-shimmer mirage along the floor
  if (pF.y < 0.30) {
    float shm = smoothstep(des_HZ + 0.012, des_HZ + 0.002, pF.y) * smoothstep(des_HZ - 0.03, des_HZ - 0.005, pF.y);
    vec2 pW = vec2(pF.x + shm * (0.0008 + 0.0014 * des_D) * sin(pF.y * 260.0 - t * 1.3 + 5.0 * sc_n1(pF.x * 6.0 + t * 0.12)), pF.y);
    vec2 hf = des_farH(pW.x);
    cov = smoothstep(aa, -aa, (pW.y - hf.x) * inversesqrt(1.0 + hf.y * hf.y));
    if (cov > 0.0) {
      float fny = inversesqrt(1.0 + hf.y * hf.y);
      float df = max(hf.x - pW.y, 0.0) * fny;
      float nr = mix(0.25, exp(-abs(pW.x - des_sunW.x) * 2.0), des_gc);
      // Plateaus melt into the haze; below the horizon the valley floor warms toward sunlit sand,
      // streaked by distant dune rows.
      float fl = smoothstep(des_HZ - 0.002, des_HZ - 0.035, pW.y);
      vec3 farN = mix(u_c2, u_c3, 0.5) * 0.3;
      vec3 farD = mix(vec3(0.66, 0.42, 0.36), vec3(0.90, 0.54, 0.30) * (0.9 + 0.1 * sin(pW.y * 700.0 + 6.0 * sc_n1(pW.x * 9.0))), fl)
                * (des_amb * 0.8 + des_key * des_kI * (0.12 + 0.30 * des_hi));
      col = mix(mix(farN, farD, des_D), hz, (0.62 - 0.12 * des_D) * (1.0 - 0.7 * fl * des_D));
      col += mix(u_a0, vec3(1.0, 0.9, 0.7), 0.4) * (exp(-df / (1.2 * des_px)) * 0.8 * (0.15 + 0.85 * fny) + exp(-df / 0.003) * 0.3 * fny * fny) * (0.06 + 1.1 * nr) * des_rim * (1.0 - 0.6 * des_D);
      // A road winding across the valley floor and a car crawling along it: a sun glint by day,
      // headlights from dusk, and a dust plume trailing behind it in the heat.
      float ry = des_HZ - 0.017 + 0.003 * sin(pW.x * 1.1 + 1.0);
      col *= 1.0 - 0.30 * des_D * smoothstep(1.3 * des_px, 0.4 * des_px, abs(pW.y - ry));
      vec2 cq = pW - vec2(mod(t * 0.011, 3.2) - 1.6, ry + 0.0012);
      float pl = exp(cq.x / 0.05) * step(cq.x, 0.0) * exp(-pow((cq.y - 0.0025) / (0.0015 - cq.x * 0.07), 2.0));
      col = mix(col, vec3(0.92, 0.74, 0.56) * (des_amb * 0.6 + des_key * des_kI * 0.5), pl * 0.55 * des_D);
      col += vec3(1.0, 0.86, 0.62) * (smoothstep(1.8 * des_px, 0.3 * des_px, length(cq)) * (1.6 * sc_lights() + 0.7 * des_D)
                                      + exp(-length(cq * vec2(0.35, 1.5)) / 0.004) * 0.22 * sc_lights());
      float mir = exp(-max(des_HZ - pW.y, 0.0) / 0.006) * smoothstep(des_HZ + 0.004, des_HZ - 0.002, pW.y);
      col += hz * mir * (0.35 + 0.35 * des_D) * (0.8 + 0.2 * sin(pW.y * 900.0 + t * 1.1));
      acc += rem * cov * col;
      rem *= 1.0 - cov;
    }
  }

  return acc + ins * (1.0 - rem) + rem * skyG;
}
`,
};
