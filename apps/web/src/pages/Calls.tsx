import { Link } from 'react-router-dom';
import { useCalls } from '../api/hooks';
import { DateRange } from '../components/DateRange';
import { Pagination } from '../components/Pagination';
import { Empty, ErrorState, Loading } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { StatusFilter } from '../components/StatusFilter';
import { formatDateTime } from '../lib/time';
import { useUrlFilters } from '../lib/useUrlFilters';

export default function Calls() {
  const f = useUrlFilters();
  const q = useCalls(f.sp.toString() ? `?${f.sp.toString()}` : '');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">All calls</h1>
      <div className="card flex flex-wrap items-start gap-3">
        <StatusFilter
          selected={f.statuses}
          onChange={(next) => f.set({ status: next.join(',') })}
        />
        <DateRange from={f.get('from')} to={f.get('to')} onChange={(v) => f.set(v)} />
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <Empty>No calls match these filters.</Empty>}
      <ul className="space-y-2">
        {q.data?.items.map((c) => (
          <li key={c.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                to={`/clients/${c.client_id}`}
                className="font-medium text-indigo-700 hover:underline"
              >
                {c.client_name} <span className="font-normal text-slate-500">{c.client_phone}</span>
              </Link>
              <StatusBadge status={c.status} />
            </div>
            <p className="mt-1 text-sm">{c.summary}</p>
            <p className="mt-1 text-xs text-slate-400">
              {formatDateTime(c.created_at)} · {c.direction}
              {c.edited ? ' · edited' : ''}
            </p>
          </li>
        ))}
      </ul>
      {q.data && (
        <Pagination
          page={f.page}
          total={q.data.total}
          pageSize={q.data.pageSize}
          onPage={(p) => f.set({ page: String(p) })}
        />
      )}
    </div>
  );
}
