import { describe, expect, it } from 'vitest';
import {
  availabilityIntervals,
  computeFreeSlots,
  createMeetingSchema,
  mergeIntervals,
  meetingTimeIssues,
  overlaps,
  scheduleViolations,
  subtractIntervals,
  type WeeklyBlock,
} from './index';

const t = (iso: string) => Date.parse(iso);
const iv = (a: string, b: string) => ({ start: t(a), end: t(b) });
const iso = (ms: number) => new Date(ms).toISOString();
const blk = (weekday: number, start_time: string, end_time: string): WeeklyBlock => ({
  weekday,
  start_time,
  end_time,
});

// 2030-01-14 is a Monday.
const MON = '2030-01-14';
const COLOMBO = 'Asia/Colombo'; // UTC+05:30, no DST

describe('meetingTimeIssues', () => {
  const ok = (s: string, e: string) => meetingTimeIssues(s, e);
  it('accepts 15..480 minutes on 15-minute marks', () => {
    expect(ok('2030-01-14T04:00:00Z', '2030-01-14T04:15:00Z')).toEqual([]);
    expect(ok('2030-01-14T04:00:00Z', '2030-01-14T12:00:00Z')).toEqual([]);
  });
  it('rejects end <= start', () => {
    expect(ok('2030-01-14T04:00:00Z', '2030-01-14T04:00:00Z')[0]?.message).toMatch(/after start/);
    expect(ok('2030-01-14T05:00:00Z', '2030-01-14T04:00:00Z')[0]?.message).toMatch(/after start/);
  });
  it('rejects 14 and 481 minutes, accepts the boundaries', () => {
    expect(
      ok('2030-01-14T04:00:00Z', '2030-01-14T04:14:00Z').some((i) => /15–480/.test(i.message)),
    ).toBe(true);
    expect(
      ok('2030-01-14T04:00:00Z', '2030-01-14T12:01:00Z').some((i) => /15–480/.test(i.message)),
    ).toBe(true);
  });
  it('rejects times off the 15-minute grid (incl. seconds)', () => {
    expect(ok('2030-01-14T04:05:00Z', '2030-01-14T05:05:00Z').map((i) => i.path)).toContain(
      'startAt',
    );
    expect(ok('2030-01-14T04:00:00Z', '2030-01-14T05:10:00Z').map((i) => i.path)).toContain(
      'endAt',
    );
    expect(ok('2030-01-14T04:00:30Z', '2030-01-14T05:00:00Z').map((i) => i.path)).toContain(
      'startAt',
    );
  });
});

describe('createMeetingSchema', () => {
  const base = {
    mentorId: 'm',
    clientId: 'c',
    title: 'Intro',
    mode: 'online',
    startAt: '2030-01-14T10:00:00+05:30',
    endAt: '2030-01-14T11:00:00+05:30',
  };
  it('normalizes times to UTC and defaults force/logCall to false', () => {
    const m = createMeetingSchema.parse(base);
    expect(m.startAt).toBe('2030-01-14T04:30:00.000Z');
    expect(m).toMatchObject({ force: false, logCall: false, locationOrLink: null, agenda: null });
  });
  it('rejects bad times, modes and blank titles', () => {
    expect(createMeetingSchema.safeParse({ ...base, endAt: base.startAt }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, mode: 'carrier-pigeon' }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, title: ' ' }).success).toBe(false);
    expect(
      createMeetingSchema.safeParse({ ...base, startAt: '2030-01-14T10:07:00+05:30' }).success,
    ).toBe(false);
  });
});

describe('overlap / merge / subtract', () => {
  it('back-to-back intervals do not overlap; any shared minute does', () => {
    expect(
      overlaps(
        iv('2030-01-14T04:00:00Z', '2030-01-14T05:00:00Z'),
        iv('2030-01-14T05:00:00Z', '2030-01-14T06:00:00Z'),
      ),
    ).toBe(false);
    expect(
      overlaps(
        iv('2030-01-14T04:00:00Z', '2030-01-14T05:00:00Z'),
        iv('2030-01-14T04:59:00Z', '2030-01-14T06:00:00Z'),
      ),
    ).toBe(true);
    expect(
      overlaps(
        iv('2030-01-14T04:00:00Z', '2030-01-14T08:00:00Z'),
        iv('2030-01-14T05:00:00Z', '2030-01-14T06:00:00Z'),
      ),
    ).toBe(true);
  });
  it('merges overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        { start: 5, end: 8 },
        { start: 1, end: 3 },
        { start: 3, end: 4 },
        { start: 7, end: 10 },
      ]),
    ).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 10 },
    ]);
  });
  it('subtracts a middle chunk, an edge chunk, and several chunks', () => {
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 3, end: 5 }])).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 10 },
    ]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 0, end: 4 }])).toEqual([
      { start: 4, end: 10 },
    ]);
    expect(
      subtractIntervals(
        [{ start: 0, end: 10 }],
        [
          { start: 1, end: 2 },
          { start: 8, end: 12 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 8 },
    ]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: -5, end: 20 }])).toEqual([]);
  });
});

