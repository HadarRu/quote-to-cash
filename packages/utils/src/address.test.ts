import { describe, expect, it } from 'vitest';
import { formatAddressLine } from './address.ts';

describe('formatAddressLine', () => {
  it('joins the parts that exist', () => {
    expect(
      formatAddressLine({ street: 'הרצל', houseNumber: '5', apartment: '3', city: 'חיפה' }, 'דירה'),
    ).toBe('הרצל 5, דירה 3, חיפה');
    expect(formatAddressLine({ street: 'הרצל', city: 'חיפה' }, 'דירה')).toBe('הרצל, חיפה');
  });
});
