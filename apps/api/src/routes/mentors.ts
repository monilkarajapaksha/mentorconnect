import { Hono } from 'hono';
import {
  MENTOR_COLORS,
  computeFreeSlots,
  freeSlotsQuerySchema,
  createMentorSchema,
  createTimeOffSchema,
  listMentorsQuerySchema,
  setAvailabilitySchema,
  updateMentorSchema,
  type AvailabilityBlock,
  type Mentor,
  type MentorTimeOff,
} from '@calllog/shared';
import type { AppEnv } from '../env';
import { likePattern, rangeBound } from '../lib/db';
import { AppError } from '../lib/errors';
import { loadSchedule } from '../lib/schedule';

const mentors = new Hono<AppEnv>();

type MentorRow = Omit<Mentor, 'expertise' | 'is_active'> & { expertise: string; is_active: number };
const toMentor = (r: MentorRow): Mentor => ({
  ...r,
  expertise: JSON.parse(r.expertise) as string[],
  is_active: !!r.is_active,
});

const DUPLICATE = () =>
  new AppError(409, 'MENTOR_EXISTS', 'A mentor with this email already exists');

/** Today in Sri Lanka time as YYYY-MM-DD (the admin's working day). */
function colomboToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
}

async function loadMentor(db: D1Database, id: string): Promise<Mentor> {
  const row = await db.prepare('SELECT * FROM mentors WHERE id = ?').bind(id).first<MentorRow>();
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Mentor not found');
  return toMentor(row);
}

// --- list / search ---
mentors.get('/', async (c) => {
  const q = listMentorsQuerySchema.parse(c.req.query());
  const today = colomboToday();
  const where: string[] = [];
  const params: unknown[] = [rangeBound(today, 'from'), rangeBound(today, 'to')];

  if (q.active !== 'all') {
    where.push('m.is_active = ?');
    params.push(q.active === 'true' ? 1 : 0);
  }
  if (q.search) {
    where.push(
      `(m.name LIKE ? ESCAPE '\\' OR m.email LIKE ? ESCAPE '\\' OR m.expertise LIKE ? ESCAPE '\\')`,
    );
    const p = likePattern(q.search);
    params.push(p, p, p);
  }
  if (q.expertise) {
    where.push(`EXISTS (SELECT 1 FROM json_each(m.expertise) WHERE lower(value) = lower(?))`);
    params.push(q.expertise);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT m.*,
       (SELECT COUNT(*) FROM meetings x
         WHERE x.mentor_id = m.id AND x.status IN ('scheduled', 'completed')
           AND x.start_at >= ? AND x.start_at <= ?) AS today_meetings
     FROM mentors m ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.name COLLATE NOCASE`,
  )
    .bind(...params)
    .all<MentorRow & { today_meetings: number }>();

  // Next open slot (default-length meeting) within two weeks, for active mentors.
  const now = Date.now();
  const horizon = now + 14 * 86_400_000;
  const active = results.filter((r) => r.is_active);
  const sched = await loadSchedule(
    c.env.DB,
    active.map((r) => r.id),
    new Date(now).toISOString(),
    new Date(horizon).toISOString(),
  );

  return c.json({
    items: results.map(({ today_meetings, ...r }) => {
      const mentor = toMentor(r);
      const [next] = mentor.is_active
        ? computeFreeSlots({
            blocks: sched.blocks.get(r.id) ?? [],
            timeOff: sched.timeOff.get(r.id) ?? [],
            busy: sched.busy.get(r.id) ?? [],
            timeZone: r.timezone,
            from: now,
            to: horizon,
            durationMinutes: r.default_meeting_minutes,
            notBefore: now,
            maxSlots: 1,
          })
        : [];
      return { ...mentor, today_meetings, next_free_slot: next ?? null };
    }),
  });
});

// --- create ---
mentors.post('/', async (c) => {
  const input = createMentorSchema.parse(await c.req.json());
  const db = c.env.DB;

  if (await db.prepare('SELECT 1 AS x FROM mentors WHERE email = ?').bind(input.email).first()) {
    throw DUPLICATE();
  }

  let color = input.color;
  if (!color) {
    // Least-used palette color, so mentors stay distinguishable on the calendar.
    const { results } = await db
      .prepare('SELECT color, COUNT(*) AS n FROM mentors GROUP BY color')
      .all<{ color: string; n: number }>();
    const used = new Map(results.map((r) => [r.color, r.n]));
    color = [...MENTOR_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]!;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO mentors (id, name, email, phone_e164, expertise, bio, color, timezone,
           default_meeting_minutes, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.email,
        input.phone,
        JSON.stringify(input.expertise),
        input.bio,
        color,
        input.timezone,
        input.defaultMeetingMinutes,
        input.isActive ? 1 : 0,
        now,
        now,
      )
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw DUPLICATE();
    throw e;
  }
  return c.json({ mentor: await loadMentor(db, id) }, 201);
});

// --- one mentor (with weekly hours and how many upcoming meetings deactivating would affect) ---
mentors.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const mentor = await loadMentor(db, id);
  const [availability, upcoming] = await Promise.all([
    db
      .prepare('SELECT * FROM mentor_availability WHERE mentor_id = ? ORDER BY weekday, start_time')
      .bind(id)
      .all<AvailabilityBlock>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM meetings
         WHERE mentor_id = ? AND status = 'scheduled' AND start_at >= ?`,
      )
      .bind(id, new Date().toISOString())
      .first<{ n: number }>(),
  ]);
  return c.json({
    mentor,
    availability: availability.results,
    upcomingScheduledMeetings: upcoming?.n ?? 0,
  });
});

