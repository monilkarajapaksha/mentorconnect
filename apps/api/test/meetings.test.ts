import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { addCall, api, authed, createClient, createMentor, json } from './helpers';

// 2030-01-14 is a Monday. All times below are Sri Lanka time (UTC+05:30).
const MON = '2030-01-14';
const at = (time: string, date = MON) => new Date(`${date}T${time}:00+05:30`).toISOString();

let cookie: string;
let mentor: { id: string; name: string };
let client: { id: string };

async function setHours(mentorId: string, blocks: unknown[]) {
  const res = await api(`/api/mentors/${mentorId}/availability`, {
    method: 'PUT',
    cookie,
    json: { blocks },
  });
  expect(res.status).toBe(200);
}
const monday = (start_time: string, end_time: string) => ({
  weekday: 1,
  startTime: start_time,
  endTime: end_time,
});

const body = (over: Record<string, unknown> = {}) => ({
  mentorId: mentor.id,
  clientId: client.id,
  title: 'Mentoring session',
  mode: 'online',
  startAt: at('10:00'),
  endAt: at('11:00'),
  ...over,
});
const post = (over: Record<string, unknown> = {}) =>
  api('/api/meetings', { method: 'POST', cookie, json: body(over) });
const patch = (id: string, data: unknown) =>
  api(`/api/meetings/${id}`, { method: 'PATCH', cookie, json: data });
async function book(over: Record<string, unknown> = {}) {
  const res = await post(over);
  if (res.status !== 201) throw new Error(`book ${res.status}: ${await res.text()}`);
  return (await json(res)).meeting as {
    id: string;
    start_at: string;
    end_at: string;
    status: string;
  };
}
const history = async (id: string) =>
  (await json(await api(`/api/meetings/${id}`, { cookie }))).history as {
    action: string;
    changes: Record<string, { old: unknown; new: unknown }> & { forced?: string[] };
    admin_name: string;
  }[];

beforeEach(async () => {
  cookie = await authed();
  mentor = await createMentor(cookie, { name: 'Asha Mentor' });
  client = await createClient(cookie, '0771234567', 'Nimal');
  await setHours(mentor.id, [monday('09:00', '17:00')]);
});

describe('creating meetings', () => {
  it('books a meeting and returns it with mentor/client info', async () => {
    const res = await post({ agenda: 'Career plan', locationOrLink: 'https://meet.example/abc' });
    expect(res.status).toBe(201);
    const { meeting, call } = await json(res);
    expect(meeting).toMatchObject({
      mentor_id: mentor.id,
      client_id: client.id,
      status: 'scheduled',
      mode: 'online',
      start_at: at('10:00'),
      end_at: at('11:00'),
      agenda: 'Career plan',
      location_or_link: 'https://meet.example/abc',
      mentor_name: 'Asha Mentor',
      client_name: 'Nimal',
      client_phone: '+94771234567',
      external_event_id: null,
    });
    expect(meeting.mentor_color).toMatch(/^#/);
    expect(meeting.created_by_admin_id).toBeTruthy();
    expect(call).toBeNull();
  });

  it('stores times in UTC however they were sent', async () => {
    const m = await book({ startAt: '2030-01-14T10:00:00+05:30', endAt: '2030-01-14T05:30:00Z' });
    expect(m.start_at).toBe('2030-01-14T04:30:00.000Z');
    expect(m.end_at).toBe('2030-01-14T05:30:00.000Z');
  });

  it('writes a "created" history entry', async () => {
    const m = await book();
    const h = await history(m.id);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ action: 'created' });
    expect(h[0]?.admin_name).toBeTruthy();
  });

  it.each([
    ['end before start', { startAt: at('11:00'), endAt: at('10:00') }],
    ['zero length', { startAt: at('10:00'), endAt: at('10:00') }],
    ['14 minutes', { startAt: at('10:00'), endAt: at('10:14') }],
    ['more than 480 minutes', { startAt: at('09:00'), endAt: at('17:15') }],
    ['start off the 15-minute grid', { startAt: at('10:05'), endAt: at('11:00') }],
    ['end off the 15-minute grid', { startAt: at('10:00'), endAt: at('11:10') }],
    ['unknown mode', { mode: 'telepathy' }],
    ['blank title', { title: '  ' }],
    ['garbage time', { startAt: 'tomorrow' }],
  ])('400 for %s', async (_l, over) => {
    const res = await post(over);
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts the 15 and 480 minute limits', async () => {
    expect((await post({ startAt: at('09:00'), endAt: at('09:15') })).status).toBe(201);
    await setHours(mentor.id, [monday('00:00', '23:45')]);
    expect((await post({ startAt: at('12:00'), endAt: at('20:00') })).status).toBe(201);
  });

  it('404 for an unknown mentor or client', async () => {
    expect((await post({ mentorId: 'nope' })).status).toBe(404);
    expect((await post({ clientId: 'nope' })).status).toBe(404);
  });

  it('409 MENTOR_INACTIVE for a deactivated mentor', async () => {
    await api(`/api/mentors/${mentor.id}`, { method: 'DELETE', cookie });
    const res = await post();
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe('MENTOR_INACTIVE');
  });
});

