import { Link } from 'react-router-dom';
import { useScheduled } from '../api/hooks';
import { Empty, ErrorState, Loading } from '../components/States';
import { formatDateTime } from '../lib/time';

export default function Scheduled() {
  const q = useScheduled();
  const items = q.data?.items ?? [];
  const overdue = items.filter((i) => i.overdue).length;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Scheduled calls</h1>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && items.length === 0 && <Empty>Nothing scheduled.</Empty>}
      {overdue > 0 && <p className="text-sm font-medium text-red-700">{overdue} overdue</p>}
      <ul className="space-y-2">
        {items.map((c) => (
          <li
            key={c.id}
            data-overdue={c.overdue}
            className={`card ${c.overdue ? '!border-red-300 !bg-red-50' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                to={`/clients/${c.client_id}`}
                className="font-medium text-indigo-700 hover:underline"
              >
                {c.client_name} <span className="font-normal text-slate-500">{c.client_phone}</span>
              </Link>
              <span
                className={`text-sm font-semibold ${c.overdue ? 'text-red-700' : 'text-blue-700'}`}
              >
                {c.overdue && 'Overdue · '}
                {formatDateTime(c.scheduled_at)}
              </span>
            </div>
            <p className="mt-1 text-sm">{c.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
