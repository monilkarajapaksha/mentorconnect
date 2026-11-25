import { Hono } from 'hono';
import {
  createCallSchema,
  listCallsQuerySchema,
  updateCallSchema,
  type Call,
  type Client,
} from '@calllog/shared';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { offset, paginated, PAGE_SIZE, rangeBound, recomputeClient } from '../lib/db';

const calls = new Hono<AppEnv>();

const TRACKED = ['direction', 'status', 'summary', 'scheduled_at', 'notes'] as const;

calls.get('/', async (c) => {
  const q = listCallsQuerySchema.parse(c.req.query());
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status.length) {
    where.push(`c.status IN (${q.status.map(() => '?').join(',')})`);
    params.push(...q.status);
  }
  const from = rangeBound(q.from, 'from');
  const to = rangeBound(q.to, 'to');
  if (from) {
    where.push('c.created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('c.created_at <= ?');
    params.push(to);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = c.env.DB;

  const [items, total] = await Promise.all([
    db
      .prepare(
        `SELECT c.*, cl.name AS client_name, cl.phone_e164 AS client_phone,
           EXISTS(SELECT 1 FROM call_history h WHERE h.call_id = c.id) AS edited
         FROM calls c JOIN clients cl ON cl.id = c.client_id ${whereSql}
         ORDER BY c.created_at DESC, c.rowid DESC LIMIT ${PAGE_SIZE} OFFSET ?`,
      )
      .bind(...params, offset(q.page))
      .all<Omit<Call, 'edited'> & { edited: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM calls c ${whereSql}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);
  return c.json(
    paginated(
      items.results.map((r) => ({ ...r, edited: !!r.edited })),
      q.page,
      total?.n ?? 0,
    ),
  );
});

calls.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const patch = updateCallSchema.parse(await c.req.json());
  const db = c.env.DB;
  const existing = await db.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first<Call>();
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Call not found');

  // Merge, then re-validate the whole call (e.g. status=scheduled still needs scheduled_at).
  const merged = createCallSchema.parse({
    direction: patch.direction ?? existing.direction,
    status: patch.status ?? existing.status,
    summary: patch.summary ?? existing.summary,
    scheduledAt: patch.scheduledAt !== undefined ? patch.scheduledAt : existing.scheduled_at,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
  });
  const next = {
    direction: merged.direction,
    status: merged.status,
    summary: merged.summary,
    scheduled_at: merged.scheduledAt ? new Date(merged.scheduledAt).toISOString() : null,
    notes: merged.notes,
  };

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of TRACKED) {
    if (existing[f] !== next[f]) changes[f] = { old: existing[f], new: next[f] };
  }
  if (!Object.keys(changes).length)
    return c.json({ call: existing, client: await getClient(db, existing.client_id) });

  const now = new Date().toISOString();
  const adminId = c.get('admin').id;
  await db.batch([
    db
      .prepare(
        `UPDATE calls SET direction = ?, status = ?, summary = ?, scheduled_at = ?, notes = ?,
           updated_by_admin_id = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        next.direction,
        next.status,
        next.summary,
        next.scheduled_at,
        next.notes,
        adminId,
        now,
        id,
      ),
    db
      .prepare(
        'INSERT INTO call_history (id, call_id, admin_id, changed_at, changes) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(crypto.randomUUID(), id, adminId, now, JSON.stringify(changes)),
    recomputeClient(db, existing.client_id),
  ]);
  const call = await db.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first<Call>();
  return c.json({
    call: { ...call, edited: true },
    client: await getClient(db, existing.client_id),
  });
});

calls.get('/:id/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.changed_at, h.changes, a.name AS admin_name
     FROM call_history h LEFT JOIN admins a ON a.id = h.admin_id
     WHERE h.call_id = ? ORDER BY h.changed_at DESC, h.rowid DESC`,
  )
    .bind(c.req.param('id'))
    .all<{ id: string; changed_at: string; changes: string; admin_name: string | null }>();
  return c.json({ items: results.map((r) => ({ ...r, changes: JSON.parse(r.changes) })) });
});

calls.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const existing = await db
    .prepare('SELECT client_id FROM calls WHERE id = ?')
    .bind(id)
    .first<{ client_id: string }>();
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Call not found');
  await db.batch([
    db.prepare('DELETE FROM calls WHERE id = ?').bind(id),
    recomputeClient(db, existing.client_id),
  ]);
  return c.json({ ok: true, client: await getClient(db, existing.client_id) });
});

const getClient = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Client>();

export default calls;
