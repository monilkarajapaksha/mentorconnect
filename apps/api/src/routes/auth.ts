import { Hono } from 'hono';
import { changePasswordSchema, loginSchema } from '@calllog/shared';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/password';
import { clearSessionCookie, createSession, setSessionCookie } from '../lib/session';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

const auth = new Hono<AppEnv>();

auth.post('/login', async (c) => {
  const { email, password } = loginSchema.parse(await c.req.json());
  const db = c.env.DB;
  const now = new Date();

  const attempt = await db
    .prepare('SELECT failed_count, locked_until FROM login_attempts WHERE email = ?')
    .bind(email)
    .first<{ failed_count: number; locked_until: string | null }>();

  if (attempt?.locked_until && attempt.locked_until > now.toISOString()) {
    throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', {
      lockedUntil: attempt.locked_until,
    });
  }

  const admin = await db
    .prepare('SELECT id, email, name, password_hash FROM admins WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; name: string; password_hash: string }>();

  // Always run a hash comparison so unknown emails take similar time.
  const ok = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH);

  if (!admin || !ok) {
    // A previous lock that has expired starts the count over.
    const previous = attempt?.locked_until ? 0 : (attempt?.failed_count ?? 0);
    const failed = previous + 1;
    const lockedUntil =
      failed >= MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString()
        : null;
    await db
      .prepare(
        `INSERT INTO login_attempts (email, failed_count, locked_until, last_attempt_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(email) DO UPDATE SET
           failed_count = ?2, locked_until = ?3, last_attempt_at = ?4`,
      )
      .bind(email, failed, lockedUntil, now.toISOString())
      .run();
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  await db.batch([
    db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email),
    db
      .prepare('UPDATE admins SET last_login_at = ? WHERE id = ?')
      .bind(now.toISOString(), admin.id),
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()),
  ]);

  setSessionCookie(c, await createSession(db, admin.id));
  return c.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
});

auth.post('/logout', async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(c.get('sessionId')).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.get('/me', (c) => c.json({ admin: c.get('admin') }));

auth.post('/change-password', async (c) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(await c.req.json());
  const db = c.env.DB;
  const admin = c.get('admin');

  const row = await db
    .prepare('SELECT password_hash FROM admins WHERE id = ?')
    .bind(admin.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
  }

  await db.batch([
    db
      .prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(newPassword), admin.id),
    // Sign out all other devices.
    db
      .prepare('DELETE FROM sessions WHERE admin_id = ? AND id <> ?')
      .bind(admin.id, c.get('sessionId')),
  ]);
  return c.json({ ok: true });
});

export default auth;
