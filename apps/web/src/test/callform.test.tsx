import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallForm, type CallFormValues } from '../components/CallForm';
import { call, client, mockFetch, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

const base: CallFormValues = {
  direction: 'incoming',
  status: 'follow_up_2',
  summary: '',
  scheduledAt: null,
  notes: null,
};

function setup(initial: Partial<CallFormValues> = {}) {
  const onSubmit = vi.fn();
  render(
    <CallForm
      initial={{ ...base, ...initial }}
      submitLabel="Save"
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  return onSubmit;
}

describe('CallForm', () => {
  it('pre-selects the suggested status it is given', () => {
    setup({ status: 'follow_up_2' });
    expect(screen.getByLabelText('Status')).toHaveValue('follow_up_2');
    expect(
      within(screen.getByLabelText('Status')).getByRole('option', { name: '2nd Follow-up' }),
    ).toBeInTheDocument();
  });

  it('offers all 16 statuses', () => {
    setup();
    expect(within(screen.getByLabelText('Status')).getAllByRole('option')).toHaveLength(16);
  });

  it('requires a summary', async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Summary is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills when editing and submits only edited values on top', async () => {
    const onSubmit = setup({ status: 'follow_up_1', summary: 'Old summary', notes: 'n1' });
    expect(screen.getByLabelText('Summary')).toHaveValue('Old summary');
    await userEvent.clear(screen.getByLabelText('Summary'));
    await userEvent.type(screen.getByLabelText('Summary'), 'Corrected summary');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({
      direction: 'incoming',
      status: 'follow_up_1',
      summary: 'Corrected summary',
      scheduledAt: null,
      notes: 'n1',
    });
  });

  it('shows the date-time field only for "Scheduled" and requires it', async () => {
    const onSubmit = setup({ summary: 'x' });
    expect(screen.queryByLabelText(/Scheduled date/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'scheduled');
    expect(screen.getByLabelText(/Scheduled date/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Scheduled date & time is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('converts the Colombo date-time to UTC on submit', async () => {
    const onSubmit = setup({ summary: 'x' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'scheduled');
    fireEvent.change(screen.getByLabelText(/Scheduled date/), {
      target: { value: '2030-01-15T10:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[0]![0].scheduledAt).toBe('2030-01-15T04:30:00.000Z');
  });

  it('shows an existing UTC scheduled time in Colombo time', () => {
    setup({ status: 'scheduled', summary: 'x', scheduledAt: '2030-01-15T04:30:00.000Z' });
    expect(screen.getByLabelText(/Scheduled date/)).toHaveValue('2030-01-15T10:00');
  });

  it('drops scheduledAt when the status is changed away from scheduled', async () => {
    const onSubmit = setup({
      status: 'scheduled',
      summary: 'x',
      scheduledAt: '2030-01-15T04:30:00.000Z',
    });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'order_confirmed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      status: 'order_confirmed',
      scheduledAt: null,
    });
  });
});

describe('editing a call from the client page', () => {
  it('opens call #1 in a modal, saves a new summary via PATCH, and shows a toast', async () => {
    const first = call({ id: 'k1', summary: 'First call about pricing' });
    const second = call({ id: 'k2', status: 'follow_up_2', summary: 'Second call' });
    const fetchMock = mockFetch({
      'GET /api/clients/c1': () => ({
        json: { client: client(), calls: [second, first], suggestedStatus: 'follow_up_3' },
      }),
      'PATCH /api/calls/k1': () => ({ json: { call: first, client: client() } }),
    });
    renderApp('/clients/c1');
    await screen.findByRole('heading', { name: 'Nimal Perera' });

    await userEvent.click(screen.getByRole('button', { name: 'Edit / Update call 1' })); // oldest = call #1
    const dialog = await screen.findByRole('dialog', { name: 'Edit call' });
    const summary = within(dialog).getByLabelText('Summary');
    expect(summary).toHaveValue('First call about pricing');
    await userEvent.clear(summary);
    await userEvent.type(summary, 'Pricing agreed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(String(patch[0])).toBe('/api/calls/k1');
    expect(JSON.parse(String(patch[1]!.body))).toMatchObject({
      summary: 'Pricing agreed',
      status: 'follow_up_1',
    });
    expect(await screen.findByText('Call updated')).toBeInTheDocument();
  });

  it('"Log new call" pre-selects the suggested next follow-up', async () => {
    mockFetch({
      'GET /api/clients/c1': () => ({
        json: {
          client: client({ current_status: 'follow_up_1' }),
          calls: [call()],
          suggestedStatus: 'follow_up_2',
        },
      }),
    });
    renderApp('/clients/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Log new call' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log new call' });
    expect(within(dialog).getByLabelText('Status')).toHaveValue('follow_up_2');
  });

  it('asks for confirmation before deleting a call', async () => {
    const fetchMock = mockFetch({
      'GET /api/clients/c1': () => ({
        json: { client: client(), calls: [call()], suggestedStatus: 'follow_up_2' },
      }),
      'DELETE /api/calls/k1': () => ({ json: { ok: true } }),
    });
    renderApp('/clients/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete call 1' }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    const dialog = await screen.findByRole('dialog', { name: 'Delete call?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(true),
    );
  });
});
