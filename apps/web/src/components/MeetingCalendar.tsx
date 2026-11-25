import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { DatesSetArg, DateSelectArg, EventDropArg, EventInput } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import type { MeetingWithRefs } from '@calllog/shared';
import {
  CAL_VIEWS,
  FC_TO_VIEW,
  VIEW_LABELS,
  VIEW_TO_FC,
  blocksTime,
  calNow,
  ceilQuarter,
  colomboToIso,
  fromCal,
  toCal,
  type CalView,
} from '../lib/calendar';

export interface BackgroundBlock {
  id: string;
  start: number;
  end: number;
  kind: 'available' | 'timeoff';
  color?: string;
}

export interface MoveRequest {
  meeting: MeetingWithRefs;
  newStart: string;
  newEnd: string;
  /** Puts the event back where it was (used when the server says no). */
  revert: () => void;
}

interface Props {
  view: CalView;
  /** Anchor date, YYYY-MM-DD in Sri Lanka time. */
  date: string;
  onNavigate: (view: CalView, date: string) => void;
  /** Visible range as real UTC instants; used to load meetings. */
  onRange: (fromIso: string, toIso: string) => void;
  meetings: MeetingWithRefs[];
  background?: BackgroundBlock[];
  defaultMinutes: number;
  onCreate: (startIso: string, endIso: string) => void;
  onOpenMeeting: (id: string) => void;
  onMove: (move: MoveRequest) => void;
  /** Turn keyboard shortcuts off while a dialog is open. */
  shortcutsEnabled: boolean;
  /** Several mentors shown at once: different mentors may overlap, and names are shown. */
  multiMentor?: boolean;
  actions?: ReactNode;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
};

