/**
 * Pure scheduling rules, shared by the API (which enforces them) and the UI (which mirrors them).
 * Times are epoch milliseconds internally; "local" means the mentor's IANA timezone.
 */
import { formatInTimeZone, fromZonedTime, getTimezoneOffset } from 'date-fns-tz';

export const SNAP_MINUTES = 15;
export const MIN_MEETING_MINUTES = 15;
export const MAX_MEETING_MINUTES = 480;
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

export interface Interval {
  start: number;
  end: number;
}
export interface WeeklyBlock {
  weekday: number; // 0 = Sunday, in the mentor's timezone
  start_time: string; // 'HH:MM'
  end_time: string;
}

// ---------- meeting time rules ----------

export interface TimeIssue {
  path: 'startAt' | 'endAt';
  message: string;
}

/** End after start, 15–480 minutes long, both ends on 15-minute marks. */
export function meetingTimeIssues(startIso: string, endIso: string): TimeIssue[] {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const issues: TimeIssue[] = [];
  if (end <= start) {
    issues.push({ path: 'endAt', message: 'End must be after start' });
    return issues;
  }
  const minutes = (end - start) / MIN_MS;
  if (minutes < MIN_MEETING_MINUTES || minutes > MAX_MEETING_MINUTES) {
    issues.push({
      path: 'endAt',
      message: `Meetings must be ${MIN_MEETING_MINUTES}–${MAX_MEETING_MINUTES} minutes long`,
    });
  }
  const onGrid = (ms: number) => ms % (SNAP_MINUTES * MIN_MS) === 0;
  if (!onGrid(start))
    issues.push({ path: 'startAt', message: 'Start must be on a 15-minute mark' });
  if (!onGrid(end)) issues.push({ path: 'endAt', message: 'End must be on a 15-minute mark' });
  return issues;
}

// ---------- intervals ----------

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Sorts and merges overlapping or touching intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/** `base` minus `removals` (both already merged). */
export function subtractIntervals(base: Interval[], removals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const b of base) {
    let pieces: Interval[] = [{ ...b }];
    for (const r of removals) {
      if (r.end <= b.start || r.start >= b.end) continue;
      pieces = pieces.flatMap((p) => {
        if (r.end <= p.start || r.start >= p.end) return [p];
        const left = r.start > p.start ? [{ start: p.start, end: r.start }] : [];
        const right = r.end < p.end ? [{ start: r.end, end: p.end }] : [];
        return [...left, ...right];
      });
    }
    out.push(...pieces);
  }
  return out;
}

// ---------- weekly availability ----------

/** Calendar weekday (0 = Sunday) of a YYYY-MM-DD date. Independent of any timezone. */
const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const addDaysYmd = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Expands weekly blocks into UTC intervals within [fromMs, toMs).
 * Blocks are read in the mentor's timezone, so e.g. Monday 00:30 Colombo is Sunday 19:00 UTC.
 */
export function availabilityIntervals(
  blocks: WeeklyBlock[],
  timeZone: string,
  fromMs: number,
  toMs: number,
): Interval[] {
  if (!blocks.length || toMs <= fromMs) return [];
  // One extra local day on each side so blocks that straddle the range edges are not missed.
  let day = addDaysYmd(formatInTimeZone(fromMs, timeZone, 'yyyy-MM-dd'), -1);
  const lastDay = addDaysYmd(formatInTimeZone(toMs, timeZone, 'yyyy-MM-dd'), 1);
  const out: Interval[] = [];
  for (; day <= lastDay; day = addDaysYmd(day, 1)) {
    const weekday = weekdayOf(day);
    for (const b of blocks) {
      if (b.weekday !== weekday) continue;
      const start = fromZonedTime(`${day}T${b.start_time}:00`, timeZone).getTime();
      const end = fromZonedTime(`${day}T${b.end_time}:00`, timeZone).getTime();
      const clipped = { start: Math.max(start, fromMs), end: Math.min(end, toMs) };
      if (clipped.end > clipped.start) out.push(clipped);
    }
  }
  return mergeIntervals(out);
}

export type Violation = 'outside_availability' | 'time_off';

/** Soft rules: is the meeting inside the mentor's weekly hours, and clear of time off? */
export function scheduleViolations(opts: {
  blocks: WeeklyBlock[];
  timeOff: Interval[];
  timeZone: string;
  start: number;
  end: number;
}): Violation[] {
  const out: Violation[] = [];
  const windows = availabilityIntervals(opts.blocks, opts.timeZone, opts.start, opts.end);
  const covered = windows.some((w) => w.start <= opts.start && w.end >= opts.end);
  if (!covered) out.push('outside_availability');
  if (opts.timeOff.some((t) => overlaps(t, { start: opts.start, end: opts.end })))
    out.push('time_off');
  return out;
}

// ---------- free slots ----------

export interface Slot {
  start: string;
  end: string;
}

/**
 * Open slots = weekly hours - time off - scheduled meetings.
 * Slots start on `stepMinutes` marks of the mentor's local clock and never start before `notBefore`.
 */
export function computeFreeSlots(opts: {
  blocks: WeeklyBlock[];
  timeOff: Interval[];
  busy: Interval[];
  timeZone: string;
  from: number;
  to: number;
  durationMinutes: number;
  stepMinutes?: number;
  notBefore?: number;
  maxSlots?: number;
}): Slot[] {
  const step = (opts.stepMinutes ?? 30) * MIN_MS;
  const duration = opts.durationMinutes * MIN_MS;
  const maxSlots = opts.maxSlots ?? 1000;
  const from = Math.max(opts.from, opts.notBefore ?? opts.from);

  const windows = availabilityIntervals(opts.blocks, opts.timeZone, from, opts.to);
  const free = subtractIntervals(windows, mergeIntervals([...opts.timeOff, ...opts.busy]));

  const slots: Slot[] = [];
  for (const f of free) {
    // First slot starts on a clock mark of the mentor's local time. Steps that divide an hour
    // (15/30/60) align to themselves; longer or odd steps just start on the next 15-minute mark,
    // so a 09:00 opening is not wasted on e.g. a 2-hour step. (Offsets are multiples of 15 min.)
    const align = [15, 30, 60].includes(opts.stepMinutes ?? 30) ? step : SNAP_MINUTES * MIN_MS;
    const offset = getTimezoneOffset(opts.timeZone, new Date(f.start));
    let s = Math.ceil((f.start + offset) / align) * align - offset;
    for (; s + duration <= f.end; s += step) {
      slots.push({ start: new Date(s).toISOString(), end: new Date(s + duration).toISOString() });
      if (slots.length >= maxSlots) return slots;
    }
  }
  return slots;
}
