import { describe, expect, it } from 'vitest';
import {
  computeQuoteTotals,
  lineTotalMinor,
  quantityThousandths,
  type QuoteTotalsInput,
} from './quote-totals.ts';

const base: QuoteTotalsInput = {
  lines: [],
  discountType: 'none',
  discountValue: 0,
  vatRateBp: 1800,
};
const consistent = (t: ReturnType<typeof computeQuoteTotals>) =>
  expect(t.totalMinor).toBe(t.subtotalMinor - t.discountMinor + t.vatMinor);

describe('quantities and line totals', () => {
  it('parses decimal quantities exactly', () => {
    expect(quantityThousandths('1.5')).toBe(1500n);
    expect(quantityThousandths(2)).toBe(2000n);
    expect(quantityThousandths('0.125')).toBe(125n);
  });

  it.each(['0', '-1', '1.2345', 'abc', ''])('rejects quantity %j', (q) => {
    expect(() => quantityThousandths(q)).toThrow(RangeError);
  });

  it('rounds line totals half away from zero, like Postgres round(numeric)', () => {
    expect(lineTotalMinor({ quantity: '1.5', unitPriceMinor: 333 })).toBe(500); // 499.5
    expect(lineTotalMinor({ quantity: '0.333', unitPriceMinor: 100 })).toBe(33); // 33.3
    expect(lineTotalMinor({ quantity: '2.5', unitPriceMinor: 3 })).toBe(8); // 7.5
  });
});

describe('computeQuoteTotals', () => {
  it('adds VAT to prices before VAT', () => {
    const t = computeQuoteTotals({
      ...base,
      lines: [{ quantity: 2, unitPriceMinor: 25000, vatIncluded: false }],
    });
    expect(t).toMatchObject({
      lineTotalsMinor: [50000],
      subtotalMinor: 50000,
      vatMinor: 9000,
      totalMinor: 59000,
    });
  });

  it('keeps VAT-inclusive prices exact (₪100 stays ₪100.00)', () => {
    const t = computeQuoteTotals({
      ...base,
      lines: [{ quantity: 1, unitPriceMinor: 10000, vatIncluded: true }],
    });
    expect(t).toMatchObject({ subtotalMinor: 8475, vatMinor: 1525, totalMinor: 10000 });
    consistent(t);
  });

  it('mixes inclusive and exclusive lines', () => {
    const t = computeQuoteTotals({
      ...base,
      lines: [
        { quantity: 1, unitPriceMinor: 11800, vatIncluded: true },
        { quantity: '1.5', unitPriceMinor: 10000, vatIncluded: false },
      ],
    });
    expect(t).toMatchObject({ subtotalMinor: 25000, vatMinor: 4500, totalMinor: 29500 });
  });

  it('rounds VAT on awkward amounts', () => {
    const t = computeQuoteTotals({
      ...base,
      lines: [{ quantity: 1, unitPriceMinor: 999, vatIncluded: false }],
    });
    expect(t).toMatchObject({ subtotalMinor: 999, vatMinor: 180, totalMinor: 1179 }); // 179.82
  });

  it('applies a percent discount before VAT, rounding the discount', () => {
    const t = computeQuoteTotals({
      ...base,
      discountType: 'percent',
      discountValue: 1000,
      lines: [{ quantity: 1, unitPriceMinor: 12345, vatIncluded: false }],
    });
    expect(t).toMatchObject({
      subtotalMinor: 12345,
      discountMinor: 1235,
      vatMinor: 2000,
      totalMinor: 13110,
    });
    consistent(t);
  });

  it('caps an amount discount at the subtotal', () => {
    const t = computeQuoteTotals({
      ...base,
      discountType: 'amount',
      discountValue: 999999,
      lines: [{ quantity: 1, unitPriceMinor: 5000, vatIncluded: false }],
    });
    expect(t).toMatchObject({
      subtotalMinor: 5000,
      discountMinor: 5000,
      vatMinor: 0,
      totalMinor: 0,
    });
  });

  it('takes a percent off the gross exactly, also for VAT-inclusive prices', () => {
    const t = computeQuoteTotals({
      ...base,
      discountType: 'percent',
      discountValue: 5000,
      lines: [{ quantity: 1, unitPriceMinor: 10000, vatIncluded: true }],
    });
    expect(t.totalMinor).toBe(5000);
    consistent(t);
  });

  it('charges no VAT for exempt businesses (עוסק פטור)', () => {
    const t = computeQuoteTotals({
      ...base,
      vatRateBp: 0,
      discountType: 'amount',
      discountValue: 333,
      lines: [{ quantity: 3, unitPriceMinor: 3333, vatIncluded: true }],
    });
    expect(t).toMatchObject({
      subtotalMinor: 9999,
      discountMinor: 333,
      vatMinor: 0,
      totalMinor: 9666,
    });
  });

  it('handles an empty quote', () => {
    expect(computeQuoteTotals(base)).toMatchObject({
      subtotalMinor: 0,
      discountMinor: 0,
      vatMinor: 0,
      totalMinor: 0,
    });
  });

  it('is always consistent and non-negative (randomised)', () => {
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 2000; i++) {
      const lines = Array.from({ length: 1 + rand(5) }, () => ({
        quantity: `${1 + rand(20)}.${rand(1000)}`,
        unitPriceMinor: rand(500000),
        vatIncluded: rand(2) === 1,
      }));
      const discountType = (['none', 'percent', 'amount'] as const)[rand(3)]!;
      const t = computeQuoteTotals({
        lines,
        discountType,
        discountValue: rand(20000),
        vatRateBp: [0, 1700, 1800][rand(3)]!,
      });
      consistent(t);
      expect(t.discountMinor).toBeLessThanOrEqual(t.subtotalMinor);
      expect(t.vatMinor).toBeGreaterThanOrEqual(0);
    }
  });
});
