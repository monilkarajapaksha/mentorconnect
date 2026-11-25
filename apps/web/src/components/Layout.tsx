import { useEffect } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../api/client';
import { useMe } from '../api/hooks';
import { ErrorState, Loading } from './States';

const NAV = [
  { to: '/', label: 'Lookup', end: true },
  { to: '/clients', label: 'Clients' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/mentors', label: 'Mentors' },
  { to: '/calls', label: 'Calls' },
  { to: '/scheduled', label: 'Scheduled' },
];

/** Protected shell: redirects to /login when there is no session. */
export function Layout() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // "/" jumps to the lookup box from anywhere (the box itself handles focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key !== '/' ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) ||
        t.isContentEditable
      )
        return;
      if (location.pathname !== '/') {
        e.preventDefault();
        navigate('/');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [location.pathname, navigate]);

  if (me.isLoading) return <Loading />;
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (me.error || !me.data) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="text-lg font-bold text-indigo-600">
            CallLog
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/change-password" className="text-slate-600 hover:underline">
              {me.data.name}
            </Link>
            <button className="btn" onClick={logout}>
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
