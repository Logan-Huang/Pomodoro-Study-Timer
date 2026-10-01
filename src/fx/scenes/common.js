// Shared GLSL helpers for the nature scenery (prefix sc_). Spliced after the sky, before the scenes.
// Coordinates: uv is 0..1 with y up. sc_world() maps to "world" units where x is measured in screen
// heights from the centre, so shapes keep their proportions on any aspect ratio (phones show a crop).

export const COMMON_GLSL = `
// ------------------------------------------------------------------ scenery helpers (sc_*)
float sc_aspect() { return u_res.x / u_res.y; }

// Anti-aliasing width in uv.y units (~1.5 px at render resolution).
float sc_aa() { return 1.5 / u_res.y; }

// World coords: x in screen heights from centre, y = uv.y. depth 0 (far) .. 1 (near) adds pointer parallax.
vec2 sc_world(vec2 uv, float depth) {
  vec2 p = vec2((uv.x - 0.5) * sc_aspect(), uv.y);
  p.x += (u_mouse.x - 0.5) * 0.045 * depth;
  p.y += (u_mouse.y - 0.5) * 0.012 * depth;
  return p;
}

// 1 below the silhouette line h, 0 above; anti-aliased.
float sc_below(float y, float h) {
  float a = sc_aa();
  return smoothstep(h + a, h - a, y);
}

float sc_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// 1D value noise and fbm (for silhouettes).
float sc_n1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}
float sc_fbm1(float x) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * sc_n1(x);
    x = x * 2.07 + 17.3;
    a *= 0.5;
  }
  return v;
}

// Ridged 1D noise: sharp crests, good for alpine ranges. Roughly 0..1.
float sc_ridge1(float x) {
  float v = 0.0;
  float a = 0.55;
  float w = 1.0;
  for (int i = 0; i < 5; i++) {
    float n = 1.0 - abs(sc_n1(x) * 2.0 - 1.0);
    n *= n;
    v += a * n * w;
    w = clamp(n * 1.4, 0.0, 1.0);
    x = x * 2.13 + 31.7;
    a *= 0.5;
  }
  return v;
}

// Mountain range profile (~0..1) at world x. sharp: 0 = rolling hills .. 1 = jagged alpine.
float sc_range(float x, float seed, float sharp) {
  float r = sc_ridge1(x + seed * 13.1);
  float s = sc_fbm1(x * 0.7 + seed * 7.7);
  return mix(s, r, sharp);
}

// Conifer silhouettes: height of the tree line above its base at world x.
// density = trees per world unit, h = tallest tree height, seed varies the stand.
float sc_pines(float x, float density, float h, float seed) {
  float cell = floor(x * density);
  float best = 0.0;
  for (int k = -1; k <= 1; k++) {
    float c = cell + float(k);
    float r1 = hash11(c * 1.37 + seed * 91.1);
    float r2 = hash11(c * 7.13 + seed * 17.9);
    float cx = (c + 0.5 + (r1 - 0.5) * 0.7) / density;
    float th = h * mix(0.55, 1.0, r2);
    float w = th * 0.26;
    float d = abs(x - cx) / w;
    if (d < 1.0) {
      float u = 1.0 - d;
      float tiers = 5.0 + floor(r1 * 3.0);
      float saw = fract(u * tiers);
      best = max(best, th * (u - 0.22 * saw / tiers * (1.0 - u * 0.5)));
    }
    best = max(best, step(abs(x - cx), w * 0.05) * th * 0.12);
  }
  return best;
}

// Moon: lit disc with faint maria and a soft halo. p, c in world coords. Additive light.
vec3 sc_moon(vec2 p, vec2 c, float r, vec3 tint) {
  float d = length(p - c);
  float disc = smoothstep(r + sc_aa(), r - sc_aa(), d);
  float maria = 0.86 + 0.14 * vnoise((p - c) / r * 2.6 + 4.0);
  vec3 col = tint * disc * maria * 1.15;
  col += tint * exp(-max(d - r, 0.0) / (r * 2.2)) * 0.32 * (1.0 - disc);
  return col;
}

// Atmospheric perspective: blend towards haze with distance (amount 0..1).
vec3 sc_haze(vec3 col, vec3 hazeCol, float amount) {
  return mix(col, hazeCol, clamp(amount, 0.0, 1.0));
}

// ---------------------------------------------------------------- time of day (sc_*)
// u_day: 0 night .. 1 full daylight · u_golden: sunrise/sunset warmth · u_sunElev: -1..1 ·
// u_sun: sun position in screen uv (y > 1 = above the screen at midday) · u_dawn: 1 morning.

// Artificial lights (windows, lanterns, lamps, fireflies): full at night, off in bright day.
float sc_lights() { return 1.0 - smoothstep(0.2, 0.7, u_day); }

// Night-only sky objects (moons, milky way): fade out as the sky brightens.
float sc_nightVis() { return 1.0 - smoothstep(0.0, 0.3, u_day + u_golden * 0.35); }

// Key light colour: silver moonlight at night, warm gold at sunrise/sunset, bright sun by day.
vec3 sc_keyColor() {
  vec3 moon = mix(vec3(0.52, 0.60, 0.80), u_a1, 0.2) * 0.55;
  vec3 c = mix(moon, vec3(1.0, 0.95, 0.86) * 1.3, u_day);
  return mix(c, vec3(1.0, 0.60, 0.33) * 1.2, clamp(u_golden, 0.0, 1.0) * 0.85);
}

// Ambient sky fill: palette-dark at night, soft blue by day, rosy at sunrise/sunset.
vec3 sc_ambient() {
  vec3 night = mix(u_c1, u_c2, 0.5) * 0.8 + 0.015;
  vec3 c = mix(night, vec3(0.34, 0.44, 0.60), u_day);
  return mix(c, vec3(0.50, 0.34, 0.40), clamp(u_golden, 0.0, 1.0) * 0.6);
}

// Horizontal direction toward the day's key light: -1 = light from the left, +1 = from the right.
// (At night scenes usually light from their own moon position instead.)
float sc_sunSide(float x) { return clamp((u_sun.x - x) * 3.0, -1.0, 1.0); }

// Haze colour that matches the sky just above the horizon at screen x (uses the real sky).
vec3 sc_horizonHaze(float x, float horizonY) {
  return skyColor(vec2(x, horizonY + 0.03));
}
`;
