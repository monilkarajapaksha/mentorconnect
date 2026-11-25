import { Link } from 'react-router-dom';
import { useMeetings } from '../api/hooks';
import { addDaysYmd, colomboDate } from '../lib/calendar';
import { formatRange } from '../lib/time';
import { MeetingStatusBadge } from './MeetingPanel';
import { ErrorState, Loading } from './States';

/** Home-page card: all of today's meetings (Sri Lanka time), soonest first. */
export function TodaysMeetings() {
  const today = colomboDate();
  const q = useMeetings(`?from=${today}&to=${addDaysYmd(today, 0)}`);
  const items = (q.data?.items ?? [])
    .filter((m) => m.status !== 'cancelled')
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <section aria-label="Today's meetings">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Today’s meetings</h2>
        <Link to="/calendar" className="text-sm text-indigo-600 underline">
          Open calendar
        </Link>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && items.length === 0 && (
        <p className="card text-sm text-slate-500">No meetings today.</p>
      )}
      <ul className="space-y-2">
        {items.map((m) => (
          <li
            key={m.id}
            className="card flex flex-wrap items-center justify-between gap-2 !p-3 text-sm"
          >
            <div>
              <Link
                className="font-medium text-indigo-600 hover:underline"
                to={`/calendar?meeting=${m.id}&date=${today}`}
              >
                {formatRange(m.start_at, m.end_at).replace(/^[^,]*, [^,]*, /, '')}
              </Link>{' '}
              · {m.client_name} with{' '}
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: m.mentor_color }}
                />
                {m.mentor_name}
              </span>
            </div>
            <MeetingStatusBadge status={m.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
