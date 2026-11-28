import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CALL_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  createCallSchema,
  normalizePhone,
  statusSqlList,
  suggestNextStatus,
} from './index';

describe('status enum', () => {
  it('has 17 statuses incl. 10 follow-ups', () => {
    expect(CALL_STATUSES).toHaveLength(17);
    expect(CALL_STATUSES.filter((s) => s.startsWith('follow_up_'))).toHaveLength(10);
  });
  it('has a label and color for every status', () => {
    for (const s of CALL_STATUSES) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_COLORS[s]).toBeTruthy();
    }
    expect(STATUS_LABELS.follow_up_2).toBe('2nd Follow-up');
  });
  it('relabels declined and adds rejected_offer', () => {
    expect(STATUS_LABELS.declined).toBe('Not answered');
    expect(STATUS_LABELS.rejected_offer).toBe('Rejected the offer');
  });
  it('migration CHECK list matches the shared enum (no drift)', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../apps/api/migrations/0004_rejected_offer_status.sql'),
      'utf8',
    );
    expect(sql).toContain(`status IN (${statusSqlList()})`);
  });
});

describe('suggestNextStatus', () => {
  it('goes N -> N+1', () => expect(suggestNextStatus('follow_up_1')).toBe('follow_up_2'));
  it('caps at 10', () => expect(suggestNextStatus('follow_up_10')).toBe('follow_up_10'));
  it('starts at 1st follow-up otherwise', () => {
    expect(suggestNextStatus(null)).toBe('follow_up_1');
    expect(suggestNextStatus('declined')).toBe('follow_up_1');
  });
});

describe('normalizePhone', () => {
  it('maps all LK formats to the same E.164', () => {
    for (const v of ['0771234567', '077 123 4567', '+94771234567']) {
      expect(normalizePhone(v)).toBe('+94771234567');
    }
  });
  it('rejects garbage', () => expect(normalizePhone('abc')).toBeNull());
});

describe('createCallSchema', () => {
  const base = { direction: 'incoming', summary: 'hi' } as const;
  it('requires scheduledAt when scheduled', () => {
    expect(createCallSchema.safeParse({ ...base, status: 'scheduled' }).success).toBe(false);
    expect(
      createCallSchema.safeParse({
        ...base,
        status: 'scheduled',
        scheduledAt: '2026-12-01T04:30:00Z',
      }).success,
    ).toBe(true);
  });
  it('rejects unknown status', () => {
    expect(createCallSchema.safeParse({ ...base, status: 'nope' }).success).toBe(false);
  });
});
