import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CALL_STATUSES, FOLLOW_UP_STATUSES, STATUS_COLORS, STATUS_LABELS } from '@calllog/shared';
import { ApiError } from '../api/client';
import { useCreateClient, useLookup, useStats, type ClientFields } from '../api/hooks';
import { ClientForm } from '../components/ClientForm';
import { ErrorState, Loading } from '../components/States';
import { TodaysMeetings } from '../components/TodaysMeetings';
import { useToast } from '../components/Toast';

export default function Home() {
  const [sp, setSp] = useSearchParams();
  const phone = sp.get('phone') ?? '';
  const [input, setInput] = useState(phone);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const lookup = useLookup(phone);
  const stats = useStats();
  const create = useCreateClient();
  const toast = useToast();

  // Focus the search box on load, and whenever "/" is pressed outside a text field.
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) &&
        !t.isContentEditable
      ) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Known client -> straight to their page.
  useEffect(() => {
    if (lookup.data?.found) navigate(`/clients/${lookup.data.client.id}`, { replace: true });
  }, [lookup.data, navigate]);

  function search(e: FormEvent) {
    e.preventDefault();
    const v = input.trim();
    if (v) setSp({ phone: v });
  }

  function addClient(values: ClientFields, normalizedPhone: string) {
    create.mutate(
      { ...values, phone: normalizedPhone },
      {
        onSuccess: ({ client }) => {
          toast.success('Client added');
          navigate(`/clients/${client.id}`);
        },
        onError: (err) => {
          // Someone else added this number a moment ago: just open them.
          if (err instanceof ApiError && err.code === 'CLIENT_EXISTS') {
            const id = (err.details as { clientId?: string } | undefined)?.clientId;
            if (id) navigate(`/clients/${id}`);
          }
        },
      },
    );
  }

  const invalid = lookup.error instanceof ApiError && lookup.error.code === 'INVALID_PHONE';

  return (
    <div className="space-y-8">
      <section>
        <form onSubmit={search} className="flex gap-2" role="search">
          <input
            ref={inputRef}
            type="tel"
            aria-label="Phone number"
            placeholder="Search phone number, e.g. 077 123 4567   ( / )"
            className="input !py-4 !text-lg"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn btn-primary !px-6 !text-base" disabled={lookup.isFetching}>
            Search
          </button>
        </form>

        <div className="mt-4">
          {phone && lookup.isLoading && <Loading label="Looking up…" />}
          {invalid && (
            <p role="alert" className="text-sm text-red-600">
              That doesn&apos;t look like a valid phone number.
            </p>
          )}
          {lookup.error && !invalid && (
            <ErrorState error={lookup.error} onRetry={() => lookup.refetch()} />
          )}
          {lookup.data && !lookup.data.found && (
            <div className="card max-w-xl">
              <h2 className="text-lg font-semibold">New number</h2>
              <p className="mb-4 text-sm text-slate-600">
                No client with <b>{lookup.data.normalizedPhone}</b> yet. Add them to start logging
                calls.
              </p>
              <ClientForm
                phone={lookup.data.normalizedPhone}
                submitLabel="Add client"
                busy={create.isPending}
                serverError={create.error instanceof ApiError ? create.error.message : undefined}
                onSubmit={(v) =>
                  addClient(v, (lookup.data as { normalizedPhone: string }).normalizedPhone)
                }
              />
            </div>
          )}
        </div>
      </section>

      <TodaysMeetings />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Clients by status</h2>
        {stats.isLoading && <Loading />}
        {stats.error && <ErrorState error={stats.error} onRetry={() => stats.refetch()} />}
        {stats.data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard
              to={`/clients?status=${FOLLOW_UP_STATUSES.join(',')}`}
              label="Any follow-up"
              count={FOLLOW_UP_STATUSES.reduce((n, s) => n + (stats.data.counts[s] ?? 0), 0)}
              color="bg-amber-50 border-amber-200 text-amber-900"
            />
            {CALL_STATUSES.map((s) => (
              <StatCard
                key={s}
                to={`/clients?status=${s}`}
                label={STATUS_LABELS[s]}
                count={stats.data.counts[s] ?? 0}
                color={STATUS_COLORS[s]}
              />
            ))}
          </div>
        )}
        {stats.data && (
          <p className="mt-3 text-sm text-slate-500">
            {stats.data.total} client{stats.data.total === 1 ? '' : 's'} in total
            {stats.data.noCalls ? `, ${stats.data.noCalls} with no calls yet` : ''}.
          </p>
        )}
      </section>
    </div>
  );
}

function StatCard({
  to,
  label,
  count,
  color,
}: {
  to: string;
  label: string;
  count: number;
  color: string;
}) {
  return (
    <Link to={to} className={`block rounded-lg border p-3 transition hover:shadow-md ${color}`}>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-sm">{label}</div>
    </Link>
  );
}
