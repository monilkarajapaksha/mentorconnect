import { Hono } from 'hono';
import {
  CALL_STATUSES,
  createCallSchema,
  createClientSchema,
  listClientsQuerySchema,
  normalizePhone,
  suggestNextStatus,
  updateClientSchema,
  type Call,
  type Client,
} from '@calllog/shared';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { MEETING_SELECT } from '../lib/meetings';
import { likePattern, offset, paginated, PAGE_SIZE, rangeBound, recomputeClient } from '../lib/db';

const clients = new Hono<AppEnv>();

type CallRow = Omit<Call, 'edited'> & { edited: number };
const toCall = (r: CallRow): Call => ({ ...r, edited: !!r.edited });

async function loadClientWithCalls(db: D1Database, client: Client) {
  const { results } = await db
    .prepare(
      `SELECT c.*, EXISTS(SELECT 1 FROM call_history h WHERE h.call_id = c.id) AS edited
       FROM calls c WHERE c.client_id = ? ORDER BY c.created_at DESC, c.rowid DESC`,
    )
    .bind(client.id)
    .all<CallRow>();
  return {
    client,
    calls: results.map(toCall),
    suggestedStatus: suggestNextStatus(client.current_status),
  };
}

// --- lookup by phone (must be registered before /:id) ---
clients.get('/lookup', async (c) => {
  // A raw "+" in a query string is decoded as a space; restore it.
  const raw = c.req.query('phone') ?? '';
  const phone = raw.startsWith(' ') ? `+${raw.trimStart()}` : raw;
  const normalized = normalizePhone(phone);
  if (!normalized) throw new AppError(400, 'INVALID_PHONE', 'Invalid phone number');

  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE phone_e164 = ?')
    .bind(normalized)
    .first<Client>();
  if (!client) return c.json({ found: false, normalizedPhone: normalized });
  return c.json({ found: true, ...(await loadClientWithCalls(c.env.DB, client)) });
});

