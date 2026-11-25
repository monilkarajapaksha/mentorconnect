import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEETING_MODES,
  MEETING_STATUSES,
  createMentorSchema,
  createTimeOffSchema,
  isValidTimeZone,
  setAvailabilitySchema,
  updateMentorSchema,
} from './index';

const base = { name: 'Asha', email: 'Asha@Example.com' };

describe('migration 0003 stays in sync with shared constants', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../../apps/api/migrations/0003_mentors_meetings.sql'),
    'utf8',
  );
  it('meeting statuses', () => {
    expect(sql).toContain(`status IN (${MEETING_STATUSES.map((s) => `'${s}'`).join(', ')})`);
  });
  it('meeting modes', () => {
    expect(sql).toContain(`mode IN (${MEETING_MODES.map((s) => `'${s}'`).join(', ')})`);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimeZone('Asia/Colombo')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('createMentorSchema', () => {
  it('applies defaults and lowercases the email', () => {
    const m = createMentorSchema.parse(base);
    expect(m).toMatchObject({
      email: 'asha@example.com',
      timezone: 'Asia/Colombo',
      defaultMeetingMinutes: 60,
      expertise: [],
      phone: null,
      bio: null,
      isActive: true,
    });
    expect(m.color).toBeUndefined();
  });
  it('normalizes phone to E.164', () => {
    expect(createMentorSchema.parse({ ...base, phone: '077 123 4567' }).phone).toBe('+94771234567');
    expect(createMentorSchema.parse({ ...base, phone: '' }).phone).toBeNull();
    expect(createMentorSchema.safeParse({ ...base, phone: 'abc' }).success).toBe(false);
  });
  it('dedupes expertise tags case-insensitively and trims', () => {
    expect(
      createMentorSchema.parse({ ...base, expertise: [' Python ', 'python', 'SQL'] }).expertise,
    ).toEqual(['Python', 'SQL']);
  });
  it.each([
    ['bad color', { color: 'red' }],
    ['bad timezone', { timezone: 'Nowhere/Land' }],
    ['minutes not multiple of 15', { defaultMeetingMinutes: 50 }],
    ['minutes too small', { defaultMeetingMinutes: 0 }],
    ['minutes too large', { defaultMeetingMinutes: 495 }],
    ['bad email', { email: 'nope' }],
    ['blank name', { name: '  ' }],
  ])('rejects %s', (_label, patch) => {
    expect(createMentorSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe('updateMentorSchema', () => {
  it('does not inject defaults for absent fields (a PATCH must not overwrite them)', () => {
    expect(updateMentorSchema.parse({ name: 'New' })).toEqual({ name: 'New' });
  });
});

describe('setAvailabilitySchema', () => {
  const b = (weekday: number, startTime: string, endTime: string) => ({
    weekday,
    startTime,
    endTime,
  });
  it('allows several blocks per day, and touching blocks', () => {
    expect(
      setAvailabilitySchema.safeParse({ blocks: [b(1, '09:00', '12:00'), b(1, '14:00', '17:00')] })
        .success,
    ).toBe(true);
    expect(
      setAvailabilitySchema.safeParse({ blocks: [b(1, '09:00', '12:00'), b(1, '12:00', '13:00')] })
        .success,
    ).toBe(true);
  });
  it('rejects overlapping blocks on the same day only', () => {
    expect(
      setAvailabilitySchema.safeParse({ blocks: [b(1, '09:00', '12:00'), b(1, '11:00', '13:00')] })
        .success,
    ).toBe(false);
    expect(
      setAvailabilitySchema.safeParse({ blocks: [b(1, '09:00', '12:00'), b(2, '11:00', '13:00')] })
        .success,
    ).toBe(true);
  });
  it('rejects end <= start, bad times and bad weekdays', () => {
    for (const blocks of [
      [b(1, '12:00', '12:00')],
      [b(1, '13:00', '12:00')],
      [b(1, '9:00', '10:00')],
      [b(1, '24:00', '25:00')],
      [b(7, '09:00', '10:00')],
      [b(-1, '09:00', '10:00')],
    ]) {
      expect(setAvailabilitySchema.safeParse({ blocks }).success).toBe(false);
    }
  });
  it('accepts an empty schedule (clears it)', () => {
    expect(setAvailabilitySchema.safeParse({ blocks: [] }).success).toBe(true);
  });
});

describe('createTimeOffSchema', () => {
  it('normalizes to UTC and requires end after start', () => {
    const t = createTimeOffSchema.parse({
      startAt: '2030-01-15T10:00:00+05:30',
      endAt: '2030-01-15T12:00:00+05:30',
    });
    expect(t.startAt).toBe('2030-01-15T04:30:00.000Z');
    expect(
      createTimeOffSchema.safeParse({
        startAt: '2030-01-15T10:00:00Z',
        endAt: '2030-01-15T10:00:00Z',
      }).success,
    ).toBe(false);
    expect(createTimeOffSchema.safeParse({ startAt: 'tomorrow', endAt: 'later' }).success).toBe(
      false,
    );
  });
});
