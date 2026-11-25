import { z } from 'zod';
import { CALL_STATUSES } from './statuses';
import { normalizePhone } from './phone';

export const callStatusSchema = z.enum(CALL_STATUSES);
export const directionSchema = z.enum(['incoming', 'outgoing']);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid phone number' });
      return z.NEVER;
    }
    return n;
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

export const createClientSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(1, 'Name is required').max(200),
  company: optionalText(200),
  email: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  notes: optionalText(5000),
});

export const updateClientSchema = createClientSchema.omit({ phone: true }).partial();

const callFields = {
  direction: directionSchema,
  status: callStatusSchema,
  summary: z.string().trim().min(1, 'Summary is required').max(5000),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  notes: optionalText(5000),
};

const scheduledRule = (v: { status?: string; scheduledAt?: string | null }) =>
  v.status !== 'scheduled' || !!v.scheduledAt;
const scheduledMessage = {
  message: 'Scheduled date & time is required when status is Scheduled',
  path: ['scheduledAt'],
};

export const createCallSchema = z.object(callFields).refine(scheduledRule, scheduledMessage);
/** For PATCH the rule is re-checked against the merged row in the API. */
export const updateCallSchema = z.object(callFields).partial();

export const pageSchema = z.coerce.number().int().min(1).default(1);

export const dateRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const statusListSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').filter(Boolean) : []))
  .pipe(z.array(callStatusSchema));

export const listClientsQuerySchema = z.object({
  status: statusListSchema,
  search: z.string().trim().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(['last_call_desc', 'last_call_asc']).default('last_call_desc'),
  page: pageSchema,
});

export const listCallsQuerySchema = z.object({
  status: statusListSchema,
  from: z.string().optional(),
  to: z.string().optional(),
  page: pageSchema,
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type CreateCallInput = z.infer<typeof createCallSchema>;
export type UpdateCallInput = z.infer<typeof updateCallSchema>;
