import { useState } from 'react';
import type { Slot } from '@calllog/shared';
import { useFreeSlots } from '../api/hooks';
import type { MentorListItem } from '../api/types';
import { addDaysYmd, colomboDate } from '../lib/calendar';
import { formatRange } from '../lib/time';
import { ErrorState, Loading } from './States';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const SHOWN = 12;

interface Props {
  mentors: MentorListItem[];
  /** Mentors to search; empty means every active mentor. */
  mentorIds?: string[];
  onPick: (mentor: MentorListItem, slot: Slot) => void;
}

function MentorSlots({
  mentor,
  duration,
  from,
  to,
  onPick,
}: {
  mentor: MentorListItem;
  duration: number;
  from: string;
  to: string;
  onPick: (slot: Slot) => void;
}) {
  const q = useFreeSlots(mentor.id, `?duration=${duration}&from=${from}&to=${to}`);
  return (
    <section aria-label={`Free slots for ${mentor.name}`}>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: mentor.color }}
        />
        {mentor.name}
      </h3>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.slots.length === 0 && (
        <p className="text-sm text-slate-500">No free {duration}-minute slots in this period.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {q.data?.slots.slice(0, SHOWN).map((s) => (
          <button key={s.start} className="btn !px-2 !py-1 text-xs" onClick={() => onPick(s)}>
            {formatRange(s.start, s.end)}
          </button>
        ))}
      </div>
      {q.data && q.data.slots.length > SHOWN && (
        <p className="mt-1 text-xs text-slate-500">
          Showing the first {SHOWN} of {q.data.slots.length}. Narrow the dates to see others.
        </p>
      )}
    </section>
  );
}

/** Lists open slots for the chosen mentors; picking one hands the mentor and slot back. */
export function FreeSlotFinder({ mentors, mentorIds = [], onPick }: Props) {
  const [duration, setDuration] = useState(60);
  const [from, setFrom] = useState(() => colomboDate());
  const [to, setTo] = useState(() => addDaysYmd(colomboDate(), 7));
  const searched = mentors.filter(
    (m) => m.is_active && (mentorIds.length === 0 || mentorIds.includes(m.id)),
  );
  const valid = from <= to;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="slot-duration">
            Length
          </label>
          <select
            id="slot-duration"
            className="input"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} minutes
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="slot-from">
            From
          </label>
          <input
            id="slot-from"
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="slot-to">
            To
          </label>
          <input
            id="slot-to"
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      {!valid && (
        <p role="alert" className="text-sm text-red-600">
          “To” must not be before “From”.
        </p>
      )}
      {valid && searched.length === 0 && (
        <p className="text-sm text-slate-500">No active mentors to search.</p>
      )}
      {valid &&
        searched.map((m) => (
          <MentorSlots
            key={m.id}
            mentor={m}
            duration={duration}
            from={from}
            to={to}
            onPick={(slot) => onPick(m, slot)}
          />
        ))}
    </div>
  );
}
