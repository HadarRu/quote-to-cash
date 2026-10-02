import type { AppSupabaseClient } from '../lib/supabase';
import type { CustomerDetail, CustomerListItem } from './model';
import type { CustomersDb, DbResult } from './service';

/** Most recent customers kept on the device for the list and offline search. */
export const CUSTOMER_LIST_LIMIT = 500;

const now = () => new Date().toISOString();

/** CustomersDb over the Supabase Data API; RLS limits every call to the user's businesses. */
export function supabaseCustomersDb(supabase: AppSupabaseClient): CustomersDb {
  return {
    async listCustomers(businessId): Promise<DbResult<CustomerListItem[]>> {
      const { data, error } = await supabase
        .from('customer')
        .select('id, full_name, phone_e164, email, updated_at')
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(CUSTOMER_LIST_LIMIT);
      if (error) return { data: null, error };
      return {
        data: data.map((c) => ({
          id: c.id,
          fullName: c.full_name,
          phone: c.phone_e164,
          email: c.email,
          updatedAt: c.updated_at,
        })),
        error: null,
      };
    },

    async getCustomer(customerId): Promise<DbResult<CustomerDetail | null>> {
      const { data, error } = await supabase
        .from('customer')
        .select(
          `id, full_name, phone_e164, email, notes, updated_at, deleted_at,
           customer_address (id, street, house_number, apartment, city, postal_code, access_notes, is_primary, deleted_at),
           quote (id, quote_number, title, status, total_minor, created_at, deleted_at)`,
        )
        .eq('id', customerId)
        .is('customer_address.deleted_at', null)
        .is('quote.deleted_at', null)
        .order('created_at', { referencedTable: 'quote', ascending: false })
        .maybeSingle();
      if (error) return { data: null, error };
      if (!data) return { data: null, error: null };
      return {
        data: {
          id: data.id,
          fullName: data.full_name,
          phone: data.phone_e164,
          email: data.email,
          notes: data.notes,
          updatedAt: data.updated_at,
          deletedAt: data.deleted_at,
          addresses: data.customer_address
            .map((a) => ({
              id: a.id,
              street: a.street,
              houseNumber: a.house_number,
              apartment: a.apartment,
              city: a.city,
              postalCode: a.postal_code,
              accessNotes: a.access_notes,
              isPrimary: a.is_primary,
            }))
            .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
          quotes: data.quote.map((q) => ({
            id: q.id,
            quoteNumber: q.quote_number,
            title: q.title,
            status: q.status,
            totalMinor: q.total_minor,
            createdAt: q.created_at,
          })),
        },
        error: null,
      };
    },

    async findActiveByPhone(businessId, phone) {
      const { data, error } = await supabase
        .from('customer')
        .select('id, full_name')
        .eq('business_id', businessId)
        .eq('phone_e164', phone)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return { data: null, error };
      return { data: data ? { id: data.id, fullName: data.full_name } : null, error: null };
    },

    async upsertCustomer(row) {
      const { error } = await supabase.from('customer').upsert(row, { onConflict: 'id' });
      return { error };
    },

    async upsertAddress(row) {
      const { error } = await supabase.from('customer_address').upsert(row, { onConflict: 'id' });
      return { error };
    },

    async softDeleteAddress(addressId) {
      const { error } = await supabase
        .from('customer_address')
        .update({ deleted_at: now() })
        .eq('id', addressId);
      return { error };
    },

    async softDeleteCustomer(customerId) {
      const { data, error } = await supabase
        .from('customer')
        .update({ deleted_at: now() })
        .eq('id', customerId)
        .select('id');
      if (error) return { error };
      // RLS hides rows of other businesses: nothing updated means not allowed.
      return { error: data.length === 0 ? { code: '42501', message: 'customer not found' } : null };
    },
  };
}
