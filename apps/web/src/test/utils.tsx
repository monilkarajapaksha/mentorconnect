import type { MeetingWithRefs } from '@calllog/shared';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AppProviders, AppRoutes } from '../App';

// Loosely typed on purpose: handlers just inspect the parsed JSON body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Req = { url: URL; method: string; body: any };
type Handler = (req: Req) => { status?: number; json: unknown };

export const ADMIN = { id: 'a1', email: 'admin@example.com', name: 'Test Admin' };

/** Stubs fetch with a route table keyed "METHOD /api/path". Unmatched requests fail loudly. */
export function mockFetch(routes: Record<string, Handler>) {
  const all: Record<string, Handler> = {
    'GET /api/auth/me': () => ({ json: { admin: ADMIN } }),
    ...routes,
  };
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const handler = all[`${method} ${url.pathname}`];
    if (!handler)
      return new Response(
        JSON.stringify({ error: { code: 'UNMOCKED', message: `${method} ${url.pathname}` } }),
        { status: 500 },
      );
    const { status = 200, json } = handler({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderApp(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
}

export const client = (over = {}) => ({
  id: 'c1',
  phone_e164: '+94771234567',
  name: 'Nimal Perera',
  company: 'Lanka Traders',
  email: null,
  notes: null,
  current_status: 'follow_up_1',
  last_call_at: '2026-03-10T05:00:00.000Z',
  created_at: '2026-03-01T05:00:00.000Z',
  updated_at: '2026-03-01T05:00:00.000Z',
  ...over,
});

export const call = (over = {}) => ({
  id: 'k1',
  client_id: 'c1',
  direction: 'incoming',
  status: 'follow_up_1',
  summary: 'First call about pricing',
  scheduled_at: null,
  notes: null,
  created_by_admin_id: 'a1',
  updated_by_admin_id: 'a1',
  created_at: '2026-03-10T05:00:00.000Z',
  updated_at: '2026-03-10T05:00:00.000Z',
  edited: false,
  ...over,
});

export const mentor = (over = {}) => ({
  id: 'mt1',
  name: 'Asha Mentor',
  email: 'asha@example.com',
  phone_e164: null,
  expertise: ['Python', 'Data science'],
  bio: null,
  color: '#4f46e5',
  timezone: 'Asia/Colombo',
  default_meeting_minutes: 60,
  is_active: true,
  created_at: '2026-03-01T05:00:00.000Z',
  updated_at: '2026-03-01T05:00:00.000Z',
  ...over,
});

export const meeting = (over: Record<string, unknown> = {}): MeetingWithRefs =>
  ({
    id: 'm1',
    mentor_id: 'mt1',
    client_id: 'c1',
    title: 'Career planning',
    start_at: '2030-01-14T04:30:00.000Z', // Mon 10:00 Colombo
    end_at: '2030-01-14T05:30:00.000Z',
    status: 'scheduled',
    mode: 'online',
    location_or_link: 'https://meet.example/abc',
    agenda: 'Plan the next year',
    notes: null,
    external_event_id: null,
    created_by_admin_id: 'a1',
    updated_by_admin_id: 'a1',
    created_at: '2026-03-01T05:00:00.000Z',
    updated_at: '2026-03-01T05:00:00.000Z',
    mentor_name: 'Asha Mentor',
    mentor_color: '#4f46e5',
    mentor_timezone: 'Asia/Colombo',
    client_name: 'Nimal Perera',
    client_phone: '+94771234567',
    ...over,
  }) as MeetingWithRefs;

export const meetingDetail = (over: Record<string, unknown> = {}) => ({
  meeting: meeting(),
  mentor: mentor(),
  client: client({ current_status: 'follow_up_2' }),
  clientCurrentStatus: 'follow_up_2',
  recentCalls: [
    call({ id: 'k3', status: 'follow_up_2', summary: 'Second call about pricing' }),
    call({ id: 'k1', status: 'follow_up_1', summary: 'First call' }),
  ],
  history: [
    {
      id: 'h2',
      changed_at: '2026-03-02T05:00:00.000Z',
      action: 'rescheduled',
      admin_name: 'Test Admin',
      changes: {
        start_at: { old: '2030-01-13T04:30:00.000Z', new: '2030-01-14T04:30:00.000Z' },
        forced: ['outside_availability'],
      },
    },
    {
      id: 'h1',
      changed_at: '2026-03-01T05:00:00.000Z',
      action: 'created',
      admin_name: 'Test Admin',
      changes: { start_at: { old: null, new: '2030-01-13T04:30:00.000Z' } },
    },
  ],
  ...over,
});
