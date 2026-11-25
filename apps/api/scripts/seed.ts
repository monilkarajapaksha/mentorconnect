/**
 * Usage: npm run seed -w @calllog/api [-- --remote]
 * Inserts ~18 demo clients (every status covered) with realistic call histories.
 * Safe to re-run: seeded clients use the fake range +94 77 100 xxxx and are replaced each time.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CALL_STATUSES, FOLLOW_UP_STATUSES, type CallStatus } from '@calllog/shared';

const { values } = parseArgs({ options: { remote: { type: 'boolean', default: false } } });

const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
const DAY = 86_400_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const PEOPLE: [string, string | null][] = [
  ['Nimal Perera', 'Lanka Traders'],
  ['Kamala Silva', 'Silva & Sons'],
  ['Ruwan Fernando', null],
  ['Dilini Jayawardena', 'Ceylon Tea Co'],
  ['Saman Kumara', 'Kumara Hardware'],
  ['Anjali Wickramasinghe', null],
  ['Pradeep Rathnayake', 'Island Logistics'],
  ['Tharushi Gunasekara', 'Blue Wave Travels'],
  ['Chaminda Bandara', null],
  ['Nadeesha Herath', 'Herath Textiles'],
  ['Lahiru Senanayake', 'Senanayake Legal'],
  ['Ishara Dissanayake', null],
  ['Kasun Abeywickrama', 'Abeywickrama Foods'],
  ['Madhavi Peiris', 'Peiris Dental'],
  ['Sanduni Rajapaksha', null],
  ['Buddhika Amarasinghe', 'Amara Constructions'],
  ['Hasini Weerasinghe', 'Weera Boutique'],
  ['Janaka Liyanage', null],
];

// One client per status (16), plus two extra to show a long follow-up chain.
const TARGETS: CallStatus[] = [...CALL_STATUSES, 'follow_up_3', 'scheduled'];

const sql: string[] = [`DELETE FROM clients WHERE phone_e164 LIKE '+9477100%';`];

PEOPLE.forEach(([name, company], i) => {
  const status = TARGETS[i]!;
  const clientId = crypto.randomUUID();
  const phone = `+9477100${String(1000 + i).slice(-4)}`;
  const email = company ? `${name.split(' ')[0]!.toLowerCase()}@example.com` : null;

  // Build a plausible history ending in `status`.
  const history: CallStatus[] = [];
  const followIdx = FOLLOW_UP_STATUSES.indexOf(status as (typeof FOLLOW_UP_STATUSES)[number]);
  if (followIdx >= 0) history.push(...FOLLOW_UP_STATUSES.slice(0, followIdx + 1));
  else if (status === 'declined') history.push('follow_up_1', 'follow_up_2', 'declined');
  else if (status === 'scheduled') history.push('follow_up_1', 'scheduled');
  else {
    const journey: CallStatus[] = [
      'follow_up_1',
      'scheduled',
      'order_confirmed',
      'payment_done',
      'session_done',
      'feedback_received',
    ];
    history.push(...journey.slice(0, journey.indexOf(status) + 1));
  }

  const spacingH = 30 + (i % 5) * 12;
  const lastAgoH = 2 + i * 7; // spread last-call dates across ~5 days
  let lastCreated = hoursAgo(lastAgoH);
  const calls = history.map((st, k) => {
    const created = hoursAgo(lastAgoH + (history.length - 1 - k) * spacingH);
    if (k === history.length - 1) lastCreated = created;
    const scheduled =
      st === 'scheduled'
        ? new Date(Date.now() + (i % 2 === 0 ? 1 : -1) * (DAY / 2 + i * 3_600_000)).toISOString() // some overdue
        : null;
    return { id: crypto.randomUUID(), st, created, scheduled, k };
  });

  const created0 = calls[0]!.created;
  sql.push(
    `INSERT INTO clients (id, phone_e164, name, company, email, notes, current_status, last_call_at, created_at, updated_at)
     VALUES (${q(clientId)}, ${q(phone)}, ${q(name)}, ${q(company)}, ${q(email)}, ${q(i % 3 === 0 ? 'Prefers calls after 4pm.' : null)}, ${q(status)}, ${q(lastCreated)}, ${q(created0)}, ${q(created0)});`,
  );
  for (const c of calls) {
    sql.push(
      `INSERT INTO calls (id, client_id, direction, status, summary, scheduled_at, notes, created_at, updated_at)
       VALUES (${q(c.id)}, ${q(clientId)}, ${q(c.k % 2 === 0 ? 'outgoing' : 'incoming')}, ${q(c.st)}, ${q(`Call ${c.k + 1}: discussed requirements (${c.st}).`)}, ${q(c.scheduled)}, NULL, ${q(c.created)}, ${q(c.created)});`,
    );
  }
});

const dir = mkdtempSync(join(tmpdir(), 'calllog-seed-'));
const file = join(dir, 'seed.sql');
writeFileSync(file, sql.join('\n'));
execFileSync(
  'npx',
  [
    'wrangler',
    'd1',
    'execute',
    'calllog-db',
    values.remote ? '--remote' : '--local',
    '--file',
    file,
  ],
  {
    stdio: 'inherit',
  },
);
console.log(`Seeded ${PEOPLE.length} clients (${values.remote ? 'remote' : 'local'} D1).`);
