import { SELF, env } from 'cloudflare:test';
import { hashPassword } from '../src/lib/password';

export const ADMIN = {
  email: 'admin@example.com',
  password: 'correct-horse-battery',
  name: 'Test Admin',
};

// Hashing is the slow part (PBKDF2), so compute the hash once per test file.
let cachedHash: string | undefined;

export async function seedAdmin(overrides: Partial<typeof ADMIN> = {}) {
  const a = { ...ADMIN, ...overrides };
  cachedHash ??= await hashPassword(ADMIN.password);
  const hash = a.password === ADMIN.password ? cachedHash : await hashPassword(a.password);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO admins (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, a.email, hash, a.name, new Date().toISOString())
    .run();
  return { id, ...a };
}

export function api(path: string, init: RequestInit & { cookie?: string; json?: unknown } = {}) {
  const { cookie, json, headers, ...rest } = init;
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  if (json !== undefined) h.set('Content-Type', 'application/json');
  return SELF.fetch(`http://localhost${path}`, {
    ...rest,
    headers: h,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

/** Logs in and returns the `session=...` cookie pair to send on later requests. */
export async function login(email = ADMIN.email, password = ADMIN.password): Promise<string> {
  const res = await api('/api/auth/login', { method: 'POST', json: { email, password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

/** Seeds an admin and returns a logged-in cookie. */
export async function authed(): Promise<string> {
  await seedAdmin();
  return login();
}

// Test helper: loosely typed on purpose so assertions stay readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function createClient(
  cookie: string,
  phone: string,
  name = 'Test Client',
  extra = {},
) {
  const res = await api('/api/clients', {
    method: 'POST',
    cookie,
    json: { phone, name, ...extra },
  });
  if (res.status !== 201) throw new Error(`createClient ${res.status}: ${await res.text()}`);
  return (await json(res)).client as {
    id: string;
    phone_e164: string;
    current_status: string | null;
  };
}

export async function addCall(
  cookie: string,
  clientId: string,
  body: Record<string, unknown> = {},
) {
  const res = await api(`/api/clients/${clientId}/calls`, {
    method: 'POST',
    cookie,
    json: { direction: 'incoming', status: 'follow_up_1', summary: 'Spoke briefly', ...body },
  });
  if (res.status !== 201) throw new Error(`addCall ${res.status}: ${await res.text()}`);
  return (await json(res)).call as { id: string; status: string };
}

export async function createMentor(cookie: string, body: Record<string, unknown> = {}) {
  const res = await api('/api/mentors', {
    method: 'POST',
    cookie,
    json: {
      name: 'Asha Mentor',
      email: `m${crypto.randomUUID().slice(0, 8)}@example.com`,
      ...body,
    },
  });
  if (res.status !== 201) throw new Error(`createMentor ${res.status}: ${await res.text()}`);
  return (await json(res)).mentor as {
    id: string;
    name: string;
    color: string;
    is_active: boolean;
    expertise: string[];
    timezone: string;
  };
}
