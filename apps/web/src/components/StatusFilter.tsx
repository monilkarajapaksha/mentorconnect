import { useState } from 'react';
import { CALL_STATUSES, FOLLOW_UP_STATUSES, STATUS_LABELS, type CallStatus } from '@calllog/shared';
import { StatusBadge } from './StatusBadge';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
  /** Optional per-status counts, shown as "2nd Follow-up (7)". */
  counts?: Record<string, number>;
}

/** Multi-select status filter, with an "Any follow-up" shortcut for follow_up_1..10. */
export function StatusFilter({ selected, onChange, counts }: Props) {
  const [open, setOpen] = useState(false);
  const set = new Set(selected);
  const suffix = (n?: number) => (counts && n !== undefined ? ` (${n})` : '');
  const followUpCount = FOLLOW_UP_STATUSES.reduce((sum, s) => sum + (counts?.[s] ?? 0), 0);
  const anyFollowUp = FOLLOW_UP_STATUSES.every((s) => set.has(s));

  const toggle = (status: string) => {
    const next = new Set(set);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    onChange(CALL_STATUSES.filter((s) => next.has(s)));
  };
  const toggleAnyFollowUp = () => {
    const next = new Set(set);
    for (const s of FOLLOW_UP_STATUSES) {
      if (anyFollowUp) next.delete(s);
      else next.add(s);
    }
    onChange(CALL_STATUSES.filter((s) => next.has(s)));
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        Status{selected.length ? ` (${selected.length} selected)` : ': all'} ▾
      </button>
      {open && (
        <div
          role="group"
          aria-label="Filter by status"
          className="absolute z-20 mt-1 max-h-96 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
        >
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 font-medium hover:bg-slate-50">
            <input type="checkbox" checked={anyFollowUp} onChange={toggleAnyFollowUp} />
            <span>{`Any follow-up${suffix(followUpCount)}`}</span>
          </label>
          <hr className="my-1" />
          {CALL_STATUSES.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
            >
              <input type="checkbox" checked={set.has(s)} onChange={() => toggle(s)} />
              <span className="text-sm">{`${STATUS_LABELS[s]}${suffix(counts?.[s] ?? 0)}`}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              className="mt-1 w-full px-2 py-1 text-left text-sm text-indigo-600"
              onClick={() => onChange([])}
            >
              Clear status filter
            </button>
          )}
        </div>
      )}
      {selected.length > 0 && !anyFollowUp && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selected.map((s) => (
            <StatusBadge key={s} status={s as CallStatus} />
          ))}
        </div>
      )}
      {anyFollowUp && selected.length === FOLLOW_UP_STATUSES.length && (
        <div className="mt-2 text-xs text-slate-500">Any follow-up</div>
      )}
    </div>
  );
}
