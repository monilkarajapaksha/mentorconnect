import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Client } from '@calllog/shared';
import { useClientMeetings } from '../api/hooks';
import { formatRange } from '../lib/time';
import { BookSession } from './BookSession';
import { MeetingStatusBadge } from './MeetingPanel';
import { Empty, ErrorState, Loading } from './States';

/** Upcoming and past mentor meetings for one client, plus "Book a session". */
export function ClientMeetings({ client }: { client: Client }) {
  const q = useClientMeetings(client.id);
  const [booking, setBooking] = useState(false);

  const row = (m: NonNullable<typeof q.data>['upcoming'][number]) => (
    <li key={m.id} className="card flex flex-wrap items-center justify-between gap-2 !p-3 text-sm">
      <div>
        <Link
          className="font-medium text-indigo-600 hover:underline"
          to={`/mentors/${m.mentor_id}?meeting=${m.id}&date=${m.start_at.slice(0, 10)}`}
        >
          {m.title}
        </Link>
        <div className="text-slate-600">
          {formatRange(m.start_at, m.end_at)} · with {m.mentor_name}
        </div>
      </div>
      <MeetingStatusBadge status={m.status} />
    </li>
  );

  return (
    <section aria-label="Meetings">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Meetings</h2>
        <button className="btn btn-primary" onClick={() => setBooking(true)}>
          Book a session
        </button>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.upcoming.length + q.data.past.length === 0 && (
        <Empty>No meetings yet. Use “Book a session” to schedule one with a mentor.</Empty>
      )}
      {q.data && q.data.upcoming.length > 0 && (
        <>
          <h3 className="mb-1 text-sm font-semibold text-slate-600">Upcoming</h3>
          <ul className="mb-3 space-y-2">{q.data.upcoming.map(row)}</ul>
        </>
      )}
      {q.data && q.data.past.length > 0 && (
        <>
          <h3 className="mb-1 text-sm font-semibold text-slate-600">Past</h3>
          <ul className="space-y-2">{q.data.past.map(row)}</ul>
        </>
      )}
      {booking && (
        <BookSession title="Book a session" client={client} onClose={() => setBooking(false)} />
      )}
    </section>
  );
}
