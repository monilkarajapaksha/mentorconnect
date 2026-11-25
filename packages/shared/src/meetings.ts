import { z } from 'zod';
import { isoInstant } from './mentors';
import { meetingTimeIssues } from './scheduling';

/** Meeting constants. (Separate from CALL_STATUSES: a meeting's `scheduled` is not a call's.) */
export const MEETING_STATUSES = [
  'scheduled',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_MODES = ['online', 'in_person', 'phone'] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  rescheduled: 'Rescheduled',
};

export const MEETING_MODE_LABELS: Record<MeetingMode, string> = {
  online: 'Online',
  in_person: 'In person',
  phone: 'Phone',
};

// ---------- schemas ----------

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const meetingStatusSchema = z.enum(MEETING_STATUSES);
export const meetingModeSchema = z.enum(MEETING_MODES);

const meetingFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  startAt: isoInstant,
  endAt: isoInstant,
  mode: meetingModeSchema,
  locationOrLink: text(500),
  agenda: text(5000),
  notes: text(5000),
  /** Override soft warnings (outside weekly hours / during time off). Recorded in the history. */
  force: z.boolean().default(false),
  /** On create: also log a "Scheduled" call. On PATCH to completed: also log "Session Done". */
  logCall: z.boolean().default(false),
};

export const createMeetingSchema = z
  .object({
    mentorId: z.string().min(1),
    clientId: z.string().min(1),
    ...meetingFields,
  })
  .superRefine((m, ctx) => {
    for (const i of meetingTimeIssues(m.startAt, m.endAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: i.message, path: [i.path] });
    }
  });

/** PATCH: every field optional; the API re-validates the merged start/end. */
export const updateMeetingSchema = z
  .object({ ...meetingFields, status: meetingStatusSchema })
  .partial();

export const listMeetingsQuerySchema = z.object({
  mentorIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : [])),
  clientId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(meetingStatusSchema)),
});

export const freeSlotsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  duration: z.coerce
    .number()
    .int()
    .min(15)
    .max(480)
    .refine((n) => n % 15 === 0, 'Must be a multiple of 15')
    .optional(),
  step: z.coerce
    .number()
    .int()
    .min(15)
    .max(240)
    .refine((n) => n % 15 === 0, 'Must be a multiple of 15')
    .default(30),
});

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export interface Meeting {
  id: string;
  mentor_id: string;
  client_id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: MeetingStatus;
  mode: MeetingMode;
  location_or_link: string | null;
  agenda: string | null;
  notes: string | null;
  external_event_id: string | null;
  created_by_admin_id: string | null;
  updated_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A meeting plus the names/colors the calendar needs. */
export interface MeetingWithRefs extends Meeting {
  mentor_name: string;
  mentor_color: string;
  mentor_timezone: string;
  client_name: string;
  client_phone: string;
}
