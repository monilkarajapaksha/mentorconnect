import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Creates a session row (storing only the token hash) and returns the raw token. */
export async function createSession(db: D1Database, adminId: string): Promise<string> {
  const token = newToken();
  const now = new Date();
  await db
    .prepare('INSERT INTO sessions (id, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(
      await sha256Hex(token),
      adminId,
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      now.toISOString(),
    )
    .run();
  return token;
}

function isLocalhost(c: Context): boolean {
  const host = new URL(c.req.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !isLocalhost(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: !isLocalhost(c) });
}
