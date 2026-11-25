import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MENTOR_COLORS } from '@calllog/shared';
import { addCall, api, authed, createClient, createMentor, json } from './helpers';

let cookie: string;
beforeEach(async () => {
  cookie = await authed();
});

const list = async (qs = '') =>
  (await json(await api(`/api/mentors${qs}`, { cookie }))).items as {
    name: string;
    today_meetings: number;
    is_active: boolean;
  }[];
const names = (items: { name: string }[]) => items.map((m) => m.name).sort();

describe('create / read mentors', () => {
  it('creates a mentor with defaults and an auto-assigned palette color', async () => {
    const res = await api('/api/mentors', {
      method: 'POST',
      cookie,
      json: { name: 'Asha', email: 'Asha@Example.com' },
    });
    expect(res.status).toBe(201);
    const { mentor } = await json(res);
    expect(mentor).toMatchObject({
      name: 'Asha',
      email: 'asha@example.com',
      timezone: 'Asia/Colombo',
      default_meeting_minutes: 60,
      is_active: true,
      expertise: [],
      phone_e164: null,
    });
    expect(MENTOR_COLORS).toContain(mentor.color);
  });

  it('gives the next mentors different colors until the palette is used up', async () => {
    const colors = [];
    for (let i = 0; i < 4; i++) colors.push((await createMentor(cookie)).color);
    expect(new Set(colors).size).toBe(4);
  });

  it('keeps an explicit color, timezone, phone and tags', async () => {
    const m = await createMentor(cookie, {
      color: '#FF0000',
      timezone: 'Europe/London',
      phone: '0771234567',
      expertise: ['Python', 'Data'],
      defaultMeetingMinutes: 45,
    });
    const got = (await json(await api(`/api/mentors/${m.id}`, { cookie }))).mentor;
    expect(got).toMatchObject({
      color: '#ff0000',
      timezone: 'Europe/London',
      phone_e164: '+94771234567',
      expertise: ['Python', 'Data'],
      default_meeting_minutes: 45,
    });
  });

  it('409 for a duplicate email (case-insensitive)', async () => {
    await createMentor(cookie, { email: 'dup@example.com' });
    const res = await api('/api/mentors', {
      method: 'POST',
      cookie,
      json: { name: 'X', email: 'DUP@example.com' },
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe('MENTOR_EXISTS');
  });

  it.each([
    ['missing name', { email: 'a@b.com' }],
    ['bad email', { name: 'A', email: 'nope' }],
    ['bad color', { name: 'A', email: 'a@b.com', color: 'blue' }],
    ['bad timezone', { name: 'A', email: 'a@b.com', timezone: 'Mars/Base' }],
    ['bad minutes', { name: 'A', email: 'a@b.com', defaultMeetingMinutes: 20 }],
    ['bad phone', { name: 'A', email: 'a@b.com', phone: '12' }],
  ])('400 for %s', async (_l, body) => {
    const res = await api('/api/mentors', { method: 'POST', cookie, json: body });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('VALIDATION_ERROR');
  });

  it('404 for an unknown mentor', async () => {
    expect((await api('/api/mentors/nope', { cookie })).status).toBe(404);
  });
});

describe('list / search / filter', () => {
  beforeEach(async () => {
    await createMentor(cookie, {
      name: 'Asha Perera',
      email: 'asha@x.com',
      expertise: ['Python', 'Data Science'],
    });
    await createMentor(cookie, {
      name: 'Bimal Silva',
      email: 'bimal@y.com',
      expertise: ['Design'],
    });
    const gone = await createMentor(cookie, {
      name: 'Chathu Gone',
      email: 'chathu@z.com',
      expertise: ['Python'],
    });
    await api(`/api/mentors/${gone.id}`, { method: 'DELETE', cookie });
  });

  it('hides inactive mentors by default; active=all shows everyone; active=false only inactive', async () => {
    expect(names(await list())).toEqual(['Asha Perera', 'Bimal Silva']);
    expect(names(await list('?active=all'))).toEqual(['Asha Perera', 'Bimal Silva', 'Chathu Gone']);
    expect(names(await list('?active=false'))).toEqual(['Chathu Gone']);
  });

  it('searches by name, email and expertise (case-insensitive)', async () => {
    expect(names(await list('?search=bimal'))).toEqual(['Bimal Silva']);
    expect(names(await list('?search=Y.COM'))).toEqual(['Bimal Silva']);
    expect(names(await list('?search=science'))).toEqual(['Asha Perera']);
    expect(names(await list('?search=nobody'))).toEqual([]);
  });

  it('filters by an exact expertise tag', async () => {
    expect(names(await list('?expertise=python'))).toEqual(['Asha Perera']);
    expect(names(await list('?expertise=Pyth'))).toEqual([]);
    expect(names(await list('?expertise=python&active=all'))).toEqual([
      'Asha Perera',
      'Chathu Gone',
    ]);
  });

  it('treats % in search literally and resists SQL injection', async () => {
    expect(await list('?search=%25')).toHaveLength(0);
    const res = await api(`/api/mentors?search=${encodeURIComponent("'; DROP TABLE mentors;--")}`, {
      cookie,
    });
    expect(res.status).toBe(200);
    expect(await list()).toHaveLength(2);
  });

  it('rejects an invalid active value', async () => {
    expect((await api('/api/mentors?active=maybe', { cookie })).status).toBe(400);
  });
});

describe('update / soft delete', () => {
  it('PATCH changes only the given fields', async () => {
    const m = await createMentor(cookie, {
      name: 'Old',
      expertise: ['A'],
      defaultMeetingMinutes: 30,
    });
    const res = await api(`/api/mentors/${m.id}`, {
      method: 'PATCH',
      cookie,
      json: { name: 'New', expertise: ['B', 'C'] },
    });
    expect((await json(res)).mentor).toMatchObject({
      name: 'New',
      expertise: ['B', 'C'],
      default_meeting_minutes: 30,
    });
  });

  it('PATCH can clear phone and bio, and rejects a taken email', async () => {
    const a = await createMentor(cookie, { phone: '0771234567', bio: 'hi' });
    const b = await createMentor(cookie, { email: 'taken@example.com' });
    const cleared = await json(
      await api(`/api/mentors/${a.id}`, { method: 'PATCH', cookie, json: { phone: '', bio: '' } }),
    );
    expect(cleared.mentor).toMatchObject({ phone_e164: null, bio: null });
    const dup = await api(`/api/mentors/${a.id}`, {
      method: 'PATCH',
      cookie,
      json: { email: 'taken@example.com' },
    });
    expect(dup.status).toBe(409);
    expect(b.id).not.toBe(a.id);
  });

  it('PATCH 404s for unknown mentors and 400s on bad values', async () => {
    const m = await createMentor(cookie);
    expect(
      (await api('/api/mentors/nope', { method: 'PATCH', cookie, json: { name: 'x' } })).status,
    ).toBe(404);
    expect(
      (await api(`/api/mentors/${m.id}`, { method: 'PATCH', cookie, json: { color: 'nope' } }))
        .status,
    ).toBe(400);
  });

  it('DELETE is a soft delete: row and availability are kept, mentor can be reactivated', async () => {
    const m = await createMentor(cookie);
    await api(`/api/mentors/${m.id}/availability`, {
      method: 'PUT',
      cookie,
      json: { blocks: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }] },
    });
    const del = await api(`/api/mentors/${m.id}`, { method: 'DELETE', cookie });
    expect(del.status).toBe(200);
    expect((await json(del)).mentor.is_active).toBe(false);

    const row = await env.DB.prepare('SELECT is_active FROM mentors WHERE id = ?')
      .bind(m.id)
      .first<{ is_active: number }>();
    expect(row?.is_active).toBe(0);
    const avail = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM mentor_availability WHERE mentor_id = ?',
    )
      .bind(m.id)
      .first<{ n: number }>();
    expect(avail?.n).toBe(1);

    expect((await api(`/api/mentors/${m.id}`, { cookie })).status).toBe(200); // still readable
    const back = await json(
      await api(`/api/mentors/${m.id}`, { method: 'PATCH', cookie, json: { isActive: true } }),
    );
    expect(back.mentor.is_active).toBe(true);
    expect(await list()).toHaveLength(1);
  });

  it('DELETE 404s for unknown mentors', async () => {
    expect((await api('/api/mentors/nope', { method: 'DELETE', cookie })).status).toBe(404);
  });
});

