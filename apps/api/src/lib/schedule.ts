import type { AvailabilityBlock, Interval, WeeklyBlock } from '@calllog/shared';

export interface ScheduleData {
  blocks: Map<string, WeeklyBlock[]>;
  timeOff: Map<string, Interval[]>;
  /** Scheduled meetings only: those are what block a mentor's time. */
  busy: Map<string, Interval[]>;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Loads weekly hours, time off and booked meetings for several mentors in three queries. */
export async function loadSchedule(
  db: D1Database,
  mentorIds: string[],
  fromIso: string,
  toIso: string,
): Promise<ScheduleData> {
  const data: ScheduleData = { blocks: new Map(), timeOff: new Map(), busy: new Map() };
  if (!mentorIds.length) return data;
  const ids = placeholders(mentorIds.length);

  const [blocks, timeOff, busy] = await Promise.all([
    db
      .prepare(`SELECT * FROM mentor_availability WHERE mentor_id IN (${ids})`)
      .bind(...mentorIds)
      .all<AvailabilityBlock>(),
    db
      .prepare(
        `SELECT mentor_id, start_at, end_at FROM mentor_time_off
         WHERE mentor_id IN (${ids}) AND end_at > ? AND start_at < ?`,
      )
      .bind(...mentorIds, fromIso, toIso)
      .all<{ mentor_id: string; start_at: string; end_at: string }>(),
    db
      .prepare(
        `SELECT mentor_id, start_at, end_at FROM meetings
         WHERE mentor_id IN (${ids}) AND status = 'scheduled' AND end_at > ? AND start_at < ?`,
      )
      .bind(...mentorIds, fromIso, toIso)
      .all<{ mentor_id: string; start_at: string; end_at: string }>(),
  ]);

  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const b of blocks.results) push(data.blocks, b.mentor_id, b);
  for (const t of timeOff.results) {
    push(data.timeOff, t.mentor_id, { start: Date.parse(t.start_at), end: Date.parse(t.end_at) });
  }
  for (const m of busy.results) {
    push(data.busy, m.mentor_id, { start: Date.parse(m.start_at), end: Date.parse(m.end_at) });
  }
  return data;
}
