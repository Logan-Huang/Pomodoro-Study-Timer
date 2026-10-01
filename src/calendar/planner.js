// Pure scheduling helpers (no DOM). Times are epoch milliseconds.
const MIN = 60000;
const MIN_FOCUS = 10 * MIN;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 'study' when the title/description matches a keyword (at a word start) or carries a study marker. */
export function classifyEvent(event, keywords = []) {
  const title = String(event?.title ?? '');
  const head = title.trimStart();
  if (/\[focus\]/i.test(title) || head.startsWith('\u{1F4DA}') || head.startsWith('\u{1F345}')) return 'study';
  const hay = `${title}\n${event?.description ?? ''}`;
  for (const raw of keywords || []) {
    const kw = String(raw).trim();
    if (kw && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(kw)}`, 'iu').test(hay)) return 'study';
  }
  return 'busy';
}

/**
 * Fill [startMs, endMs) with focus/break cycles. Never starts or ends on a break; total equals the
 * window exactly. Windows under 10 minutes return [].
 *
 * Self-checks (focus 25, short 5, long 15, every 4):
 *   25 min  -> [Focus 1 25]
 *   60 min  -> [Focus 1 25, Short 5, Focus 2 30]            (5m leftover stretches the last focus)
 *   90 min  -> [Focus 1 25, Short 5, Focus 2 25, Short 5, Focus 3 30]
 *   45 min  -> [Focus 1 25, Short 5, Focus 2 15]            (a >=10m remainder becomes a shorter focus)
 *   8 min   -> []
 * In every case the durations sum to the window length.
 */
export function planBlock(startMs, endMs, opts = {}) {
  const total = Math.round(endMs - startMs);
  if (!(total >= MIN_FOCUS)) return [];
  const focus = Math.max(1, opts.focusMin ?? 25) * MIN;
  const short = Math.max(1, opts.shortBreakMin ?? 5) * MIN;
  const long = Math.max(1, opts.longBreakMin ?? 15) * MIN;
  const every = Math.max(1, Math.round(opts.longBreakEvery ?? 4));

  const segs = [];
  let rem = total;
  let count = 0;
  let afterFocus = false;
  while (rem > 0) {
    if (afterFocus) {
      const isLong = count % every === 0;
      const dur = isLong ? long : short;
      if (rem < dur + MIN_FOCUS) break; // not enough room for a break plus a meaningful focus
      segs.push({ phase: isLong ? 'long' : 'short', durationMs: dur, label: isLong ? 'Long break' : 'Short break' });
      rem -= dur;
      afterFocus = false;
    } else {
      const dur = Math.min(rem, focus);
      count += 1;
      segs.push({ phase: 'focus', durationMs: dur, label: `Focus ${count}` });
      rem -= dur;
      afterFocus = true;
    }
  }

  let left = total - segs.reduce((n, s) => n + s.durationMs, 0);
  if (left > 0) {
    const last = segs[segs.length - 1];
    const stretch = Math.min(left, Math.round(last.durationMs * 0.5));
    last.durationMs += stretch;
    left -= stretch;
    if (left > 0) {
      const breaks = segs.filter((s) => s.phase !== 'focus');
      if (!breaks.length) last.durationMs += left;
      else {
        const sum = breaks.reduce((n, s) => n + s.durationMs, 0);
        let given = 0;
        breaks.forEach((b, i) => {
          const g = i === breaks.length - 1 ? left - given : Math.round((left * b.durationMs) / sum);
          b.durationMs += g;
          given += g;
        });
      }
    }
  }
  return segs;
}

export function summarizePlan(segments = []) {
  let focusMs = 0;
  let breakMs = 0;
  let focusCount = 0;
  for (const s of segments) {
    if (s.phase === 'focus') { focusMs += s.durationMs; focusCount += 1; } else breakMs += s.durationMs;
  }
  return { focusMs, breakMs, focusCount, totalMs: focusMs + breakMs };
}

/**
 * Gaps between timed events inside [fromMs, toMs]. A gap qualifies when it is still at least minMs
 * long after reserving bufferMs at its end; the returned slot is the raw gap (callers plan to
 * slot.end - bufferMs).
 */
export function findFreeSlots(events, fromMs, toMs, { minMs = 20 * MIN, bufferMs = 5 * MIN } = {}) {
  const spans = (events || [])
    .filter((e) => !e.allDay && e.end > fromMs && e.start < toMs)
    .map((e) => [Math.max(e.start, fromMs), Math.min(e.end, toMs)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && span[0] <= prev[1]) prev[1] = Math.max(prev[1], span[1]);
    else merged.push([...span]);
  }
  const slots = [];
  const push = (start, end) => {
    if (end - start - bufferMs >= minMs) slots.push({ start, end });
  };
  let cursor = fromMs;
  for (const [s, e] of merged) {
    if (s > cursor) push(cursor, s);
    cursor = Math.max(cursor, e);
  }
  if (toMs > cursor) push(cursor, toMs);
  return slots;
}

/** What is happening around `now`. */
export function getNowContext(events, now = Date.now()) {
  const timed = (events || []).filter((e) => !e.allDay).sort((a, b) => a.start - b.start);
  const active = timed.filter((e) => e.start <= now && now < e.end);
  const current = active.find((e) => e.kind === 'study') || active[0] || null;
  const next = timed.find((e) => e.start > now) || null;
  return {
    current,
    next,
    freeUntil: !current && next ? next.start : null,
    minutesUntilNext: next ? Math.ceil((next.start - now) / MIN) : null,
  };
}
