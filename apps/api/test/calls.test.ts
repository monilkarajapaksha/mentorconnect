import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { addCall, api, authed, createClient, json } from './helpers';

let cookie: string;
let clientId: string;
beforeEach(async () => {
  cookie = await authed();
  clientId = (await createClient(cookie, '0771234567', 'Nimal')).id;
});

const getClient = async () =>
  (await json(await api(`/api/clients/${clientId}`, { cookie }))).client;
const post = (body: unknown) =>
  api(`/api/clients/${clientId}/calls`, { method: 'POST', cookie, json: body });
const patch = (id: string, body: unknown) =>
  api(`/api/calls/${id}`, { method: 'PATCH', cookie, json: body });
const FUTURE = '2030-01-15T04:30:00.000Z';

describe('creating calls', () => {
  it('creates a call and syncs the client current_status + last_call_at', async () => {
    const res = await post({ direction: 'outgoing', status: 'follow_up_1', summary: 'Intro call' });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.call).toMatchObject({
      client_id: clientId,
      status: 'follow_up_1',
      direction: 'outgoing',
    });
    expect(body.client.current_status).toBe('follow_up_1');
    expect(body.client.last_call_at).toBe(body.call.created_at);
  });

  it('records which admin created it', async () => {
    const { call } = await json(
      await post({ direction: 'incoming', status: 'declined', summary: 's' }),
    );
    expect(call.created_by_admin_id).toBeTruthy();
    expect(call.updated_by_admin_id).toBe(call.created_by_admin_id);
  });

  it('rejects statuses outside the enum (400)', async () => {
    for (const status of ['nope', 'follow_up_11', 'follow_up_0', 'FOLLOW_UP_1', '']) {
      expect((await post({ direction: 'incoming', status, summary: 's' })).status).toBe(400);
    }
  });

  it.each([
    'declined',
    'follow_up_1',
    'follow_up_10',
    'order_confirmed',
    'payment_done',
    'session_done',
    'feedback_received',
  ])('accepts status %s', async (status) => {
    expect((await post({ direction: 'incoming', status, summary: 's' })).status).toBe(201);
  });

  it('requires summary and a valid direction', async () => {
    expect((await post({ direction: 'incoming', status: 'declined' })).status).toBe(400);
    expect((await post({ direction: 'incoming', status: 'declined', summary: '  ' })).status).toBe(
      400,
    );
    expect((await post({ direction: 'sideways', status: 'declined', summary: 's' })).status).toBe(
      400,
    );
  });

  it('scheduled requires scheduledAt; stored as UTC', async () => {
    const missing = await post({ direction: 'incoming', status: 'scheduled', summary: 's' });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(await json(missing))).toContain('scheduledAt');

    const ok = await post({
      direction: 'incoming',
      status: 'scheduled',
      summary: 's',
      scheduledAt: '2030-01-15T10:00:00+05:30', // Colombo time
    });
    expect(ok.status).toBe(201);
    expect((await json(ok)).call.scheduled_at).toBe('2030-01-15T04:30:00.000Z');
  });

  it('rejects a garbage scheduledAt', async () => {
    const res = await post({
      direction: 'incoming',
      status: 'scheduled',
      summary: 's',
      scheduledAt: 'tomorrow',
    });
    expect(res.status).toBe(400);
  });

  it('404 for an unknown client', async () => {
    const res = await api('/api/clients/nope/calls', {
      method: 'POST',
      cookie,
      json: { direction: 'incoming', status: 'declined', summary: 's' },
    });
    expect(res.status).toBe(404);
  });

  it('the most recent call wins even when created within the same millisecond', async () => {
    const stamp = '2030-01-01T00:00:00.000Z';
    const a = await addCall(cookie, clientId, { status: 'follow_up_1' });
    const b = await addCall(cookie, clientId, { status: 'follow_up_2' });
    await env.DB.prepare('UPDATE calls SET created_at = ?').bind(stamp).run();
    await patch(a.id, { summary: 'touch' }); // triggers recompute
    expect(b.status).toBe('follow_up_2');
    expect((await getClient()).current_status).toBe('follow_up_2');
  });
});

