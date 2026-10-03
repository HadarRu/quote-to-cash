import { describe, expect, it, vi } from 'vitest';
import {
  changePrice,
  importStarterPriceList,
  saveCategory,
  saveService,
  setFavorite,
  type PriceListDb,
} from './service.ts';

const ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';

function fakeDb(overrides: Partial<PriceListDb> = {}) {
  const ok = vi.fn().mockResolvedValue({ error: null });
  const db: PriceListDb = {
    load: vi.fn(),
    upsertService: ok,
    updateService: ok,
    softDeleteService: ok,
    upsertCategory: ok,
    softDeleteCategory: ok,
    importStarter: vi.fn().mockResolvedValue({ data: 21, error: null }),
    ...overrides,
  };
  return db;
}

const values = {
  id: ID,
  name: 'שקע כוח',
  categoryId: null,
  unit: 'point',
  vatIncluded: false,
  isFavorite: false,
  priceText: '350',
} as const;

describe('saveService', () => {
  it('stores the price in agorot', async () => {
    const db = fakeDb();
    expect(await saveService(db, 'b1', values)).toEqual({ ok: true });
    expect(db.upsertService).toHaveBeenCalledWith(
      expect.objectContaining({ default_price_minor: 35000, business_id: 'b1', unit: 'point' }),
    );
  });

  it('rejects negative or unreadable prices and short names before touching the database', async () => {
    const db = fakeDb();
    expect(await saveService(db, 'b1', { ...values, priceText: '-5', name: 'א' })).toEqual({
      ok: false,
      fieldErrors: { name: 'service_name_too_short', priceMinor: 'price_negative' },
    });
    expect(db.upsertService).not.toHaveBeenCalled();
  });
});

describe('changePrice', () => {
  it('updates only the price', async () => {
    const db = fakeDb();
    expect(await changePrice(db, ID, '1,250.5')).toEqual({ ok: true });
    expect(db.updateService).toHaveBeenCalledWith(ID, { default_price_minor: 125050 });
  });

  it('says a negative price is negative', async () => {
    expect(await changePrice(fakeDb(), ID, '-1')).toEqual({ ok: false, error: 'price_negative' });
  });

  it.each(['', 'abc', '1.234'])('refuses %j', async (text) => {
    const db = fakeDb();
    expect(await changePrice(db, ID, text)).toEqual({ ok: false, error: 'price_invalid' });
    expect(db.updateService).not.toHaveBeenCalled();
  });

  it('reports offline failures', async () => {
    const db = fakeDb({
      updateService: vi
        .fn()
        .mockResolvedValue({ error: { message: 'TypeError: Failed to fetch' } }),
    });
    expect(await changePrice(db, ID, '10')).toEqual({ ok: false, error: 'offline_write' });
  });
});

describe('setFavorite / saveCategory', () => {
  it('toggles the favorite flag', async () => {
    const db = fakeDb();
    await setFavorite(db, ID, true);
    expect(db.updateService).toHaveBeenCalledWith(ID, { is_favorite: true });
  });

  it('validates category names', async () => {
    expect(await saveCategory(fakeDb(), 'b1', { id: ID, name: ' ' })).toEqual({
      ok: false,
      error: 'category_name_too_short',
    });
  });
});

describe('importStarterPriceList', () => {
  it('sends the trade’s starter list to the import RPC', async () => {
    const db = fakeDb();
    expect(await importStarterPriceList(db, 'b1', 'electrician')).toEqual({ ok: true, added: 21 });
    expect(db.importStarter).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ trade: 'electrician', version: 1 }),
    );
  });

  it('has nothing to import for trades without a starter list', async () => {
    const db = fakeDb();
    expect(await importStarterPriceList(db, 'b1', 'plumber')).toEqual({
      ok: false,
      error: 'no_starter_list',
    });
    expect(db.importStarter).not.toHaveBeenCalled();
  });
});
