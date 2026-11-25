import { AppError } from './errors';

export const PAGE_SIZE = 25;

/**
 * Statement that re-derives a client's current_status / last_call_at from their latest call.
 * Run it in the same D1 batch as any call insert/update/delete so they stay in sync.
 * "Latest" = highest created_at (rowid breaks ties within the same millisecond).
 */
export function recomputeClient(db: D1Database, clientId: string): D1PreparedStatement {
  const latest = (col: string) =>
    `(SELECT ${col} FROM calls WHERE client_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1)`;
  return db
    .prepare(
      `UPDATE clients SET current_status = ${latest('status')}, last_call_at = ${latest('created_at')}
       WHERE id = ?1`,
    )
    .bind(clientId);
}

/** Escape LIKE wildcards; use with `ESCAPE '\'`. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * Turns a user-supplied date or datetime into a UTC ISO string.
 * Date-only values (YYYY-MM-DD) are whole days in Sri Lanka time (UTC+05:30, no DST).
 */
export function rangeBound(value: string | undefined, edge: 'from' | 'to'): string | null {
  if (!value) return null;
  const input = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${edge === 'from' ? '00:00:00.000' : '23:59:59.999'}+05:30`
    : value;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, 'INVALID_DATE', `Invalid date: ${value}`);
  }
  return d.toISOString();
}

export function offset(page: number): number {
  return (page - 1) * PAGE_SIZE;
}

export function paginated<T>(items: T[], page: number, total: number) {
  return { items, page, pageSize: PAGE_SIZE, total };
}
