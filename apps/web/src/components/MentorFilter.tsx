import { useState } from 'react';
import type { MentorListItem } from '../api/types';

interface Props {
  mentors: MentorListItem[];
  /** Selected ids; empty means "all". */
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** Searchable mentor checklist with colour dots. Nothing ticked = everyone. */
export function MentorFilter({ mentors, selected, onChange }: Props) {
  const [text, setText] = useState('');
  const shown = mentors.filter((m) => m.name.toLowerCase().includes(text.trim().toLowerCase()));
  const all = selected.length === 0;

  function toggle(id: string) {
    const base = all ? mentors.map((m) => m.id) : selected;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    onChange(next.length === mentors.length ? [] : next);
  }

  return (
    <fieldset className="card !p-3">
      <legend className="sr-only">Mentors</legend>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Mentors</span>
        <button className="text-xs text-indigo-600 underline" onClick={() => onChange([])}>
          Show all
        </button>
      </div>
      <input
        type="search"
        className="input mb-2 !py-1 text-sm"
        placeholder="Search mentors"
        aria-label="Search mentors"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {shown.map((m) => (
          <li key={m.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={all || selected.includes(m.id)}
                onChange={() => toggle(m.id)}
              />
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: m.color }}
              />
              {m.name}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="text-xs text-slate-500">No mentors match.</li>}
      </ul>
    </fieldset>
  );
}
