import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useChangePassword } from '../api/hooks';
import { useToast } from '../components/Toast';

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');
  const change = useChangePassword();
  const toast = useToast();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setLocalError('New password must be at least 10 characters');
    if (next !== confirm) return setLocalError('Passwords do not match');
    setLocalError('');
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success('Password changed');
          setCurrent('');
          setNext('');
          setConfirm('');
        },
      },
    );
  }
  const error = localError || (change.error instanceof ApiError ? change.error.message : '');

  return (
    <form onSubmit={submit} className="card mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Change password</h1>
      {[
        ['Current password', current, setCurrent, 'current-password'],
        ['New password', next, setNext, 'new-password'],
        ['Confirm new password', confirm, setConfirm, 'new-password'],
      ].map(([label, value, set, ac]) => (
        <div key={label as string}>
          <label className="label">
            {label as string}
            <input
              type="password"
              className="input mt-1 font-normal"
              autoComplete={ac as string}
              value={value as string}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              required
            />
          </label>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={change.isPending}>
        {change.isPending ? 'Saving…' : 'Change password'}
      </button>
      <p className="text-xs text-slate-500">Changing your password signs out your other devices.</p>
    </form>
  );
}
