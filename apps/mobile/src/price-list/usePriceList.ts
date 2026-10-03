import { useCallback, useMemo } from 'react';
import { useCurrentBusiness } from '../auth/AuthProvider';
import { getSupabase } from '../lib/supabase';
import { useCachedQuery } from '../lib/useCachedQuery';
import { supabasePriceListDb } from './db';
import type { PriceList } from './model';

/** The business's price list with an offline copy; `db` performs writes. */
export function usePriceList() {
  const { business } = useCurrentBusiness();
  const db = useMemo(() => supabasePriceListDb(getSupabase()), []);
  const fetcher = useCallback(() => db.load(business.id), [db, business.id]);
  const query = useCachedQuery<PriceList>(`price-list:${business.id}`, fetcher);
  return { ...query, db, business };
}
