import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { availabilityIntervals } from '@calllog/shared';
import { ApiError } from '../api/client';
import {
  useDeactivateMentor,
  useMeetings,
  useMentor,
  useTimeOff,
  useUpdateMentor,
} from '../api/hooks';
import { AvailabilityEditor } from '../components/AvailabilityEditor';
import {
  MeetingCalendar,
  type BackgroundBlock,
  type MoveRequest,
} from '../components/MeetingCalendar';
import { MeetingModal } from '../components/MeetingModal';
import { MeetingPanel } from '../components/MeetingPanel';
import { MentorForm } from '../components/MentorForm';
import { MiniMonth } from '../components/MiniMonth';
import { ConfirmDialog } from '../components/Modal';
import { MoveConfirm } from '../components/MoveConfirm';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { TimeOffEditor } from '../components/TimeOffEditor';
import { colomboDate, defaultView, isCalView } from '../lib/calendar';

type Tab = 'calendar' | 'availability' | 'time-off';
const TABS: { key: Tab; label: string }[] = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'availability', label: 'Availability' },
  { key: 'time-off', label: 'Time off' },
];

export default function MentorDetail() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const q = useMentor(id);
  const toast = useToast();
  const update = useUpdateMentor(id);
  const deactivate = useDeactivateMentor(id);

  const tab = (TABS.find((t) => t.key === sp.get('tab'))?.key ?? 'calendar') as Tab;
  const viewParam = sp.get('view');
  const view = isCalView(viewParam) ? viewParam : defaultView();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '')
    ? (sp.get('date') as string)
    : colomboDate();
  const meetingId = sp.get('meeting');

  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [creating, setCreating] = useState<{ start: string; end: string } | null>(null);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const meetings = useMeetings(
    range
      ? `?mentorIds=${id}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
      : '',
    !!range,
  );
  const timeOff = useTimeOff(id, range?.from, range?.to);

  const mentor = q.data?.mentor;
  const blocks = q.data?.availability;
  const timeOffIntervals = useMemo(
    () =>
      (timeOff.data?.items ?? []).map((t) => ({
        start: Date.parse(t.start_at),
        end: Date.parse(t.end_at),
      })),
    [timeOff.data],
  );
  const background = useMemo<BackgroundBlock[]>(() => {
    if (!mentor || !blocks || !range) return [];
    const from = Date.parse(range.from);
    const to = Date.parse(range.to);
    return [
      ...availabilityIntervals(blocks, mentor.timezone, from, to).map((iv, i) => ({
        id: String(i),
        ...iv,
        kind: 'available' as const,
        color: mentor.color,
      })),
      ...timeOffIntervals.map((iv, i) => ({ id: String(i), ...iv, kind: 'timeoff' as const })),
    ];
  }, [mentor, blocks, range, timeOffIntervals]);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  if (q.isLoading) return <Loading />;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <Empty>
        Mentor not found.{' '}
        <Link className="text-indigo-600 underline" to="/mentors">
          Back to mentors
        </Link>
      </Empty>
    );
  }
  if (q.error || !q.data || !mentor || !blocks)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const modalOpen = !!creating || !!move || editing || confirmOff || !!meetingId;
  const upcoming = q.data.upcomingScheduledMeetings;

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-4 w-4 rounded-full"
              style={{ background: mentor.color }}
            />
            <h1 className="text-2xl font-bold">{mentor.name}</h1>
            {!mentor.is_active && (
              <span className="rounded bg-slate-200 px-2 text-xs">Inactive</span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {mentor.email}
            {mentor.phone_e164 ? ` · ${mentor.phone_e164}` : ''} · {mentor.timezone} ·{' '}
            {mentor.default_meeting_minutes} min sessions
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {mentor.expertise.map((t) => (
              <span
                key={t}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
              >
                {t}
              </span>
            ))}
          </div>
          {mentor.bio && <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm">{mentor.bio}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setEditing(true)}>
            Edit mentor
          </button>
          {mentor.is_active ? (
            <button className="btn" onClick={() => setConfirmOff(true)}>
              Deactivate
            </button>
          ) : (
            <button
              className="btn"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { isActive: true },
                  { onSuccess: () => toast.success('Mentor reactivated') },
                )
              }
            >
              Reactivate
            </button>
          )}
        </div>
      </section>

      <div role="tablist" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key === 'calendar' ? null : t.key })}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'availability' && (
        <AvailabilityEditor mentorId={id} timezone={mentor.timezone} blocks={blocks} />
      )}
      {tab === 'time-off' && <TimeOffEditor mentorId={id} />}

      {tab === 'calendar' && (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <aside className="hidden space-y-3 lg:block">
            <MiniMonth selected={date} onSelect={(d) => setParams({ date: d })} />
            <div className="card !p-3 text-xs text-slate-600">
              <p className="mb-1 font-medium text-slate-800">Legend</p>
              <p>
                <span
                  className="mr-1 inline-block h-3 w-3 rounded align-middle"
                  style={{ background: `${mentor.color}33` }}
                />{' '}
                Weekly availability
              </p>
              <p className="mt-1">
                <span className="mr-1 inline-block h-3 w-3 rounded bg-slate-300 align-middle" />{' '}
                Time off
              </p>
              <p className="mt-2">
                Shortcuts: <kbd>t</kbd> today · <kbd>d</kbd> <kbd>w</kbd> <kbd>m</kbd> <kbd>a</kbd>{' '}
                views · <kbd>c</kbd> new meeting
              </p>
              <p className="mt-2">Times are shown in Sri Lanka time.</p>
            </div>
          </aside>
          <div>
            {meetings.error && (
              <ErrorState error={meetings.error} onRetry={() => meetings.refetch()} />
            )}
            {blocks.length === 0 && (
              <p className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                No weekly hours set yet, so every booking will need an override.{' '}
                <button className="underline" onClick={() => setParams({ tab: 'availability' })}>
                  Set hours
                </button>
              </p>
            )}
            {!mentor.is_active && (
              <p className="mb-3 rounded-md bg-slate-100 p-2 text-sm">
                This mentor is inactive and cannot be booked.
              </p>
            )}
            <MeetingCalendar
              view={view}
              date={date}
              onNavigate={(v, d) => setParams({ view: v, date: d })}
              onRange={(from, to) =>
                setRange((r) => (r?.from === from && r.to === to ? r : { from, to }))
              }
              meetings={meetings.data?.items ?? []}
              background={background}
              defaultMinutes={mentor.default_meeting_minutes}
              shortcutsEnabled={!modalOpen}
              onCreate={(start, end) => mentor.is_active && setCreating({ start, end })}
              onOpenMeeting={(mid) => setParams({ meeting: mid })}
              onMove={setMove}
              actions={
                <button
                  className="btn btn-primary"
                  disabled={!mentor.is_active}
                  onClick={() => setCreating({ start: '', end: '' })}
                >
                  New meeting
                </button>
              }
            />
            {meetings.isFetching && <p className="mt-1 text-xs text-slate-400">Updating…</p>}
          </div>
        </div>
      )}

      {creating && (
        <MeetingModal
          mode="create"
          mentor={mentor}
          initialStart={creating.start || undefined}
          initialEnd={creating.end || undefined}
          blocks={blocks}
          timeOff={timeOffIntervals}
          onClose={() => setCreating(null)}
        />
      )}
      {move && <MoveConfirm move={move} onDone={() => setMove(null)} />}
      {meetingId && (
        <MeetingPanel meetingId={meetingId} onClose={() => setParams({ meeting: null })} />
      )}
      {editing && (
        <MentorForm
          mentor={mentor}
          busy={update.isPending}
          error={update.error}
          onClose={() => setEditing(false)}
          onSubmit={(v) =>
            update.mutate(v, {
              onSuccess: () => {
                toast.success('Mentor saved');
                setEditing(false);
              },
            })
          }
        />
      )}
      {confirmOff && (
        <ConfirmDialog
          title="Deactivate this mentor?"
          confirmLabel="Deactivate"
          message={`${mentor.name} will be hidden from the mentor list and can't be booked. Their meetings and history are kept.${upcoming ? ` They have ${upcoming} upcoming scheduled meeting${upcoming === 1 ? '' : 's'}, which stay on the calendar.` : ''}`}
          busy={deactivate.isPending}
          onCancel={() => setConfirmOff(false)}
          onConfirm={() =>
            deactivate.mutate(undefined, {
              onSuccess: () => {
                toast.success('Mentor deactivated');
                setConfirmOff(false);
              },
            })
          }
        />
      )}
    </div>
  );
}
