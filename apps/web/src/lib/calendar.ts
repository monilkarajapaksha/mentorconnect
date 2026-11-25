/**
 * FullCalendar only understands 'local' and 'UTC' time zones without a paid/extra plugin, but the
 * admin must always see Sri Lanka time no matter where their browser is. Sri Lanka is a fixed
 * UTC+05:30 (no DST), so we run the calendar in 'UTC' and shift every instant by +05:30 on the way
 * in (toCal) and back on the way out (fromCal). The calendar's "UTC wall clock" is Colombo time.
 */
export const COLOMBO_OFFSET_MS = 5.5 * 3_600_000;
const MIN = 60_000;

/** Real instant -> the shifted Date FullCalendar should display. */
export const toCal = (instant: string | number | Date): Date =>
  new Date(new Date(instant).getTime() + COLOMBO_OFFSET_MS);

/** Shifted Date from FullCalendar -> the real instant. */
export const fromCal = (d: Date): Date => new Date(d.getTime() - COLOMBO_OFFSET_MS);

export const calNow = (): Date => toCal(Date.now());

/** YYYY-MM-DD of an instant, in Colombo time. */
export const colomboDate = (instant: string | number | Date = Date.now()): string =>
  toCal(instant).toISOString().slice(0, 10);

export const addDaysYmd = (ymd: string, days: number): string =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Colombo wall-clock 'YYYY-MM-DD' + 'HH:MM' -> UTC ISO. */
export const colomboToIso = (ymd: string, hhmm: string): string =>
  new Date(`${ymd}T${hhmm}:00+05:30`).toISOString();

/** Next 15-minute mark at or after `ms`. */
export const ceilQuarter = (ms: number): number => Math.ceil(ms / (15 * MIN)) * 15 * MIN;

export type CalView = 'day' | 'week' | 'month' | 'agenda';
export const CAL_VIEWS: CalView[] = ['day', 'week', 'month', 'agenda'];
export const VIEW_LABELS: Record<CalView, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  agenda: 'Agenda',
};
export const VIEW_TO_FC: Record<CalView, string> = {
  day: 'timeGridDay',
  week: 'timeGridWeek',
  month: 'dayGridMonth',
  agenda: 'listWeek',
};
export const FC_TO_VIEW: Record<string, CalView> = {
  timeGridDay: 'day',
  timeGridWeek: 'week',
  dayGridMonth: 'month',
  listWeek: 'agenda',
};

export const isCalView = (v: string | null | undefined): v is CalView =>
  !!v && (CAL_VIEWS as string[]).includes(v);

/** Small screens default to the agenda; larger ones to the week. */
export const defaultView = (): CalView =>
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches
    ? 'agenda'
    : 'week';

/** Meetings in these states occupy the mentor's time (and so block overlaps in the UI too). */
export const blocksTime = (status: string) => status === 'scheduled';
