import type { ApprovalMethod, JobAction, JobStatus } from '@q2c/types';
import { isNetworkError } from '../lib/errors';
import type { AppSupabaseClient } from '../lib/supabase';
import type { ApiError, ApiResult } from '../quotes/outbox';
import { fromJobRow, type JobListItem, type JobRow } from './model';

const JOB_COLUMNS = `id, status, title, quote_id, updated_at, started_at, completed_at,
  customer (full_name),
  quote (quote_number, total_minor),
  appointment (id, status, starts_at, ends_at, deleted_at),
  invoice (id, status, deleted_at)`;

const apiError = (error: { code?: string; message: string; name?: string }): ApiError => ({
  code: error.code,
  message: error.message,
  retryable: isNetworkError(error),
});

const ok = <T>(data: T): ApiResult<T> => ({ data, error: null });
const fail = <T>(error: { code?: string; message: string }): ApiResult<T> => ({
  data: null,
  error: apiError(error),
});

/**
 * Jobs: reads through the Data API (RLS), every change through the database
 * functions of 20261006000100_jobs.sql (clients cannot write jobs directly).
 */
export function supabaseJobsApi(supabase: AppSupabaseClient) {
  return {
    async listJobs(businessId: string): Promise<ApiResult<JobListItem[]>> {
      const { data, error } = await supabase
        .from('job')
        .select(JOB_COLUMNS)
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(300);
      if (error) return fail(error);
      return ok((data as unknown as JobRow[]).map(fromJobRow));
    },

    async fetchJob(jobId: string): Promise<ApiResult<JobListItem | null>> {
      const { data, error } = await supabase
        .from('job')
        .select(JOB_COLUMNS)
        .eq('id', jobId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return fail(error);
      return ok(data ? fromJobRow(data as unknown as JobRow) : null);
    },

    /** The quote's live job, if it has one. */
    async jobOfQuote(
      quoteId: string,
    ): Promise<ApiResult<{ id: string; status: JobStatus } | null>> {
      const { data, error } = await supabase
        .from('job')
        .select('id, status')
        .eq('quote_id', quoteId)
        .is('deleted_at', null)
        .maybeSingle();
      return error ? fail(error) : ok(data);
    },

    /** "צור עבודה": the approved quote's job (the existing one if there is one). */
    async createForQuote(quoteId: string): Promise<ApiResult<string>> {
      const { data, error } = await supabase.rpc('create_job_for_quote', { p_quote_id: quoteId });
      return error ? fail(error) : ok(data);
    },

    /** "סמן כמאושר": the quote becomes approved and its job is created. Returns the job. */
    async markApproved(
      quoteId: string,
      method: ApprovalMethod,
      note: string | undefined,
    ): Promise<ApiResult<string>> {
      const { data, error } = await supabase.rpc('mark_quote_approved', {
        p_quote_id: quoteId,
        p_method: method,
        ...(note ? { p_note: note } : {}),
      });
      return error ? fail(error) : ok(data);
    },

    /** "קבע מועד": a confirmed visit; 23P01 when it overlaps another one. */
    async schedule(jobId: string, startsAt: string, endsAt: string): Promise<ApiResult<string>> {
      const { data, error } = await supabase.rpc('schedule_job', {
        p_job_id: jobId,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
      });
      return error ? fail(error) : ok(data);
    },

    async transition(jobId: string, action: JobAction): Promise<ApiResult<JobStatus>> {
      const { data, error } = await supabase.rpc('transition_job', {
        p_job_id: jobId,
        p_action: action,
      });
      return error ? fail(error) : ok(data);
    },
  };
}

export type SupabaseJobsApi = ReturnType<typeof supabaseJobsApi>;
