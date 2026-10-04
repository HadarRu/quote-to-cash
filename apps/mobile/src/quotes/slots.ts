import type { QuoteSlot } from '@q2c/types';
import { strings } from '@q2c/ui';
import { addDays, dateInJerusalem, formatDateIL, jerusalemTime } from '@q2c/utils';

/** Days offered for a visit: today and the next two weeks (Israel calendar). */
export const SLOT_DAYS = 14;
/** Start hours offered (Israel time). */
export const SLOT_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;
/** Visit lengths offered, in hours. */
export const SLOT_DURATIONS = [1, 2, 3, 4] as const;

/** A proposed time as picked on the device. */
export interface SlotChoice {
  day: string;
  hour: number;
  hours: number;
}

const weekdayShort = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'short' });

/** The day chips: "היום", "מחר", then e.g. "יום ה׳ 08.10.2026". */
export function slotDayOptions(now: Date): { value: string; label: string }[] {
  const today = dateInJerusalem(now);
  return Array.from({ length: SLOT_DAYS }, (_, i) => {
    const day = addDays(today, i);
    const label =
      i === 0
        ? strings.quotes.slotToday
        : i === 1
          ? strings.quotes.slotTomorrow
          : `${weekdayShort.format(new Date(`${day}T12:00:00Z`))} ${formatDateIL(`${day}T12:00:00Z`)}`;
    return { value: day, label };
  });
}

/** UTC instants of a picked time (DST-aware). */
export function toSlot(choice: SlotChoice): QuoteSlot {
  const start = jerusalemTime(choice.day, choice.hour);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + choice.hours * 60 * 60 * 1000).toISOString(),
  };
}
