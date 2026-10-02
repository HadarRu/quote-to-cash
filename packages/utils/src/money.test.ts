import { describe, expect, it } from 'vitest';
import { formatMoney, fromMinor, toMinor } from './money';

describe('money', () => {
  it('converts shekels to integer agorot', () => {
    expect(toMinor(12.5)).toBe(1250);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor(1.005)).toBe(101);
    expect(toMinor(-3.99)).toBe(-399);
    expect(toMinor(0)).toBe(0);
  });

  it('rejects non-finite amounts', () => {
    expect(() => toMinor(Number.NaN)).toThrow(RangeError);
    expect(() => toMinor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('converts agorot to shekels and rejects fractional agorot', () => {
    expect(fromMinor(123450)).toBe(1234.5);
    expect(() => fromMinor(1.5)).toThrow();
  });

  it('formats agorot as ILS', () => {
    const formatted = formatMoney(123450);
    expect(formatted).toContain('1,234.50');
    expect(formatted).toContain('₪');
  });
});
