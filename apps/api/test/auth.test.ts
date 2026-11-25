import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { ADMIN, api, login, seedAdmin } from './helpers';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM login_attempts'),
    env.DB.prepare('DELETE FROM admins'),
  ]);
  await seedAdmin();
});

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const h = await hashPassword('s3cret-pass-word');
    expect(h.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('s3cret-pass-word', h)).toBe(true);
    expect(await verifyPassword('nope', h)).toBe(false);
  });
  it('uses a random salt', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('login', () => {
  it('succeeds and sets a hardened cookie', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      json: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { admin: { email: string; name: string } };
    expect(body.admin).toMatchObject({ email: ADMIN.email, name: ADMIN.name });
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });

  it('stores only a hash of the session token', async () => {
    const cookie = await login();
    const token = cookie.replace('session=', '');
    const rows = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.id).not.toBe(token);
    expect(rows.results[0]?.id).toHaveLength(64);
  });

  it('updates last_login_at', async () => {
    await login();
    const row = await env.DB.prepare('SELECT last_login_at FROM admins').first<{
      last_login_at: string | null;
    }>();
    expect(row?.last_login_at).toBeTruthy();
  });

  it('fails with wrong password (401) and unknown email (401, same message)', async () => {
    const wrong = await api('/api/auth/login', {
      method: 'POST',
      json: { email: ADMIN.email, password: 'x' },
    });
    const unknown = await api('/api/auth/login', {
      method: 'POST',
      json: { email: 'no@one.com', password: 'x' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const a = (await wrong.json()) as { error: { code: string; message: string } };
    const b = (await unknown.json()) as { error: { code: string; message: string } };
    expect(a.error).toEqual(b.error);
    expect(a.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 for a malformed body', async () => {
    const res = await api('/api/auth/login', { method: 'POST', json: { email: 'not-an-email' } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('treats email case-insensitively', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      json: { email: 'ADMIN@Example.com', password: ADMIN.password },
    });
    expect(res.status).toBe(200);
  });

  it('locks the account for 15 minutes after 5 failures, even with the right password', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await api('/api/auth/login', {
        method: 'POST',
        json: { email: ADMIN.email, password: 'bad' },
      });
      expect(r.status).toBe(401);
    }
    const locked = await api('/api/auth/login', {
      method: 'POST',
      json: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(locked.status).toBe(429);
    const body = (await locked.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ACCOUNT_LOCKED');

    const row = await env.DB.prepare('SELECT locked_until FROM login_attempts WHERE email = ?')
      .bind(ADMIN.email)
      .first<{ locked_until: string }>();
    const minutes = (new Date(row!.locked_until).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it('lets the user in again once the lock has expired', async () => {
    await env.DB.prepare(
      'INSERT INTO login_attempts (email, failed_count, locked_until, last_attempt_at) VALUES (?, 5, ?, ?)',
    )
      .bind(ADMIN.email, new Date(Date.now() - 1000).toISOString(), new Date().toISOString())
      .run();
    const res = await api('/api/auth/login', {
      method: 'POST',
      json: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.status).toBe(200);
  });

  it('resets the failure counter after a successful login', async () => {
    for (let i = 0; i < 3; i++) {
      await api('/api/auth/login', {
        method: 'POST',
        json: { email: ADMIN.email, password: 'bad' },
      });
    }
    await login();
    const row = await env.DB.prepare('SELECT * FROM login_attempts WHERE email = ?')
      .bind(ADMIN.email)
      .first();
    expect(row).toBeNull();
  });
});

describe('route protection', () => {
  it.each([
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/change-password'],
    ['GET', '/api/anything-else'],
  ])('%s %s returns 401 without a session', async (method, path) => {
    const res = await api(path, { method });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a forged/unknown session token', async () => {
    const res = await api('/api/auth/me', { cookie: 'session=not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const cookie = await login();
    await env.DB.prepare('UPDATE sessions SET expires_at = ?')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    expect((await api('/api/auth/me', { cookie })).status).toBe(401);
  });

  it('rejects cross-origin mutating requests', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      json: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.status).toBe(403);
  });
});

describe('me / logout', () => {
  it('returns the logged-in admin', async () => {
    const cookie = await login();
    const res = await api('/api/auth/me', { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { admin: { email: string } };
    expect(body.admin.email).toBe(ADMIN.email);
  });

  it('logout deletes the session, clears the cookie and invalidates the token', async () => {
    const cookie = await login();
    const out = await api('/api/auth/logout', { method: 'POST', cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get('Set-Cookie') ?? '').toMatch(/session=;|Max-Age=0|Expires=/);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>();
    expect(count?.n).toBe(0);
    // The old cookie must no longer work.
    expect((await api('/api/auth/me', { cookie })).status).toBe(401);
  });
});

describe('change-password', () => {
  it('changes the password, keeps this session, signs out other sessions', async () => {
    const current = await login();
    const other = await login();
    const res = await api('/api/auth/change-password', {
      method: 'POST',
      cookie: current,
      json: { currentPassword: ADMIN.password, newPassword: 'a-brand-new-password' },
    });
    expect(res.status).toBe(200);
    expect((await api('/api/auth/me', { cookie: current })).status).toBe(200);
    expect((await api('/api/auth/me', { cookie: other })).status).toBe(401);

    const oldLogin = await api('/api/auth/login', {
      method: 'POST',
      json: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api('/api/auth/login', {
      method: 'POST',
      json: { email: ADMIN.email, password: 'a-brand-new-password' },
    });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a wrong current password (400)', async () => {
    const cookie = await login();
    const res = await api('/api/auth/change-password', {
      method: 'POST',
      cookie,
      json: { currentPassword: 'wrong', newPassword: 'a-brand-new-password' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a short new password (400)', async () => {
    const cookie = await login();
    const res = await api('/api/auth/change-password', {
      method: 'POST',
      cookie,
      json: { currentPassword: ADMIN.password, newPassword: 'short' },
    });
    expect(res.status).toBe(400);
  });
});
