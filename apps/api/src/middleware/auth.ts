import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { SESSION_COOKIE, sha256Hex } from '../lib/session';

const PUBLIC = new Set(['POST /api/auth/login']);

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (PUBLIC.has(`${c.req.method} ${c.req.path}`)) return next();

  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Login required');

  const sessionId = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT a.id, a.email, a.name FROM sessions s
     JOIN admins a ON a.id = s.admin_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(sessionId, new Date().toISOString())
    .first<{ id: string; email: string; name: string }>();
  if (!row) throw new AppError(401, 'UNAUTHENTICATED', 'Session expired or invalid');

  c.set('admin', row);
  c.set('sessionId', sessionId);
  await next();
});

/** Basic CSRF defence on top of SameSite=Strict: reject cross-origin mutating requests. */
export const sameOriginForMutations = createMiddleware<AppEnv>(async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) {
      throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin request blocked');
    }
  }
  await next();
});
