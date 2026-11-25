import { useEffect, useMemo, useState } from 'react';
import { WEEKDAY_LABELS, setAvailabilitySchema, type AvailabilityBlock } from '@calllog/shared';
import { ApiError } from '../api/client';
import { useSetAvailability } from '../api/hooks';
import { useToast } from './Toast';

type Row = { start: string; end: string };
type Week = Record<number, Row[]>;
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const WEEKDAYS = [1, 2, 3, 4, 5];

const toWeek = (blocks: AvailabilityBlock[]): Week => {
  const w: Week = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const b of blocks) w[b.weekday]?.push({ start: b.start_time, end: b.end_time });
  return w;
};

/** Weekly recurring hours: several blocks per day are allowed (e.g. 09:00-12:00 and 14:00-17:00). */
export function AvailabilityEditor({
  mentorId,
  timezone,
  blocks,
}: {
  mentorId: string;
  timezone: string;
  blocks: AvailabilityBlock[];
}) {
  const initial = useMemo(() => toWeek(blocks), [blocks]);
  const [week, setWeek] = useState<Week>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const save = useSetAvailability(mentorId);
  const toast = useToast();

  useEffect(() => setWeek(initial), [initial]);
  const dirty = JSON.stringify(week) !== JSON.stringify(initial);

  const setDay = (d: number, rows: Row[]) => setWeek((w) => ({ ...w, [d]: rows }));
  const edit = (d: number, i: number, patch: Partial<Row>) =>
    setDay(
      d,
      (week[d] ?? []).map((r, k) => (k === i ? { ...r, ...patch } : r)),
    );

  function onSave() {
    const payload = ORDER.flatMap((weekday) =>
      (week[weekday] ?? []).map((r) => ({ weekday, startTime: r.start, endTime: r.end })),
    );
    const parsed = setAvailabilitySchema.safeParse({ blocks: payload });
    if (!parsed.success) {
      setProblems(
        parsed.error.issues.map((i) => {
          const idx = i.path[1];
          const b = typeof idx === 'number' ? payload[idx] : undefined;
          return `${b ? `${WEEKDAY_LABELS[b.weekday]} ${b.startTime}–${b.endTime}: ` : ''}${i.message}`;
        }),
      );
      return;
    }
    setProblems([]);
    save.mutate(payload, {
      onSuccess: () => toast.success('Weekly hours saved'),
      onError: (e) => setProblems([e instanceof ApiError ? e.message : 'Could not save']),
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Hours are in the mentor’s timezone (<b>{timezone}</b>). A day can have several blocks.
        Meetings outside these hours need an explicit override.
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {ORDER.map((d) => {
          const rows = week[d] ?? [];
          return (
            <li key={d} className="flex flex-wrap items-start gap-3 p-3">
              <div className="w-28 pt-2 text-sm font-medium">{WEEKDAY_LABELS[d]}</div>
              <div className="flex-1 space-y-2">
                {rows.length === 0 && <p className="pt-2 text-sm text-slate-400">Unavailable</p>}
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="time"
                      aria-label={`${WEEKDAY_LABELS[d]} block ${i + 1} start`}
                      className="input !w-auto"
                      value={r.start}
                      onChange={(e) => edit(d, i, { start: e.target.value })}
                    />
                    <span>–</span>
                    <input
                      type="time"
                      aria-label={`${WEEKDAY_LABELS[d]} block ${i + 1} end`}
                      className="input !w-auto"
                      value={r.end}
                      onChange={(e) => edit(d, i, { end: e.target.value })}
                    />
                    <button
                      className="px-2 text-slate-400 hover:text-red-600"
                      aria-label={`Remove ${WEEKDAY_LABELS[d]} block ${i + 1}`}
                      onClick={() =>
                        setDay(
                          d,
                          rows.filter((_, k) => k !== i),
                        )
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 text-sm">
                <button
                  className="btn"
                  onClick={() =>
                    setDay(d, [
                      ...rows,
                      rows.length
                        ? { start: rows[rows.length - 1]!.end, end: '17:00' }
                        : { start: '09:00', end: '17:00' },
                    ])
                  }
                >
                  Add hours
                </button>
                {rows.length > 0 && (
                  <button
                    className="btn"
                    title="Copy these hours to Monday–Friday"
                    onClick={() =>
                      setWeek((w) => ({
                        ...w,
                        ...Object.fromEntries(
                          WEEKDAYS.map((x) => [x, rows.map((r) => ({ ...r }))]),
                        ),
                      }))
                    }
                  >
                    Copy to weekdays
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {problems.length > 0 && (
        <ul role="alert" className="list-disc rounded-md bg-red-50 p-3 pl-6 text-sm text-red-800">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={onSave} disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save weekly hours'}
        </button>
        {dirty && (
          <button
            className="btn"
            onClick={() => {
              setWeek(initial);
              setProblems([]);
            }}
          >
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}
