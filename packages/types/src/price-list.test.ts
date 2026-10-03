import { describe, expect, it } from 'vitest';
import electrician from './starter-price-lists/electrician.json' with { type: 'json' };
import {
  getStarterPriceList,
  priceMinorSchema,
  ServiceSchema,
  StarterPriceListSchema,
} from './price-list.ts';

const id = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
const service = {
  id,
  name: 'התקנת שקע',
  categoryId: null,
  unit: 'point',
  priceMinor: 25000,
  vatIncluded: false,
  isFavorite: true,
};

describe('priceMinorSchema', () => {
  it('accepts zero and positive whole agorot', () => {
    expect(priceMinorSchema.parse(0)).toBe(0);
    expect(priceMinorSchema.parse(25050)).toBe(25050);
  });

  it('rejects negative, fractional and absurd prices', () => {
    expect(priceMinorSchema.safeParse(-1).error?.issues[0]?.message).toBe('price_negative');
    expect(priceMinorSchema.safeParse(10.5).error?.issues[0]?.message).toBe('price_invalid');
    expect(priceMinorSchema.safeParse(100_000_001).error?.issues[0]?.message).toBe(
      'price_too_high',
    );
  });
});

describe('ServiceSchema', () => {
  it('accepts a valid service and trims the name', () => {
    expect(ServiceSchema.parse({ ...service, name: '  התקנת שקע ' }).name).toBe('התקנת שקע');
  });

  it('rejects unknown units and negative prices', () => {
    const messages = ServiceSchema.safeParse({
      ...service,
      unit: 'box',
      priceMinor: -100,
    }).error?.issues.map((i) => i.message);
    expect(messages).toEqual(['unit_invalid', 'price_negative']);
  });
});

describe('starter price lists', () => {
  it('the electrician list matches the schema the import RPC expects', () => {
    expect(StarterPriceListSchema.safeParse(electrician).success).toBe(true);
  });

  it('has unique keys, so the import can be idempotent', () => {
    const list = getStarterPriceList('electrician')!;
    const keys = [
      ...list.categories.map((c) => c.key),
      ...list.categories.flatMap((c) => c.services.map((s) => s.key)),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is only offered for trades that have one', () => {
    expect(getStarterPriceList('electrician')?.trade).toBe('electrician');
    expect(getStarterPriceList('plumber')).toBeNull();
    expect(getStarterPriceList(null)).toBeNull();
  });
});
