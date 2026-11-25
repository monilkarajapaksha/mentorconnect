import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateMentor, useMentors } from '../api/hooks';
import { MentorForm } from '../components/MentorForm';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../lib/time';
import { useUrlFilters } from '../lib/useUrlFilters';

export default function Mentors() {
  const f = useUrlFilters();
  const navigate = useNavigate();
  const toast = useToast();
  const [text, setText] = useState(f.get('search'));
  const [adding, setAdding] = useState(false);
  const create = useCreateMentor();
  const showInactive = f.get('active') === 'all';

  useEffect(() => {
    if (text === f.get('search')) return;
    const t = setTimeout(() => f.set({ search: text }), 300);
    return () => clearTimeout(t);
  }, [text]);

  const query = new URLSearchParams();
  if (f.get('search')) query.set('search', f.get('search'));
  if (showInactive) query.set('active', 'all');
  const q = useMentors(query.toString() ? `?${query}` : '');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Mentors</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          Add mentor
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-3">
        <input
          className="input !w-72"
          type="search"
          aria-label="Search mentors"
          placeholder="Search name, email or expertise"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => f.set({ active: e.target.checked ? 'all' : null })}
          />
          Show inactive
        </label>
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && (
        <Empty>
          {f.get('search')
            ? 'No mentors match your search.'
            : 'No mentors yet. Use “Add mentor” to create the first one.'}
        </Empty>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {q.data?.items.map((m) => (
          <li key={m.id}>
            <Link
              to={`/mentors/${m.id}`}
              className={`card block transition hover:shadow-md ${m.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ background: m.color }}
                />
                <span className="font-semibold">{m.name}</span>
                {!m.is_active && (
                  <span className="rounded bg-slate-200 px-1.5 text-xs">Inactive</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {m.expertise.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
                  >
                    {t}
                  </span>
                ))}
                {m.expertise.length === 0 && (
                  <span className="text-xs text-slate-400">No expertise tags</span>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs uppercase text-slate-500">Today</dt>
                  <dd>
                    {m.today_meetings} meeting{m.today_meetings === 1 ? '' : 's'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Next free slot</dt>
                  <dd>
                    {m.is_active
                      ? m.next_free_slot
                        ? formatDateTime(m.next_free_slot.start)
                        : 'None in 14 days'
                      : '—'}
                  </dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>

      {adding && (
        <MentorForm
          busy={create.isPending}
          error={create.error}
          onClose={() => setAdding(false)}
          onSubmit={(v) =>
            create.mutate(v, {
              onSuccess: ({ mentor }) => {
                toast.success('Mentor added');
                navigate(`/mentors/${mentor.id}?tab=availability`);
              },
            })
          }
        />
      )}
    </div>
  );
}
