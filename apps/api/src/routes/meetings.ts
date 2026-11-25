import { Hono } from 'hono';
import {
  createMeetingSchema,
  listMeetingsQuerySchema,
  meetingTimeIssues,
  scheduleViolations,
  updateMeetingSchema,
  type Call,
  type Client,
  type Meeting,
  type Mentor,
  type Violation,
} from '@calllog/shared';
import type { AppEnv } from '../env';
import { rangeBound, recomputeClient } from '../lib/db';
import { AppError } from '../lib/errors';
import { MEETING_SELECT, findConflict, loadMeeting } from '../lib/meetings';
import { loadSchedule } from '../lib/schedule';

const meetings = new Hono<AppEnv>();

type MentorRow = Omit<Mentor, 'expertise' | 'is_active'> & { expertise: string; is_active: number };

const TRACKED = [
  'title',
  'start_at',
  'end_at',
  'status',
  'mode',
  'location_or_link',
  'agenda',
  'notes',
] as const;

function conflictError(conflict: unknown) {
  return new AppError(409, 'MEETING_CONFLICT', 'The mentor already has a meeting at this time', {
    conflictingMeeting: conflict,
  });
}

/** Soft rules: weekly hours + time off. Throws 422 unless the admin passed force. */
async function checkSoftRules(
  db: D1Database,
  mentor: { id: string; timezone: string },
  startIso: string,
  endIso: string,
  force: boolean,
): Promise<Violation[]> {
  const sched = await loadSchedule(db, [mentor.id], startIso, endIso);
  const violations = scheduleViolations({
    blocks: sched.blocks.get(mentor.id) ?? [],
    timeOff: sched.timeOff.get(mentor.id) ?? [],
    timeZone: mentor.timezone,
    start: Date.parse(startIso),
    end: Date.parse(endIso),
  });
  if (violations.length && !force) {
    const timeOff = violations.includes('time_off');
    throw new AppError(
      422,
      timeOff ? 'TIME_OFF' : 'OUTSIDE_AVAILABILITY',
      timeOff
        ? 'The mentor has time off during this period'
        : "This time is outside the mentor's weekly availability",
      { violations, canForce: true },
    );
  }
  return violations;
}

const meetingLink = (mentorId: string, meetingId: string) =>
  `/mentors/${mentorId}?meeting=${meetingId}`;

// --- calendar feed ---
meetings.get('/', async (c) => {
  const q = listMeetingsQuerySchema.parse(c.req.query());
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.mentorIds.length) {
    where.push(`m.mentor_id IN (${q.mentorIds.map(() => '?').join(',')})`);
    params.push(...q.mentorIds);
  }
  if (q.clientId) {
    where.push('m.client_id = ?');
    params.push(q.clientId);
  }
  if (q.status.length) {
    where.push(`m.status IN (${q.status.map(() => '?').join(',')})`);
    params.push(...q.status);
  }
  // Window semantics: anything that overlaps [from, to].
  const from = rangeBound(c.req.query('from'), 'from');
  const to = rangeBound(c.req.query('to'), 'to');
  if (from) {
    where.push('m.end_at > ?');
    params.push(from);
  }
  if (to) {
    where.push('m.start_at < ?');
    params.push(to);
  }
  const { results } = await c.env.DB.prepare(
    `${MEETING_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.start_at, m.rowid LIMIT 1000`,
  )
    .bind(...params)
    .all();
  return c.json({ items: results });
});

