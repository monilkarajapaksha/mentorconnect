/**
 * Usage: npm run create-admin -- --email you@example.com --password 'secret-pass' [--name Name] [--remote]
 * Writes to local D1 by default, or remote D1 with --remote.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { hashPassword } from '../src/lib/password';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
    remote: { type: 'boolean', default: false },
  },
});

const email = values.email?.trim().toLowerCase();
const password = values.password;
if (!email || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length < 10) {
  console.error(
    'Required: --email <valid email> --password <at least 10 chars> [--name] [--remote]',
  );
  process.exit(1);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const name = values.name?.trim() || email.split('@')[0] || 'Admin';
const hash = await hashPassword(password);
const sql = `INSERT INTO admins (id, email, password_hash, name, created_at)
VALUES (${q(randomUUID())}, ${q(email)}, ${q(hash)}, ${q(name)}, ${q(new Date().toISOString())});`;

execFileSync(
  'npx',
  [
    'wrangler',
    'd1',
    'execute',
    'calllog-db',
    values.remote ? '--remote' : '--local',
    '--command',
    sql,
  ],
  { stdio: 'inherit' },
);
console.log(`Admin ${email} created (${values.remote ? 'remote' : 'local'} D1).`);
