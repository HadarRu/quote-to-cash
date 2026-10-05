import { useCallback } from 'react';
import { getSupabase } from '../lib/supabase';
import { useCachedQuery } from '../lib/useCachedQuery';
import { supabaseJobsApi, type SupabaseJobsApi } from './api';
import type { JobListItem } from './model';

let api: SupabaseJobsApi | null = null;

export function getJobsApi(): SupabaseJobsApi {
  api ??= supabaseJobsApi(getSupabase());
  return api;
}

/** The business's jobs (offline copy kept). */
export function useJobs(businessId: string) {
  const fetcher = useCallback(() => getJobsApi().listJobs(businessId), [businessId]);
  return useCachedQuery<JobListItem[]>(`jobs:${businessId}`, fetcher);
}

export function useJob(jobId: string) {
  const fetcher = useCallback(() => getJobsApi().fetchJob(jobId), [jobId]);
  return useCachedQuery<JobListItem | null>(`job:${jobId}`, fetcher);
}

/** The job of a quote, or null while it has none. */
export function useQuoteJob(quoteId: string) {
  const fetcher = useCallback(() => getJobsApi().jobOfQuote(quoteId), [quoteId]);
  return useCachedQuery(`quote-job:${quoteId}`, fetcher);
}
