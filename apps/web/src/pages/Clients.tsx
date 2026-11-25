import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useClients } from '../api/hooks';
import { DateRange } from '../components/DateRange';
import { Pagination } from '../components/Pagination';
import { Empty, ErrorState, Loading } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { StatusFilter } from '../components/StatusFilter';
import { formatDateTime } from '../lib/time';
import { useUrlFilters } from '../lib/useUrlFilters';

export default function Clients() {
  const f = useUrlFilters();
  const navigate = useNavigate();
  const [text, setText] = useState(f.get('search'));

  // Debounce typing into the URL.
  useEffect(() => {
    if (text === f.get('search')) return;
    const t = setTimeout(() => f.set({ search: text }), 300);
    return () => clearTimeout(t);
  }, [text]);

  const q = useClients(f.sp.toString() ? `?${f.sp.toString()}` : '');
  const sort = f.get('sort') || 'last_call_desc';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Clients</h1>
      <div className="card flex flex-wrap items-start gap-3">
        <input
          className="input !w-64"
          type="search"
          aria-label="Search clients"
          placeholder="Search name, phone, company"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <StatusFilter
          selected={f.statuses}
          counts={q.data?.statusCounts}
          onChange={(next) => f.set({ status: next.join(',') })}
        />
        <DateRange from={f.get('from')} to={f.get('to')} onChange={(v) => f.set(v)} />
        <select
          className="input !w-auto"
          aria-label="Sort"
          value={sort}
          onChange={(e) =>
            f.set({ sort: e.target.value === 'last_call_desc' ? null : e.target.value })
          }
        >
          <option value="last_call_desc">Last call: newest first</option>
          <option value="last_call_asc">Last call: oldest first</option>
        </select>
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <Empty>No clients match these filters.</Empty>}
      {q.data && q.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Phone</th>
                <th className="hidden px-3 py-2 md:table-cell">Company</th>
                <th className="px-3 py-2">Status</th>
                <th className="hidden px-3 py-2 sm:table-cell">Last call</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => navigate(`/clients/${c.id}`)}
                >
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/clients/${c.id}`} className="text-indigo-700 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{c.phone_e164}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{c.company ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.current_status} />
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    {formatDateTime(c.last_call_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
