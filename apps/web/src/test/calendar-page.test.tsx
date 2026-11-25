import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meeting, mentor, mockFetch, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

const item = (over = {}) => ({ ...mentor(), today_meetings: 0, next_free_slot: null, ...over });
const MENTORS = [
  item({ id: 'mt1', name: 'Asha Mentor', color: '#4f46e5' }),
  item({ id: 'mt2', name: 'Ravi Mentor', color: '#059669' }),
  item({ id: 'mt3', name: 'Old Mentor', is_active: false }),
];

function routes(extra: Parameters<typeof mockFetch>[0] = {}) {
  return {
    'GET /api/mentors': () => ({ json: { items: MENTORS } }),
    'GET /api/meetings': () => ({ json: { items: [meeting()] } }),
    ...extra,
  };
}
const meetingQueries = (f: ReturnType<typeof mockFetch>) =>
  f.mock.calls
    .map(([u]) => new URL(String(u), 'http://x'))
    .filter((u) => u.pathname === '/api/meetings');

describe('All-mentors calendar page', () => {
  it('lists only active mentors in the filter, all ticked by default', async () => {
    mockFetch(routes());
    renderApp('/calendar?view=week&date=2030-01-14');
    const filter = await screen.findByRole('group', { name: 'Mentors' });
    expect(within(filter).getByRole('checkbox', { name: /Asha Mentor/ })).toBeChecked();
    expect(within(filter).getByRole('checkbox', { name: /Ravi Mentor/ })).toBeChecked();
    expect(within(filter).queryByText('Old Mentor')).not.toBeInTheDocument();
  });

  it('loads meetings for all mentors, then filters by the ticked ones (kept in the URL)', async () => {
    const f = mockFetch(routes());
    renderApp('/calendar?view=week&date=2030-01-14');
    await waitFor(() => expect(meetingQueries(f).length).toBeGreaterThan(0));
    expect(meetingQueries(f)[0]!.searchParams.get('mentorIds')).toBeNull();

    // Untick Ravi: only Asha remains selected.
    await userEvent.click(await screen.findByRole('checkbox', { name: /Ravi Mentor/ }));
    await waitFor(() =>
      expect(meetingQueries(f).some((u) => u.searchParams.get('mentorIds') === 'mt1')).toBe(true),
    );
    expect(screen.getByRole('checkbox', { name: /Ravi Mentor/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Asha Mentor/ })).toBeChecked();
  });

  it('"Show all" resets the filter', async () => {
    const f = mockFetch(routes());
    renderApp('/calendar?view=week&date=2030-01-14&mentors=mt1');
    expect(await screen.findByRole('checkbox', { name: /Ravi Mentor/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByRole('checkbox', { name: /Ravi Mentor/ })).toBeChecked();
    await waitFor(() => expect(meetingQueries(f).at(-1)!.searchParams.get('mentorIds')).toBeNull());
  });

  it('searches mentors by name', async () => {
    mockFetch(routes());
    renderApp('/calendar?view=week&date=2030-01-14');
    await userEvent.type(await screen.findByLabelText('Search mentors'), 'rav');
    expect(screen.queryByRole('checkbox', { name: /Asha Mentor/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ravi Mentor/ })).toBeInTheDocument();
  });

  it('status chips filter the query', async () => {
    const f = mockFetch(routes());
    renderApp('/calendar?view=week&date=2030-01-14');
    const chip = await screen.findByRole('button', { name: 'Completed' });
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(meetingQueries(f).some((u) => u.searchParams.get('status') === 'completed')).toBe(
        true,
      ),
    );
  });

  it('shows a meeting and opens its details panel from the URL', async () => {
    mockFetch(
      routes({
        'GET /api/meetings/m1': () => ({
          json: {
            meeting: meeting(),
            mentor: mentor(),
            client: { id: 'c1', name: 'Nimal Perera', phone_e164: '+94771234567' },
            clientCurrentStatus: 'declined',
            recentCalls: [],
            history: [],
          },
        }),
      }),
    );
    renderApp('/calendar?view=week&date=2030-01-14&meeting=m1');
    expect(
      await screen.findByRole('complementary', { name: 'Meeting details' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open client' })).toHaveAttribute(
      'href',
      '/clients/c1',
    );
  });

  it('has a Calendar link in the header navigation', async () => {
    mockFetch(routes());
    renderApp('/calendar?view=week&date=2030-01-14');
    expect(await screen.findByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    );
  });

  it('"Find a free slot" lists slots per mentor, and picking one opens the booking form', async () => {
    const slots = { mentorId: 'mt1', timezone: 'Asia/Colombo', duration: 60, step: 30 };
    const f = mockFetch(
      routes({
        'GET /api/mentors/mt1/free-slots': () => ({
          json: {
            ...slots,
            slots: [{ start: '2030-01-14T04:30:00.000Z', end: '2030-01-14T05:30:00.000Z' }],
          },
        }),
        'GET /api/mentors/mt2/free-slots': () => ({
          json: { ...slots, mentorId: 'mt2', slots: [] },
        }),
      }),
    );
    renderApp('/calendar?view=week&date=2030-01-14');
    await userEvent.click(await screen.findByRole('button', { name: 'Find a free slot' }));
    const ashaSection = await screen.findByRole('region', { name: 'Free slots for Asha Mentor' });
    expect(
      await within(screen.getByRole('region', { name: 'Free slots for Ravi Mentor' })).findByText(
        /No free 60-minute slots/,
      ),
    ).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => String(u).includes('/mentors/mt3/'))).toBe(false); // inactive: not searched

    await userEvent.click(await within(ashaSection).findByRole('button', { name: /10:00–11:00/ }));
    expect(await screen.findByRole('dialog', { name: 'New meeting' })).toBeInTheDocument();
    expect(screen.getByLabelText('Start (Sri Lanka time)')).toHaveValue('2030-01-14T10:00');
  });

  it('rejects an inverted date range in the slot finder without calling the API', async () => {
    const f = mockFetch(
      routes({ 'GET /api/mentors/mt1/free-slots': () => ({ json: { slots: [] } }) }),
    );
    renderApp('/calendar?view=week&date=2030-01-14&mentors=mt1');
    await userEvent.click(await screen.findByRole('button', { name: 'Find a free slot' }));
    const to = await screen.findByLabelText('To');
    const before = f.mock.calls.length;
    await userEvent.clear(to);
    await userEvent.type(to, '2000-01-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('“To” must not be before “From”');
    expect(f.mock.calls.slice(before).some(([u]) => String(u).includes('2000-01-01'))).toBe(false);
  });
});
