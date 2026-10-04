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
  /** Jobs not completed yet; completing one makes it ready to invoice. */
  openJobs: JobSummary[];
  /** Completed jobs with no live invoice. */
  jobsToInvoice: JobSummary[];
}

/** The business's invoices and its jobs: open, and completed without an invoice (offline copy kept). */
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
        openJobs: jobs.data.open,
        jobsToInvoice: jobs.data.toInvoice,
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