// --- update ---
const COLUMNS = {
  name: 'name',
  email: 'email',
  phone: 'phone_e164',
  expertise: 'expertise',
  bio: 'bio',
  color: 'color',
  timezone: 'timezone',
  defaultMeetingMinutes: 'default_meeting_minutes',
  isActive: 'is_active',
} as const;

mentors.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const input = updateMentorSchema.parse(await c.req.json());
  const db = c.env.DB;
  await loadMentor(db, id); // 404 if missing

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    // Column names come from the fixed map above, never from user input.
    sets.push(`${COLUMNS[key as keyof typeof COLUMNS]} = ?`);
    values.push(
      key === 'expertise' ? JSON.stringify(value) : key === 'isActive' ? (value ? 1 : 0) : value,
    );
  }
  if (sets.length) {
    try {
      await db
        .prepare(`UPDATE mentors SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
        .bind(...values, new Date().toISOString(), id)
        .run();
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw DUPLICATE();
      throw e;
    }
  }
  return c.json({ mentor: await loadMentor(db, id) });
});

// --- soft delete: keeps the row and its meetings, hides the mentor from default lists ---
mentors.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await loadMentor(db, id);
  await db
    .prepare('UPDATE mentors SET is_active = 0, updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();
  return c.json({ ok: true, mentor: await loadMentor(db, id) });
});

// --- permanent delete: removes the mentor with their meetings, availability and time off ---
mentors.delete('/:id/permanent', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await loadMentor(db, id);
  // meetings.mentor_id has no cascade, so meetings go first (meeting_history cascades from them,
  // calls.meeting_id is set to NULL); availability and time off cascade from the mentor row.
  await db.batch([
    db.prepare('DELETE FROM meetings WHERE mentor_id = ?').bind(id),
    db.prepare('DELETE FROM mentors WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// --- weekly availability ---
mentors.get('/:id/availability', async (c) => {
  const id = c.req.param('id');
  await loadMentor(c.env.DB, id);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM mentor_availability WHERE mentor_id = ? ORDER BY weekday, start_time',
  )
    .bind(id)
    .all<AvailabilityBlock>();
  return c.json({ availability: results });
});

mentors.put('/:id/availability', async (c) => {
  const id = c.req.param('id');
  const { blocks } = setAvailabilitySchema.parse(await c.req.json());
  const db = c.env.DB;
  await loadMentor(db, id);
  // One batch = one transaction: the schedule is replaced atomically.
  await db.batch([
    db.prepare('DELETE FROM mentor_availability WHERE mentor_id = ?').bind(id),
    ...blocks.map((b) =>
      db
        .prepare(
          'INSERT INTO mentor_availability (id, mentor_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), id, b.weekday, b.startTime, b.endTime),
    ),
  ]);
  const { results } = await db
    .prepare('SELECT * FROM mentor_availability WHERE mentor_id = ? ORDER BY weekday, start_time')
    .bind(id)
    .all<AvailabilityBlock>();
  return c.json({ availability: results });
});

// --- open slots = weekly hours - time off - booked meetings ---
const MAX_RANGE_DAYS = 62;
mentors.get('/:id/free-slots', async (c) => {
  const id = c.req.param('id');
  const q = freeSlotsQuerySchema.parse(c.req.query());
  const mentor = await loadMentor(c.env.DB, id);

  const now = Date.now();
  const from = rangeBound(q.from, 'from') ?? new Date(now).toISOString();
  const to = rangeBound(q.to, 'to') ?? new Date(Date.parse(from) + 14 * 86_400_000).toISOString();
  if (Date.parse(to) <= Date.parse(from)) {
    throw new AppError(400, 'INVALID_RANGE', '"to" must be after "from"');
  }
  if (Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * 86_400_000) {
    throw new AppError(400, 'RANGE_TOO_LARGE', `Ask for at most ${MAX_RANGE_DAYS} days at a time`);
  }
  const duration = q.duration ?? mentor.default_meeting_minutes;

  // Inactive mentors cannot be booked, so they have no open slots.
  const sched = mentor.is_active ? await loadSchedule(c.env.DB, [id], from, to) : null;
  const slots = sched
    ? computeFreeSlots({
        blocks: sched.blocks.get(id) ?? [],
        timeOff: sched.timeOff.get(id) ?? [],
        busy: sched.busy.get(id) ?? [],
        timeZone: mentor.timezone,
        from: Date.parse(from),
        to: Date.parse(to),
        durationMinutes: duration,
        stepMinutes: q.step,
        notBefore: now,
      })
    : [];
  return c.json({ mentorId: id, timezone: mentor.timezone, duration, step: q.step, slots });
});

// --- time off ---
mentors.get('/:id/time-off', async (c) => {
  const id = c.req.param('id');
  await loadMentor(c.env.DB, id);
  const from = rangeBound(c.req.query('from'), 'from');
  const to = rangeBound(c.req.query('to'), 'to');
  const where = ['mentor_id = ?'];
  const params: unknown[] = [id];
  // Anything that overlaps the requested window.
  if (from) {
    where.push('end_at > ?');
    params.push(from);
  }
  if (to) {
    where.push('start_at < ?');
    params.push(to);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM mentor_time_off WHERE ${where.join(' AND ')} ORDER BY start_at`,
  )
    .bind(...params)
    .all<MentorTimeOff>();
  return c.json({ items: results });
});

mentors.post('/:id/time-off', async (c) => {
  const id = c.req.param('id');
  const input = createTimeOffSchema.parse(await c.req.json());
  const db = c.env.DB;
  await loadMentor(db, id);
  const timeOffId = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO mentor_time_off (id, mentor_id, start_at, end_at, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(timeOffId, id, input.startAt, input.endAt, input.reason, new Date().toISOString())
    .run();
  const timeOff = await db
    .prepare('SELECT * FROM mentor_time_off WHERE id = ?')
    .bind(timeOffId)
    .first<MentorTimeOff>();
  return c.json({ timeOff }, 201);
});

/** Mounted separately at /api/time-off (DELETE /api/time-off/:id). */
export const timeOff = new Hono<AppEnv>();
timeOff.delete('/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM mentor_time_off WHERE id = ?')
    .bind(c.req.param('id'))
    .run();
  if (!res.meta.changes) throw new AppError(404, 'NOT_FOUND', 'Time off not found');
  return c.json({ ok: true });
});

export default mentors;
