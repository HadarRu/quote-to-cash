import { useCallback } from 'react';
import { getSupabase } from '../lib/supabase';
import { useCachedQuery } from '../lib/useCachedQuery';
import { supabaseInvoicesApi, type SupabaseInvoicesApi } from './api';
import type { InvoiceListItem, JobSummary } from './model';

let api: SupabaseInvoicesApi | null = null;

export function getInvoicesApi(): SupabaseInvoicesApi {
  api ??= supabaseInvoicesApi(getSupabase());
  return api;
}

export interface InvoicesOverview {
  invoices: InvoiceListItem[];
  /** Completed jobs with no live invoice. */
  jobsToInvoice: JobSummary[];
}

/** The business's invoices and its completed jobs without an invoice (offline copy kept). */
export function useInvoicesOverview(businessId: string) {
  const fetcher = useCallback(async () => {
    const [invoices, jobs] = await Promise.all([
      getInvoicesApi().listInvoices(businessId),
      getInvoicesApi().listJobs(businessId),
    ]);
    if (invoices.error) return invoices;
    if (jobs.error) return jobs;
    return {
      data: {
        invoices: invoices.data,
        jobsToInvoice: jobs.data,
      },
      error: null,
    };
  }, [businessId]);
  return useCachedQuery<InvoicesOverview>(`invoices:${businessId}`, fetcher);
}

export function useInvoice(invoiceId: string) {
  const fetcher = useCallback(() => getInvoicesApi().fetchInvoice(invoiceId), [invoiceId]);
  return useCachedQuery<InvoiceListItem | null>(`invoice:${invoiceId}`, fetcher);
}
