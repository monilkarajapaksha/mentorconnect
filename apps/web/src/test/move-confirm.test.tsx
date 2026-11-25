import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../App';
import { MoveConfirm } from '../components/MoveConfirm';
import { meeting, mockFetch } from './utils';

afterEach(() => vi.unstubAllGlobals());

const NEW_START = '2030-01-15T08:30:00.000Z'; // Tue 14:00 Colombo
const NEW_END = '2030-01-15T09:30:00.000Z';

function setup(routes: Parameters<typeof mockFetch>[0]) {
  const f = mockFetch(routes);
  const revert = vi.fn();
  const onDone = vi.fn();
  render(
    <AppProviders>
      <MoveConfirm
        move={{ meeting: meeting(), newStart: NEW_START, newEnd: NEW_END, revert }}
        onDone={onDone}
      />
    </AppProviders>,
  );
  return { f, revert, onDone };
}
const patchCalls = (f: ReturnType<typeof mockFetch>) =>
  f.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([, i]) => JSON.parse(String(i!.body)));

describe('Move confirmation after drag / resize', () => {
  it('shows the old and the new time', () => {
    setup({});
    expect(screen.getByText('Mon, 14 Jan 2030, 10:00–11:00')).toBeInTheDocument();
    expect(screen.getByText('Tue, 15 Jan 2030, 14:00–15:00')).toBeInTheDocument();
  });

  it('Confirm sends the new times and does NOT revert', async () => {
    const { f, revert, onDone } = setup({
      'PATCH /api/meetings/m1': () => ({ json: { meeting: meeting(), call: null } }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(patchCalls(f)).toEqual([{ startAt: NEW_START, endAt: NEW_END, force: false }]);
    expect(revert).not.toHaveBeenCalled();
  });

  it('Cancel puts the event back and sends nothing', async () => {
    const { f, revert, onDone } = setup({});
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(revert).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalled();
    expect(patchCalls(f)).toHaveLength(0);
  });

  it('closing with Escape also puts the event back', async () => {
    const { revert } = setup({});
    await userEvent.keyboard('{Escape}');
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it('on a 409 clash the event is rolled back and the admin is told who it clashes with', async () => {
    const { revert, onDone } = setup({
      'PATCH /api/meetings/m1': () => ({
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
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    await waitFor(() => expect(revert).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalled();
    expect(
      await screen.findByText('Not moved: clashes with a meeting with Kamal Silva'),
    ).toBeInTheDocument();
  });

  it('on any other server error it also rolls back', async () => {
    const { revert } = setup({
      'PATCH /api/meetings/m1': () => ({
        status: 500,
        json: { error: { code: 'INTERNAL', message: 'Boom' } },
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    await waitFor(() => expect(revert).toHaveBeenCalled());
    expect(await screen.findByText('Not moved: Boom')).toBeInTheDocument();
  });

  it('on a 422 availability warning it asks, and "Move anyway" resends with force', async () => {
    const { f, revert, onDone } = setup({
      'PATCH /api/meetings/m1': ({ body }) =>
        body.force
          ? { json: { meeting: meeting(), call: null } }
          : {
              status: 422,
              json: {
                error: {
                  code: 'OUTSIDE_AVAILABILITY',
                  message: "This time is outside the mentor's weekly availability",
                },
              },
            },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm move' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Move it anyway?');
    expect(revert).not.toHaveBeenCalled(); // still waiting for the decision
    await userEvent.click(screen.getByRole('button', { name: 'Move anyway' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(patchCalls(f).map((b) => b.force)).toEqual([false, true]);
    expect(revert).not.toHaveBeenCalled();
  });
});
