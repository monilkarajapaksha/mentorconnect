import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  ceilQuarter,
  colomboDate,
  colomboToIso,
  fromCal,
  toCal,
} from '../lib/calendar';
import { fromColomboInput, toColomboInput } from '../lib/time';

describe('Sri Lanka time shift used by the calendar', () => {
  it('toCal shows an instant as Colombo wall-clock time (in the UTC fields)', () => {
    expect(toCal('2030-01-14T04:30:00Z').toISOString()).toBe('2030-01-14T10:00:00.000Z');
  });
  it('fromCal is the exact inverse of toCal', () => {
    const iso = '2030-06-01T23:15:00.000Z';
    expect(fromCal(toCal(iso)).toISOString()).toBe(iso);
  });
  it('colomboDate crosses midnight at 18:30 UTC, not at 00:00 UTC', () => {
    expect(colomboDate('2030-01-13T18:29:00Z')).toBe('2030-01-13');
    expect(colomboDate('2030-01-13T18:30:00Z')).toBe('2030-01-14');
    expect(colomboDate('2030-01-13T19:00:00Z')).toBe('2030-01-14');
  });
  it('colomboToIso converts a Colombo wall-clock time to UTC', () => {
    expect(colomboToIso('2030-01-14', '00:30')).toBe('2030-01-13T19:00:00.000Z');
    expect(colomboToIso('2030-01-14', '09:00')).toBe('2030-01-14T03:30:00.000Z');
  });
  it('addDaysYmd works across month and year ends', () => {
    expect(addDaysYmd('2030-01-31', 1)).toBe('2030-02-01');
    expect(addDaysYmd('2030-01-01', -1)).toBe('2029-12-31');
  });
  it('ceilQuarter rounds up to the next 15-minute mark, leaving exact marks alone', () => {
    const t = Date.parse('2030-01-14T04:31:00Z');
    expect(new Date(ceilQuarter(t)).toISOString()).toBe('2030-01-14T04:45:00.000Z');
    expect(new Date(ceilQuarter(Date.parse('2030-01-14T04:30:00Z'))).toISOString()).toBe(
      '2030-01-14T04:30:00.000Z',
    );
  });
});

describe('datetime-local helpers', () => {
  it('round-trips Colombo local input <-> UTC', () => {
    expect(fromColomboInput('2030-01-14T10:00')).toBe('2030-01-14T04:30:00.000Z');
    expect(toColomboInput('2030-01-14T04:30:00.000Z')).toBe('2030-01-14T10:00');
    expect(toColomboInput('2030-01-13T19:00:00.000Z')).toBe('2030-01-14T00:30');
  });
  it('returns null/empty for blank or invalid values', () => {
    expect(fromColomboInput('')).toBeNull();
    expect(toColomboInput(null)).toBe('');
  });
});
