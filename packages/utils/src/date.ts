/** Business display time zone; timestamps are stored in UTC. */
export const DISPLAY_TIME_ZONE = 'Asia/Jerusalem';

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Formats a UTC timestamp as an Israeli calendar date, e.g. "02.10.2026". */
export function formatDateIL(isoUtc: string): string {
  return dateFormatter.format(new Date(isoUtc));
}

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function jerusalemParts(date: Date) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return parts;
}

/** The Israeli calendar date of a moment, as "YYYY-MM-DD". */
export function dateInJerusalem(date: Date): string {
  const p = jerusalemParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" plus a number of days. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The last second of an Israeli calendar day ("YYYY-MM-DD") as a UTC moment (DST-aware). */
export function endOfDayInJerusalem(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const wanted = Date.UTC(y, m - 1, d, 23, 59, 59);
  // The zone's offset at that wall-clock time, found by formatting a first guess.
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = jerusalemParts(new Date(guess));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wanted - shown;
  }
  return new Date(guess);
}
