import { useState, type FormEvent } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import {
  MEETING_MODES,
  MEETING_MODE_LABELS,
  meetingTimeIssues,
  scheduleViolations,
  type Call,
  type Client,
  type Interval,
  type MeetingMode,
  type MeetingWithRefs,
  type WeeklyBlock,
} from '@calllog/shared';
import { ApiError } from '../api/client';
import { useCreateMeeting, useUpdateMeeting } from '../api/hooks';
import { ceilQuarter } from '../lib/calendar';
import { formatRange, fromColomboInput, toColomboInput } from '../lib/time';
import { ClientPicker } from './ClientPicker';
import { Modal } from './Modal';
import { useToast } from './Toast';

export interface MentorRef {
  id: string;
  name: string;
  timezone: string;
  default_meeting_minutes: number;
}

interface Props {
  mode: 'create' | 'edit' | 'reschedule';
  mentor: MentorRef;
  /** create: pre-selected client (e.g. when booking from a client's page). */
  client?: Client | null;
  /** edit / reschedule: the meeting being changed. */
  meeting?: MeetingWithRefs;
  /** create: the slot the admin picked. */
  initialStart?: string;
  initialEnd?: string;
  /** When known, used to warn about hours/time off before the server is asked. */
  blocks?: WeeklyBlock[];
  timeOff?: Interval[];
  onClose: () => void;
  onSaved?: (result: { meeting: MeetingWithRefs; call: Call | null }) => void;
}

type Problem = { kind: 'conflict' | 'soft' | 'error'; message: string };

const TITLES = {
  create: 'New meeting',
  edit: 'Edit meeting',
  reschedule: 'Reschedule meeting',
} as const;

