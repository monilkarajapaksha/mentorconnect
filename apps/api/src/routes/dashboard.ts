import { Hono } from 'hono';
import { CALL_STATUSES } from '@calllog/shared';
import type { AppEnv } from '../env';
import { rangeBound } from '../lib/db';

const dashboard = new Hono<AppEnv>();

/** Count of clients per current status. */
dashboard.get('/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT current_status AS status, COUNT(*) AS n FROM clients GROUP BY current_status',
  ).all<{ status: string | null; n: number }>();
  const counts = Object.fromEntries(CALL_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  let total = 0;
  let noCalls = 0;
  for (const r of results) {
    total += r.n;
    if (r.status) counts[r.status] = r.n;
    else noCalls = r.n;
  }
  return c.json({ total, noCalls, counts });
});

/**
 * Scheduled calls sorted by time. Only a client's *latest* call counts: if they've since moved
 * on (e.g. Order Confirmed), the old "scheduled" call is not an open task any more.
 */
dashboard.get('/scheduled', async (c) => {
  const from = rangeBound(c.req.query('from'), 'from');
  const to = rangeBound(c.req.query('to'), 'to');
  const where = [
    `c.status = 'scheduled'`,
    `c.id = (SELECT id FROM calls WHERE client_id = cl.id ORDER BY created_at DESC, rowid DESC LIMIT 1)`,
  ];
  const params: unknown[] = [];
  if (from) {
    where.push('c.scheduled_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('c.scheduled_at <= ?');
    params.push(to);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT c.*, cl.name AS client_name, cl.phone_e164 AS client_phone
     FROM calls c JOIN clients cl ON cl.id = c.client_id
     WHERE ${where.join(' AND ')} ORDER BY c.scheduled_at ASC`,
  )
    .bind(...params)
    .all<{ scheduled_at: string }>();
  const now = new Date().toISOString();
  return c.json({ items: results.map((r) => ({ ...r, overdue: r.scheduled_at < now })) });
});

export default dashboard;
