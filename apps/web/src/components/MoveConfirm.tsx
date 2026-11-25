import { useState } from 'react';
import { ApiError } from '../api/client';
import { useUpdateMeeting } from '../api/hooks';
import { formatRange } from '../lib/time';
import type { MoveRequest } from './MeetingCalendar';
import { Modal } from './Modal';
import { useToast } from './Toast';

/**
 * Shown after a drag or resize: old vs new time, then PATCH.
 * The calendar already shows the new position (optimistic); anything but success reverts it.
 */
export function MoveConfirm({ move, onDone }: { move: MoveRequest; onDone: () => void }) {
  const update = useUpdateMeeting();
  const toast = useToast();
  const [warning, setWarning] = useState<string | null>(null);
  const { meeting } = move;

  function cancel() {
    move.revert();
    onDone();
  }

  function confirm(force: boolean) {
    update.mutate(
      { id: meeting.id, startAt: move.newStart, endAt: move.newEnd, force },
      {
        onSuccess: () => {
          toast.success('Meeting moved');
          onDone();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 422) {
            setWarning(err.message); // let the admin decide: "Move anyway"
            return;
          }
          move.revert();
          if (err instanceof ApiError && err.code === 'MEETING_CONFLICT') {
            const c = (err.details as { conflictingMeeting?: { client_name: string } } | undefined)
              ?.conflictingMeeting;
            toast.error(
              c
                ? `Not moved: clashes with a meeting with ${c.client_name}`
                : 'Not moved: time already booked',
            );
          } else {
            toast.error(
              err instanceof ApiError ? `Not moved: ${err.message}` : 'Could not move the meeting',
            );
          }
          onDone();
        },
      },
    );
  }

  return (
    <Modal title="Move meeting?" onClose={cancel}>
      <p className="mb-3 text-sm">
        <b>{meeting.client_name}</b> with {meeting.mentor_name}
      </p>
      <dl className="mb-4 space-y-2 text-sm">
        <div className="rounded bg-slate-50 p-2">
          <dt className="text-xs uppercase text-slate-500">Currently</dt>
          <dd>{formatRange(meeting.start_at, meeting.end_at)}</dd>
        </div>
        <div className="rounded bg-indigo-50 p-2">
          <dt className="text-xs uppercase text-indigo-600">New time</dt>
          <dd className="font-medium">{formatRange(move.newStart, move.newEnd)}</dd>
        </div>
      </dl>
      {warning && (
        <p role="alert" className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          {warning}. Move it anyway?
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={cancel} disabled={update.isPending}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => confirm(!!warning)}
          disabled={update.isPending}
        >
          {update.isPending ? 'Moving…' : warning ? 'Move anyway' : 'Confirm move'}
        </button>
      </div>
    </Modal>
  );
}