export function MeetingModal({
  mode,
  mentor,
  client: initialClient = null,
  meeting,
  initialStart,
  initialEnd,
  blocks,
  timeOff,
  onClose,
  onSaved,
}: Props) {
  const toast = useToast();
  const create = useCreateMeeting();
  const update = useUpdateMeeting();

  const startIso =
    meeting?.start_at ?? initialStart ?? new Date(ceilQuarter(Date.now())).toISOString();
  const endIso =
    meeting?.end_at ??
    initialEnd ??
    new Date(Date.parse(startIso) + mentor.default_meeting_minutes * 60_000).toISOString();

  const [client, setClient] = useState<Client | null>(initialClient);
  const [title, setTitle] = useState(meeting?.title ?? 'Mentoring session');
  const [start, setStart] = useState(toColomboInput(startIso));
  const [end, setEnd] = useState(toColomboInput(endIso));
  const [meetMode, setMeetMode] = useState<MeetingMode>(meeting?.mode ?? 'online');
  const [link, setLink] = useState(meeting?.location_or_link ?? '');
  const [agenda, setAgenda] = useState(meeting?.agenda ?? '');
  const [notes, setNotes] = useState(meeting?.notes ?? '');
  const [logCall, setLogCall] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const startUtc = fromColomboInput(start);
  const endUtc = fromColomboInput(end);
  const busy = create.isPending || update.isPending;

  // Mirror of the server's soft rules, shown before submitting when the schedule is known.
  const liveWarning =
    blocks && timeOff && startUtc && endUtc && Date.parse(endUtc) > Date.parse(startUtc)
      ? scheduleViolations({
          blocks,
          timeOff,
          timeZone: mentor.timezone,
          start: Date.parse(startUtc),
          end: Date.parse(endUtc),
        })
      : [];

  function changeStart(value: string) {
    // Moving the start keeps the meeting's length.
    const oldStart = fromColomboInput(start);
    const oldEnd = fromColomboInput(end);
    const next = fromColomboInput(value);
    setStart(value);
    if (oldStart && oldEnd && next) {
      setEnd(
        toColomboInput(
          new Date(Date.parse(next) + (Date.parse(oldEnd) - Date.parse(oldStart))).toISOString(),
        ),
      );
    }
  }

  function validate(): { startAt: string; endAt: string } | null {
    const next: Record<string, string> = {};
    if (mode === 'create' && !client) next.client = 'Choose a client';
    if (mode !== 'reschedule' && !title.trim()) next.title = 'Title is required';
    if (!startUtc) next.start = 'Start is required';
    if (!endUtc) next.end = 'End is required';
    if (startUtc && endUtc) {
      for (const issue of meetingTimeIssues(startUtc, endUtc)) {
        next[issue.path === 'startAt' ? 'start' : 'end'] ??= issue.message;
      }
    }
    setErrors(next);
    return Object.keys(next).length || !startUtc || !endUtc
      ? null
      : { startAt: startUtc, endAt: endUtc };
  }

  function handleError(err: unknown, canForce: (b: boolean) => void) {
    if (err instanceof ApiError && err.code === 'MEETING_CONFLICT') {
      const c = (err.details as { conflictingMeeting?: MeetingWithRefs } | undefined)
        ?.conflictingMeeting;
      setProblem({
        kind: 'conflict',
        message: c
          ? `${mentor.name} already has a meeting with ${c.client_name} at ${formatRange(c.start_at, c.end_at)}.`
          : err.message,
      });
    } else if (err instanceof ApiError && err.status === 422) {
      setProblem({ kind: 'soft', message: err.message });
      canForce(true);
    } else {
      setProblem({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not save the meeting.',
      });
    }
  }

  function submit(force = false) {
    setProblem(null);
    const times = validate();
    if (!times) return;
    const done = (r: { meeting: MeetingWithRefs; call: Call | null }) => {
      toast.success(
        mode === 'create'
          ? r.call
            ? 'Meeting booked and call logged'
            : 'Meeting booked'
          : mode === 'reschedule'
            ? 'Meeting rescheduled'
            : 'Meeting saved',
      );
      onSaved?.(r);
      onClose();
    };
    const onError = (err: unknown) => handleError(err, () => undefined);

    if (mode === 'create' && client) {
      create.mutate(
        {
          mentorId: mentor.id,
          clientId: client.id,
          title: title.trim(),
          ...times,
          mode: meetMode,
          locationOrLink: link.trim(),
          agenda: agenda.trim(),
          force,
          logCall,
        },
        { onSuccess: done, onError },
      );
    } else if (meeting) {
      update.mutate(
        {
          id: meeting.id,
          ...times,
          ...(mode === 'edit'
            ? {
                title: title.trim(),
                mode: meetMode,
                locationOrLink: link.trim(),
                agenda: agenda.trim(),
                notes: notes.trim(),
              }
            : {}),
          force,
        },
        { onSuccess: done, onError },
      );
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(false);
  };

  const tzNote =
    mentor.timezone !== 'Asia/Colombo' && startUtc
      ? `${mentor.name}'s timezone is ${mentor.timezone}: ${formatInTimeZone(startUtc, mentor.timezone, 'EEE HH:mm')} there.`
      : null;

  return (
    <Modal title={TITLES[mode]} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-slate-600">
          Mentor: <b>{mentor.name}</b>
        </p>

        {mode === 'create' && (
          <ClientPicker value={client} onChange={setClient} error={errors.client} />
        )}
        {mode !== 'create' && meeting && (
          <p className="text-sm text-slate-600">
            Client: <b>{meeting.client_name}</b>{' '}
            <span className="text-slate-500">{meeting.client_phone}</span>
          </p>
        )}

        {mode !== 'reschedule' && (
          <div>
            <label className="label" htmlFor="meeting-title">
              Title
            </label>
            <input
              id="meeting-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={!!errors.title}
            />
            {errors.title && <p className="mt-1 text-sm text-red-600">{errors.title}</p>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="meeting-start">
              Start (Sri Lanka time)
            </label>
            <input
              id="meeting-start"
              type="datetime-local"
              step={900}
              className="input"
              value={start}
              onChange={(e) => changeStart(e.target.value)}
              aria-invalid={!!errors.start}
            />
            {errors.start && <p className="mt-1 text-sm text-red-600">{errors.start}</p>}
          </div>
          <div>
            <label className="label" htmlFor="meeting-end">
              End (Sri Lanka time)
            </label>
            <input
              id="meeting-end"
              type="datetime-local"
              step={900}
              className="input"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              aria-invalid={!!errors.end}
            />
            {errors.end && <p className="mt-1 text-sm text-red-600">{errors.end}</p>}
          </div>
        </div>
        {tzNote && <p className="text-xs text-slate-500">{tzNote}</p>}

        {mode !== 'reschedule' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="meeting-mode">
                  Mode
                </label>
                <select
                  id="meeting-mode"
                  className="input"
                  value={meetMode}
                  onChange={(e) => setMeetMode(e.target.value as MeetingMode)}
                >
                  {MEETING_MODES.map((m) => (
                    <option key={m} value={m}>
                      {MEETING_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="meeting-link">
                  Location or link
                </label>
                <input
                  id="meeting-link"
                  className="input"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://… or address"
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="meeting-agenda">
                Agenda
              </label>
              <textarea
                id="meeting-agenda"
                className="input"
                rows={2}
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
              />
            </div>
            {mode === 'edit' && (
              <div>
                <label className="label" htmlFor="meeting-notes">
                  Notes (after the session)
                </label>
                <textarea
                  id="meeting-notes"
                  className="input"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            )}
          </>
        )}

        {mode === 'create' && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={logCall}
                onChange={(e) => setLogCall(e.target.checked)}
              />
              <span>
                Also log a call with status <b>Scheduled</b> for this client
              </span>
            </label>
            {logCall && (
              <p className="mt-2 text-xs text-slate-600">
                This will add a call to {client?.name ?? 'the client'}’s timeline: <i>Scheduled</i>
                {startUtc ? ` for ${formatRange(startUtc, endUtc ?? startUtc)}` : ''}, and set their
                current status to Scheduled.
              </p>
            )}
          </div>
        )}

        {liveWarning.length > 0 && !problem && (
          <p role="status" className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
            {liveWarning.includes('time_off') ? `${mentor.name} has time off then. ` : ''}
            {liveWarning.includes('outside_availability')
              ? `This is outside ${mentor.name}'s weekly availability. `
              : ''}
            You can still book it, but you will be asked to confirm.
          </p>
        )}

        {problem && (
          <div
            role="alert"
            className={`rounded-md p-3 text-sm ${problem.kind === 'soft' ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800'}`}
          >
            <p>{problem.message}</p>
            {problem.kind === 'soft' && (
              <button
                type="button"
                className="btn btn-primary mt-2"
                disabled={busy}
                onClick={() => submit(true)}
              >
                Book anyway
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy
              ? 'Saving…'
              : mode === 'create'
                ? 'Book meeting'
                : mode === 'reschedule'
                  ? 'Reschedule'
                  : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
