import type { ReactNode } from 'react';
import { ApiError } from '../api/client';

export const Loading = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="flex items-center gap-2 p-6 text-sm text-slate-500" role="status">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
    {label}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
    {children}
  </div>
);

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      {message}
      {onRetry && (
        <button className="ml-3 underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
