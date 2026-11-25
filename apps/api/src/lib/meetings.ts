import type { MeetingWithRefs } from '@calllog/shared';

export const MEETING_SELECT = `
  SELECT m.*, mt.name AS mentor_name, mt.color AS mentor_color, mt.timezone AS mentor_timezone,
         c.name AS client_name, c.phone_e164 AS client_phone
  FROM meetings m
  JOIN mentors mt ON mt.id = m.mentor_id
  JOIN clients c ON c.id = m.client_id`;

export const loadMeeting = (db: D1Database, id: string) =>
  db.prepare(`${MEETING_SELECT} WHERE m.id = ?`).bind(id).first<MeetingWithRefs>();

/** The scheduled meeting (if any) that overlaps [startIso, endIso) for this mentor. */
export const findConflict = (
  db: D1Database,
  mentorId: string,
  startIso: string,
  endIso: string,
  excludeId?: string,
) =>
  db
    .prepare(
      `${MEETING_SELECT}
       WHERE m.mentor_id = ? AND m.status = 'scheduled' AND m.start_at < ? AND m.end_at > ?
         AND m.id <> ?
       LIMIT 1`,
    )
    .bind(mentorId, endIso, startIso, excludeId ?? '')
    .first<MeetingWithRefs>();
