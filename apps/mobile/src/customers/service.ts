import type { CustomerInput } from '@q2c/types';
import type { ErrorKey } from '@q2c/ui';
import type { CustomerDetail, CustomerListItem } from './model';

export interface DbError {
  code?: string;
  message: string;
}

export type DbResult<T> = { data: T; error: null } | { data: null; error: DbError };

export interface CustomerRowWrite {
  id: string;
  business_id: string;
  full_name: string;
  phone_e164: string;
  email: string | null;
  notes: string | null;
}

export interface AddressRowWrite {
  id: string;
  business_id: string;
  customer_id: string;
  street: string;
  house_number: string | null;
  apartment: string | null;
  city: string;
  postal_code: string | null;
  access_notes: string | null;
  is_primary: boolean;
}

/** Data access used by the customer screens (Supabase Data API under RLS; see db.ts). */
export interface CustomersDb {
  listCustomers(businessId: string): Promise<DbResult<CustomerListItem[]>>;
  getCustomer(customerId: string): Promise<DbResult<CustomerDetail | null>>;
  findActiveByPhone(
    businessId: string,
    phone: string,
  ): Promise<DbResult<{ id: string; fullName: string } | null>>;
  /** Insert-or-update by primary key, so a retried save is harmless. */
  upsertCustomer(row: CustomerRowWrite): Promise<{ error: DbError | null }>;
  upsertAddress(row: AddressRowWrite): Promise<{ error: DbError | null }>;
  softDeleteAddress(addressId: string): Promise<{ error: DbError | null }>;
  softDeleteCustomer(customerId: string): Promise<{ error: DbError | null }>;
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: 'duplicate_phone'; existing: { id: string; fullName: string } }
  | { ok: false; error: ErrorKey };

const UNIQUE_VIOLATION = '23505';

export function dbErrorKey(error: DbError): ErrorKey {
  if (error.code === '42501') return 'forbidden';
  if (/network|fetch|timed? ?out|offline/i.test(error.message)) return 'offline_write';
  return 'generic';
}

/**
 * Creates or updates a customer. A phone already used by another active
 * customer of the business is reported as `duplicate_phone` with that
 * customer, so the screen can offer to open it instead.
 *
 * `addressIds.current` is the id of the address section in the form (client
 * generated); `addressIds.previous` is the primary address loaded for editing.
 * A previous address that is no longer in the form is soft-deleted.
 */
export async function saveCustomer(
  db: CustomersDb,
  businessId: string,
  input: CustomerInput,
  addressIds: { current: string | null; previous: string | null } = {
    current: null,
    previous: null,
  },
): Promise<SaveResult> {
  const existing = await db.findActiveByPhone(businessId, input.phone);
  if (existing.error) return { ok: false, error: dbErrorKey(existing.error) };
  if (existing.data && existing.data.id !== input.id) {
    return { ok: false, error: 'duplicate_phone', existing: existing.data };
  }

  const saved = await db.upsertCustomer({
    id: input.id,
    business_id: businessId,
    full_name: input.fullName,
    phone_e164: input.phone,
    email: input.email ?? null,
    notes: input.notes ?? null,
  });
  if (saved.error) {
    if (saved.error.code === UNIQUE_VIOLATION) {
      // Someone added the same phone between the check and the save.
      const raced = await db.findActiveByPhone(businessId, input.phone);
      if (raced.data && raced.data.id !== input.id) {
        return { ok: false, error: 'duplicate_phone', existing: raced.data };
      }
    }
    return { ok: false, error: dbErrorKey(saved.error) };
  }

  if (input.address && addressIds.current) {
    const address = await db.upsertAddress({
      id: addressIds.current,
      business_id: businessId,
      customer_id: input.id,
      street: input.address.street,
      house_number: input.address.houseNumber ?? null,
      apartment: input.address.apartment ?? null,
      city: input.address.city,
      postal_code: input.address.postalCode ?? null,
      access_notes: input.address.accessNotes ?? null,
      is_primary: true,
    });
    if (address.error) return { ok: false, error: dbErrorKey(address.error) };
  }
  const keptAddress = input.address ? addressIds.current : null;
  if (addressIds.previous && addressIds.previous !== keptAddress) {
    const removed = await db.softDeleteAddress(addressIds.previous);
    if (removed.error) return { ok: false, error: dbErrorKey(removed.error) };
  }

  return { ok: true, id: input.id };
}

/** Soft delete: the row stays (deleted_at is set), so the customer's quotes stay readable. */
export async function deleteCustomer(
  db: CustomersDb,
  customerId: string,
): Promise<{ ok: true } | { ok: false; error: ErrorKey }> {
  const { error } = await db.softDeleteCustomer(customerId);
  return error ? { ok: false, error: dbErrorKey(error) } : { ok: true };
}