describe('editing calls', () => {
  it('editing the LATEST call updates the client current_status', async () => {
    await addCall(cookie, clientId, { status: 'follow_up_1' });
    const latest = await addCall(cookie, clientId, { status: 'follow_up_2' });
    expect((await getClient()).current_status).toBe('follow_up_2');
    const res = await patch(latest.id, { status: 'order_confirmed' });
    expect(res.status).toBe(200);
    expect((await json(res)).client.current_status).toBe('order_confirmed');
    expect((await getClient()).current_status).toBe('order_confirmed');
  });

  it('editing an OLDER call does not change the client current_status', async () => {
    const first = await addCall(cookie, clientId, { status: 'follow_up_1' });
    await addCall(cookie, clientId, { status: 'follow_up_2' });
    await patch(first.id, { status: 'declined', summary: 'corrected' });
    expect((await getClient()).current_status).toBe('follow_up_2');
  });

  it('can update summary, notes, direction and scheduled time', async () => {
    const call = await addCall(cookie, clientId, { status: 'scheduled', scheduledAt: FUTURE });
    const res = await patch(call.id, {
      summary: 'Updated summary',
      notes: 'Bring brochure',
      direction: 'outgoing',
      scheduledAt: '2030-02-01T05:00:00Z',
    });
    expect((await json(res)).call).toMatchObject({
      summary: 'Updated summary',
      notes: 'Bring brochure',
      direction: 'outgoing',
      scheduled_at: '2030-02-01T05:00:00.000Z',
    });
  });

  it('changing to scheduled without a time is rejected; with a time it is accepted', async () => {
    const call = await addCall(cookie, clientId, { status: 'follow_up_1' });
    expect((await patch(call.id, { status: 'scheduled' })).status).toBe(400);
    expect((await patch(call.id, { status: 'scheduled', scheduledAt: FUTURE })).status).toBe(200);
  });

  it('cannot clear scheduledAt while the status is scheduled', async () => {
    const call = await addCall(cookie, clientId, { status: 'scheduled', scheduledAt: FUTURE });
    expect((await patch(call.id, { scheduledAt: null })).status).toBe(400);
  });

  it('rejects an invalid status on edit and 404s for an unknown call', async () => {
    const call = await addCall(cookie, clientId);
    expect((await patch(call.id, { status: 'bogus' })).status).toBe(400);
    expect((await patch('nope', { summary: 'x' })).status).toBe(404);
  });

  it('writes call_history with old/new values and flags the call as edited', async () => {
    const call = await addCall(cookie, clientId, { summary: 'before', status: 'follow_up_1' });
    await patch(call.id, { summary: 'after', status: 'follow_up_2' });

    const hist = await json(await api(`/api/calls/${call.id}/history`, { cookie }));
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0].changes).toEqual({
      summary: { old: 'before', new: 'after' },
      status: { old: 'follow_up_1', new: 'follow_up_2' },
    });
    expect(hist.items[0].admin_name).toBeTruthy();

    const { calls } = await json(await api(`/api/clients/${clientId}`, { cookie }));
    expect(calls[0].edited).toBe(true);
  });

  it('a no-op edit creates no history; untouched calls are not flagged edited', async () => {
    const call = await addCall(cookie, clientId, { summary: 'same' });
    await patch(call.id, { summary: 'same' });
    const hist = await json(await api(`/api/calls/${call.id}/history`, { cookie }));
    expect(hist.items).toHaveLength(0);
    const { calls } = await json(await api(`/api/clients/${clientId}`, { cookie }));
    expect(calls[0].edited).toBe(false);
  });
});

