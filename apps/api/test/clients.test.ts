import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { addCall, api, authed, createClient, json } from './helpers';

let cookie: string;
beforeEach(async () => {
  cookie = await authed();
});

describe('phone normalization & lookup', () => {
  it.each(['0771234567', '077 123 4567', '+94771234567', '94771234567'])(
    'lookup of %s finds the same client',
    async (variant) => {
      const c = await createClient(cookie, '0771234567', 'Nimal');
      expect(c.phone_e164).toBe('+94771234567');
      const res = await api(`/api/clients/lookup?phone=${encodeURIComponent(variant)}`, { cookie });
      const body = await json(res);
      expect(body.found).toBe(true);
      expect(body.client.id).toBe(c.id);
    },
  );

  it('handles an unencoded "+" (decoded as a space) in the query string', async () => {
    const c = await createClient(cookie, '+94771234567');
    const res = await api('/api/clients/lookup?phone=+94771234567', { cookie });
    expect((await json(res)).client.id).toBe(c.id);
  });

  it('returns found:false with the normalized number for a new number', async () => {
    const res = await api('/api/clients/lookup?phone=0712345678', { cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ found: false, normalizedPhone: '+94712345678' });
  });

  it('returns 400 for an invalid or missing number', async () => {
    expect((await api('/api/clients/lookup?phone=abc', { cookie })).status).toBe(400);
    expect((await api('/api/clients/lookup', { cookie })).status).toBe(400);
  });

  it('returns calls newest first, and suggests the next follow-up', async () => {
    const c = await createClient(cookie, '0771234567');
    await addCall(cookie, c.id, { status: 'follow_up_1', summary: 'first' });
    await addCall(cookie, c.id, { status: 'follow_up_2', summary: 'second' });
    const body = await json(await api('/api/clients/lookup?phone=0771234567', { cookie }));
    expect(body.calls.map((x: { summary: string }) => x.summary)).toEqual(['second', 'first']);
    expect(body.client.current_status).toBe('follow_up_2');
    expect(body.suggestedStatus).toBe('follow_up_3');
  });

  it('suggests follow_up_1 for a new client and caps at follow_up_10', async () => {
    const c = await createClient(cookie, '0771234567');
    let body = await json(await api(`/api/clients/${c.id}`, { cookie }));
    expect(body.suggestedStatus).toBe('follow_up_1');
    await addCall(cookie, c.id, { status: 'follow_up_10' });
    body = await json(await api(`/api/clients/${c.id}`, { cookie }));
    expect(body.suggestedStatus).toBe('follow_up_10');
  });

  it('suggests follow_up_1 after a non-follow-up status', async () => {
    const c = await createClient(cookie, '0771234567');
    await addCall(cookie, c.id, { status: 'declined' });
    const body = await json(await api(`/api/clients/${c.id}`, { cookie }));
    expect(body.suggestedStatus).toBe('follow_up_1');
  });
});

