import { describe, expect, it } from 'vitest';
import { formatDateIL } from './date.ts';

describe('formatDateIL', () => {
  it('shows the calendar date in Israel, not in UTC', () => {
    // 22:30 UTC on 2 Oct is already 3 Oct in Israel (UTC+3).
    expect(formatDateIL('2026-10-02T22:30:00Z')).toBe('03.10.2026');
    expect(formatDateIL('2026-10-02T10:00:00Z')).toBe('02.10.2026');
  });
});
