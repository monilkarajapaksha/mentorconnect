import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ApiError } from './api/client';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import Calls from './pages/Calls';
import Calendar from './pages/Calendar';
import ChangePassword from './pages/ChangePassword';
import ClientDetail from './pages/ClientDetail';
import Clients from './pages/Clients';
import Home from './pages/Home';
import Login from './pages/Login';
import MentorDetail from './pages/MentorDetail';
import Mentors from './pages/Mentors';
import Scheduled from './pages/Scheduled';

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    // Any 401 mid-session re-checks /auth/me, which makes the guard redirect to /login.
    const on401 = (err: unknown) => {
      if (err instanceof ApiError && err.status === 401 && qc.getQueryData(['me'])) {
        qc.setQueryData(['me'], undefined);
        void qc.invalidateQueries({ queryKey: ['me'] });
      }
    };
    const qc: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError: on401 }),
      mutationCache: new MutationCache({ onError: on401 }),
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    return qc;
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/calls" element={<Calls />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/mentors" element={<Mentors />} />
        <Route path="/mentors/:id" element={<MentorDetail />} />
        <Route path="/scheduled" element={<Scheduled />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="*" element={<p className="p-6 text-slate-500">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
