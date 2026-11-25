import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { colomboDate } from '../lib/calendar';
import { meeting, mockFetch, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

const stats = { 'GET /api/stats': () => ({ json: { total: 0, noCalls: 0, counts: {} } }) };

describe("Home: today's meetings", () => {
  it('asks for today (Sri Lanka date), sorted by start time, hiding cancelled ones', async () => {
    const f = mockFetch({
      ...stats,
      'GET /api/meetings': () => ({
        json: {
          items: [
            meeting({
              id: 'late',
              client_name: 'Late Client',
              start_at: '2030-01-14T09:30:00.000Z',
              end_at: '2030-01-14T10:30:00.000Z',
            }),
            meeting({
              id: 'early',
              client_name: 'Early Client',
              start_at: '2030-01-14T04:30:00.000Z',
              end_at: '2030-01-14T05:30:00.000Z',
            }),
            meeting({ id: 'gone', client_name: 'Cancelled Client', status: 'cancelled' }),
          ],
        },
      }),
    });
    renderApp('/');
    const card = await screen.findByRole('region', { name: "Today's meetings" });
    const rows = await within(card).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Early Client');
    expect(rows[0]).toHaveTextContent('10:00–11:00');
    expect(rows[1]).toHaveTextContent('Late Client');
    expect(within(card).queryByText(/Cancelled Client/)).not.toBeInTheDocument();
    const q = new URL(
      String(f.mock.calls.find(([u]) => String(u).startsWith('/api/meetings'))![0]),
      'http://x',
    );
    expect(q.searchParams.get('from')).toBe(colomboDate());
    expect(q.searchParams.get('to')).toBe(colomboDate());
  });

  it('links each meeting to the calendar panel, and says so when there are none', async () => {
    mockFetch({
      ...stats,
      'GET /api/meetings': () => ({ json: { items: [meeting({ id: 'm1' })] } }),
    });
    renderApp('/');
    const link = await screen.findByRole('link', { name: /10:00–11:00/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('/calendar?meeting=m1'));
  });

  it('empty state', async () => {
    mockFetch({ ...stats, 'GET /api/meetings': () => ({ json: { items: [] } }) });
    renderApp('/');
    expect(await screen.findByText('No meetings today.')).toBeInTheDocument();
  });
});
