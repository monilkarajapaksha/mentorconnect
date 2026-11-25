import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useLogin, useMe } from '../api/hooks';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';

  if (me.data) return <Navigate to={from} replace />;

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate(
      { email, password },
      {
        onSuccess: ({ admin }) => {
          qc.setQueryData(['me'], admin);
          navigate(from, { replace: true });
        },
      },
    );
  }

  const err = login.error;
  const message =
    err instanceof ApiError
      ? err.code === 'ACCOUNT_LOCKED'
        ? 'Too many failed attempts. Please try again in 15 minutes.'
        : err.message
      : err
        ? 'Could not sign in. Please try again.'
        : '';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4" aria-label="Login">
        <h1 className="text-xl font-bold text-indigo-600">CallLog</h1>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {message && (
          <p role="alert" className="text-sm text-red-600">
            {message}
          </p>
        )}
        <button className="btn btn-primary w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
