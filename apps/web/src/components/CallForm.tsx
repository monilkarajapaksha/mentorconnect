import { useState, type FormEvent } from 'react';
import { CALL_STATUSES, STATUS_LABELS, type CallStatus } from '@calllog/shared';
import type { CallPayload } from '../api/hooks';
import { fromColomboInput, toColomboInput } from '../lib/time';

export interface CallFormValues {
  direction: 'incoming' | 'outgoing';
  status: CallStatus;
  summary: string;
  scheduledAt: string | null; // UTC ISO
  notes: string | null;
}

interface Props {
  initial: CallFormValues;
  submitLabel: string;
  busy?: boolean;
  serverError?: string;
  onSubmit: (v: CallPayload) => void;
  onCancel: () => void;
}

export function CallForm({ initial, submitLabel, busy, serverError, onSubmit, onCancel }: Props) {
  const [direction, setDirection] = useState(initial.direction);
  const [status, setStatus] = useState<CallStatus>(initial.status);
  const [summary, setSummary] = useState(initial.summary);
  const [scheduled, setScheduled] = useState(toColomboInput(initial.scheduledAt));
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [errors, setErrors] = useState<{ summary?: string; scheduled?: string }>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!summary.trim()) next.summary = 'Summary is required';
    if (status === 'scheduled' && !fromColomboInput(scheduled)) {
      next.scheduled = 'Scheduled date & time is required';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({
      direction,
      status,
      summary: summary.trim(),
      scheduledAt: status === 'scheduled' ? fromColomboInput(scheduled) : null,
      notes: notes.trim(),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="call-direction">
            Direction
          </label>
          <select
            id="call-direction"
            className="input"
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="call-status">
            Status
          </label>
          <select
            id="call-status"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as CallStatus)}
          >
            {CALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {status === 'scheduled' && (
        <div>
          <label className="label" htmlFor="call-scheduled">
            Scheduled date &amp; time (Sri Lanka time)
          </label>
          <input
            id="call-scheduled"
            type="datetime-local"
            className="input"
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
            aria-invalid={!!errors.scheduled}
          />
          {errors.scheduled && <p className="mt-1 text-sm text-red-600">{errors.scheduled}</p>}
        </div>
      )}

      <div>
        <label className="label" htmlFor="call-summary">
          Summary
        </label>
        <textarea
          id="call-summary"
          className="input"
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-invalid={!!errors.summary}
        />
        {errors.summary && <p className="mt-1 text-sm text-red-600">{errors.summary}</p>}
      </div>

      <div>
        <label className="label" htmlFor="call-notes">
          Notes (optional)
        </label>
        <textarea
          id="call-notes"
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-red-600">
          {serverError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
