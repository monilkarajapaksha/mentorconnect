import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import {
  MEETING_MODE_LABELS,
  MEETING_STATUSES,
  MEETING_STATUS_LABELS,
  type MeetingStatus,
} from '@calllog/shared';
import { ApiError } from '../api/client';
import { useDeleteMeeting, useMeeting, useUpdateMeeting } from '../api/hooks';
import type { MeetingHistoryEntry } from '../api/types';
import { formatDateTime, formatRange } from '../lib/time';
import { MeetingModal } from './MeetingModal';
import { ConfirmDialog, Modal } from './Modal';
import { ErrorState, Loading } from './States';
import { StatusBadge } from './StatusBadge';
import { useToast } from './Toast';

export const MEETING_STATUS_STYLES: Record<MeetingStatus, string> = {
  scheduled: 'bg-blue-100 text-blue-800 border-blue-300',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-300 line-through',
  no_show: 'bg-orange-100 text-orange-800 border-orange-300',
  rescheduled: 'bg-purple-100 text-purple-800 border-purple-300',
};

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${MEETING_STATUS_STYLES[status]}`}
    >
      {MEETING_STATUS_LABELS[status]}
    </span>
  );
}

type Dialog = 'edit' | 'reschedule' | 'cancel' | 'complete' | 'delete' | null;

const ACTION_LABELS: Record<MeetingHistoryEntry['action'], string> = {
  created: 'Created',
  updated: 'Edited',
  rescheduled: 'Rescheduled',
  status_changed: 'Status changed',
  cancelled: 'Cancelled',
};
const VIOLATION_LABELS: Record<string, string> = {
  outside_availability: 'outside availability',
  time_off: 'time off',
};

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (field === 'status') return MEETING_STATUS_LABELS[v as MeetingStatus] ?? String(v);
  if (field === 'mode')
    return MEETING_MODE_LABELS[v as keyof typeof MEETING_MODE_LABELS] ?? String(v);
  if (field === 'start_at' || field === 'end_at') return formatDateTime(String(v));
  return String(v);
}
const FIELD_LABELS: Record<string, string> = {
  start_at: 'Start',
  end_at: 'End',
  location_or_link: 'Location / link',
  title: 'Title',
  status: 'Status',
  mode: 'Mode',
  agenda: 'Agenda',
  notes: 'Notes',
};

interface Props {
  meetingId: string;
  onClose: () => void;
}

/** Side panel with everything about one meeting, and the actions on it. */
export function MeetingPanel({ meetingId, onClose }: Props) {
  const q = useMeeting(meetingId);
  const update = useUpdateMeeting();
  const del = useDeleteMeeting();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [logCall, setLogCall] = useState(true);
  const [notes, setNotes] = useState('');

  const data = q.data;
  useEffect(() => setNotes(data?.meeting.notes ?? ''), [data?.meeting.notes, data?.meeting.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !dialog && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, dialog]);

  function patch(body: Parameters<typeof update.mutate>[0], success: string) {
    update.mutate(body, {
      onSuccess: () => {
        toast.success(success);
        setDialog(null);
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : 'Could not update the meeting');
        setDialog(null);
      },
    });
  }

  return (
    <aside
      aria-label="Meeting details"
      className="fixed inset-y-0 right-0 z-30 flex w-full flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl sm:w-[26rem]"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Meeting details</h2>
        <button
          className="text-slate-400 hover:text-slate-700"
          onClick={onClose}
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      {q.isLoading && <Loading />}
      {q.error && (
        <div className="p-4">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}

      {data && (
        <div className="space-y-5 p-4">
          <section>
            <h3 className="text-lg font-semibold">{data.meeting.title}</h3>
            <p className="mt-1 text-sm">
              {formatRange(data.meeting.start_at, data.meeting.end_at)}
            </p>
            <p className="text-xs text-slate-500">Sri Lanka time</p>
            {data.mentor.timezone !== 'Asia/Colombo' && (
              <p className="text-xs text-slate-500">
                {formatInTimeZone(data.meeting.start_at, data.mentor.timezone, 'HH:mm')}–
                {formatInTimeZone(data.meeting.end_at, data.mentor.timezone, 'HH:mm')} in{' '}
                {data.mentor.timezone}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="meeting-status" className="text-sm font-medium">
                Status
              </label>
              <select
                id="meeting-status"
                className="input !w-auto"
                value={data.meeting.status}
                disabled={update.isPending}
                onChange={(e) => {
                  const next = e.target.value as MeetingStatus;
                  if (next === 'completed') setDialog('complete');
                  else if (next === 'cancelled') setDialog('cancel');
                  else
                    patch(
                      { id: data.meeting.id, status: next },
                      `Marked ${MEETING_STATUS_LABELS[next].toLowerCase()}`,
                    );
                }}
              >
                {MEETING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {MEETING_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <MeetingStatusBadge status={data.meeting.status} />
            </div>
          </section>

          <section className="space-y-1 text-sm">
            <p>
              <span className="text-slate-500">Mode:</span> {MEETING_MODE_LABELS[data.meeting.mode]}
            </p>
            {data.meeting.location_or_link && (
              <p className="break-all">
                <span className="text-slate-500">Where:</span>{' '}
                {/^https?:\/\//.test(data.meeting.location_or_link) ? (
                  <a
                    className="text-indigo-600 underline"
                    href={data.meeting.location_or_link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {data.meeting.location_or_link}
                  </a>
                ) : (
                  data.meeting.location_or_link
                )}
              </p>
            )}
            {data.meeting.agenda && (
              <p className="whitespace-pre-wrap">
                <span className="text-slate-500">Agenda:</span> {data.meeting.agenda}
              </p>
            )}
          </section>

          <section>
            <label className="label" htmlFor="panel-notes">
              Notes (after the session)
            </label>
            <textarea
              id="panel-notes"
              className="input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button
              className="btn mt-2"
              disabled={update.isPending || notes === (data.meeting.notes ?? '')}
              onClick={() => patch({ id: data.meeting.id, notes }, 'Notes saved')}
            >
              Save notes
            </button>
          </section>

          <section className="card" aria-label="Client">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{data.client.name}</p>
                <p className="text-sm text-slate-600">{data.client.phone_e164}</p>
              </div>
              <StatusBadge status={data.clientCurrentStatus} />
            </div>
            <p className="mb-1 mt-3 text-xs uppercase text-slate-500">Last calls</p>
            {data.recentCalls.length === 0 ? (
              <p className="text-sm text-slate-500">No calls yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.recentCalls.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={c.status} />
                      <span className="text-xs text-slate-400">{formatDateTime(c.created_at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-slate-600">{c.summary}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={`/clients/${data.client.id}`} className="btn btn-primary">
                Open client
              </Link>
              <Link to={`/mentors/${data.mentor.id}`} className="btn">
                Open mentor
              </Link>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Mentor:{' '}
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: data.mentor.color }}
                />
                {data.mentor.name}
              </span>
            </p>
          </section>

          <section className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setDialog('edit')}>
              Edit
            </button>
            <button className="btn" onClick={() => setDialog('reschedule')}>
              Reschedule
            </button>
            {data.meeting.status !== 'completed' && (
              <button className="btn" onClick={() => setDialog('complete')}>
                Mark completed
              </button>
            )}
            {data.meeting.status !== 'cancelled' && (
              <button className="btn" onClick={() => setDialog('cancel')}>
                Cancel meeting
              </button>
            )}
            <button className="btn text-red-700" onClick={() => setDialog('delete')}>
              Delete
            </button>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            <ol className="space-y-3 text-xs">
              {data.history.map((h) => (
                <li key={h.id} className="rounded-md bg-slate-50 p-2">
                  <div className="font-medium">
                    {ACTION_LABELS[h.action]} · {formatDateTime(h.changed_at)} ·{' '}
                    {h.admin_name ?? 'Unknown'}
                  </div>
                  <ul className="ml-4 mt-1 list-disc">
                    {Object.entries(h.changes).map(([field, change]) =>
                      Array.isArray(change) ? (
                        <li key={field} className="text-amber-700">
                          Overridden: {change.map((c) => VIOLATION_LABELS[c] ?? c).join(', ')}
                        </li>
                      ) : h.action === 'created' ? null : (
                        <li key={field}>
                          {FIELD_LABELS[field] ?? field}: {fmtValue(field, change.old)} →{' '}
                          {fmtValue(field, change.new)}
                        </li>
                      ),
                    )}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}

      {data && (dialog === 'edit' || dialog === 'reschedule') && (
        <MeetingModal
          mode={dialog}
          mentor={data.mentor}
          meeting={data.meeting}
          onClose={() => setDialog(null)}
        />
      )}

      {data && dialog === 'cancel' && (
        <ConfirmDialog
          title="Cancel this meeting?"
          message="The meeting is kept in the history as cancelled, and the time becomes free again. The client's call status is not changed."
          confirmLabel="Cancel meeting"
          busy={update.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() => patch({ id: data.meeting.id, status: 'cancelled' }, 'Meeting cancelled')}
        />
      )}

      {data && dialog === 'complete' && (
        <Modal title="Mark as completed" onClose={() => setDialog(null)}>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={logCall}
              onChange={(e) => setLogCall(e.target.checked)}
            />
            <span>
              Also log a call with status <b>Session Done</b> for {data.client.name}
            </span>
          </label>
          {logCall && (
            <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
              This adds a call to their timeline and changes their current status from{' '}
              <b>{data.clientCurrentStatus ?? 'none'}</b> to <b>Session Done</b>.
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn" onClick={() => setDialog(null)}>
              Back
            </button>
            <button
              className="btn btn-primary"
              disabled={update.isPending}
              onClick={() =>
                patch(
                  { id: data.meeting.id, status: 'completed', logCall },
                  logCall ? 'Completed and call logged' : 'Marked completed',
                )
              }
            >
              Mark completed
            </button>
          </div>
        </Modal>
      )}

      {data && dialog === 'delete' && (
        <ConfirmDialog
          title="Delete this meeting?"
          message="This permanently removes the meeting and its history. Calls already logged stay, but lose their link. To keep a record, cancel it instead."
          busy={del.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            del.mutate(data.meeting.id, {
              onSuccess: () => {
                toast.success('Meeting deleted');
                onClose();
              },
              onError: () => toast.error('Could not delete the meeting'),
            })
          }
        />
      )}
    </aside>
  );
}
