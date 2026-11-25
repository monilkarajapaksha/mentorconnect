import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusFilter } from '../components/StatusFilter';
import { client, mockFetch, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

const FOLLOW_UPS = Array.from({ length: 10 }, (_, i) => `follow_up_${i + 1}`);
const counts = { follow_up_1: 3, follow_up_2: 7, declined: 1, scheduled: 0 };

async function open(ui: Parameters<typeof render>[0]) {
  render(ui);
  await userEvent.click(screen.getByRole('button', { name: /Status/ }));
}

describe('StatusFilter', () => {
  it('shows a count next to each status, e.g. "2nd Follow-up (7)"', async () => {
    await open(<StatusFilter selected={[]} counts={counts} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: '2nd Follow-up (7)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Declined (1)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Scheduled (0)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Any follow-up (10)' })).toBeInTheDocument(); // 3 + 7
  });

  it('lists all 16 statuses plus "Any follow-up"', async () => {
    await open(<StatusFilter selected={[]} counts={counts} onChange={() => {}} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(17);
  });

  it('selecting a status calls onChange with it; multi-select adds to the list', async () => {
    const onChange = vi.fn();
    await open(<StatusFilter selected={['declined']} counts={counts} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: '2nd Follow-up (7)' }));
    expect(onChange).toHaveBeenCalledWith(['declined', 'follow_up_2']);
  });

  it('unchecking removes a status', async () => {
    const onChange = vi.fn();
    await open(<StatusFilter selected={['declined', 'follow_up_2']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Declined' }));
    expect(onChange).toHaveBeenCalledWith(['follow_up_2']);
  });

  it('"Any follow-up" selects follow_up_1..10 and keeps other selections', async () => {
    const onChange = vi.fn();
    await open(<StatusFilter selected={['declined']} counts={counts} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Any follow-up/ }));
    expect(onChange).toHaveBeenCalledWith(['declined', ...FOLLOW_UPS]);
  });

  it('"Any follow-up" is checked when all ten are selected, and unchecking clears them', async () => {
    const onChange = vi.fn();
    await open(<StatusFilter selected={['declined', ...FOLLOW_UPS]} onChange={onChange} />);
    const any = screen.getByRole('checkbox', { name: /Any follow-up/ });
    expect(any).toBeChecked();
    await userEvent.click(any);
    expect(onChange).toHaveBeenCalledWith(['declined']);
  });
});

describe('status filter on the Clients page', () => {
  const list = (statusCounts = counts) => ({
    json: { items: [client()], page: 1, pageSize: 25, total: 1, statusCounts },
  });

  it('reads the filter from the URL and sends it to the API', async () => {
    const fetchMock = mockFetch({ 'GET /api/clients': () => list() });
    renderApp('/clients?status=follow_up_2,declined');
    await screen.findByText('Nimal Perera');
    const url = new URL(
      String(fetchMock.mock.calls.find(([u]) => String(u).startsWith('/api/clients?'))![0]),
      'http://x',
    );
    expect(url.searchParams.get('status')).toBe('follow_up_2,declined');
    expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument();
  });

  it('choosing a status refetches with that status and resets to page 1', async () => {
    const fetchMock = mockFetch({ 'GET /api/clients': () => list() });
    renderApp('/clients?page=3');
    await screen.findByText('Nimal Perera');
    await userEvent.click(screen.getByRole('button', { name: /Status/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: '2nd Follow-up (7)' }));
    await screen.findByRole('button', { name: /1 selected/ });
    const last = new URL(
      String(
        fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/clients?')).at(-1)![0],
      ),
      'http://x',
    );
    expect(last.searchParams.get('status')).toBe('follow_up_2');
    expect(last.searchParams.has('page')).toBe(false);
  });

  it('shows empty and error states', async () => {
    mockFetch({
      'GET /api/clients': () => ({
        json: { items: [], page: 1, pageSize: 25, total: 0, statusCounts: {} },
      }),
    });
    renderApp('/clients?status=declined');
    expect(await screen.findByText('No clients match these filters.')).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockFetch({
      'GET /api/clients': () => ({
        status: 500,
        json: { error: { code: 'INTERNAL', message: 'Boom' } },
      }),
    });
    renderApp('/clients?status=x');
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });
});