describe('create / update client', () => {
  it('creates a client with only name + phone (optional fields null)', async () => {
    const res = await api('/api/clients', {
      method: 'POST',
      cookie,
      json: { phone: '0771234567', name: 'Kamal' },
    });
    expect(res.status).toBe(201);
    const { client } = await json(res);
    expect(client).toMatchObject({
      name: 'Kamal',
      company: null,
      email: null,
      notes: null,
      current_status: null,
    });
  });

  it('requires a name and a valid phone (400)', async () => {
    expect(
      (await api('/api/clients', { method: 'POST', cookie, json: { phone: '0771234567' } })).status,
    ).toBe(400);
    expect(
      (await api('/api/clients', { method: 'POST', cookie, json: { phone: '12', name: 'x' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await api('/api/clients', {
          method: 'POST',
          cookie,
          json: { phone: '0771234567', name: ' ' },
        })
      ).status,
    ).toBe(400);
  });

  it('accepts an empty-string email as null but rejects a malformed one', async () => {
    const ok = await api('/api/clients', {
      method: 'POST',
      cookie,
      json: { phone: '0771234567', name: 'A', email: '' },
    });
    expect((await json(ok)).client.email).toBeNull();
    const bad = await api('/api/clients', {
      method: 'POST',
      cookie,
      json: { phone: '0772345678', name: 'B', email: 'nope' },
    });
    expect(bad.status).toBe(400);
  });

  it('409 for a duplicate phone, even written in another format', async () => {
    const c = await createClient(cookie, '0771234567');
    const res = await api('/api/clients', {
      method: 'POST',
      cookie,
      json: { phone: '+94 77 123 4567', name: 'Dup' },
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe('CLIENT_EXISTS');
    expect(body.error.details.clientId).toBe(c.id);
  });

  it('PATCH updates only the given fields; phone cannot be changed', async () => {
    const c = await createClient(cookie, '0771234567', 'Old', { company: 'Acme' });
    const res = await api(`/api/clients/${c.id}`, {
      method: 'PATCH',
      cookie,
      json: { name: 'New', phone: '0779999999' },
    });
    const { client } = await json(res);
    expect(client).toMatchObject({ name: 'New', company: 'Acme', phone_e164: '+94771234567' });
  });

  it('PATCH can clear an optional field; 404 for unknown id', async () => {
    const c = await createClient(cookie, '0771234567', 'N', { company: 'Acme' });
    const res = await api(`/api/clients/${c.id}`, {
      method: 'PATCH',
      cookie,
      json: { company: '' },
    });
    expect((await json(res)).client.company).toBeNull();
    expect(
      (await api('/api/clients/nope', { method: 'PATCH', cookie, json: { name: 'x' } })).status,
    ).toBe(404);
    expect((await api('/api/clients/nope', { cookie })).status).toBe(404);
  });
});

describe('list, search, filters', () => {
  async function seed() {
    const a = await createClient(cookie, '0771111111', 'Alice', { company: 'Zeta Corp' });
    const b = await createClient(cookie, '0772222222', 'Bob');
    const c = await createClient(cookie, '0773333333', 'Carol');
    const d = await createClient(cookie, '0774444444', 'Dave'); // never called
    await addCall(cookie, a.id, { status: 'follow_up_2' });
    await addCall(cookie, b.id, { status: 'follow_up_5' });
    await addCall(cookie, c.id, { status: 'declined' });
    return { a, b, c, d };
  }
  const list = async (qs = '') => json(await api(`/api/clients${qs}`, { cookie }));

  it('filters by multiple statuses', async () => {
    await seed();
    const body = await list('?status=follow_up_2,declined');
    expect(body.items.map((x: { name: string }) => x.name).sort()).toEqual(['Alice', 'Carol']);
    expect(body.total).toBe(2);
  });

  it('"any follow-up" = follow_up_1..10 expanded by the client', async () => {
    await seed();
    const all = Array.from({ length: 10 }, (_, i) => `follow_up_${i + 1}`).join(',');
    const body = await list(`?status=${all}`);
    expect(body.items.map((x: { name: string }) => x.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('rejects an unknown status (400)', async () => {
    expect((await api('/api/clients?status=bogus', { cookie })).status).toBe(400);
  });

  it('searches by name, company and phone (local format too)', async () => {
    await seed();
    expect((await list('?search=bob')).items).toHaveLength(1);
    expect((await list('?search=zeta')).items[0].name).toBe('Alice');
    expect((await list('?search=0773333333')).items[0].name).toBe('Carol');
    expect((await list('?search=+94774444444')).items).toHaveLength(1);
  });

  it('treats % and _ in search literally and is safe against SQL injection', async () => {
    await seed();
    expect((await list('?search=%25')).items).toHaveLength(0);
    const res = await api(`/api/clients?search=${encodeURIComponent("'; DROP TABLE clients;--")}`, {
      cookie,
    });
    expect(res.status).toBe(200);
    expect((await list()).total).toBe(4);
  });

  it('statusCounts ignore the status filter but respect search', async () => {
    await seed();
    const all = await list('?status=declined');
    expect(all.items).toHaveLength(1);
    expect(all.statusCounts).toMatchObject({
      follow_up_2: 1,
      follow_up_5: 1,
      declined: 1,
      follow_up_1: 0,
    });
    const searched = await list('?search=alice');
    expect(searched.statusCounts.follow_up_2).toBe(1);
    expect(searched.statusCounts.declined).toBe(0);
  });

  it('filters by last-call date range (whole days in Colombo time)', async () => {
    const { a, b } = await seed();
    // 2026-03-10 20:00 UTC is already 2026-03-11 01:30 in Colombo.
    await env.DB.prepare('UPDATE clients SET last_call_at = ? WHERE id = ?')
      .bind('2026-03-10T20:00:00.000Z', a.id)
      .run();
    await env.DB.prepare('UPDATE clients SET last_call_at = ? WHERE id = ?')
      .bind('2026-03-01T05:00:00.000Z', b.id)
      .run();
    expect(
      (await list('?from=2026-03-11&to=2026-03-11')).items.map((x: { name: string }) => x.name),
    ).toEqual(['Alice']);
    expect((await list('?from=2026-03-10&to=2026-03-10')).items).toHaveLength(0);
    expect((await list('?to=2026-03-05')).items.map((x: { name: string }) => x.name)).toEqual([
      'Bob',
    ]);
    expect((await api('/api/clients?from=garbage', { cookie })).status).toBe(400);
  });

  it('sorts by last call date, with never-called clients last', async () => {
    const { a, b, c } = await seed();
    await env.DB.prepare('UPDATE clients SET last_call_at = ? WHERE id = ?')
      .bind('2026-01-01T00:00:00.000Z', a.id)
      .run();
    await env.DB.prepare('UPDATE clients SET last_call_at = ? WHERE id = ?')
      .bind('2026-02-01T00:00:00.000Z', b.id)
      .run();
    await env.DB.prepare('UPDATE clients SET last_call_at = ? WHERE id = ?')
      .bind('2026-03-01T00:00:00.000Z', c.id)
      .run();
    const names = (b: { items: { name: string }[] }) => b.items.map((x) => x.name);
    expect(names(await list('?sort=last_call_desc'))).toEqual(['Carol', 'Bob', 'Alice', 'Dave']);
    expect(names(await list('?sort=last_call_asc'))).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
  });

  it('paginates 25 per page', async () => {
    // Bulk insert in one batch: 30 sequential HTTP calls made this test slow and load-sensitive.
    const now = new Date().toISOString();
    await env.DB.batch(
      Array.from({ length: 30 }, (_, i) =>
        env.DB.prepare(
          'INSERT INTO clients (id, phone_e164, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), `+947712345${String(i).padStart(2, '0')}`, `C${i}`, now, now),
      ),
    );
    const p1 = await list();
    const p2 = await list('?page=2');
    expect(p1.items).toHaveLength(25);
    expect(p2.items).toHaveLength(5);
    expect(p1.total).toBe(30);
  });
});

describe('stats', () => {
  it('counts clients per current status', async () => {
    const a = await createClient(cookie, '0771111111');
    await createClient(cookie, '0772222222');
    await addCall(cookie, a.id, { status: 'payment_done' });
    const body = await json(await api('/api/stats', { cookie }));
    expect(body).toMatchObject({ total: 2, noCalls: 1 });
    expect(body.counts.payment_done).toBe(1);
    expect(body.counts.declined).toBe(0);
  });
});

describe('auth on client routes', () => {
  it.each([
    ['GET', '/api/clients'],
    ['GET', '/api/clients/lookup?phone=0771234567'],
    ['POST', '/api/clients'],
    ['GET', '/api/clients/x'],
    ['PATCH', '/api/clients/x'],
    ['POST', '/api/clients/x/calls'],
    ['GET', '/api/stats'],
  ])('%s %s -> 401 without a session', async (method, path) => {
    expect((await api(path, { method })).status).toBe(401);
  });
});
