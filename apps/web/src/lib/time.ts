/** All times are stored in UTC and shown in Sri Lanka time (UTC+05:30, no DST). */
const TZ = 'Asia/Colombo';

const display = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const dateOnly = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium' });

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? display.format(new Date(iso)) : '—';
export const formatDate = (iso: string | null | undefined) =>
  iso ? dateOnly.format(new Date(iso)) : '—';

/** UTC ISO -> value for <input type="datetime-local"> in Colombo time. */
export function toColomboInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Value from <input type="datetime-local"> (Colombo time) -> UTC ISO string. */
export function fromColomboInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const weekday = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "Mon, 14 Jan 2030, 10:00–11:00" in Sri Lanka time. */
export function formatRange(startIso: string, endIso: string): string {
  return `${weekday.format(new Date(startIso))}, ${clock.format(new Date(startIso))}–${clock.format(new Date(endIso))}`;
}