describe('no double booking', () => {
  beforeEach(async () => {
    await book(); // 10:00-11:00
  });

  it.each([
    ['exact overlap', '10:00', '11:00'],
    ['starts inside', '10:30', '11:30'],
    ['ends inside', '09:30', '10:30'],
    ['contains it', '09:30', '11:30'],
    ['contained by it', '10:15', '10:45'],
    ['one minute-grid step of overlap at the start', '10:45', '11:45'],
    ['one minute-grid step of overlap at the end', '09:15', '10:15'],
  ])('409 for %s, with the conflicting meeting in details', async (_l, s, e) => {
    const res = await post({ startAt: at(s), endAt: at(e) });
    expect(res.status).toBe(409);
    const err = (await json(res)).error;
    expect(err.code).toBe('MEETING_CONFLICT');
    expect(err.details.conflictingMeeting).toMatchObject({
      start_at: at('10:00'),
      end_at: at('11:00'),
      client_name: 'Nimal',
    });
  });

  it('back-to-back meetings are allowed, before and after', async () => {
    expect((await post({ startAt: at('09:00'), endAt: at('10:00') })).status).toBe(201);
    expect((await post({ startAt: at('11:00'), endAt: at('12:00') })).status).toBe(201);
  });

  it('force does NOT override a double booking', async () => {
    const res = await post({ force: true });
    expect(res.status).toBe(409);
  });

  it('cancelled meetings are ignored', async () => {
    const [{ id }] = (await json(await api(`/api/meetings?mentorIds=${mentor.id}`, { cookie })))
      .items;
    await patch(id, { status: 'cancelled' });
    expect((await post()).status).toBe(201);
  });

  it('completed, no-show and rescheduled meetings do not block either', async () => {
    const [{ id }] = (await json(await api(`/api/meetings?mentorIds=${mentor.id}`, { cookie })))
      .items;
    for (const status of ['completed', 'no_show', 'rescheduled']) {
      await patch(id, { status });
      expect((await post({ startAt: at('10:00'), endAt: at('11:00') })).status).toBe(201);
      await env.DB.prepare(`UPDATE meetings SET status = 'cancelled' WHERE id <> ?`).bind(id).run();
    }
  });

  it('a different mentor can be booked at the same time', async () => {
    const other = await createMentor(cookie);
    await setHours(other.id, [monday('09:00', '17:00')]);
    expect((await post({ mentorId: other.id })).status).toBe(201);
  });

  it('a failed booking leaves nothing behind (no meeting, no call)', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM meetings').first<{
      n: number;
    }>();
    const res = await post({ logCall: true });
    expect(res.status).toBe(409);
    const after = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM meetings) AS m, (SELECT COUNT(*) FROM calls) AS c',
    ).first<{ m: number; c: number }>();
    expect(after).toEqual({ m: before!.n, c: 0 });
  });

  it('two simultaneous bookings of the same free slot: exactly one wins', async () => {
    const results = await Promise.all([
      post({ startAt: at('13:00'), endAt: at('14:00'), title: 'A' }),
      post({ startAt: at('13:00'), endAt: at('14:00'), title: 'B' }),
      post({ startAt: at('13:30'), endAt: at('14:30'), title: 'C' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    const n = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM meetings WHERE start_at >= ? AND status = 'scheduled'`,
    )
      .bind(at('12:00'))
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});

describe('weekly availability and time off', () => {
  it('outside the weekly hours: 422 OUTSIDE_AVAILABILITY, and nothing is created', async () => {
    const res = await post({ startAt: at('18:00'), endAt: at('19:00') });
    expect(res.status).toBe(422);
    const err = (await json(res)).error;
    expect(err.code).toBe('OUTSIDE_AVAILABILITY');
    expect(err.details).toMatchObject({ violations: ['outside_availability'], canForce: true });
    expect((await json(await api('/api/meetings', { cookie }))).items).toHaveLength(0);
  });

  it.each([
    ['sticking out of the end', '16:30', '17:30'],
    ['sticking out of the start', '08:30', '09:30'],
    ['on a day with no hours', '10:00', '11:00', '2030-01-15'],
  ])('outside hours when %s', async (_l, s, e, date = MON) => {
    expect((await post({ startAt: at(s, date), endAt: at(e, date) })).status).toBe(422);
  });

  it('inside a block, or exactly filling it, is fine', async () => {
    expect((await post({ startAt: at('09:00'), endAt: at('17:00') })).status).toBe(201);
  });

  it('several blocks per day: spanning the gap between them is outside', async () => {
    await setHours(mentor.id, [monday('09:00', '12:00'), monday('14:00', '17:00')]);
    expect((await post({ startAt: at('14:00'), endAt: at('15:00') })).status).toBe(201);
    expect(
      (await post({ startAt: at('11:00'), endAt: at('13:00'), title: 'spans lunch' })).status,
    ).toBe(422);
  });

  it('a mentor with no weekly hours at all is "outside" everywhere', async () => {
    await setHours(mentor.id, []);
    expect((await post()).status).toBe(422);
  });

  it('force: true overrides and is recorded in the history', async () => {
    const res = await post({ startAt: at('18:00'), endAt: at('19:00'), force: true });
    expect(res.status).toBe(201);
    const h = await history((await json(res)).meeting.id);
    expect(h[0]?.changes.forced).toEqual(['outside_availability']);
  });

  it('time off blocks booking with 422 TIME_OFF, and force overrides it', async () => {
    await api(`/api/mentors/${mentor.id}/time-off`, {
      method: 'POST',
      cookie,
      json: { startAt: at('09:00'), endAt: at('12:00'), reason: 'Dentist' },
    });
    const blocked = await post({ startAt: at('10:00'), endAt: at('11:00') });
    expect(blocked.status).toBe(422);
    const err = (await json(blocked)).error;
    expect(err.code).toBe('TIME_OFF');
    expect(err.details.violations).toEqual(['time_off']);

    const forced = await post({ startAt: at('10:00'), endAt: at('11:00'), force: true });
    expect(forced.status).toBe(201);
    expect((await history((await json(forced)).meeting.id))[0]?.changes.forced).toEqual([
      'time_off',
    ]);
  });

  it('time off that only touches the meeting does not block it', async () => {
    await api(`/api/mentors/${mentor.id}/time-off`, {
      method: 'POST',
      cookie,
      json: { startAt: at('11:00'), endAt: at('13:00') },
    });
    expect((await post({ startAt: at('10:00'), endAt: at('11:00') })).status).toBe(201);
  });

  it('time off AND outside hours: reports both and records both when forced', async () => {
    await api(`/api/mentors/${mentor.id}/time-off`, {
      method: 'POST',
      cookie,
      json: { startAt: at('17:00'), endAt: at('20:00') },
    });
    const res = await post({ startAt: at('18:00'), endAt: at('19:00') });
    expect((await json(res)).error.details.violations).toEqual([
      'outside_availability',
      'time_off',
    ]);
    const forced = await post({ startAt: at('18:00'), endAt: at('19:00'), force: true });
    expect((await history((await json(forced)).meeting.id))[0]?.changes.forced).toEqual([
      'outside_availability',
      'time_off',
    ]);
  });

  it("availability is read in the mentor's own timezone", async () => {
    const ny = await createMentor(cookie, { timezone: 'America/New_York' });
    await setHours(ny.id, [monday('09:00', '10:00')]); // Monday 09:00-10:00 New York = 14:00-15:00 UTC in January
    expect(
      (
        await post({
          mentorId: ny.id,
          startAt: '2030-01-14T14:00:00Z',
          endAt: '2030-01-14T15:00:00Z',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post({
          mentorId: ny.id,
          startAt: '2030-01-14T09:00:00Z',
          endAt: '2030-01-14T10:00:00Z',
        })
      ).status,
    ).toBe(422);
  });
});

describe('editing meetings', () => {
  it('moving to a free time works, and records a "rescheduled" history entry', async () => {
    const m = await book();
    const res = await patch(m.id, { startAt: at('13:00'), endAt: at('14:00') });
    expect(res.status).toBe(200);
    expect((await json(res)).meeting).toMatchObject({
      start_at: at('13:00'),
      end_at: at('14:00'),
      status: 'scheduled',
    });
    const [latest] = await history(m.id);
    expect(latest?.action).toBe('rescheduled');
    expect(latest?.changes).toEqual({
      start_at: { old: at('10:00'), new: at('13:00') },
      end_at: { old: at('11:00'), new: at('14:00') },
    });
    expect((await history(m.id)).map((h) => h.action)).toEqual(['rescheduled', 'created']);
  });

  it('moving into another meeting: 409 and the meeting is unchanged', async () => {
    await book({ startAt: at('13:00'), endAt: at('14:00') });
    const m = await book();
    const res = await patch(m.id, { startAt: at('13:30'), endAt: at('14:30') });
    expect(res.status).toBe(409);
    expect((await json(res)).error.details.conflictingMeeting.start_at).toBe(at('13:00'));
    const got = (await json(await api(`/api/meetings/${m.id}`, { cookie }))).meeting;
    expect(got.start_at).toBe(at('10:00'));
    expect(await history(m.id)).toHaveLength(1);
  });

  it('a meeting never conflicts with itself: shifting or resizing within its own slot works', async () => {
    const m = await book();
    expect((await patch(m.id, { startAt: at('10:15'), endAt: at('11:15') })).status).toBe(200);
    expect((await patch(m.id, { endAt: at('12:00') })).status).toBe(200); // resize: start stays
    expect((await json(await api(`/api/meetings/${m.id}`, { cookie }))).meeting).toMatchObject({
      start_at: at('10:15'),
      end_at: at('12:00'),
    });
  });

  it('moving outside availability: 422, force overrides and is recorded', async () => {
    const m = await book();
    expect((await patch(m.id, { startAt: at('18:00'), endAt: at('19:00') })).status).toBe(422);
    const forced = await patch(m.id, { startAt: at('18:00'), endAt: at('19:00'), force: true });
    expect(forced.status).toBe(200);
    expect((await history(m.id))[0]?.changes.forced).toEqual(['outside_availability']);
  });

  it('editing text fields only does not re-check availability or conflicts', async () => {
    const m = await book({ startAt: at('18:00'), endAt: at('19:00'), force: true });
    const res = await patch(m.id, {
      notes: 'Went well',
      agenda: 'New agenda',
      title: 'Renamed',
      locationOrLink: 'Room 4',
    });
    expect(res.status).toBe(200);
    expect((await json(res)).meeting).toMatchObject({
      notes: 'Went well',
      agenda: 'New agenda',
      title: 'Renamed',
      location_or_link: 'Room 4',
    });
    expect((await history(m.id))[0]?.action).toBe('updated');
  });

  it('can clear optional text by sending an empty string', async () => {
    const m = await book({ agenda: 'x' });
    expect((await json(await patch(m.id, { agenda: '' }))).meeting.agenda).toBeNull();
  });

  it('cancelling keeps the meeting, records "cancelled", and frees the slot', async () => {
    const m = await book();
    const res = await patch(m.id, { status: 'cancelled' });
    expect((await json(res)).meeting.status).toBe('cancelled');
    expect((await history(m.id))[0]?.action).toBe('cancelled');
    expect((await post()).status).toBe(201); // slot is free again
    expect((await json(await api(`/api/meetings/${m.id}`, { cookie }))).meeting.status).toBe(
      'cancelled',
    ); // still there
  });

  it('status changes are recorded as "status_changed"', async () => {
    const m = await book();
    await patch(m.id, { status: 'no_show' });
    expect((await history(m.id))[0]).toMatchObject({
      action: 'status_changed',
      changes: { status: { old: 'scheduled', new: 'no_show' } },
    });
  });

  it('reopening a cancelled meeting is checked: 409 if the slot was taken, 200 if free', async () => {
    const m = await book();
    await patch(m.id, { status: 'cancelled' });
    const taken = await book(); // same slot
    expect((await patch(m.id, { status: 'scheduled' })).status).toBe(409);
    await patch(taken.id, { status: 'cancelled' });
    expect((await patch(m.id, { status: 'scheduled' })).status).toBe(200);
  });

  it('a no-op PATCH creates no history', async () => {
    const m = await book();
    await patch(m.id, { title: 'Mentoring session', startAt: at('10:00') });
    expect(await history(m.id)).toHaveLength(1);
  });

  it('validates the merged times (400) and unknown values', async () => {
    const m = await book();
    expect((await patch(m.id, { endAt: at('09:00') })).status).toBe(400); // end before existing start
    expect((await patch(m.id, { startAt: at('10:05') })).status).toBe(400);
    expect((await patch(m.id, { endAt: at('10:10') })).status).toBe(400);
    expect((await patch(m.id, { status: 'maybe' })).status).toBe(400);
    expect((await patch('nope', { title: 'x' })).status).toBe(404);
  });

  it('mentor and client cannot be reassigned through PATCH (ignored)', async () => {
    const m = await book();
    const other = await createMentor(cookie);
    const res = await patch(m.id, { mentorId: other.id, title: 'Same mentor' });
    expect((await json(res)).meeting.mentor_id).toBe(mentor.id);
  });

  it('a deactivated mentor: cancelling/completing still works, rescheduling does not', async () => {
    const m = await book();
    await api(`/api/mentors/${mentor.id}`, { method: 'DELETE', cookie });
    expect((await patch(m.id, { startAt: at('13:00'), endAt: at('14:00') })).status).toBe(409);
    expect((await patch(m.id, { status: 'cancelled' })).status).toBe(200);
  });
});

describe('linking to call statuses', () => {
  const clientState = async () => await json(await api(`/api/clients/${client.id}`, { cookie }));

  it('logCall on create adds a "Scheduled" call linked to the meeting and updates the client status', async () => {
    const res = await post({ logCall: true });
    expect(res.status).toBe(201);
    const { meeting, call } = await json(res);
    expect(call).toMatchObject({
      client_id: client.id,
      status: 'scheduled',
      scheduled_at: meeting.start_at,
      meeting_id: meeting.id,
      direction: 'outgoing',
    });
    expect(call.summary).toContain('Asha Mentor');
    expect(call.summary).toContain(`/mentors/${mentor.id}?meeting=${meeting.id}`);
    const state = await clientState();
    expect(state.client.current_status).toBe('scheduled');
    expect(state.calls[0].id).toBe(call.id);
  });

  it('without logCall no call is created and the client status is untouched', async () => {
    await addCall(cookie, client.id, { status: 'follow_up_2' });
    const { call } = await json(await post());
    expect(call).toBeNull();
    const state = await clientState();
    expect(state.client.current_status).toBe('follow_up_2');
    expect(state.calls).toHaveLength(1);
  });

  it('the new "scheduled" call shows up on /api/scheduled', async () => {
    await post({ logCall: true });
    expect((await json(await api('/api/scheduled', { cookie }))).items).toHaveLength(1);
  });

  it('marking completed with logCall adds a "Session Done" call and updates the client status', async () => {
    const m = await book();
    const res = await patch(m.id, { status: 'completed', logCall: true });
    expect(res.status).toBe(200);
    const { call, meeting } = await json(res);
    expect(meeting.status).toBe('completed');
    expect(call).toMatchObject({ status: 'session_done', meeting_id: m.id, scheduled_at: null });
    expect((await clientState()).client.current_status).toBe('session_done');
  });

  it('marking completed without logCall leaves calls and status alone', async () => {
    const m = await book({ logCall: true });
    await patch(m.id, { status: 'completed' });
    const state = await clientState();
    expect(state.client.current_status).toBe('scheduled');
    expect(state.calls).toHaveLength(1);
  });

  it('logCall is rejected when the patch is not completing the meeting', async () => {
    const m = await book();
    const res = await patch(m.id, { notes: 'x', logCall: true });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('INVALID_LOG_CALL');
    const done = await book({ startAt: at('13:00'), endAt: at('14:00') });
    await patch(done.id, { status: 'completed' });
    expect((await patch(done.id, { status: 'completed', logCall: true })).status).toBe(400); // already completed
  });

  it('deleting the meeting keeps the call but unlinks it', async () => {
    const { meeting, call } = await json(await post({ logCall: true }));
    await api(`/api/meetings/${meeting.id}`, { method: 'DELETE', cookie });
    const row = await env.DB.prepare('SELECT meeting_id FROM calls WHERE id = ?')
      .bind(call.id)
      .first<{ meeting_id: string | null }>();
    expect(row).toEqual({ meeting_id: null });
  });
});

describe('reading meetings', () => {
  it('feed: filters by mentor, client, status and window; includes names and colors', async () => {
    const other = await createMentor(cookie, { name: 'Other Mentor' });
    await setHours(other.id, [monday('09:00', '17:00')]);
    const client2 = await createClient(cookie, '0772222222', 'Second');
    const a = await book();
    await book({ mentorId: other.id, clientId: client2.id });
    const c = await book({ startAt: at('13:00'), endAt: at('14:00') });
    await patch(c.id, { status: 'cancelled' });

    const feed = async (qs: string) =>
      (await json(await api(`/api/meetings${qs}`, { cookie }))).items as {
        id: string;
        mentor_name: string;
        client_name: string;
        mentor_color: string;
      }[];
    expect(await feed('')).toHaveLength(3);
    expect((await feed(`?mentorIds=${other.id}`)).map((m) => m.mentor_name)).toEqual([
      'Other Mentor',
    ]);
    expect(await feed(`?mentorIds=${mentor.id},${other.id}`)).toHaveLength(3);
    expect((await feed(`?clientId=${client2.id}`)).map((m) => m.client_name)).toEqual(['Second']);
    expect((await feed('?status=cancelled')).map((m) => m.id)).toEqual([c.id]);
    expect(await feed('?status=scheduled,cancelled')).toHaveLength(3);
    expect((await feed(`?mentorIds=${mentor.id}&status=scheduled`)).map((m) => m.id)).toEqual([
      a.id,
    ]);
    expect((await feed(''))[0]?.mentor_color).toMatch(/^#/);
    expect((await api('/api/meetings?status=bogus', { cookie })).status).toBe(400);
  });

  it('feed: window returns anything overlapping it, using Colombo days for dates', async () => {
    await book({ startAt: at('23:00'), endAt: at('23:45'), force: true });
    await book({
      startAt: at('00:30', '2030-01-15'),
      endAt: at('01:30', '2030-01-15'),
      force: true,
    });
    const count = async (qs: string) =>
      (await json(await api(`/api/meetings?${qs}`, { cookie }))).items.length;
    expect(await count('from=2030-01-14&to=2030-01-14')).toBe(1);
    expect(await count('from=2030-01-15&to=2030-01-15')).toBe(1);
    expect(await count('from=2030-01-14&to=2030-01-15')).toBe(2);
    expect(await count('from=2030-01-16')).toBe(0);
    // A meeting that straddles the window start still counts
    expect(
      await count(`from=${encodeURIComponent(at('23:30'))}&to=${encodeURIComponent(at('23:40'))}`),
    ).toBe(1);
    expect((await api('/api/meetings?from=garbage', { cookie })).status).toBe(400);
  });

  it('feed is ordered by start time', async () => {
    await book({ startAt: at('13:00'), endAt: at('14:00') });
    await book({ startAt: at('09:00'), endAt: at('10:00') });
    const starts = (await json(await api('/api/meetings', { cookie }))).items.map(
      (m: { start_at: string }) => m.start_at,
    );
    expect(starts).toEqual([...starts].sort());
  });

  it('GET /:id returns mentor, client, current status, latest 3 calls and history', async () => {
    for (let i = 1; i <= 4; i++)
      await addCall(cookie, client.id, { summary: `call ${i}`, status: 'follow_up_1' });
    const m = await book();
    await patch(m.id, { notes: 'n' });
    const body = await json(await api(`/api/meetings/${m.id}`, { cookie }));
    expect(body.meeting.id).toBe(m.id);
    expect(body.mentor).toMatchObject({ id: mentor.id, name: 'Asha Mentor', expertise: [] });
    expect(body.client).toMatchObject({ id: client.id, name: 'Nimal' });
    expect(body.clientCurrentStatus).toBe('follow_up_1');
    expect(body.recentCalls.map((c: { summary: string }) => c.summary)).toEqual([
      'call 4',
      'call 3',
      'call 2',
    ]);
    expect(body.history.map((h: { action: string }) => h.action)).toEqual(['updated', 'created']);
    expect((await api('/api/meetings/nope', { cookie })).status).toBe(404);
  });

  it('GET /api/clients/:id/meetings splits upcoming (still scheduled) from past, nearest first', async () => {
    const soon = (h: number) =>
      new Date(Math.ceil((Date.now() + h * 3_600_000) / 900_000) * 900_000);
    const mk = async (start: Date, force = true) =>
      (
        await json(
          await post({
            startAt: start.toISOString(),
            endAt: new Date(start.getTime() + 3_600_000).toISOString(),
            force,
          }),
        )
      ).meeting.id as string;
    const later = await mk(soon(48));
    const sooner = await mk(soon(24));
    const cancelled = await mk(soon(72));
    await patch(cancelled, { status: 'cancelled' });
    const past = await mk(soon(-48));

    const res = await json(await api(`/api/clients/${client.id}/meetings`, { cookie }));
    expect(res.upcoming.map((m: { id: string }) => m.id)).toEqual([sooner, later]);
    expect(res.past.map((m: { id: string }) => m.id).sort()).toEqual([cancelled, past].sort());
    expect(res.upcoming[0]).toMatchObject({
      mentor_name: 'Asha Mentor',
      mentor_color: expect.stringMatching(/^#/),
    });
    expect((await api('/api/clients/nope/meetings', { cookie })).status).toBe(404);
  });

  it('DELETE removes the meeting and its history; 404 the second time', async () => {
    const m = await book();
    expect((await api(`/api/meetings/${m.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await api(`/api/meetings/${m.id}`, { cookie })).status).toBe(404);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM meeting_history').first<{
      n: number;
    }>();
    expect(n?.n).toBe(0);
    expect((await api(`/api/meetings/${m.id}`, { method: 'DELETE', cookie })).status).toBe(404);
  });

  it("mentor list: today's meeting count and next free slot reflect bookings", async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
    const list = async () =>
      (await json(await api('/api/mentors', { cookie }))).items.find(
        (x: { id: string }) => x.id === mentor.id,
      );
    // Hours on every weekday so a slot always exists within two weeks.
    await setHours(
      mentor.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })),
    );
    const before = await list();
    expect(before.next_free_slot).toMatchObject({
      start: expect.any(String),
      end: expect.any(String),
    });
    expect(Date.parse(before.next_free_slot.end) - Date.parse(before.next_free_slot.start)).toBe(
      60 * 60_000,
    );
    expect(before.today_meetings).toBe(0);
    // Book exactly that slot: the next one must be different.
    await post({ startAt: before.next_free_slot.start, endAt: before.next_free_slot.end });
    const after = await list();
    expect(after.next_free_slot.start).not.toBe(before.next_free_slot.start);
    expect(Date.parse(after.next_free_slot.start)).toBeGreaterThanOrEqual(
      Date.parse(before.next_free_slot.end),
    );
    if (
      before.next_free_slot.start.slice(0, 10) === day ||
      new Date(before.next_free_slot.start).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Colombo',
      }) === day
    ) {
      expect(after.today_meetings).toBe(1);
    }
  });

  it('mentors with no hours, and inactive mentors, have no next free slot', async () => {
    await setHours(mentor.id, []);
    const list = (await json(await api('/api/mentors?active=all', { cookie }))).items;
    expect(list.find((x: { id: string }) => x.id === mentor.id).next_free_slot).toBeNull();
  });
});

