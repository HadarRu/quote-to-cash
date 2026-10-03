import { describe, expect, it } from 'vitest';
import { addDays, dateInJerusalem, endOfDayInJerusalem, formatDateIL } from './date.ts';

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
