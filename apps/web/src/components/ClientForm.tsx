import { useState, type FormEvent } from 'react';
import type { Client } from '@calllog/shared';
import type { ClientFields } from '../api/hooks';

interface Props {
  phone: string;
  initial?: Partial<Client>;
  submitLabel: string;
  busy?: boolean;
  serverError?: string;
  onSubmit: (v: ClientFields) => void;
  onCancel?: () => void;
}

export function ClientForm({
  phone,
  initial,
  submitLabel,
  busy,
  serverError,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [company, setCompany] = useState(initial?.company ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [nameError, setNameError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setNameError('Name is required');
    setNameError('');
    onSubmit({
      name: name.trim(),
      company: company.trim(),
      email: email.trim(),
      notes: notes.trim(),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div>
        <label className="label" htmlFor="client-phone">
          Phone
        </label>
        <input id="client-phone" className="input bg-slate-100" value={phone} readOnly />
      </div>
      <div>
        <label className="label" htmlFor="client-name">
          Name
        </label>
        <input
          id="client-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        {nameError && <p className="mt-1 text-sm text-red-600">{nameError}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="client-company">
            Preferred job
          </label>
          <input
            id="client-company"
            className="input"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="client-email">
            Email
          </label>
          <input
            id="client-email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="client-notes">
          Notes
        </label>
        <textarea
          id="client-notes"
          className="input"
          rows={3}
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
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