describe('free slots', () => {
  const slots = async (qs: string, id = mentor.id) => {
    const res = await api(`/api/mentors/${id}/free-slots?${qs}`, { cookie });
    expect(res.status).toBe(200);
    return (await json(res)).slots as { start: string; end: string }[];
  };
  const colomboTimes = (s: { start: string }[]) =>
    s.map((x) => new Date(Date.parse(x.start) + 5.5 * 3_600_000).toISOString().slice(11, 16));

  it('lists open slots for the day: 60 minutes every 30 by default', async () => {
    const s = await slots(`from=${MON}&to=${MON}&duration=60`);
    expect(colomboTimes(s)).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '13:00',
      '13:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
      '16:00',
    ]);
    expect(s[0]).toEqual({ start: at('09:00'), end: at('10:00') });
  });

  it('duration and step change the slots; the mentor default duration is used when omitted', async () => {
    expect(colomboTimes(await slots(`from=${MON}&to=${MON}&duration=120&step=120`))).toEqual([
      '09:00',
      '11:00',
      '13:00',
      '15:00',
    ]);
    await api(`/api/mentors/${mentor.id}`, {
      method: 'PATCH',
      cookie,
      json: { defaultMeetingMinutes: 30 },
    });
    const s = await slots(`from=${MON}&to=${MON}`);
    expect(Date.parse(s[0]!.end) - Date.parse(s[0]!.start)).toBe(30 * 60_000);
  });

  it('subtracts booked meetings (back-to-back slots remain)', async () => {
    await book({ startAt: at('10:00'), endAt: at('12:00') });
    const t = colomboTimes(await slots(`from=${MON}&to=${MON}&duration=60&step=60`));
    expect(t).toEqual(['09:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('ignores cancelled meetings', async () => {
    const m = await book({ startAt: at('10:00'), endAt: at('12:00') });
    await patch(m.id, { status: 'cancelled' });
    expect(colomboTimes(await slots(`from=${MON}&to=${MON}&duration=60&step=60`))).toContain(
      '10:00',
    );
  });

  it('subtracts time off', async () => {
    await api(`/api/mentors/${mentor.id}/time-off`, {
      method: 'POST',
      cookie,
      json: { startAt: at('09:00'), endAt: at('15:00') },
    });
    expect(colomboTimes(await slots(`from=${MON}&to=${MON}&duration=60&step=60`))).toEqual([
      '15:00',
      '16:00',
    ]);
  });

  it('every returned slot is accepted by the booking endpoint (no false offers)', async () => {
    await book({ startAt: at('11:00'), endAt: at('12:30') });
    await api(`/api/mentors/${mentor.id}/time-off`, {
      method: 'POST',
      cookie,
      json: { startAt: at('14:00'), endAt: at('15:15') },
    });
    const s = await slots(`from=${MON}&to=${MON}&duration=45&step=15`);
    expect(s.length).toBeGreaterThan(10);
    for (const slot of s) {
      const res = await post({ startAt: slot.start, endAt: slot.end });
      expect(res.status, `${slot.start}`).toBe(201);
      await api(`/api/meetings/${(await json(res)).meeting.id}`, { method: 'DELETE', cookie });
    }
  });

  it('handles midnight: a Monday 00:30-02:00 Colombo block is Sunday 19:00 UTC, yet belongs to Colombo-Monday', async () => {
    await setHours(mentor.id, [monday('00:30', '02:00')]);
    const mon = await slots(`from=${MON}&to=${MON}&duration=30`);
    expect(mon.map((x) => x.start)).toEqual([
      '2030-01-13T19:00:00.000Z',
      '2030-01-13T19:30:00.000Z',
      '2030-01-13T20:00:00.000Z',
    ]);
    expect(colomboTimes(mon)).toEqual(['00:30', '01:00', '01:30']);
    expect(await slots(`from=2030-01-13&to=2030-01-13&duration=30`)).toEqual([]); // Colombo Sunday: nothing
  });

  it('handles a late-evening block just before Colombo midnight', async () => {
    await setHours(mentor.id, [monday('22:00', '23:45')]);
    const s = await slots(`from=${MON}&to=${MON}&duration=45&step=15`);
    expect(colomboTimes(s)).toEqual(['22:00', '22:15', '22:30', '22:45', '23:00']);
    expect(s[0]?.start).toBe('2030-01-14T16:30:00.000Z'); // same UTC day as Colombo here
  });

  it("converts a mentor's local hours (New York) into the admin's Colombo-day query", async () => {
    const ny = await createMentor(cookie, { timezone: 'America/New_York' });
    await setHours(ny.id, [monday('09:00', '10:00')]); // 14:00-15:00 UTC = 19:30-20:30 Colombo, Monday
    const s = await slots(`from=${MON}&to=${MON}&duration=30`, ny.id);
    expect(s.map((x) => x.start)).toEqual(['2030-01-14T14:00:00.000Z', '2030-01-14T14:30:00.000Z']);
  });

  it('does not offer slots in the past', async () => {
    await setHours(
      mentor.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '00:00', endTime: '23:45' })),
    );
    expect(await slots('from=2020-01-06&to=2020-01-06&duration=30')).toEqual([]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
    const s = await slots(`from=${today}&to=${today}&duration=15&step=15`);
    expect(s.every((x) => Date.parse(x.start) >= Date.now() - 1000)).toBe(true);
  });

  it('inactive mentors have no slots; unknown mentors 404; bad params 400', async () => {
    await api(`/api/mentors/${mentor.id}`, { method: 'DELETE', cookie });
    expect(await slots(`from=${MON}&to=${MON}`)).toEqual([]);
    expect((await api('/api/mentors/nope/free-slots', { cookie })).status).toBe(404);
    expect((await api(`/api/mentors/${mentor.id}/free-slots?duration=20`, { cookie })).status).toBe(
      400,
    );
    expect((await api(`/api/mentors/${mentor.id}/free-slots?duration=10`, { cookie })).status).toBe(
      400,
    );
    expect(
      (await api(`/api/mentors/${mentor.id}/free-slots?from=${MON}&to=2030-01-01`, { cookie }))
        .status,
    ).toBe(400);
    expect(
      (await api(`/api/mentors/${mentor.id}/free-slots?from=2030-01-01&to=2031-01-01`, { cookie }))
        .status,
    ).toBe(400);
  });
});

describe('auth on every meeting route', () => {
  it.each([
    ['GET', '/api/meetings'],
    ['POST', '/api/meetings'],
    ['GET', '/api/meetings/x'],
    ['PATCH', '/api/meetings/x'],
    ['DELETE', '/api/meetings/x'],
    ['GET', '/api/mentors/x/free-slots'],
    ['GET', '/api/clients/x/meetings'],
  ])('%s %s -> 401 without a session', async (method, path) => {
    expect((await api(path, { method })).status).toBe(401);
  });
});
