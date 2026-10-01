// Time of day for the scenery: where the sun is, how much daylight there is, and how golden the
// light is. "auto" follows the local clock with seasonal sunrise/sunset (mid-northern latitude,
// solar noon from the time zone's DST); the other modes pin a representative moment.

export const TOD_MODES = ['auto', 'dawn', 'day', 'dusk', 'night'];

const LATITUDE = 40; // degrees; a reasonable default without asking for location
const DEG = Math.PI / 180;

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function isDst(d) {
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
  return d.getTimezoneOffset() < Math.max(jan, jul);
}

/** Approximate local sunrise / solar noon / sunset (hours) for a date. */
export function sunTimes(d = new Date()) {
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear(d))) / 365) * DEG;
  const cosH = -Math.tan(LATITUDE * DEG) * Math.tan(decl);
  const halfDay = (Math.acos(Math.min(1, Math.max(-1, cosH))) / DEG) / 15; // hours
  const noon = 12 + (isDst(d) ? 1 : 0) + 0.25; // a little past the hour, as in most zones
  return { sunrise: noon - halfDay, noon, sunset: noon + halfDay, halfDay };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Lighting state for an hour of the day.
 * @returns {{ hour:number, elevation:number, day:number, golden:number, dawn:boolean, sun:[number, number], label:string }}
 *   elevation: -1 (deep night) .. 0 (horizon) .. 1 (noon); day: 0 night .. 1 full daylight;
 *   golden: warm sunrise/sunset light (0..1); sun: screen uv of the sun disc (y may be off-screen).
 */
export function lightAt(hour, times = sunTimes()) {
  const { noon, halfDay } = times;
  let dh = hour - noon;
  if (dh > 12) dh -= 24;
  if (dh < -12) dh += 24;
  const t = dh / halfDay; // -1 sunrise .. 0 noon .. 1 sunset
  let elevation;
  if (Math.abs(t) <= 1) elevation = Math.cos((t * Math.PI) / 2);
  else elevation = -Math.min(1, ((Math.abs(t) - 1) * halfDay) / 3); // ~3 h to deep night
  const day = smooth(-0.1, 0.32, elevation);
  const golden = Math.exp(-Math.pow((elevation - 0.03) / 0.13, 2));
  // Sun path: rises bottom-left, arcs over (off the top of the screen at noon), sets bottom-right.
  const tc = clamp(t, -1.1, 1.1);
  const sun = [0.5 + 0.42 * tc, 0.22 + 0.95 * elevation];
  let label = 'night';
  if (elevation > 0.3) label = 'day';
  else if (elevation > -0.12) label = t < 0 ? 'dawn' : 'dusk';
  return { hour, elevation, day, golden, dawn: t < 0, sun, label };
}

/** The hour to show for a mode ("auto" = now). */
export function hourFor(mode, now = new Date(), times = sunTimes(now)) {
  switch (mode) {
    case 'dawn': return times.sunrise + 0.35;
    case 'day': return times.noon - times.halfDay * 0.55;
    case 'dusk': return times.sunset - 0.3;
    case 'night': return (times.sunset + 4) % 24;
    default: return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }
}
