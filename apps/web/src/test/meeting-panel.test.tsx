import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../App';
import { MeetingPanel } from '../components/MeetingPanel';
import { meeting, meetingDetail, mentor, mockFetch } from './utils';

afterEach(() => vi.unstubAllGlobals());

function setup(detail = meetingDetail(), extra: Parameters<typeof mockFetch>[0] = {}) {
  const f = mockFetch({ 'GET /api/meetings/m1': () => ({ json: detail }), ...extra });
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <AppProviders>
        <MeetingPanel meetingId="m1" onClose={onClose} />
      </AppProviders>
    </MemoryRouter>,
  );
  return { f, onClose };
}
const patches = (f: ReturnType<typeof mockFetch>) =>
  f.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([, i]) => JSON.parse(String(i!.body)));

describe('Meeting details panel', () => {
  it('shows title, time in Sri Lanka time, status, mode and a clickable meeting link', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Career planning' })).toBeInTheDocument();
    expect(screen.getByText(/Mon, 14 Jan 2030, 10:00–11:00/)).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('scheduled');
    expect(screen.getByText('Online')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'https://meet.example/abc' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText(/Plan the next year/)).toBeInTheDocument();
  });

  it('"Open client" goes to the client page; "Open mentor" goes to the mentor calendar', async () => {
    setup();
    expect(await screen.findByRole('link', { name: 'Open client' })).toHaveAttribute(
      'href',
      '/clients/c1',
    );
    expect(screen.getByRole('link', { name: 'Open mentor' })).toHaveAttribute(
      'href',
      '/mentors/mt1',
    );
  });

  it("shows the client's current call status and their last calls", async () => {
    setup();
    const card = await screen.findByLabelText('Client');
    expect(within(card).getByText('Nimal Perera')).toBeInTheDocument();
    expect(within(card).getByText('+94771234567')).toBeInTheDocument();
    expect(within(card).getAllByText('2nd Follow-up').length).toBeGreaterThan(0);
    expect(within(card).getByText('Second call about pricing')).toBeInTheDocument();
    expect(within(card).getByText('First call')).toBeInTheDocument();
  });

  it('shows the change history incl. overridden warnings', async () => {
    setup();
    await screen.findByRole('heading', { name: 'History' });
    expect(screen.getByText(/Rescheduled ·/)).toBeInTheDocument();
    expect(screen.getByText(/Created ·/)).toBeInTheDocument();
    expect(screen.getByText('Overridden: outside availability')).toBeInTheDocument();
    expect(screen.getAllByText(/Test Admin/).length).toBeGreaterThanOrEqual(2);
  });

  it("also shows the mentor's own timezone when it is not Sri Lanka", async () => {
    setup(meetingDetail({ mentor: mentor({ timezone: 'America/New_York' }) }));
    expect(await screen.findByText(/in America\/New_York/)).toBeInTheDocument();
  });

  it('offers Edit, Reschedule, Mark completed, Cancel and Delete', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Career planning' });
    for (const name of ['Edit', 'Reschedule', 'Mark completed', 'Cancel meeting', 'Delete']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('hides Cancel / Mark completed when they no longer apply', async () => {
    setup(meetingDetail({ meeting: meeting({ status: 'cancelled' }) }));
    await screen.findByRole('heading', { name: 'Career planning' });
    expect(screen.queryByRole('button', { name: 'Cancel meeting' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
  });

  it('Cancel meeting asks first, then sets status cancelled (and says the client status is untouched)', async () => {
    const { f } = setup(undefined, {
      'PATCH /api/meetings/m1': () => ({
        json: { meeting: meeting({ status: 'cancelled' }), call: null },
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel meeting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this meeting?' });
    expect(dialog).toHaveTextContent("client's call status is not changed");
    expect(patches(f)).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel meeting' }));
    await waitFor(() => expect(patches(f)).toEqual([{ status: 'cancelled' }]));
    expect(await screen.findByText('Meeting cancelled')).toBeInTheDocument();
  });

  it('Mark completed offers to log "Session Done", ticked by default, and shows what will change', async () => {
    const { f } = setup(undefined, {
      'PATCH /api/meetings/m1': () => ({
        json: { meeting: meeting({ status: 'completed' }), call: { id: 'k' } },
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Mark completed' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark as completed' });
    expect(
      within(dialog).getByRole('checkbox', { name: /Also log a call with status Session Done/ }),
    ).toBeChecked();
    expect(dialog).toHaveTextContent(/Session Done/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(patches(f)).toEqual([{ status: 'completed', logCall: true }]));
    expect(await screen.findByText('Completed and call logged')).toBeInTheDocument();
  });

  it('completing without the checkbox sends logCall: false', async () => {
    const { f } = setup(undefined, {
      'PATCH /api/meetings/m1': () => ({
        json: { meeting: meeting({ status: 'completed' }), call: null },
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Mark completed' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark as completed' });
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(patches(f)).toEqual([{ status: 'completed', logCall: false }]));
  });

  it('changing the status dropdown to "No-show" updates right away; "Completed" goes through the dialog', async () => {
    const { f } = setup(undefined, {
      'PATCH /api/meetings/m1': () => ({
        json: { meeting: meeting({ status: 'no_show' }), call: null },
      }),
    });
    await screen.findByRole('heading', { name: 'Career planning' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'no_show');
    await waitFor(() => expect(patches(f)).toEqual([{ status: 'no_show' }]));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'completed');
    expect(await screen.findByRole('dialog', { name: 'Mark as completed' })).toBeInTheDocument();
    expect(patches(f)).toHaveLength(1);
  });

  it('shows the server error as a toast when an update is refused', async () => {
    setup(undefined, {
      'PATCH /api/meetings/m1': () => ({
        status: 409,
        json: {
          error: {
            code: 'MEETING_CONFLICT',
            message: 'The mentor already has a meeting at this time',
          },
        },
      }),
    });
    await screen.findByRole('heading', { name: 'Career planning' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'no_show');
    expect(
      await screen.findByText('The mentor already has a meeting at this time'),
    ).toBeInTheDocument();
  });

  it('notes: Save is disabled until changed, then PATCHes only the notes', async () => {
    const { f } = setup(undefined, {
      'PATCH /api/meetings/m1': () => ({
        json: { meeting: meeting({ notes: 'Great session' }), call: null },
      }),
    });
    const save = await screen.findByRole('button', { name: 'Save notes' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Notes (after the session)'), 'Great session');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(patches(f)).toEqual([{ notes: 'Great session' }]));
  });

  it('Edit and Reschedule open the meeting form with the right title', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit meeting' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    expect(await screen.findByRole('dialog', { name: 'Reschedule meeting' })).toBeInTheDocument();
  });

  it('Delete is a confirmed, permanent action and closes the panel afterwards', async () => {
    const { f, onClose } = setup(undefined, {
      'DELETE /api/meetings/m1': () => ({ json: { ok: true } }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    expect(dialog).toHaveTextContent(/permanently/i);
    expect(f.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('closes with the ✕ button and with Escape', async () => {
    const { onClose } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Close panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows an error state with Retry when the meeting cannot be loaded', async () => {
    setup(meetingDetail(), {
      'GET /api/meetings/m1': () => ({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'Meeting not found' } },
      }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Meeting not found');
  });
});
