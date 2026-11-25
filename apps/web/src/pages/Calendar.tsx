import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MEETING_STATUSES, MEETING_STATUS_LABELS, type MeetingStatus } from '@calllog/shared';
import { useMeetings, useMentors } from '../api/hooks';
import type { MentorListItem } from '../api/types';
import { BookSession } from '../components/BookSession';
import { MeetingCalendar, type MoveRequest } from '../components/MeetingCalendar';
import { MeetingModal } from '../components/MeetingModal';
import { MeetingPanel } from '../components/MeetingPanel';
import { MentorFilter } from '../components/MentorFilter';
import { MiniMonth } from '../components/MiniMonth';
import { Modal } from '../components/Modal';
import { MoveConfirm } from '../components/MoveConfirm';
import { ErrorState, Loading } from '../components/States';
import { colomboDate, defaultView, isCalView } from '../lib/calendar';

const isStatus = (s: string): s is MeetingStatus =>
  (MEETING_STATUSES as readonly string[]).includes(s);

/** Every mentor's meetings on one calendar, filtered by mentor and status. */
export default function Calendar() {
  const [sp, setSp] = useSearchParams();
  const mentors = useMentors('');
  const viewParam = sp.get('view');
  const view = isCalView(viewParam) ? viewParam : defaultView();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '')
    ? (sp.get('date') as string)
    : colomboDate();
  const selected = (sp.get('mentors') ?? '').split(',').filter(Boolean);
  const statuses = (sp.get('status') ?? '').split(',').filter(isStatus);
  const meetingId = sp.get('meeting');

  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [finding, setFinding] = useState(false);
  const [creating, setCreating] = useState<{ start: string; end: string } | null>(null);
  const [mentorChoice, setMentorChoice] = useState('');

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  const query = range
    ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` +
      (selected.length ? `&mentorIds=${selected.join(',')}` : '') +
      (statuses.length ? `&status=${statuses.join(',')}` : '')
    : '';
  const meetings = useMeetings(query, !!range);

  const items = mentors.data?.items ?? [];
  const activeItems = useMemo(() => items.filter((m) => m.is_active), [items]);
  const targets = selected.length
    ? activeItems.filter((m) => selected.includes(m.id))
    : activeItems;
  const mentorFor = (id: string): MentorListItem | undefined => items.find((m) => m.id === id);
  // A slot click needs one mentor: use the only one in view, otherwise ask.
  const soleMentor = targets.length === 1 ? targets[0] : undefined;
  const chosen = soleMentor ?? mentorFor(mentorChoice);
  const modalOpen = !!move || finding || !!creating || !!meetingId;

  if (mentors.isLoading) return <Loading />;
  if (mentors.error) return <ErrorState error={mentors.error} onRetry={() => mentors.refetch()} />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Calendar</h1>
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-3">
          <div className="hidden lg:block">
            <MiniMonth selected={date} onSelect={(d) => setParams({ date: d })} />
          </div>
          <MentorFilter
            mentors={activeItems}
            selected={selected}
            onChange={(ids) => setParams({ mentors: ids.join(',') })}
          />
          <fieldset className="card !p-3">
            <legend className="sr-only">Meeting status</legend>
            <p className="mb-1 text-sm font-semibold">Status</p>
            <div className="flex flex-wrap gap-1">
              {MEETING_STATUSES.map((s) => {
                const on = statuses.includes(s);
                return (
                  <button
                    key={s}
                    aria-pressed={on}
                    onClick={() =>
                      setParams({
                        status: (on ? statuses.filter((x) => x !== s) : [...statuses, s]).join(','),
                      })
                    }
                    className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white'}`}
                  >
                    {MEETING_STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
            {statuses.length === 0 && (
              <p className="mt-1 text-xs text-slate-500">All statuses shown.</p>
            )}
          </fieldset>
          <button className="btn w-full" onClick={() => setFinding(true)}>
            Find a free slot
          </button>
        </aside>
        <div>
          {meetings.error && (
            <ErrorState error={meetings.error} onRetry={() => meetings.refetch()} />
          )}
          <MeetingCalendar
            multiMentor
            view={view}
            date={date}
            onNavigate={(v, d) => setParams({ view: v, date: d })}
            onRange={(from, to) =>
              setRange((r) => (r?.from === from && r.to === to ? r : { from, to }))
            }
            meetings={meetings.data?.items ?? []}
            defaultMinutes={soleMentor?.default_meeting_minutes ?? 60}
            shortcutsEnabled={!modalOpen}
            onCreate={(start, end) => setCreating({ start, end })}
            onOpenMeeting={(id) => setParams({ meeting: id })}
            onMove={setMove}
            actions={
              <button
                className="btn btn-primary"
                onClick={() => setCreating({ start: '', end: '' })}
              >
                New meeting
              </button>
            }
          />
          {meetings.data && meetings.data.items.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">No meetings in this period.</p>
          )}
        </div>
      </div>

      {creating && !chosen && (
        <Modal title="Which mentor?" onClose={() => setCreating(null)}>
          <label className="label" htmlFor="pick-mentor">
            Mentor
          </label>
          <select
            id="pick-mentor"
            className="input"
            value={mentorChoice}
            onChange={(e) => setMentorChoice(e.target.value)}
          >
            <option value="">Choose a mentor…</option>
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Modal>
      )}
      {creating && chosen && (
        <MeetingModal
          mode="create"
          mentor={chosen}
          initialStart={creating.start || undefined}
          initialEnd={creating.end || undefined}
          onClose={() => {
            setCreating(null);
            setMentorChoice('');
          }}
        />
      )}
      {finding && <BookSession mentorIds={selected} onClose={() => setFinding(false)} />}
      {move && <MoveConfirm move={move} onDone={() => setMove(null)} />}
      {meetingId && (
        <MeetingPanel meetingId={meetingId} onClose={() => setParams({ meeting: null })} />
      )}
    </div>
  );
}