// --- create ---
meetings.post('/', async (c) => {
  const input = createMeetingSchema.parse(await c.req.json());
  const db = c.env.DB;

  const mentor = await db
    .prepare('SELECT * FROM mentors WHERE id = ?')
    .bind(input.mentorId)
    .first<MentorRow>();
  if (!mentor) throw new AppError(404, 'NOT_FOUND', 'Mentor not found');
  if (!mentor.is_active) throw new AppError(409, 'MENTOR_INACTIVE', 'This mentor is not active');
  const client = await db
    .prepare('SELECT * FROM clients WHERE id = ?')
    .bind(input.clientId)
    .first<Client>();
  if (!client) throw new AppError(404, 'NOT_FOUND', 'Client not found');

  // Hard rule first (nobody can override a double booking), then the soft rules.
  const clash = await findConflict(db, mentor.id, input.startAt, input.endAt);
  if (clash) throw conflictError(clash);
  const violations = await checkSoftRules(db, mentor, input.startAt, input.endAt, input.force);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const adminId = c.get('admin').id;
  const stillExists = `EXISTS (SELECT 1 FROM meetings WHERE id = ? AND updated_at = ?)`;

  const statements = [
    // The conflict check lives inside the INSERT itself, so two simultaneous bookings of the same
    // slot cannot both succeed (D1 has no multi-statement transactions to lean on otherwise).
    db
      .prepare(
        `INSERT INTO meetings (id, mentor_id, client_id, title, start_at, end_at, status, mode,
           location_or_link, agenda, notes, created_by_admin_id, updated_by_admin_id, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM meetings WHERE mentor_id = ? AND status = 'scheduled' AND start_at < ? AND end_at > ?)`,
      )
      .bind(
        id,
        mentor.id,
        client.id,
        input.title,
        input.startAt,
        input.endAt,
        input.mode,
        input.locationOrLink,
        input.agenda,
        input.notes,
        adminId,
        adminId,
        now,
        now,
        mentor.id,
        input.endAt,
        input.startAt,
      ),
    db
      .prepare(
        `INSERT INTO meeting_history (id, meeting_id, admin_id, changed_at, action, changes)
         SELECT ?, ?, ?, ?, 'created', ? WHERE ${stillExists}`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        adminId,
        now,
        JSON.stringify({
          start_at: { old: null, new: input.startAt },
          end_at: { old: null, new: input.endAt },
          ...(violations.length ? { forced: violations } : {}),
        }),
        id,
        now,
      ),
  ];

  let callId: string | undefined;
  if (input.logCall) {
    callId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO calls (id, client_id, direction, status, summary, scheduled_at, meeting_id,
             created_by_admin_id, updated_by_admin_id, created_at, updated_at)
           SELECT ?, ?, 'outgoing', 'scheduled', ?, ?, ?, ?, ?, ?, ? WHERE ${stillExists}`,
        )
        .bind(
          callId,
          client.id,
          `Session booked with ${mentor.name}: ${input.title}. Meeting: ${meetingLink(mentor.id, id)}`,
          input.startAt,
          id,
          adminId,
          adminId,
          now,
          now,
          id,
          now,
        ),
      recomputeClient(db, client.id),
    );
  }

  const results = await db.batch(statements);
  if (results[0]?.meta.changes === 0) {
    // Lost a race with another booking made after our pre-check.
    throw conflictError(await findConflict(db, mentor.id, input.startAt, input.endAt));
  }

  const call = callId
    ? await db.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first<Call>()
    : null;
  return c.json({ meeting: await loadMeeting(db, id), call }, 201);
});

// --- one meeting, with everything the side panel needs ---
meetings.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const meeting = await loadMeeting(db, id);
  if (!meeting) throw new AppError(404, 'NOT_FOUND', 'Meeting not found');

  const [mentor, client, calls, history] = await Promise.all([
    db.prepare('SELECT * FROM mentors WHERE id = ?').bind(meeting.mentor_id).first<MentorRow>(),
    db.prepare('SELECT * FROM clients WHERE id = ?').bind(meeting.client_id).first<Client>(),
    db
      .prepare(
        'SELECT * FROM calls WHERE client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 3',
      )
      .bind(meeting.client_id)
      .all<Call>(),
    db
      .prepare(
        `SELECT h.id, h.changed_at, h.action, h.changes, a.name AS admin_name
         FROM meeting_history h LEFT JOIN admins a ON a.id = h.admin_id
         WHERE h.meeting_id = ? ORDER BY h.changed_at DESC, h.rowid DESC`,
      )
      .bind(id)
      .all<{ changes: string }>(),
  ]);
  return c.json({
    meeting,
    mentor: mentor && {
      ...mentor,
      expertise: JSON.parse(mentor.expertise),
      is_active: !!mentor.is_active,
    },
    client,
    clientCurrentStatus: client?.current_status ?? null,
    recentCalls: calls.results,
    history: history.results.map((h) => ({ ...h, changes: JSON.parse(h.changes) })),
  });
});

// --- edit / move / resize / change status ---
meetings.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const patch = updateMeetingSchema.parse(await c.req.json());
  const db = c.env.DB;
  const existing = await db
    .prepare('SELECT * FROM meetings WHERE id = ?')
    .bind(id)
    .first<Meeting>();
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Meeting not found');

  const next = {
    title: patch.title ?? existing.title,
    start_at: patch.startAt ?? existing.start_at,
    end_at: patch.endAt ?? existing.end_at,
    status: patch.status ?? existing.status,
    mode: patch.mode ?? existing.mode,
    location_or_link:
      patch.locationOrLink !== undefined ? patch.locationOrLink : existing.location_or_link,
    agenda: patch.agenda !== undefined ? patch.agenda : existing.agenda,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
  };

  const timeChanged = next.start_at !== existing.start_at || next.end_at !== existing.end_at;
  if (timeChanged) {
    const issues = meetingTimeIssues(next.start_at, next.end_at);
    if (issues.length) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of issues) (fieldErrors[i.path] ??= []).push(i.message);
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
        formErrors: [],
        fieldErrors,
      });
    }
  }

  const changes: Record<string, unknown> = {};
  for (const f of TRACKED) {
    if (existing[f] !== next[f]) changes[f] = { old: existing[f], new: next[f] };
  }
  if (!Object.keys(changes).length && !patch.logCall) {
    return c.json({ meeting: await loadMeeting(db, id), call: null });
  }

  const completing = existing.status !== 'completed' && next.status === 'completed';
  if (patch.logCall && !completing) {
    throw new AppError(
      400,
      'INVALID_LOG_CALL',
      'logCall only applies when marking a meeting completed',
    );
  }

  // Only a meeting that will be 'scheduled' occupies the mentor's time, so only then do the
  // rules apply (when the time changed, or when a cancelled/completed meeting is reopened).
  const mentor = await db
    .prepare('SELECT * FROM mentors WHERE id = ?')
    .bind(existing.mentor_id)
    .first<MentorRow>();
  if (!mentor) throw new AppError(404, 'NOT_FOUND', 'Mentor not found');
  const guard = next.status === 'scheduled' && (timeChanged || existing.status !== 'scheduled');
  let violations: Violation[] = [];
  if (guard) {
    if (!mentor.is_active) throw new AppError(409, 'MENTOR_INACTIVE', 'This mentor is not active');
    const clash = await findConflict(db, existing.mentor_id, next.start_at, next.end_at, id);
    if (clash) throw conflictError(clash);
    violations = await checkSoftRules(db, mentor, next.start_at, next.end_at, patch.force ?? false);
  }

  const action =
    next.status === 'cancelled' && existing.status !== 'cancelled'
      ? 'cancelled'
      : timeChanged
        ? 'rescheduled'
        : changes.status
          ? 'status_changed'
          : 'updated';
  const now = new Date().toISOString();
  const adminId = c.get('admin').id;
  const stillUpdated = `EXISTS (SELECT 1 FROM meetings WHERE id = ? AND updated_at = ?)`;

  const statements = [
    db
      .prepare(
        `UPDATE meetings SET title = ?, start_at = ?, end_at = ?, status = ?, mode = ?,
           location_or_link = ?, agenda = ?, notes = ?, updated_by_admin_id = ?, updated_at = ?
         WHERE id = ? AND (? = 0 OR NOT EXISTS (
           SELECT 1 FROM meetings o WHERE o.id <> ? AND o.mentor_id = ? AND o.status = 'scheduled'
             AND o.start_at < ? AND o.end_at > ?))`,
      )
      .bind(
        next.title,
        next.start_at,
        next.end_at,
        next.status,
        next.mode,
        next.location_or_link,
        next.agenda,
        next.notes,
        adminId,
        now,
        id,
        guard ? 1 : 0,
        id,
        existing.mentor_id,
        next.end_at,
        next.start_at,
      ),
    db
      .prepare(
        `INSERT INTO meeting_history (id, meeting_id, admin_id, changed_at, action, changes)
         SELECT ?, ?, ?, ?, ?, ? WHERE ${stillUpdated}`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        adminId,
        now,
        action,
        JSON.stringify({ ...changes, ...(violations.length ? { forced: violations } : {}) }),
        id,
        now,
      ),
  ];

  let callId: string | undefined;
  if (patch.logCall) {
    callId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO calls (id, client_id, direction, status, summary, scheduled_at, meeting_id,
             created_by_admin_id, updated_by_admin_id, created_at, updated_at)
           SELECT ?, ?, 'outgoing', 'session_done', ?, NULL, ?, ?, ?, ?, ? WHERE ${stillUpdated}`,
        )
        .bind(
          callId,
          existing.client_id,
          `Session completed with ${mentor.name}: ${next.title}. Meeting: ${meetingLink(mentor.id, id)}`,
          id,
          adminId,
          adminId,
          now,
          now,
          id,
          now,
        ),
      recomputeClient(db, existing.client_id),
    );
  }

  const results = await db.batch(statements);
  if (results[0]?.meta.changes === 0) {
    throw conflictError(await findConflict(db, existing.mentor_id, next.start_at, next.end_at, id));
  }
  const call = callId
    ? await db.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first<Call>()
    : null;
  return c.json({ meeting: await loadMeeting(db, id), call });
});

// --- hard delete (cancelling keeps the meeting; this removes it and its history) ---
meetings.delete('/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM meetings WHERE id = ?')
    .bind(c.req.param('id'))
    .run();
  if (!res.meta.changes) throw new AppError(404, 'NOT_FOUND', 'Meeting not found');
  return c.json({ ok: true });
});

export default meetings;
