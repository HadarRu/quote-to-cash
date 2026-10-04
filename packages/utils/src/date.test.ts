import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateInJerusalem,
  endOfDayInJerusalem,
  formatDateIL,
  formatDateTimeIL,
  formatSlotIL,
  formatTimeIL,
  formatWeekdayIL,
  jerusalemTime,
} from './date.ts';

describe('formatDateIL', () => {
  it('shows the calendar date in Israel, not in UTC', () => {
    // 22:30 UTC on 2 Oct is already 3 Oct in Israel (UTC+3).
    expect(formatDateIL('2026-10-02T22:30:00Z')).toBe('03.10.2026');
    expect(formatDateIL('2026-10-02T10:00:00Z')).toBe('02.10.2026');
  });
});

describe('Jerusalem calendar days', () => {
  it('finds the Israeli date of a moment', () => {
    expect(dateInJerusalem(new Date('2026-10-02T22:30:00Z'))).toBe('2026-10-03');
    expect(dateInJerusalem(new Date('2026-12-31T21:59:59Z'))).toBe('2026-12-31');
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-10-03', 14)).toBe('2026-10-17');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });

  it('ends the day at 23:59:59 Israel time, in summer and in winter', () => {
    // Summer (IDT, UTC+3) and winter (IST, UTC+2).
    expect(endOfDayInJerusalem('2026-07-01').toISOString()).toBe('2026-07-01T20:59:59.000Z');
    expect(endOfDayInJerusalem('2026-12-01').toISOString()).toBe('2026-12-01T21:59:59.000Z');
  });
});

describe('formatDateTimeIL', () => {
  it('shows Israel time', () => {
    expect(formatDateTimeIL('2026-10-02T22:30:00Z')).toBe('03.10.2026, 01:30');
  });
});

describe('jerusalemTime', () => {
  it('turns Israel wall-clock time into UTC, in summer and in winter', () => {
    expect(jerusalemTime('2026-07-01', 8).toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(jerusalemTime('2026-12-01', 8, 30).toISOString()).toBe('2026-12-01T06:30:00.000Z');
  });
});

describe('formatTimeIL and formatWeekdayIL', () => {
  it('show Israel time of day and weekday', () => {
    expect(formatTimeIL('2026-12-01T06:30:00Z')).toBe('08:30');
    // 23:30 UTC on Monday 30 Nov is already Tuesday in Israel.
    expect(formatWeekdayIL('2026-11-30T23:30:00Z')).toBe('יום שלישי');
  });
});

describe('formatSlotIL', () => {
  it('shows weekday, date and the time range in Israel', () => {
    expect(formatSlotIL('2026-10-06T05:00:00Z', '2026-10-06T07:00:00Z')).toBe(
      'יום שלישי 06.10.2026, 08:00–10:00',
    );
  });
});
