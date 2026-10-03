import { describe, expect, it } from 'vitest';
import { filterServices, priceInputValue, sortServices, type PriceListService } from './model.ts';

const svc = (over: Partial<PriceListService>): PriceListService => ({
  id: over.name ?? 'x',
  name: 'x',
  categoryId: 'c1',
  categoryName: 'נקודות ושקעים',
  unit: 'unit',
  priceMinor: 1000,
  vatIncluded: false,
  isFavorite: false,
  lastUsedAt: null,
  ...over,
});

const list = [
  svc({ name: 'תאורה שקועה', categoryId: 'c2', categoryName: 'תאורה' }),
  svc({ name: 'שקע כוח 16A', lastUsedAt: '2026-10-01T10:00:00Z' }),
  svc({ name: 'הנחת כבל', isFavorite: true, categoryId: 'c3', categoryName: 'כבלים' }),
  svc({ name: 'החלפת שקע', lastUsedAt: '2026-10-02T10:00:00Z' }),
  svc({ name: 'ביקור ואבחון תקלה', categoryId: null, categoryName: null }),
];

describe('sortServices', () => {
  it('puts favorites first, then recently used, then names in Hebrew order', () => {
    expect(sortServices(list).map((s) => s.name)).toEqual([
      'הנחת כבל',
      'החלפת שקע',
      'שקע כוח 16A',
      'ביקור ואבחון תקלה',
      'תאורה שקועה',
    ]);
  });
});

describe('filterServices', () => {
  it('searches Hebrew names and category names', () => {
    expect(filterServices(list, 'שקע').map((s) => s.name)).toEqual(['החלפת שקע', 'שקע כוח 16A']);
    expect(filterServices(list, 'תאורה').map((s) => s.name)).toEqual(['תאורה שקועה']);
  });

  it('filters by favorites and by category (including "no category")', () => {
    expect(filterServices(list, '', { kind: 'favorites' }).map((s) => s.name)).toEqual([
      'הנחת כבל',
    ]);
    expect(filterServices(list, '', { kind: 'category', id: null }).map((s) => s.name)).toEqual([
      'ביקור ואבחון תקלה',
    ]);
    expect(filterServices(list, 'כבל', { kind: 'category', id: 'c2' })).toEqual([]);
  });
});

describe('priceInputValue', () => {
  it('shows agorot as shekels without trailing zeros', () => {
    expect(priceInputValue(25000)).toBe('250');
    expect(priceInputValue(25050)).toBe('250.5');
    expect(priceInputValue(9990)).toBe('99.9');
  });
});
