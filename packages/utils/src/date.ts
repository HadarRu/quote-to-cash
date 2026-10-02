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
