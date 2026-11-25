import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, client, meeting, mentor, mockFetch, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

const clientPage = {
  'GET /api/clients/c1': () => ({
    json: { client: client(), calls: [call()], suggestedStatus: 'follow_up_2' },
  }),
};

describe('Client page: meetings', () => {
  it('lists upcoming and past meetings with mentor, time and status', async () => {
    mockFetch({
      ...clientPage,
      'GET /api/clients/c1/meetings': () => ({
        json: {
          upcoming: [meeting({ id: 'm1', title: 'Career planning' })],
          past: [
            meeting({
              id: 'm0',
              title: 'Intro chat',
              status: 'completed',
              start_at: '2020-01-14T04:30:00.000Z',
              end_at: '2020-01-14T05:30:00.000Z',
            }),
          ],
        },
      }),
    });
    renderApp('/clients/c1');
    const section = await screen.findByRole('region', { name: 'Meetings' });
    expect(await within(section).findByText('Upcoming')).toBeInTheDocument();
    expect(within(section).getByText('Past')).toBeInTheDocument();
    const link = within(section).getByRole('link', { name: 'Career planning' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/mentors/mt1?meeting=m1'));
    expect(within(section).getAllByText(/with Asha Mentor/)).toHaveLength(2);
    expect(within(section).getByText('Completed')).toBeInTheDocument();
  });

  it('shows an empty state when there are no meetings', async () => {
    mockFetch({
      ...clientPage,
      'GET /api/clients/c1/meetings': () => ({ json: { upcoming: [], past: [] } }),
    });
    renderApp('/clients/c1');
    expect(await screen.findByText(/No meetings yet/)).toBeInTheDocument();
  });

  it('"Book a session" finds a slot, books it for THIS client (call logging on by default)', async () => {
    const start = '2030-01-14T04:30:00.000Z';
    const f = mockFetch({
      ...clientPage,
      'GET /api/clients/c1/meetings': () => ({ json: { upcoming: [], past: [] } }),
      'GET /api/mentors': () => ({
        json: { items: [{ ...mentor(), today_meetings: 0, next_free_slot: null }] },
      }),
      'GET /api/mentors/mt1/free-slots': () => ({
        json: {
          mentorId: 'mt1',
          timezone: 'Asia/Colombo',
          duration: 60,
          step: 30,
          slots: [{ start, end: '2030-01-14T05:30:00.000Z' }],
        },
      }),
      'POST /api/meetings': () => ({
        status: 201,
        json: { meeting: meeting(), call: { id: 'k9' } },
      }),
    });
    renderApp('/clients/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Book a session' }));
    await userEvent.click(await screen.findByRole('button', { name: /10:00–11:00/ }));

    const dialog = await screen.findByRole('dialog', { name: 'New meeting' });
    expect(within(dialog).getByText('Nimal Perera')).toBeInTheDocument(); // client already chosen
    expect(within(dialog).queryByLabelText('Client')).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', { name: /Also log a call with status Scheduled/ }),
    ).toBeChecked();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Book meeting' }));
    await waitFor(() => expect(f.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true));
    const post = f.mock.calls.find(
      ([u, i]) => i?.method === 'POST' && String(u) === '/api/meetings',
    )!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({
      mentorId: 'mt1',
      clientId: 'c1',
      startAt: start,
      logCall: true,
      force: false,
    });
    expect(await screen.findByText('Meeting booked and call logged')).toBeInTheDocument();
  });
});
