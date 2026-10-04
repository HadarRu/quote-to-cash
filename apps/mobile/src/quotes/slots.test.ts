import { describe, expect, it } from 'vitest';
import { slotDayOptions, SLOT_DAYS, toSlot } from './slots.ts';

describe('slot picker', () => {
  it('offers today, tomorrow and the following days on the Israeli calendar', () => {
    // 22:30 UTC on 4 Oct is already 5 Oct in Israel.
    const days = slotDayOptions(new Date('2026-10-04T22:30:00Z'));
    expect(days).toHaveLength(SLOT_DAYS);
    expect(days.slice(0, 3).map((d) => d.value)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);
    expect(days[0]!.label).toBe('היום');
    expect(days[1]!.label).toBe('מחר');
    expect(days[2]!.label).toContain('07.10.2026');
  });

  it('turns an Israel wall-clock pick into UTC, in summer and winter', () => {
    expect(toSlot({ day: '2026-10-06', hour: 8, hours: 2 })).toEqual({
      startsAt: '2026-10-06T05:00:00.000Z',
      endsAt: '2026-10-06T07:00:00.000Z',
    });
    expect(toSlot({ day: '2026-12-06', hour: 8, hours: 1 }).startsAt).toBe(
      '2026-12-06T06:00:00.000Z',
    );
  });
});