describe('availabilityIntervals', () => {
  it('reads blocks in the mentor timezone: Monday 09:00-12:00 Colombo = 03:30-06:30 UTC', () => {
    const r = availabilityIntervals(
      [blk(1, '09:00', '12:00')],
      COLOMBO,
      t(`${MON}T00:00:00Z`),
      t('2030-01-15T00:00:00Z'),
    );
    expect(r.map((x) => [iso(x.start), iso(x.end)])).toEqual([
      ['2030-01-14T03:30:00.000Z', '2030-01-14T06:30:00.000Z'],
    ]);
  });
  it('a Monday early-morning Colombo block falls on SUNDAY in UTC', () => {
    const r = availabilityIntervals(
      [blk(1, '00:30', '02:00')],
      COLOMBO,
      t('2030-01-13T00:00:00Z'),
      t('2030-01-15T00:00:00Z'),
    );
    expect(r.map((x) => iso(x.start))).toEqual(['2030-01-13T19:00:00.000Z']);
  });
  it('a Monday late-evening Colombo block is still Monday in UTC, an hour-ish earlier than midnight', () => {
    const r = availabilityIntervals(
      [blk(1, '22:00', '23:45')],
      COLOMBO,
      t('2030-01-13T00:00:00Z'),
      t('2030-01-16T00:00:00Z'),
    );
    expect(r.map((x) => [iso(x.start), iso(x.end)])).toEqual([
      ['2030-01-14T16:30:00.000Z', '2030-01-14T18:15:00.000Z'],
    ]);
  });
  it('clips to the requested range', () => {
    const r = availabilityIntervals(
      [blk(1, '09:00', '12:00')],
      COLOMBO,
      t(`${MON}T05:00:00Z`),
      t(`${MON}T09:00:00Z`),
    );
    expect(r.map((x) => [iso(x.start), iso(x.end)])).toEqual([
      ['2030-01-14T05:00:00.000Z', '2030-01-14T06:30:00.000Z'],
    ]);
  });
  it('handles a mentor in another timezone, including DST (New York)', () => {
    const blocks = [blk(1, '09:00', '10:00'), blk(0, '09:00', '10:00')];
    const r = availabilityIntervals(
      blocks,
      'America/New_York',
      t('2030-03-04T00:00:00Z'),
      t('2030-03-12T00:00:00Z'),
    );
    const starts = r.map((x) => iso(x.start));
    expect(starts).toContain('2030-03-04T14:00:00.000Z'); // Mon, EST (UTC-5)
    expect(starts).toContain('2030-03-10T13:00:00.000Z'); // Sun Mar 10: clocks jumped forward at 2am -> EDT (UTC-4)
    expect(starts).toContain('2030-03-11T13:00:00.000Z'); // Mon after DST
  });
  it('returns nothing for no blocks or an empty range', () => {
    expect(availabilityIntervals([], COLOMBO, 0, 1e12)).toEqual([]);
    expect(availabilityIntervals([blk(1, '09:00', '12:00')], COLOMBO, 5, 5)).toEqual([]);
  });
});

describe('scheduleViolations', () => {
  const blocks = [blk(1, '09:00', '12:00'), blk(1, '14:00', '17:00')];
  const check = (s: string, e: string, timeOff: ReturnType<typeof iv>[] = []) =>
    scheduleViolations({ blocks, timeOff, timeZone: COLOMBO, start: t(s), end: t(e) });
  it('inside one block: fine', () =>
    expect(check('2030-01-14T10:00:00+05:30', '2030-01-14T11:00:00+05:30')).toEqual([]));
  it('exactly filling a block: fine', () =>
    expect(check('2030-01-14T09:00:00+05:30', '2030-01-14T12:00:00+05:30')).toEqual([]));
  it('sticking out by 15 minutes: outside', () =>
    expect(check('2030-01-14T11:30:00+05:30', '2030-01-14T12:15:00+05:30')).toEqual([
      'outside_availability',
    ]));
  it('spanning the lunch gap: outside', () =>
    expect(check('2030-01-14T11:00:00+05:30', '2030-01-14T15:00:00+05:30')).toEqual([
      'outside_availability',
    ]));
  it('a different weekday: outside', () =>
    expect(check('2030-01-15T10:00:00+05:30', '2030-01-15T11:00:00+05:30')).toEqual([
      'outside_availability',
    ]));
  it('no weekly hours at all: outside', () =>
    expect(
      scheduleViolations({
        blocks: [],
        timeOff: [],
        timeZone: COLOMBO,
        start: t('2030-01-14T05:00:00Z'),
        end: t('2030-01-14T06:00:00Z'),
      }),
    ).toEqual(['outside_availability']));
  it('overlapping time off: time_off (even if inside hours)', () =>
    expect(
      check('2030-01-14T10:00:00+05:30', '2030-01-14T11:00:00+05:30', [
        iv('2030-01-14T10:30:00+05:30', '2030-01-14T13:00:00+05:30'),
      ]),
    ).toEqual(['time_off']));
  it('time off that only touches the end: fine', () =>
    expect(
      check('2030-01-14T10:00:00+05:30', '2030-01-14T11:00:00+05:30', [
        iv('2030-01-14T11:00:00+05:30', '2030-01-14T13:00:00+05:30'),
      ]),
    ).toEqual([]));
  it('can report both', () =>
    expect(
      check('2030-01-14T12:00:00+05:30', '2030-01-14T13:00:00+05:30', [
        iv('2030-01-14T12:30:00+05:30', '2030-01-14T13:30:00+05:30'),
      ]),
    ).toEqual(['outside_availability', 'time_off']));
});

