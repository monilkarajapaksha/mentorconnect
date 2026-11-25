import { useEffect, useState } from 'react';
import { normalizePhone, type Client } from '@calllog/shared';
import { ApiError } from '../api/client';
import { useClientSearch, useCreateClient } from '../api/hooks';
import { ClientForm } from './ClientForm';
import { StatusBadge } from './StatusBadge';

interface Props {
  value: Client | null;
  onChange: (client: Client | null) => void;
  error?: string;
}

/** Search clients by name/phone/company, or add a new one inline. */
export function ClientPicker({ value, onChange, error }: Props) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);
  const search = useClientSearch(debounced);
  const create = useCreateClient();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  if (value) {
    return (
      <div>
        <span className="label">Client</span>
        <div className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          <span>
            <b>{value.name}</b> <span className="text-slate-500">{value.phone_e164}</span>
          </span>
          <button
            type="button"
            className="text-indigo-600 underline"
            onClick={() => onChange(null)}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const phone = normalizePhone(text);
  const results = search.data?.items ?? [];
  const showAdd =
    !!phone &&
    debounced === text.trim() &&
    !search.isFetching &&
    !results.some((c) => c.phone_e164 === phone);

  if (adding && phone) {
    return (
      <div className="rounded-md border border-slate-200 p-3">
        <p className="mb-2 text-sm font-medium">New client</p>
        <ClientForm
          phone={phone}
          submitLabel="Add client"
          busy={create.isPending}
          serverError={create.error instanceof ApiError ? create.error.message : undefined}
          onCancel={() => setAdding(false)}
          onSubmit={(v) =>
            create.mutate({ ...v, phone }, { onSuccess: ({ client }) => onChange(client) })
          }
        />
      </div>
    );
  }

  return (
    <div>
      <label className="label" htmlFor="client-search">
        Client
      </label>
      <input
        id="client-search"
        className="input"
        placeholder="Search by name or phone number"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
        aria-invalid={!!error}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {search.isFetching && <p className="mt-1 text-xs text-slate-500">Searching…</p>}
      {results.length > 0 && (
        <ul
          role="listbox"
          aria-label="Matching clients"
          className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white"
        >
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => onChange(c)}
              >
                <span>
                  <b>{c.name}</b> <span className="text-slate-500">{c.phone_e164}</span>
                </span>
                <StatusBadge status={c.current_status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {showAdd && (
        <button
          type="button"
          className="mt-2 text-sm text-indigo-600 underline"
          onClick={() => setAdding(true)}
        >
          No client with {phone} — add a new client
        </button>
      )}
      {debounced.length >= 2 && !search.isFetching && results.length === 0 && !phone && (
        <p className="mt-1 text-xs text-slate-500">
          No match. To add a new client, type their full phone number.
        </p>
      )}
    </div>
  );
}
