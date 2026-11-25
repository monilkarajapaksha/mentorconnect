import { useEffect, useState } from 'react';
import { colomboDate } from '../lib/calendar';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Small month picker. Works on plain YYYY-MM-DD strings, so it never depends on the browser timezone. */
export function MiniMonth({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (ymd: string) => void;
}) {
  const [shown, setShown] = useState(selected.slice(0, 7)); // YYYY-MM
  useEffect(() => setShown(selected.slice(0, 7)), [selected]);

  const [y, m] = shown.split('-').map(Number) as [number, number];
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = colomboDate();
  const move = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setShown(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const cells = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="card !p-3 text-sm" aria-label="Mini calendar">
      <div className="mb-2 flex items-center justify-between">
        <button
          className="rounded px-2 hover:bg-slate-100"
          aria-label="Previous month"
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <span className="font-medium">
          {MONTHS[m - 1]} {y}
        </span>
        <button
          className="rounded px-2 hover:bg-slate-100"
          aria-label="Next month"
          onClick={() => move(1)}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs text-slate-500">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;
          const ymd = `${shown}-${pad(day)}`;
          const isSel = ymd === selected;
          return (
            <button
              key={ymd}
              onClick={() => onSelect(ymd)}
              aria-label={ymd}
              aria-pressed={isSel}
              className={`mx-auto h-7 w-7 rounded-full text-sm ${
                isSel
                  ? 'bg-indigo-600 text-white'
                  : ymd === today
                    ? 'border border-indigo-400 text-indigo-700'
                    : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
