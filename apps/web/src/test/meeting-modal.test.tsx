import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../App';
import { MeetingModal, type MentorRef } from '../components/MeetingModal';
import { client, meeting, mockFetch } from './utils';

afterEach(() => vi.unstubAllGlobals());

const MENTOR: MentorRef = {
  id: 'mt1',
  name: 'Asha Mentor',
  timezone: 'Asia/Colombo',
  default_meeting_minutes: 60,
};
const START = '2030-01-14T04:30:00.000Z'; // Mon 10:00 Colombo
const END = '2030-01-14T05:30:00.000Z';

function setup(props: Partial<Parameters<typeof MeetingModal>[0]> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <AppProviders>
      <MeetingModal
        mode="create"
        mentor={MENTOR}
        initialStart={START}
        initialEnd={END}
        onClose={onClose}
        onSaved={onSaved}
        {...props}
      />
    </AppProviders>,
  );
  return { onClose, onSaved };
}

const clientList = (items = [client()]) => ({
  'GET /api/clients': () => ({
    json: { items, page: 1, pageSize: 25, total: items.length, statusCounts: {} },
  }),
});
const posts = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls
    .filter(([, i]) => i?.method === 'POST' && true)
    .map(([u, i]) => ({ url: String(u), body: JSON.parse(String(i!.body)) }));

