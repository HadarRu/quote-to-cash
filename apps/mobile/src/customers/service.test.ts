import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomerInput } from '@q2c/types';
import {
  deleteCustomer,
  saveCustomer,
  type AddressRowWrite,
  type CustomerRowWrite,
  type CustomersDb,
} from './service.ts';

const BUSINESS = 'b1';

/** In-memory stand-in for the Data API, enforcing the same partial unique index on phone. */
function fakeDb() {
  const customers = new Map<string, CustomerRowWrite & { deleted: boolean }>();
  const addresses = new Map<string, AddressRowWrite & { deleted: boolean }>();
  const db: CustomersDb = {
    listCustomers: async () => ({ data: [], error: null }),
    getCustomer: async () => ({ data: null, error: null }),
    findActiveByPhone: async (businessId, phone) => {
      const hit = [...customers.values()].find(
        (c) => c.business_id === businessId && c.phone_e164 === phone && !c.deleted,
      );
      return { data: hit ? { id: hit.id, fullName: hit.full_name } : null, error: null };
    },
    upsertCustomer: async (row) => {
      const clash = [...customers.values()].find(
        (c) =>
          c.business_id === row.business_id &&
          c.phone_e164 === row.phone_e164 &&
          !c.deleted &&
          c.id !== row.id,
      );
      if (clash)
        return {
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        };
      customers.set(row.id, { ...row, deleted: false });
      return { error: null };
    },
    upsertAddress: async (row) => {
      addresses.set(row.id, { ...row, deleted: false });
      return { error: null };
    },
    softDeleteAddress: async (id) => {
      const a = addresses.get(id);
      if (a) a.deleted = true;
      return { error: null };
    },
    softDeleteCustomer: async (id) => {
      const c = customers.get(id);
      if (c) c.deleted = true;
      return { error: null };
    },
  };
  return { db, customers, addresses };
}

const moshe: CustomerInput = { id: 'c1', fullName: 'משה כהן', phone: '+972521234567' };

describe('saveCustomer', () => {
  let f: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    f = fakeDb();
  });

  it('creates a customer with its primary address', async () => {
    const input = { ...moshe, address: { street: 'הרצל', city: 'חיפה' } };
    expect(await saveCustomer(f.db, BUSINESS, input, { current: 'a1', previous: null })).toEqual({
      ok: true,
      id: 'c1',
    });
    expect(f.customers.get('c1')).toMatchObject({ full_name: 'משה כהן', email: null, notes: null });
    expect(f.addresses.get('a1')).toMatchObject({
      customer_id: 'c1',
      street: 'הרצל',
      is_primary: true,
    });
  });

  it('suggests the existing customer for a duplicate phone instead of saving', async () => {
    await saveCustomer(f.db, BUSINESS, moshe);
    const result = await saveCustomer(f.db, BUSINESS, {
      id: 'c2',
      fullName: 'משה אחר',
      phone: moshe.phone,
    });
    expect(result).toEqual({
      ok: false,
      error: 'duplicate_phone',
      existing: { id: 'c1', fullName: 'משה כהן' },
    });
    expect(f.customers.has('c2')).toBe(false);
  });

  it('allows the same phone in another business', async () => {
    await saveCustomer(f.db, BUSINESS, moshe);
    expect(await saveCustomer(f.db, 'b2', { ...moshe, id: 'c9' })).toEqual({ ok: true, id: 'c9' });
  });

  it('lets a customer keep their own phone when edited, and retries are harmless', async () => {
    await saveCustomer(f.db, BUSINESS, moshe);
    expect(await saveCustomer(f.db, BUSINESS, { ...moshe, fullName: 'משה כהן (בית)' })).toEqual({
      ok: true,
      id: 'c1',
    });
    expect(f.customers.get('c1')?.full_name).toBe('משה כהן (בית)');
  });

  it('reports a duplicate that appears between the check and the save', async () => {
    const racing = fakeDb();
    await saveCustomer(racing.db, BUSINESS, moshe);
    let first = true;
    const db: CustomersDb = {
      ...racing.db,
      // The check runs before the other device's insert lands.
      findActiveByPhone: async (b, p) =>
        first ? ((first = false), { data: null, error: null }) : racing.db.findActiveByPhone(b, p),
    };
    expect(
      await saveCustomer(db, BUSINESS, { id: 'c2', fullName: 'אחר', phone: moshe.phone }),
    ).toEqual({
      ok: false,
      error: 'duplicate_phone',
      existing: { id: 'c1', fullName: 'משה כהן' },
    });
  });

  it('soft-deletes the previous address when the form no longer has one', async () => {
    await saveCustomer(
      f.db,
      BUSINESS,
      { ...moshe, address: { street: 'הרצל', city: 'חיפה' } },
      { current: 'a1', previous: null },
    );
    await saveCustomer(f.db, BUSINESS, moshe, { current: null, previous: 'a1' });
    expect(f.addresses.get('a1')?.deleted).toBe(true);
  });

  it('maps database failures', async () => {
    const db: CustomersDb = {
      ...f.db,
      findActiveByPhone: async () => ({
        data: null,
        error: { message: 'TypeError: Network request failed' },
      }),
    };
    expect(await saveCustomer(db, BUSINESS, moshe)).toEqual({ ok: false, error: 'offline_write' });
  });
});

describe('deleteCustomer', () => {
  it('soft-deletes, which frees the phone for a new customer', async () => {
    const f = fakeDb();
    await saveCustomer(f.db, BUSINESS, moshe);
    expect(await deleteCustomer(f.db, 'c1')).toEqual({ ok: true });
    expect(f.customers.get('c1')?.deleted).toBe(true);
    expect(await saveCustomer(f.db, BUSINESS, { ...moshe, id: 'c2' })).toEqual({
      ok: true,
      id: 'c2',
    });
  });
});
