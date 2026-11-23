/**
 * Local dates and times, in the city's own zone.
 *
 * Everything is stored as a UTC instant beside the local date and time it came
 * from (docs/agenda/data-model.md, "Conventions"). The sources speak local time
 * without an offset — "2026-12-05T00:00:00" and "Sábado 18:00" — so every
 * conversion goes through this zone, including across the two changes of
 * clock a year.
 */
export const ZONE = 'Europe/Madrid';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const read = (instant: Date) => {
  const out: Record<string, string> = {};
  for (const part of parts.formatToParts(instant)) out[part.type] = part.value;
  return out;
};

/** `YYYY-MM-DD` in the city for this instant. */
export const localDate = (instant: Date): string => {
  const p = read(instant);
  return `${p.year}-${p.month}-${p.day}`;
};

/** `HH:mm` in the city for this instant. */
export const localTime = (instant: Date): string => {
  const p = read(instant);
  return `${p.hour}:${p.minute}`;
};

/** The city's offset from UTC at this instant, in minutes. */
const offsetAt = (instant: Date): number => {
  const p = read(instant);
  const asUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
};

/**
 * The instant a local date and time names.
 *
 * Twice round, because the offset depends on the instant being looked for: an
 * evening in late March is +01:00 before the clocks change and +02:00 after.
 * Times past midnight in the OpenStreetMap style ('25:30') are the next day's.
 */
export const fromLocal = (date: string, time = '00:00'): Date => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let guess = naive - offsetAt(new Date(naive)) * 60000;
  guess = naive - offsetAt(new Date(guess)) * 60000;
  return new Date(guess);
};

/** A local date `days` later (or earlier). */
export const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
};

/** ISO weekday of a local date: 1 Monday … 7 Sunday. */
export const weekday = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
};

/** Whole days from one local date to another. */
export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) -
      Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) /
      86400000,
  );

/** Every local date from `from` to `to`, both included. */
export const eachDate = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) out.push(date);
  return out;
};

/** An instant written with the city's offset: `2026-10-12T08:00:00+02:00`. */
export const toLocalIso = (instant: Date): string => {
  const offset = offsetAt(instant);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${localDate(instant)}T${localTime(instant)}:${String(
    read(instant).second,
  ).padStart(2, '0')}${sign}${hh}:${mm}`;
};