async function pickClient(name = 'Nimal Perera') {
  await userEvent.type(screen.getByLabelText('Client'), 'nimal');
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('New meeting modal', () => {
  it('prefills the picked slot in Sri Lanka time and ticks "log a Scheduled call" by default', () => {
    mockFetch({});
    setup();
    expect(screen.getByLabelText('Start (Sri Lanka time)')).toHaveValue('2030-01-14T10:00');
    expect(screen.getByLabelText('End (Sri Lanka time)')).toHaveValue('2030-01-14T11:00');
    const box = screen.getByRole('checkbox', {
      name: /Also log a call with status Scheduled for this client/,
    });
    expect(box).toBeChecked();
    expect(screen.getByText(/set their current status to Scheduled/)).toBeInTheDocument();
  });

  it('searches clients by name/phone, selects one, and books with the right payload', async () => {
    const f = mockFetch({
      ...clientList(),
      'POST /api/meetings': () => ({
        status: 201,
        json: { meeting: meeting(), call: { id: 'k9' } },
      }),
    });
    const { onSaved, onClose } = setup();
    await pickClient();
    expect(screen.getByText('Nimal Perera')).toBeInTheDocument(); // chip
    expect(screen.getByText('+94771234567')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(posts(f)[0]).toEqual({
      url: '/api/meetings',
      body: {
        mentorId: 'mt1',
        clientId: 'c1',
        title: 'Mentoring session',
        startAt: START,
        endAt: END,
        mode: 'online',
        locationOrLink: '',
        agenda: '',
        force: false,
        logCall: true,
      },
    });
    expect(await screen.findByText('Meeting booked and call logged')).toBeInTheDocument();
  });

  it('unticking the checkbox sends logCall: false', async () => {
    const f = mockFetch({
      ...clientList(),
      'POST /api/meetings': () => ({ status: 201, json: { meeting: meeting(), call: null } }),
    });
    setup();
    await pickClient();
    await userEvent.click(screen.getByRole('checkbox', { name: /Also log a call/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(posts(f)[0]!.body.logCall).toBe(false);
  });

  it('requires a client and a title before anything is sent', async () => {
    const f = mockFetch({});
    setup();
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
    expect(await screen.findByText('Choose a client')).toBeInTheDocument();
    expect(screen.getByText('Title is required')).toBeInTheDocument();
    expect(posts(f)).toHaveLength(0);
  });

  it.each([
    ['end before start', '2030-01-14T09:00', 'End must be after start'],
    ['too short', '2030-01-14T10:10', /15–480 minutes/],
    ['too long', '2030-01-14T19:00', /15–480 minutes/],
    ['off the 15-minute grid', '2030-01-14T11:10', /15-minute mark/],
  ])('validates the times: %s', async (_l, end, message) => {
    const f = mockFetch({ ...clientList() });
    setup();
    await pickClient();
    fireEvent.change(screen.getByLabelText('End (Sri Lanka time)'), { target: { value: end } });
    await userEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(posts(f)).toHaveLength(0);
  });

  it('moving the start keeps the meeting length', () => {
    mockFetch({});
    setup();
    fireEvent.change(screen.getByLabelText('Start (Sri Lanka time)'), {
      target: { value: '2030-01-14T13:30' },
    });
    expect(screen.getByLabelText('End (Sri Lanka time)')).toHaveValue('2030-01-14T14:30');
  });

  it('shows who the mentor is already booked with on a 409, and offers no override', async () => {
    mockFetch({
      ...clientList(),
      'POST /api/meetings': () => ({
        status: 409,
        json: {
          error: {
            code: 'MEETING_CONFLICT',
            message: 'x',
            details: { conflictingMeeting: meeting({ client_name: 'Kamal Silva' }) },
          },
        },
      }),
    });
    const { onClose } = setup();
    await pickClient();
    await userEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Asha Mentor already has a meeting with Kamal Silva');
    expect(screen.queryByRole('button', { name: 'Book anyway' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on a 422 warning, "Book anyway" resends with force: true', async () => {
    let n = 0;
    const f = mockFetch({
      ...clientList(),
      'POST /api/meetings': ({ body }) =>
        body.force
          ? { status: 201, json: { meeting: meeting(), call: null } }
          : (n++,
            {
              status: 422,
              json: {
                error: {
                  code: 'OUTSIDE_AVAILABILITY',
                  message: "This time is outside the mentor's weekly availability",
                },
              },
            }),
    });
    const { onSaved } = setup();
    await pickClient();
    await userEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outside the mentor');
    await userEvent.click(screen.getByRole('button', { name: 'Book anyway' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posts(f).map((p) => p.body.force)).toEqual([false, true]);
    expect(n).toBe(1);
  });

  it('warns up-front when the slot is outside the known weekly hours', () => {
    mockFetch({});
    // Hours only on Tuesday, but the slot is Monday.
    setup({ blocks: [{ weekday: 2, start_time: '09:00', end_time: '17:00' }], timeOff: [] });
    expect(screen.getByText(/outside Asha Mentor's weekly availability/)).toBeInTheDocument();
  });

  it('no warning when the slot fits the weekly hours', () => {
    mockFetch({});
    setup({ blocks: [{ weekday: 1, start_time: '09:00', end_time: '17:00' }], timeOff: [] });
    expect(screen.queryByText(/weekly availability/)).not.toBeInTheDocument();
  });

  it('mentions the mentor timezone when it differs', () => {
    mockFetch({});
    setup({ mentor: { ...MENTOR, timezone: 'America/New_York' } });
    expect(screen.getByText(/timezone is America\/New_York/)).toBeInTheDocument();
  });

  it('adds a brand-new client inline when the typed phone number is unknown', async () => {
    const f = mockFetch({
      'GET /api/clients': () => ({
        json: { items: [], page: 1, pageSize: 25, total: 0, statusCounts: {} },
      }),
      'POST /api/clients': () => ({
        status: 201,
        json: { client: client({ id: 'cNew', name: 'Fresh Client', phone_e164: '+94712345678' }) },
      }),
    });
    setup();
    await userEvent.type(screen.getByLabelText('Client'), '0712345678');
    await userEvent.click(await screen.findByRole('button', { name: /add a new client/ }));
    expect(screen.getByLabelText('Phone')).toHaveValue('+94712345678');
    await userEvent.type(screen.getByLabelText('Name'), 'Fresh Client');
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }));
    expect(await screen.findByText('Fresh Client')).toBeInTheDocument(); // now the selected client
    expect(posts(f)[0]!.body).toMatchObject({ phone: '+94712345678', name: 'Fresh Client' });
  });

  it('edit mode: client is fixed, saves via PATCH', async () => {
    const f = mockFetch({
      'PATCH /api/meetings/m1': () => ({
        json: { meeting: meeting({ title: 'Renamed' }), call: null },
      }),
    });
    const { onSaved } = setup({ mode: 'edit', meeting: meeting() });
    expect(screen.queryByLabelText('Client')).not.toBeInTheDocument();
    expect(screen.getByText('Nimal Perera')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patch = f.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]!.body))).toMatchObject({
      title: 'Renamed',
      startAt: START,
      endAt: END,
      force: false,
    });
  });

  it('reschedule mode: only the time fields, and sends just the times', async () => {
    const f = mockFetch({
      'PATCH /api/meetings/m1': () => ({ json: { meeting: meeting(), call: null } }),
    });
    setup({ mode: 'reschedule', meeting: meeting() });
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Agenda')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start (Sri Lanka time)'), {
      target: { value: '2030-01-15T14:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    await waitFor(() => expect(f.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true));
    const body = JSON.parse(String(f.mock.calls.find(([, i]) => i?.method === 'PATCH')![1]!.body));
    expect(body).toEqual({
      startAt: '2030-01-15T08:30:00.000Z',
      endAt: '2030-01-15T09:30:00.000Z',
      force: false,
    });
  });
});
