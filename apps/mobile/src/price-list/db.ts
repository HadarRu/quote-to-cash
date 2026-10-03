import type { Json, ServiceUnit } from '@q2c/types';
import type { DbResult } from '../lib/db';
import type { AppSupabaseClient } from '../lib/supabase';
import type { PriceList } from './model';
import type { PriceListDb } from './service';

const now = () => new Date().toISOString();

/** PriceListDb over the Supabase Data API; RLS limits every call to the user's businesses. */
export function supabasePriceListDb(supabase: AppSupabaseClient): PriceListDb {
  return {
    async load(businessId): Promise<DbResult<PriceList>> {
      const [categories, services] = await Promise.all([
        supabase
          .from('service_category')
          .select('id, name, sort_order')
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .order('sort_order')
          .order('name'),
        supabase
          .from('service')
          .select(
            'id, name, category_id, unit, default_price_minor, vat_included, is_favorite, last_used_at, service_category (name, deleted_at)',
          )
          .eq('business_id', businessId)
          .is('deleted_at', null),
      ]);
      if (categories.error) return { data: null, error: categories.error };
      if (services.error) return { data: null, error: services.error };
      return {
        data: {
          categories: categories.data.map((c) => ({
            id: c.id,
            name: c.name,
            sortOrder: c.sort_order,
          })),
          services: services.data.map((s) => {
            const category =
              s.service_category && !s.service_category.deleted_at ? s.service_category : null;
            return {
              id: s.id,
              name: s.name,
              categoryId: category ? s.category_id : null,
              categoryName: category?.name ?? null,
              unit: s.unit as ServiceUnit,
              priceMinor: s.default_price_minor,
              vatIncluded: s.vat_included,
              isFavorite: s.is_favorite,
              lastUsedAt: s.last_used_at,
            };
          }),
        },
        error: null,
      };
    },
    async upsertService(row) {
      return { error: (await supabase.from('service').upsert(row, { onConflict: 'id' })).error };
    },
    async updateService(id, patch) {
      return { error: (await supabase.from('service').update(patch).eq('id', id)).error };
    },
    async softDeleteService(id) {
      return {
        error: (await supabase.from('service').update({ deleted_at: now() }).eq('id', id)).error,
      };
    },
    async upsertCategory(row) {
      return {
        error: (await supabase.from('service_category').upsert(row, { onConflict: 'id' })).error,
      };
    },
    async softDeleteCategory(id) {
      return {
        error: (await supabase.from('service_category').update({ deleted_at: now() }).eq('id', id))
          .error,
      };
    },
    async importStarter(businessId, list) {
      const { data, error } = await supabase.rpc('import_starter_price_list', {
        p_business_id: businessId,
        p_list: list as unknown as Json,
      });
      return error ? { data: null, error } : { data, error: null };
    },
  };
}
