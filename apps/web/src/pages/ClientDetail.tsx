import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { STATUS_LABELS, type Call } from '@calllog/shared';
import { ApiError } from '../api/client';
import {
  useCallHistory,
  useClient,
  useCreateCall,
  useDeleteCall,
  useDeleteClient,
  useUpdateCall,
  useUpdateClient,
} from '../api/hooks';
import { CallForm } from '../components/CallForm';
import { ClientForm } from '../components/ClientForm';
import { ClientMeetings } from '../components/ClientMeetings';
import { ConfirmDialog, Modal } from '../components/Modal';
import { Empty, ErrorState, Loading } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../lib/time';

type Dialog =
  | { kind: 'deleteClient' }
  | { kind: 'new' } | { kind: 'edit'; call: Call } | { kind: 'delete'; call: Call } | null;

export default function ClientDetail() {
  const { id = '' } = useParams();
  const q = useClient(id);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const toast = useToast();
  const updateClient = useUpdateClient(id);
  const createCall = useCreateCall(id);
  const updateCall = useUpdateCall();
  const deleteCall = useDeleteCall();
  const deleteClient = useDeleteClient(id);
  const navigate = useNavigate();

  if (q.isLoading) return <Loading />;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <Empty>
        Client not found.{' '}
        <Link className="text-indigo-600 underline" to="/">
          Back to lookup
        </Link>
      </Empty>
    );
  }
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const { client, calls, suggestedStatus } = q.data;
  const serverError = (e: unknown) => (e instanceof ApiError ? e.message : undefined);

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{client.name}</h1>
            <p className="text-slate-600">{client.phone_e164}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={client.current_status} />
            {!editing && (
              <button className="btn" onClick={() => setEditing(true)}>
                Edit client
              </button>
            )}
            {!editing && (
              <button className="btn btn-danger" onClick={() => setDialog({ kind: 'deleteClient' })}>
                Delete client
              </button>
            )}
          </div>
        </div>
        {editing ? (
          <div className="mt-4">
            <ClientForm
              phone={client.phone_e164}
              initial={client}
              submitLabel="Save client"
              busy={updateClient.isPending}
              serverError={serverError(updateClient.error)}
              onCancel={() => setEditing(false)}
              onSubmit={(v) =>
                updateClient.mutate(v, {
                  onSuccess: () => {
                    toast.success('Client saved');
                    setEditing(false);
                  },
                })
              }
            />
          </div>
        ) : (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <Field label="Preferred job" value={client.company} />
            <Field label="Email" value={client.email} />
            <Field label="Notes" value={client.notes} />
          </dl>
        )}
      </section>

      <ClientMeetings client={client} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Calls ({calls.length})</h2>
          <button className="btn btn-primary" onClick={() => setDialog({ kind: 'new' })}>
            Log new call
          </button>
        </div>
        {calls.length === 0 ? (
          <Empty>No calls logged yet. Use “Log new call” to record the first one.</Empty>
        ) : (
          <ol className="space-y-3">
            {calls.map((call, i) => (
              <CallItem
                key={call.id}
                call={call}
                number={calls.length - i}
                onEdit={() => setDialog({ kind: 'edit', call })}
                onDelete={() => setDialog({ kind: 'delete', call })}
              />
            ))}
          </ol>
        )}
      </section>

      {dialog?.kind === 'new' && (
        <Modal title="Log new call" onClose={() => setDialog(null)}>
          <CallForm
            initial={{
              direction: 'incoming',
              status: suggestedStatus,
              summary: '',
              scheduledAt: null,
              notes: null,
            }}
            submitLabel="Log call"
            busy={createCall.isPending}
            serverError={serverError(createCall.error)}
            onCancel={() => setDialog(null)}
            onSubmit={(v) =>
              createCall.mutate(v, {
                onSuccess: () => {
                  toast.success('Call logged');
                  setDialog(null);
                },
              })
            }
          />
        </Modal>
      )}
      {dialog?.kind === 'edit' && (
        <Modal title="Edit call" onClose={() => setDialog(null)}>
          <CallForm
            initial={{
              direction: dialog.call.direction,
              status: dialog.call.status,
              summary: dialog.call.summary,
              scheduledAt: dialog.call.scheduled_at,
              notes: dialog.call.notes,
            }}
            submitLabel="Save changes"
            busy={updateCall.isPending}
            serverError={serverError(updateCall.error)}
            onCancel={() => setDialog(null)}
            onSubmit={(v) =>
              updateCall.mutate(
                { ...v, id: dialog.call.id },
                {
                  onSuccess: () => {
                    toast.success('Call updated');
                    setDialog(null);
                  },
                },
              )
            }
          />
        </Modal>
      )}
      {dialog?.kind === 'deleteClient' && (
        <ConfirmDialog
          title="Delete this client?"
          confirmLabel="Delete client"
          message={`This permanently deletes ${client.name} together with ${calls.length} call${calls.length === 1 ? '' : 's'}, their edit history and any meetings booked for them. This cannot be undone.`}
          busy={deleteClient.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            deleteClient.mutate(undefined, {
              onSuccess: () => {
                toast.success('Client deleted');
                navigate('/clients', { replace: true });
              },
              onError: () => toast.error('Could not delete the client'),
            })
          }
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete call?"
          message="This permanently removes the call and its edit history. The client's status will be recalculated."
          busy={deleteCall.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            deleteCall.mutate(dialog.call.id, {
              onSuccess: () => {
                toast.success('Call deleted');
                setDialog(null);
              },
              onError: () => toast.error('Could not delete the call'),
            })
          }
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="whitespace-pre-wrap">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function CallItem({
  call,
  number,
  onEdit,
  onDelete,
}: {
  call: Call;
  number: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const history = useCallHistory(call.id, showHistory);
  return (
    <li className="card" data-testid="call-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-500">Call #{number}</span>
          <StatusBadge status={call.status} />
          <span className="text-xs text-slate-500">
            {call.direction === 'incoming' ? '↙ Incoming' : '↗ Outgoing'}
          </span>
          {call.edited && (
            <button
              className="text-xs italic text-slate-500 underline"
              onClick={() => setShowHistory((s) => !s)}
            >
              edited
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={onEdit} aria-label={`Edit / Update call ${number}`}>
            Edit / Update
          </button>
          <button className="btn" onClick={onDelete} aria-label={`Delete call ${number}`}>
            Delete
          </button>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap">{call.summary}</p>
      {call.status === 'scheduled' && call.scheduled_at && (
        <p className="mt-1 text-sm text-blue-700">
          Scheduled for {formatDateTime(call.scheduled_at)} (Sri Lanka time)
        </p>
      )}
      {call.notes && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">Notes: {call.notes}</p>
      )}
      <p className="mt-2 text-xs text-slate-400">Logged {formatDateTime(call.created_at)}</p>
      {showHistory && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs">
          {history.isLoading && 'Loading history…'}
          {history.data?.items.map((h) => (
            <div key={h.id} className="mb-2 last:mb-0">
              <div className="font-medium">
                {formatDateTime(h.changed_at)} · {h.admin_name ?? 'Unknown'}
              </div>
              <ul className="ml-4 list-disc">
                {Object.entries(h.changes).map(([field, c]) => (
                  <li key={field}>
                    {field}: {fmt(field, c.old)} → {fmt(field, c.new)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function fmt(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (field === 'status') return STATUS_LABELS[v as keyof typeof STATUS_LABELS] ?? String(v);
  if (field === 'scheduled_at') return formatDateTime(String(v));
  return String(v);
}