export function MeetingCalendar(props: Props) {
  const { view, date, meetings, background = [], multiMentor } = props;
  const ref = useRef<FullCalendar>(null);
  const [title, setTitle] = useState('');
  const small = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches;

  // Keep the latest callbacks in a ref so FullCalendar handlers never go stale.
  const cb = useRef(props);
  cb.current = props;

  const events = useMemo<EventInput[]>(
    () => [
      ...background.map((b) => ({
        id: `bg-${b.kind}-${b.id}`,
        start: toCal(b.start),
        end: toCal(b.end),
        display: 'background' as const,
        classNames: [b.kind === 'timeoff' ? 'cal-timeoff' : 'cal-available'],
        backgroundColor: b.kind === 'available' ? `${b.color ?? '#4f46e5'}1f` : undefined,
        editable: false,
      })),
      ...meetings.map((m) => ({
        id: m.id,
        title: multiMentor
          ? `${m.client_name} · ${m.mentor_name}`
          : `${m.client_name} — ${m.title}`,
        start: toCal(m.start_at),
        end: toCal(m.end_at),
        backgroundColor: m.mentor_color,
        borderColor: m.mentor_color,
        classNames: [`cal-${m.status}`],
        editable: m.status === 'scheduled',
        extendedProps: { meeting: m, status: m.status, mentorId: m.mentor_id },
      })),
    ],
    [background, meetings, multiMentor],
  );

  // URL -> calendar (e.g. back/forward, bookmarks, mini month).
  useEffect(() => {
    const api = ref.current?.getApi();
    if (!api) return;
    if (api.view.type !== VIEW_TO_FC[view]) api.changeView(VIEW_TO_FC[view], date);
    else if (toCal(fromCal(api.getDate())).toISOString().slice(0, 10) !== date) api.gotoDate(date);
  }, [view, date]);

  // Keyboard shortcuts, like Google Calendar: t today, d/w/m/a views, c create.
  useEffect(() => {
    if (!props.shortcutsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const api = ref.current?.getApi();
      if (!api) return;
      const key = e.key.toLowerCase();
      const views: Record<string, CalView> = { d: 'day', w: 'week', m: 'month', a: 'agenda' };
      if (key === 't') api.today();
      else if (key in views) api.changeView(VIEW_TO_FC[views[key]!]);
      else if (key === 'c') {
        e.preventDefault();
        const start = ceilQuarter(Date.now());
        cb.current.onCreate(
          new Date(start).toISOString(),
          new Date(start + cb.current.defaultMinutes * 60_000).toISOString(),
        );
      } else return;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.shortcutsEnabled]);

  function datesSet(arg: DatesSetArg) {
    setTitle(arg.view.title);
    const v = FC_TO_VIEW[arg.view.type] ?? 'week';
    const anchor = arg.view.calendar.getDate().toISOString().slice(0, 10);
    cb.current.onRange(fromCal(arg.start).toISOString(), fromCal(arg.end).toISOString());
    if (v !== cb.current.view || anchor !== cb.current.date) cb.current.onNavigate(v, anchor);
  }

  function select(arg: DateSelectArg) {
    const api = arg.view.calendar;
    api.unselect();
    const mins = cb.current.defaultMinutes;
    let start: string;
    let end: string;
    if (arg.allDay) {
      // Month view: a click on a day opens a default-length meeting at 09:00.
      start = colomboToIso(arg.startStr.slice(0, 10), '09:00');
      end = new Date(Date.parse(start) + mins * 60_000).toISOString();
    } else {
      start = fromCal(arg.start).toISOString();
      end = fromCal(arg.end).toISOString();
      // A plain click selects a single 30-minute slot: use the mentor's default length instead.
      if (Date.parse(end) - Date.parse(start) <= 30 * 60_000) {
        end = new Date(Date.parse(start) + mins * 60_000).toISOString();
      }
    }
    cb.current.onCreate(start, end);
  }

  function moved(arg: EventDropArg | EventResizeDoneArg) {
    const meeting = arg.event.extendedProps.meeting as MeetingWithRefs | undefined;
    if (!meeting || !arg.event.start) return arg.revert();
    const newStart = fromCal(arg.event.start).toISOString();
    const newEnd = arg.event.end
      ? fromCal(arg.event.end).toISOString()
      : new Date(
          Date.parse(newStart) + (Date.parse(meeting.end_at) - Date.parse(meeting.start_at)),
        ).toISOString();
    cb.current.onMove({ meeting, newStart, newEnd, revert: arg.revert });
  }

  const api = () => ref.current?.getApi();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn" onClick={() => api()?.today()}>
          Today
        </button>
        <button className="btn !px-2.5" aria-label="Previous" onClick={() => api()?.prev()}>
          ‹
        </button>
        <button className="btn !px-2.5" aria-label="Next" onClick={() => api()?.next()}>
          ›
        </button>
        <h2 className="mx-1 text-lg font-semibold" aria-live="polite">
          {title}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {props.actions}
          <div
            className="inline-flex overflow-hidden rounded-md border border-slate-300"
            role="group"
            aria-label="Calendar view"
          >
            {CAL_VIEWS.map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => api()?.changeView(VIEW_TO_FC[v])}
                className={`px-3 py-1.5 text-sm ${view === v ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={VIEW_TO_FC[view]}
          initialDate={date}
          headerToolbar={false}
          timeZone="UTC"
          now={calNow}
          firstDay={1}
          height={small ? 560 : 720}
          nowIndicator
          allDaySlot={false}
          slotDuration="00:30:00"
          snapDuration="00:15:00"
          scrollTime="08:00:00"
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          dayMaxEvents
          selectable
          selectMirror
          editable
          events={events}
          datesSet={datesSet}
          select={select}
          eventDrop={moved}
          eventResize={moved}
          eventClick={(arg) => {
            arg.jsEvent.preventDefault();
            if (arg.event.extendedProps.meeting) cb.current.onOpenMeeting(arg.event.id);
          }}
          // Mirror the server rule in the UI: you cannot drop onto another scheduled meeting.
          eventOverlap={(still, moving) =>
            still.display === 'background' ||
            !blocksTime(still.extendedProps.status ?? '') ||
            still.extendedProps.mentorId !== moving?.extendedProps.mentorId
          }
          selectOverlap={(still) =>
            !!multiMentor ||
            still.display === 'background' ||
            !blocksTime(still.extendedProps.status ?? '')
          }
          eventContent={(arg) => {
            const m = arg.event.extendedProps.meeting as MeetingWithRefs | undefined;
            if (!m || arg.view.type === 'listWeek' || arg.view.type === 'dayGridMonth')
              return undefined;
            return (
              <div className="overflow-hidden px-1 text-xs leading-tight">
                <div className="font-semibold">{arg.timeText}</div>
                <div className="truncate">{m.client_name}</div>
                <div className="truncate opacity-80">{multiMentor ? m.mentor_name : m.title}</div>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