describe('computeFreeSlots', () => {
  const base = {
    blocks: [blk(1, '09:00', '12:00')],
    timeOff: [],
    busy: [],
    timeZone: COLOMBO,
    from: t(`${MON}T00:00:00+05:30`),
    to: t(`${MON}T23:59:59+05:30`),
    durationMinutes: 60,
  };
  const starts = (opts: Partial<Parameters<typeof computeFreeSlots>[0]>) =>
    computeFreeSlots({ ...base, ...opts }).map((s) =>
      iso(Date.parse(s.start) + 5.5 * 3_600_000).slice(11, 16),
    ); // Colombo wall clock

  it('lists 60-minute slots every 30 minutes inside the hours', () => {
    expect(starts({})).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });
  it('honours the step and the duration', () => {
    expect(starts({ stepMinutes: 60 })).toEqual(['09:00', '10:00', '11:00']);
    expect(starts({ durationMinutes: 120, stepMinutes: 60 })).toEqual(['09:00', '10:00']);
    expect(starts({ durationMinutes: 15, stepMinutes: 15 }).length).toBe(12);
    // Long/odd steps start at the opening time instead of the next even clock mark.
    expect(starts({ stepMinutes: 120 })).toEqual(['09:00', '11:00']);
    expect(starts({ stepMinutes: 45 })).toEqual(['09:00', '09:45', '10:30']);
    expect(starts({ durationMinutes: 240 })).toEqual([]);
  });
  it('removes booked meetings; back-to-back slots stay available', () => {
    const busy = [iv('2030-01-14T10:00:00+05:30', '2030-01-14T11:00:00+05:30')];
    expect(starts({ busy })).toEqual(['09:00', '11:00']);
  });
  it('removes time off', () => {
    const timeOff = [iv('2030-01-14T09:00:00+05:30', '2030-01-14T10:30:00+05:30')];
    expect(starts({ timeOff })).toEqual(['10:30', '11:00']);
  });
  it('never offers slots that start before notBefore, and respects the step grid', () => {
    expect(starts({ notBefore: t('2030-01-14T09:40:00+05:30') })).toEqual([
      '10:00',
      '10:30',
      '11:00',
    ]);
  });
  it('keeps slots on the :00/:30 grid even after an odd-length meeting', () => {
    const busy = [iv('2030-01-14T09:00:00+05:30', '2030-01-14T09:15:00+05:30')];
    expect(starts({ busy })).toEqual(['09:30', '10:00', '10:30', '11:00']);
  });
  it('maxSlots caps the result', () => {
    expect(computeFreeSlots({ ...base, maxSlots: 2 })).toHaveLength(2);
  });
  it('finds a Monday 00:30-02:00 Colombo block when asked for Monday (Colombo day), though it lies on Sunday in UTC', () => {
    expect(starts({ blocks: [blk(1, '00:30', '02:00')], durationMinutes: 30 })).toEqual([
      '00:30',
      '01:00',
      '01:30',
    ]);
  });
  it('a Colombo-Monday query does not include the previous Colombo-Sunday late block', () => {
    const r = computeFreeSlots({
      ...base,
      blocks: [blk(0, '22:00', '23:45')],
      durationMinutes: 30,
    });
    expect(r).toEqual([]);
  });
  it('slots in a non-hour-offset timezone sit on the mentor local clock (Kathmandu +05:45)', () => {
    const slots = computeFreeSlots({
      ...base,
      blocks: [blk(1, '09:00', '10:00')],
      timeZone: 'Asia/Kathmandu',
      from: t('2030-01-14T00:00:00Z'),
      to: t('2030-01-15T00:00:00Z'),
      durationMinutes: 30,
    });
    expect(slots.map((s) => s.start)).toEqual([
      '2030-01-14T03:15:00.000Z',
      '2030-01-14T03:45:00.000Z',
    ]); // 09:00, 09:30 local
  });
});
