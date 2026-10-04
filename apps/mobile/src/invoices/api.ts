import type {
  Database,
  InvoiceActionResponse,
  InvoiceSnapshot,
  InvoiceStatus,
  PaymentMethod,
} from '@q2c/types';
import { isNetworkError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';
import type { AppSupabaseClient } from '../lib/supabase';
import type { ApiResult } from '../quotes/outbox';
import type { InvoiceListItem, JobSummary } from './model';

type JobStatus = Database['public']['Enums']['job_status'];

const INVOICE_COLUMNS = `id, status, invoice_number, document_number, total_minor, created_at, issued_at,
  sent_at, paid_at, voided_at, failure_reason, snapshot,
  customer (full_name, phone_e164),
  job (title),
  payment (method, status, paid_at)`;

interface InvoiceRow {
  id: string;
  status: InvoiceStatus;
  invoice_number: number;
  document_number: string | null;
  total_minor: number;
  created_at: string;
  issued_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  failure_reason: string | null;
  snapshot: InvoiceSnapshot | null;
  customer: { full_name: string; phone_e164: string } | null;
  job: { title: string } | null;
  payment: { method: PaymentMethod; status: string; paid_at: string | null }[];
}

export function fromInvoiceRow(row: InvoiceRow): InvoiceListItem {
  return {
    id: row.id,
    status: row.status,
    invoiceNumber: row.invoice_number,
    documentNumber: row.document_number,
    totalMinor: row.total_minor,
    customerName: row.snapshot?.customer.full_name ?? row.customer?.full_name ?? null,
    customerPhone: row.snapshot?.customer.phone ?? row.customer?.phone_e164 ?? null,
    jobTitle: row.snapshot?.job.title ?? row.job?.title ?? null,
    createdAt: row.created_at,
    issuedAt: row.issued_at,
    sentAt: row.sent_at,
    paidAt: row.paid_at,
    voidedAt: row.voided_at,
    failureReason: row.failure_reason,
    paymentMethod: row.payment.find((p) => p.status === 'succeeded')?.method ?? null,
    snapshot: row.snapshot,
  };
}

interface JobRow {
  id: string;
  status: JobStatus;
  title: string;
  completed_at: string | null;
  customer: { full_name: string } | null;
  quote: { total_minor: number } | null;
  invoice: { status: InvoiceStatus; deleted_at: string | null }[];
}

const toSummary = (j: JobRow): JobSummary => ({
  id: j.id,
  title: j.title,
  customerName: j.customer?.full_name ?? null,
  completedAt: j.completed_at,
  totalMinor: j.quote?.total_minor ?? null,
});

/**
 * Open jobs (to mark completed), and completed jobs whose invoices, if any,
 * are all voided (to invoice).
 */
export function splitJobs(rows: JobRow[]): { open: JobSummary[]; toInvoice: JobSummary[] } {
  return {
    open: rows.filter((j) => j.status !== 'completed').map(toSummary),
    toInvoice: rows
      .filter(
        (j) =>
          j.status === 'completed' &&
          !j.invoice.some((i) => i.status !== 'voided' && !i.deleted_at),
      )
      .map(toSummary),
  };
}

const fail = <T>(error: { message: string; code?: string }): ApiResult<T> => ({
  data: null,
  error: { code: error.code, message: error.message, retryable: isNetworkError(error) },
});

/** Invoices: reads through the Data API (RLS), every change through the `invoices` Edge Function. */
export function supabaseInvoicesApi(supabase: AppSupabaseClient) {
  return {
    async listInvoices(businessId: string): Promise<ApiResult<InvoiceListItem[]>> {
      const { data, error } = await supabase
        .from('invoice')
        .select(INVOICE_COLUMNS)
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) return fail(error);
      return { data: (data as unknown as InvoiceRow[]).map(fromInvoiceRow), error: null };
    },

    async listJobs(businessId: string) {
      const { data, error } = await supabase
        .from('job')
        .select(
          'id, status, title, completed_at, customer (full_name), quote (total_minor), invoice (status, deleted_at)',
        )
        .eq('business_id', businessId)
        .in('status', ['scheduled', 'in_progress', 'on_hold', 'completed'])
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) return fail<ReturnType<typeof splitJobs>>(error);
      return { data: splitJobs(data as unknown as JobRow[]), error: null };
    },

    /** Marks a job done (members update jobs directly under RLS). */
    async completeJob(jobId: string): Promise<ApiResult<null>> {
      const { error } = await supabase
        .from('job')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId)
        .neq('status', 'completed');
      return error ? fail(error) : { data: null, error: null };
    },

    async fetchInvoice(invoiceId: string): Promise<ApiResult<InvoiceListItem | null>> {
      const { data, error } = await supabase
        .from('invoice')
        .select(INVOICE_COLUMNS)
        .eq('id', invoiceId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return fail(error);
      return { data: data ? fromInvoiceRow(data as unknown as InvoiceRow) : null, error: null };
    },

    /** Same key, same invoice: keep it for retries of one "create" tap. */
    create(jobId: string, idempotencyKey: string) {
      return invokeFunction<InvoiceActionResponse>(supabase, 'invoices', {
        body: { jobId, idempotencyKey },
      });
    },

    issue(invoiceId: string, documentNumber: string) {
      return invokeFunction<InvoiceActionResponse>(supabase, `invoices/${invoiceId}/issue`, {
        body: { documentNumber },
      });
    },

    markSent(invoiceId: string) {
      return invokeFunction<InvoiceActionResponse>(supabase, `invoices/${invoiceId}/sent`, {
        body: {},
      });
    },

    markPaid(invoiceId: string, method: PaymentMethod) {
      return invokeFunction<InvoiceActionResponse>(supabase, `invoices/${invoiceId}/paid`, {
        body: { method },
      });
    },

    void(invoiceId: string, reason: string) {
      return invokeFunction<InvoiceActionResponse>(supabase, `invoices/${invoiceId}/void`, {
        body: { reason },
      });
    },
  };
}
export type SupabaseInvoicesApi = ReturnType<typeof supabaseInvoicesApi>;
