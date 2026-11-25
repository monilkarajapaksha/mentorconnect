import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useCreateTimeOff, useDeleteTimeOff, useTimeOff } from '../api/hooks';
import { formatDateTime, fromColomboInput } from '../lib/time';
import { ConfirmDialog } from './Modal';
import { Empty, ErrorState, Loading } from './States';
import { useToast } from './Toast';

/** Leave, holidays and blocked time: upcoming and ongoing entries, plus a form to add one. */
export function TimeOffEditor({ mentorId }: { mentorId: string }) {
  const [from] = useState(() => new Date().toISOString());
  const list = useTimeOff(mentorId, from);
  const create = useCreateTimeOff(mentorId);
  const del = useDeleteTimeOff();
  const toast = useToast();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const startAt = fromColomboInput(start);
    const endAt = fromColomboInput(end);
    if (!startAt || !endAt) return setError('Choose a start and an end');
    if (Date.parse(endAt) <= Date.parse(startAt)) return setError('End must be after start');
    setError('');
    create.mutate(
      { startAt, endAt, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success('Time off added');
          setStart('');
          setEnd('');
          setReason('');
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save'),
      },
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="card space-y-3" aria-label="Add time off">
        <h3 className="font-semibold">Add time off</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="off-start">
              From (Sri Lanka time)
            </label>
            <input
              id="off-start"
              type="datetime-local"
              className="input"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="off-end">
              To (Sri Lanka time)
            </label>
            <input
              id="off-end"
              type="datetime-local"
              className="input"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="off-reason">
              Reason (optional)
            </label>
            <input
              id="off-reason"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Leave, holiday…"
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Add time off'}
        </button>
      </form>

      <div>
        <h3 className="mb-2 font-semibold">Upcoming time off</h3>
        {list.isLoading && <Loading />}
        {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data && list.data.items.length === 0 && <Empty>No time off scheduled.</Empty>}
        <ul className="space-y-2">
          {list.data?.items.map((t) => (
            <li key={t.id} className="card flex items-center justify-between gap-2 !p-3 text-sm">
              <div>
                <div className="font-medium">
                  {formatDateTime(t.start_at)} → {formatDateTime(t.end_at)}
                </div>
                {t.reason && <div className="text-slate-500">{t.reason}</div>}
              </div>
              <button
                className="btn"
                onClick={() => setRemoving(t.id)}
                aria-label={`Delete time off starting ${formatDateTime(t.start_at)}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>

      {removing && (
        <ConfirmDialog
          title="Delete time off?"
          message="The mentor becomes bookable again during this period. Existing meetings are not affected."
          busy={del.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            del.mutate(removing, {
              onSuccess: () => {
                toast.success('Time off removed');
                setRemoving(null);
              },
              onError: () => toast.error('Could not delete time off'),
            })
          }
        />
      )}
    </div>
  );
}
