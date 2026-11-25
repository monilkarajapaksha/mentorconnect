import { z } from 'zod';
import { phoneSchema } from './schemas';

export const DEFAULT_TIMEZONE = 'Asia/Colombo';
export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Distinct, readable calendar colors. New mentors get the least-used one. */
export const MENTOR_COLORS = [
  '#4f46e5',
  '#0891b2',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#9333ea',
  '#db2777',
  '#0d9488',
  '#65a30d',
  '#ea580c',
] as const;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

const tag = z.string().trim().min(1).max(40);

const mentorFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().toLowerCase().email(),
  phone: z
    .union([z.literal('').transform(() => null), z.null(), phoneSchema])
    .nullish()
    .transform((v) => v ?? null),
  expertise: z
    .array(tag)
    .max(20)
    .default([])
    .transform((tags) => {
      const seen = new Set<string>();
      return tags.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
    }),
  bio: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v || null),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must look like #rrggbb')
    .transform((v) => v.toLowerCase()),
  timezone: z.string().refine(isValidTimeZone, 'Unknown timezone').default(DEFAULT_TIMEZONE),
  defaultMeetingMinutes: z
    .number()
    .int()
    .min(15)
    .max(480)
    .refine((n) => n % 15 === 0, 'Must be a multiple of 15')
    .default(60),
  isActive: z.boolean(),
};

/** `color` is optional on create: the API picks one if omitted. */
export const createMentorSchema = z.object({
  ...mentorFields,
  color: mentorFields.color.optional(),
  isActive: z.boolean().default(true),
});
export const updateMentorSchema = z.object(mentorFields).partial();

export const listMentorsQuerySchema = z.object({
  search: z.string().trim().optional(),
  expertise: z.string().trim().optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
});

export const availabilityBlockSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: hhmm,
    endTime: hhmm,
  })
  .refine((b) => b.endTime > b.startTime, {
    message: 'End must be after start',
    path: ['endTime'],
  });

/** Replaces the whole weekly schedule. Blocks on the same day may touch but must not overlap. */
export const setAvailabilitySchema = z
  .object({ blocks: z.array(availabilityBlockSchema).max(70) })
  .superRefine(({ blocks }, ctx) => {
    const sorted = blocks
      .map((b, index) => ({ ...b, index }))
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.weekday === cur.weekday && cur.startTime < prev.endTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Overlaps another block on ${WEEKDAY_LABELS[cur.weekday]}`,
          path: ['blocks', cur.index],
        });
      }
    }
  });

export const isoInstant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());

export const createTimeOffSchema = z
  .object({
    startAt: isoInstant,
    endAt: isoInstant,
    reason: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => v || null),
  })
  .refine((t) => t.endAt > t.startAt, { message: 'End must be after start', path: ['endAt'] });

export type CreateMentorInput = z.infer<typeof createMentorSchema>;
export type UpdateMentorInput = z.infer<typeof updateMentorSchema>;
export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>;
export type CreateTimeOffInput = z.infer<typeof createTimeOffSchema>;

export interface Mentor {
  id: string;
  name: string;
  email: string;
  phone_e164: string | null;
  expertise: string[];
  bio: string | null;
  color: string;
  timezone: string;
  default_meeting_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityBlock {
  id: string;
  mentor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface MentorTimeOff {
  id: string;
  mentor_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
  created_at: string;
}
