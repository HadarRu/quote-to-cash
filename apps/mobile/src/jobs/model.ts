import { jobMatchesFilter, type InvoiceStatus, type JobFilter, type JobStatus } from '@q2c/types';
import type { ApiError } from '../quotes/outbox';

/** A job row as the app reads it (Data API under RLS). */
export interface JobRow {
  id: string;
  status: JobStatus;
  title: string;
  quote_id: string | null;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  customer: { full_name: string } | null;
  quote: { quote_number: number | null; total_minor: number } | null;
  appointment: {
    id: string;
    status: string;
    starts_at: string;
    ends_at: string;
    deleted_at: string | null;
  }[];
  invoice: { id: string; status: InvoiceStatus; deleted_at: string | null }[];
}

export interface JobListItem {
  id: string;
  status: JobStatus;
  title: string;
  quoteId: string | null;
  quoteNumber: number | null;
  totalMinor: number | null;
  customerName: string | null;
  /** The booked visit (confirmed, or completed with the job). */
  visit: { id: string; startsAt: string; endsAt: string } | null;
  /** The live (not voided) invoice, once one was made. */
  invoice: { id: string; status: InvoiceStatus } | null;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export function fromJobRow(row: JobRow): JobListItem {
  const visit = row.appointment
    .filter((a) => !a.deleted_at && (a.status === 'confirmed' || a.status === 'completed'))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
  const invoice = row.invoice.find((i) => !i.deleted_at && i.status !== 'voided');
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    quoteId: row.quote_id,
    quoteNumber: row.quote?.quote_number ?? null,
    totalMinor: row.quote?.total_minor ?? null,
    customerName: row.customer?.full_name ?? null,
    visit: visit ? { id: visit.id, startsAt: visit.starts_at, endsAt: visit.ends_at } : null,
    invoice: invoice ? { id: invoice.id, status: invoice.status } : null,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/** Jobs in a filter; scheduled ones by visit time, the rest most recently changed first. */
export function filterJobs(jobs: JobListItem[], filter: JobFilter): JobListItem[] {
  const matching = jobs.filter((j) => jobMatchesFilter(j.status, filter));
  if (filter !== 'scheduled') return matching;
  return [...matching].sort((a, b) =>
    (a.visit?.startsAt ?? '').localeCompare(b.visit?.startsAt ?? ''),
  );
}

/**
 * Error key (packages/ui he.errors) for a refused job or approval call. The
 * database answers with SQLSTATEs (20261006000100_jobs.sql).
 */
export function jobErrorKey(error: ApiError, context: 'job' | 'quote' = 'job'): string {
  if (error.retryable) return 'network';
  switch (error.code) {
    case '23P01':
      return 'schedule_conflict';
    case '23505':
      return 'job_already_scheduled';
    case '55000':
      return context === 'quote' ? 'quote_not_approvable' : 'job_status_conflict';
    case '22007':
      return /past/.test(error.message) ? 'visit_in_past' : 'slot_invalid';
    case '22023':
      return context === 'quote' ? 'approval_method_required' : 'generic';
    case '42501':
      return context === 'quote' ? 'quote_not_found' : 'job_not_found';
    default:
      return 'generic';
  }
}