async function insertMeeting(
  mentorId: string,
  clientId: string,
  startAt: string,
  endAt: string,
  status = 'scheduled',
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO meetings (id, mentor_id, client_id, title, start_at, end_at, status, mode, created_at, updated_at)
     VALUES (?, ?, ?, 'Session', ?, ?, ?, 'online', ?, ?)`,
  )
    .bind(crypto.randomUUID(), mentorId, clientId, startAt, endAt, status, now, now)
    .run();
}

describe('meeting counts on mentors', () => {
  it("counts today's meetings (Colombo day), ignoring cancelled and other days", async () => {
    const m = await createMentor(cookie, { name: 'Counted' });
    const c = await createClient(cookie, '0771234567');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
    const at = (t: string) => new Date(`${day}T${t}+05:30`).toISOString();
    await insertMeeting(m.id, c.id, at('00:30'), at('01:30')); // counts: early morning Colombo = previous day in UTC
    await insertMeeting(m.id, c.id, at('23:00'), at('23:45')); // counts: late evening
    await insertMeeting(m.id, c.id, at('10:00'), at('11:00'), 'cancelled'); // ignored
    const tomorrow = new Date(new Date(at('10:00')).getTime() + 86_400_000).toISOString();
    await insertMeeting(
      m.id,
      c.id,
      tomorrow,
      new Date(Date.parse(tomorrow) + 3_600_000).toISOString(),
    ); // other day
    expect((await list()).find((x) => x.name === 'Counted')?.today_meetings).toBe(2);
  });

  it('GET /:id reports upcoming scheduled meetings, so the UI can warn before deactivating', async () => {
    const m = await createMentor(cookie);
    const c = await createClient(cookie, '0771234567');
    const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    await insertMeeting(m.id, c.id, future(24), future(25));
    await insertMeeting(m.id, c.id, future(48), future(49), 'cancelled'); // not counted
    await insertMeeting(m.id, c.id, future(-48), future(-47)); // past: not counted
    const body = await json(await api(`/api/mentors/${m.id}`, { cookie }));
    expect(body.upcomingScheduledMeetings).toBe(1);
  });
});

describe('weekly availability', () => {
  const put = (id: string, blocks: unknown) =>
    api(`/api/mentors/${id}/availability`, { method: 'PUT', cookie, json: { blocks } });

  it('stores several blocks per day, returned sorted', async () => {
    const m = await createMentor(cookie);
    const res = await put(m.id, [
      { weekday: 3, startTime: '14:00', endTime: '17:00' },
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
      { weekday: 1, startTime: '14:00', endTime: '17:00' },
    ]);
    expect(res.status).toBe(200);
    const { availability } = await json(res);
    expect(
      availability.map(
        (b: { weekday: number; start_time: string }) => `${b.weekday} ${b.start_time}`,
      ),
    ).toEqual(['1 09:00', '1 14:00', '3 14:00']);
    expect(
      (await json(await api(`/api/mentors/${m.id}/availability`, { cookie }))).availability,
    ).toHaveLength(3);
  });

  it('PUT replaces the previous schedule; an empty list clears it; other mentors are untouched', async () => {
    const m = await createMentor(cookie);
    const other = await createMentor(cookie);
    await put(other.id, [{ weekday: 2, startTime: '08:00', endTime: '09:00' }]);
    await put(m.id, [{ weekday: 1, startTime: '09:00', endTime: '12:00' }]);
    await put(m.id, [{ weekday: 5, startTime: '10:00', endTime: '11:00' }]);
    let got = (await json(await api(`/api/mentors/${m.id}/availability`, { cookie }))).availability;
    expect(got).toHaveLength(1);
    expect(got[0].weekday).toBe(5);
    await put(m.id, []);
    got = (await json(await api(`/api/mentors/${m.id}/availability`, { cookie }))).availability;
    expect(got).toHaveLength(0);
    expect(
      (await json(await api(`/api/mentors/${other.id}/availability`, { cookie }))).availability,
    ).toHaveLength(1);
  });

  it('an invalid PUT leaves the existing schedule intact', async () => {
    const m = await createMentor(cookie);
    await put(m.id, [{ weekday: 1, startTime: '09:00', endTime: '12:00' }]);
    const bad = await put(m.id, [
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
      { weekday: 1, startTime: '11:00', endTime: '13:00' },
    ]);
    expect(bad.status).toBe(400);
    expect(
      (await json(await api(`/api/mentors/${m.id}/availability`, { cookie }))).availability,
    ).toHaveLength(1);
  });

  it.each([
    ['end before start', [{ weekday: 1, startTime: '12:00', endTime: '09:00' }]],
    ['bad time format', [{ weekday: 1, startTime: '9am', endTime: '12:00' }]],
    ['bad weekday', [{ weekday: 7, startTime: '09:00', endTime: '12:00' }]],
  ])('400 for %s', async (_l, blocks) => {
    const m = await createMentor(cookie);
    expect((await put(m.id, blocks)).status).toBe(400);
  });

  it('404 for an unknown mentor; GET /:id includes the weekly hours', async () => {
    expect((await put('nope', [])).status).toBe(404);
    expect((await api('/api/mentors/nope/availability', { cookie })).status).toBe(404);
    const m = await createMentor(cookie);
    await put(m.id, [{ weekday: 1, startTime: '09:00', endTime: '12:00' }]);
    expect((await json(await api(`/api/mentors/${m.id}`, { cookie }))).availability).toHaveLength(
      1,
    );
  });
});

describe('time off', () => {
  const post = (id: string, body: unknown) =>
    api(`/api/mentors/${id}/time-off`, { method: 'POST', cookie, json: body });
  const T = { startAt: '2030-03-10T04:00:00Z', endAt: '2030-03-12T04:00:00Z', reason: 'Holiday' };

  it('creates, lists (sorted) and deletes time off', async () => {
    const m = await createMentor(cookie);
    const res = await post(m.id, T);
    expect(res.status).toBe(201);
    const { timeOff } = await json(res);
    expect(timeOff).toMatchObject({
      mentor_id: m.id,
      start_at: '2030-03-10T04:00:00.000Z',
      reason: 'Holiday',
    });
    await post(m.id, { startAt: '2030-01-01T04:00:00Z', endAt: '2030-01-02T04:00:00Z' });

    const items = (await json(await api(`/api/mentors/${m.id}/time-off`, { cookie }))).items;
    expect(items.map((x: { start_at: string }) => x.start_at.slice(0, 10))).toEqual([
      '2030-01-01',
      '2030-03-10',
    ]);

    expect((await api(`/api/time-off/${timeOff.id}`, { method: 'DELETE', cookie })).status).toBe(
      200,
    );
    expect((await json(await api(`/api/mentors/${m.id}/time-off`, { cookie }))).items).toHaveLength(
      1,
    );
    expect((await api(`/api/time-off/${timeOff.id}`, { method: 'DELETE', cookie })).status).toBe(
      404,
    );
  });

  it('stores times in UTC when given an offset', async () => {
    const m = await createMentor(cookie);
    const { timeOff } = await json(
      await post(m.id, {
        startAt: '2030-03-10T10:00:00+05:30',
        endAt: '2030-03-10T12:00:00+05:30',
      }),
    );
    expect(timeOff.start_at).toBe('2030-03-10T04:30:00.000Z');
  });

  it('filters by overlapping window', async () => {
    const m = await createMentor(cookie);
    await post(m.id, T); // 10th - 12th
    const q = async (qs: string) =>
      (await json(await api(`/api/mentors/${m.id}/time-off${qs}`, { cookie }))).items.length;
    expect(await q('?from=2030-03-11&to=2030-03-11')).toBe(1); // overlaps the middle
    expect(await q('?from=2030-03-13')).toBe(0);
    expect(await q('?to=2030-03-01')).toBe(0);
  });

  it.each([
    ['end before start', { startAt: '2030-03-12T04:00:00Z', endAt: '2030-03-10T04:00:00Z' }],
    ['zero length', { startAt: '2030-03-10T04:00:00Z', endAt: '2030-03-10T04:00:00Z' }],
    ['not a date', { startAt: 'soon', endAt: 'later' }],
    ['missing fields', {}],
  ])('400 for %s', async (_l, body) => {
    const m = await createMentor(cookie);
    expect((await post(m.id, body)).status).toBe(400);
  });

  it('404 for an unknown mentor', async () => {
    expect((await post('nope', T)).status).toBe(404);
    expect((await api('/api/mentors/nope/time-off', { cookie })).status).toBe(404);
  });
});

describe('deleting a mentor row cascades its schedule data', () => {
  it('removes availability and time off with the mentor (hard delete, e.g. maintenance)', async () => {
    const m = await createMentor(cookie);
    await api(`/api/mentors/${m.id}/availability`, {
      method: 'PUT',
      cookie,
      json: { blocks: [{ weekday: 1, startTime: '09:00', endTime: '10:00' }] },
    });
    await api(`/api/mentors/${m.id}/time-off`, {
      method: 'POST',
      cookie,
      json: { startAt: '2030-03-10T04:00:00Z', endAt: '2030-03-11T04:00:00Z' },
    });
    await env.DB.prepare('DELETE FROM mentors WHERE id = ?').bind(m.id).run();
    const n = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM mentor_availability) AS a, (SELECT COUNT(*) FROM mentor_time_off) AS t',
    ).first<{ a: number; t: number }>();
    expect(n).toEqual({ a: 0, t: 0 });
  });
});

describe('mentor deletion is blocked at the DB level while meetings exist', () => {
  it('meetings reference mentors without cascade, so history cannot be wiped by accident', async () => {
    const m = await createMentor(cookie);
    const c = await createClient(cookie, '0771234567');
    await addCall(cookie, c.id); // unrelated call, just exercising shared fixtures
    await insertMeeting(m.id, c.id, '2030-01-01T04:00:00.000Z', '2030-01-01T05:00:00.000Z');
    await expect(
      env.DB.prepare('DELETE FROM mentors WHERE id = ?').bind(m.id).run(),
    ).rejects.toThrow();
  });
});

describe('auth on every mentor route', () => {
  it.each([
    ['GET', '/api/mentors'],
    ['POST', '/api/mentors'],
    ['GET', '/api/mentors/x'],
    ['PATCH', '/api/mentors/x'],
    ['DELETE', '/api/mentors/x'],
    ['GET', '/api/mentors/x/availability'],
    ['PUT', '/api/mentors/x/availability'],
    ['GET', '/api/mentors/x/time-off'],
    ['POST', '/api/mentors/x/time-off'],
    ['DELETE', '/api/time-off/x'],
  ])('%s %s -> 401 without a session', async (method, path) => {
    expect((await api(path, { method })).status).toBe(401);
  });
});