// --- list with filters ---
clients.get('/', async (c) => {
  const q = listClientsQuerySchema.parse(c.req.query());
  const db = c.env.DB;

  // Filters shared by the list and by statusCounts (everything except the status filter).
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.search) {
    const clauses = [
      "name LIKE ? ESCAPE '\\'",
      "company LIKE ? ESCAPE '\\'",
      "phone_e164 LIKE ? ESCAPE '\\'",
    ];
    params.push(likePattern(q.search), likePattern(q.search));
    // Local-format numbers (0771234567) should match the stored +94 form.
    const digits = q.search.replace(/\D/g, '').replace(/^0+/, '');
    params.push(likePattern(digits || q.search));
    where.push(`(${clauses.join(' OR ')})`);
  }
  const from = rangeBound(q.from, 'from');
  const to = rangeBound(q.to, 'to');
  if (from) {
    where.push('last_call_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('last_call_at <= ?');
    params.push(to);
  }

  const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const listWhere = [...where];
  const listParams = [...params];
  if (q.status.length) {
    listWhere.push(`current_status IN (${q.status.map(() => '?').join(',')})`);
    listParams.push(...q.status);
  }
  const listWhereSql = listWhere.length ? `WHERE ${listWhere.join(' AND ')}` : '';
  const dir = q.sort === 'last_call_asc' ? 'ASC' : 'DESC';

  const [items, total, counts] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM clients ${listWhereSql}
         ORDER BY last_call_at IS NULL, last_call_at ${dir}, created_at DESC LIMIT ${PAGE_SIZE} OFFSET ?`,
      )
      .bind(...listParams, offset(q.page))
      .all<Client>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM clients ${listWhereSql}`)
      .bind(...listParams)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT current_status AS status, COUNT(*) AS n FROM clients ${baseWhere}
         ${baseWhere ? 'AND' : 'WHERE'} current_status IS NOT NULL GROUP BY current_status`,
      )
      .bind(...params)
      .all<{ status: string; n: number }>(),
  ]);

  const statusCounts = Object.fromEntries(CALL_STATUSES.map((s) => [s, 0])) as Record<
    string,
    number
  >;
  for (const row of counts.results) statusCounts[row.status] = row.n;

  return c.json({ ...paginated(items.results, q.page, total?.n ?? 0), statusCounts });
});

// --- create ---
clients.post('/', async (c) => {
  const input = createClientSchema.parse(await c.req.json());
  const db = c.env.DB;
  const existing = await db
    .prepare('SELECT id FROM clients WHERE phone_e164 = ?')
    .bind(input.phone)
    .first<{ id: string }>();
  if (existing) {
    throw new AppError(409, 'CLIENT_EXISTS', 'A client with this phone number already exists', {
      clientId: existing.id,
    });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO clients (id, phone_e164, name, company, email, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.phone, input.name, input.company, input.email, input.notes, now, now)
      .run();
  } catch (e) {
    // Lost a race with another insert of the same number.
    if (String(e).includes('UNIQUE'))
      throw new AppError(409, 'CLIENT_EXISTS', 'A client with this phone number already exists');
    throw e;
  }
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Client>();
  return c.json({ client }, 201);
});

// --- one client with calls ---
clients.get('/:id', async (c) => {
  const client = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Client>();
  if (!client) throw new AppError(404, 'NOT_FOUND', 'Client not found');
  return c.json(await loadClientWithCalls(c.env.DB, client));
});

// --- this client's meetings: upcoming = still-scheduled and in the future; everything else is past ---
clients.get('/:id/meetings', async (c) => {
  const id = c.req.param('id');
  const exists = await c.env.DB.prepare('SELECT 1 AS x FROM clients WHERE id = ?').bind(id).first();
  if (!exists) throw new AppError(404, 'NOT_FOUND', 'Client not found');
  const { results } = await c.env.DB.prepare(
    `${MEETING_SELECT} WHERE m.client_id = ? ORDER BY m.start_at DESC`,
  )
    .bind(id)
    .all<{ status: string; start_at: string }>();
  const now = new Date().toISOString();
  const isUpcoming = (m: { status: string; start_at: string }) =>
    m.status === 'scheduled' && m.start_at >= now;
  return c.json({
    upcoming: results.filter(isUpcoming).reverse(),
    past: results.filter((m) => !isUpcoming(m)),
  });
});

// --- update ---
clients.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const input = updateClientSchema.parse(await c.req.json());
  const db = c.env.DB;
  const entries = Object.entries(input).filter(([, v]) => v !== undefined);
  if (entries.length) {
    // Column names come from the zod schema keys (name/company/email/notes), never from user input.
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    const res = await db
      .prepare(`UPDATE clients SET ${sets}, updated_at = ? WHERE id = ?`)
      .bind(...entries.map(([, v]) => v), new Date().toISOString(), id)
      .run();
    if (!res.meta.changes) throw new AppError(404, 'NOT_FOUND', 'Client not found');
  }
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Client>();
  if (!client) throw new AppError(404, 'NOT_FOUND', 'Client not found');
  return c.json({ client });
});

// --- add a call ---
clients.post('/:id/calls', async (c) => {
  const clientId = c.req.param('id');
  const input = createCallSchema.parse(await c.req.json());
  const db = c.env.DB;
  const exists = await db.prepare('SELECT 1 AS x FROM clients WHERE id = ?').bind(clientId).first();
  if (!exists) throw new AppError(404, 'NOT_FOUND', 'Client not found');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const adminId = c.get('admin').id;
  await db.batch([
    db
      .prepare(
        `INSERT INTO calls (id, client_id, direction, status, summary, scheduled_at, notes,
           created_by_admin_id, updated_by_admin_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        clientId,
        input.direction,
        input.status,
        input.summary,
        input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null,
        input.notes,
        adminId,
        adminId,
        now,
        now,
      ),
    recomputeClient(db, clientId),
  ]);
  const call = await db.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first<Call>();
  const client = await db
    .prepare('SELECT * FROM clients WHERE id = ?')
    .bind(clientId)
    .first<Client>();
  return c.json({ call, client }, 201);
});

export default clients;