describe('deleting calls', () => {
  it('deleting the latest call falls back to the previous call status', async () => {
    await addCall(cookie, clientId, { status: 'follow_up_1' });
    const latest = await addCall(cookie, clientId, { status: 'payment_done' });
    const res = await api(`/api/calls/${latest.id}`, { method: 'DELETE', cookie });
    expect(res.status).toBe(200);
    expect((await getClient()).current_status).toBe('follow_up_1');
  });

  it('deleting the only call clears current_status and last_call_at', async () => {
    const only = await addCall(cookie, clientId);
    await api(`/api/calls/${only.id}`, { method: 'DELETE', cookie });
    expect(await getClient()).toMatchObject({ current_status: null, last_call_at: null });
  });

  it('deletes its history too, and 404s for unknown calls', async () => {
    const call = await addCall(cookie, clientId);
    await patch(call.id, { summary: 'changed' });
    await api(`/api/calls/${call.id}`, { method: 'DELETE', cookie });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM call_history').first<{ n: number }>();
    expect(n?.n).toBe(0);
    expect((await api(`/api/calls/${call.id}`, { method: 'DELETE', cookie })).status).toBe(404);
  });
});

describe('GET /api/calls', () => {
  it('lists calls across clients with client info, filtered by status and date', async () => {
    const other = await createClient(cookie, '0772222222', 'Other');
    const a = await addCall(cookie, clientId, { status: 'declined' });
    await addCall(cookie, other.id, { status: 'follow_up_3' });
    await env.DB.prepare('UPDATE calls SET created_at = ? WHERE id = ?')
      .bind('2026-03-10T20:00:00.000Z', a.id)
      .run();

    const all = await json(await api('/api/calls', { cookie }));
    expect(all.total).toBe(2);
    expect(all.items[0]).toHaveProperty('client_name');

    const declined = await json(await api('/api/calls?status=declined', { cookie }));
    expect(declined.items.map((x: { client_name: string }) => x.client_name)).toEqual(['Nimal']);

    const day = await json(await api('/api/calls?from=2026-03-11&to=2026-03-11', { cookie }));
    expect(day.total).toBe(1);
    expect(day.items[0].id).toBe(a.id);
    expect((await api('/api/calls?status=bogus', { cookie })).status).toBe(400);
  });
});

describe('GET /api/scheduled', () => {
  const past = new Date(Date.now() - 3600_000).toISOString();
  const soon = new Date(Date.now() + 3600_000).toISOString();

  it('sorts by scheduled time and flags overdue ones', async () => {
    const c2 = await createClient(cookie, '0772222222', 'Second');
    await addCall(cookie, clientId, { status: 'scheduled', scheduledAt: soon });
    await addCall(cookie, c2.id, { status: 'scheduled', scheduledAt: past });
    const { items } = await json(await api('/api/scheduled', { cookie }));
    expect(items.map((x: { client_name: string }) => x.client_name)).toEqual(['Second', 'Nimal']);
    expect(items.map((x: { overdue: boolean }) => x.overdue)).toEqual([true, false]);
  });

  it('drops a scheduled call once the client has a newer call', async () => {
    await addCall(cookie, clientId, { status: 'scheduled', scheduledAt: soon });
    expect((await json(await api('/api/scheduled', { cookie }))).items).toHaveLength(1);
    await addCall(cookie, clientId, { status: 'order_confirmed' });
    expect((await json(await api('/api/scheduled', { cookie }))).items).toHaveLength(0);
  });

  it('filters by date range', async () => {
    await addCall(cookie, clientId, { status: 'scheduled', scheduledAt: '2030-05-05T04:00:00Z' });
    expect(
      (await json(await api('/api/scheduled?from=2030-05-05&to=2030-05-05', { cookie }))).items,
    ).toHaveLength(1);
    expect(
      (await json(await api('/api/scheduled?from=2030-05-06', { cookie }))).items,
    ).toHaveLength(0);
  });
});

describe('auth on call routes', () => {
  it.each([
    ['GET', '/api/calls'],
    ['PATCH', '/api/calls/x'],
    ['DELETE', '/api/calls/x'],
    ['GET', '/api/calls/x/history'],
    ['GET', '/api/scheduled'],
  ])('%s %s -> 401 without a session', async (method, path) => {
    expect((await api(path, { method })).status).toBe(401);
  });
});
