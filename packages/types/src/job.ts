import { z } from 'zod';
import { Constants, type Database } from './database.types.ts';
import { QuoteSlotSchema } from './scheduling.ts';

export type JobStatus = Database['public']['Enums']['job_status'];
export const JOB_STATUSES = Constants.public.Enums.job_status;

/**
 * Allowed status changes. Mirrors app.job_transition_allowed() in
 * supabase/migrations/20261006000100_jobs.sql, which decides.
 * COMPLETED and CANCELLED are final.
 */
export const JOB_TRANSITIONS = {
  pending_schedule: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
} as const satisfies Record<JobStatus, readonly JobStatus[]>;

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return (JOB_TRANSITIONS[from] as readonly JobStatus[]).includes(to);
}

/** Actions of transition_job() and the status each one leads to. */
export const JOB_ACTIONS = {
  start: 'in_progress',
  complete: 'completed',
  cancel: 'cancelled',
} as const satisfies Record<string, JobStatus>;
export type JobAction = keyof typeof JOB_ACTIONS;

export function canJob(action: JobAction, status: JobStatus): boolean {
  return canTransitionJob(status, JOB_ACTIONS[action]);
}

/** Only a job waiting for a visit can be scheduled (schedule_job). */
export function canScheduleJob(status: JobStatus): boolean {
  return status === 'pending_schedule';
}

/** The jobs list's filters, in display order. */
export const JOB_FILTERS = {
  to_schedule: ['pending_schedule'],
  scheduled: ['scheduled'],
  in_progress: ['in_progress', 'on_hold'],
  done: ['completed', 'cancelled'],
} as const satisfies Record<string, readonly JobStatus[]>;
export type JobFilter = keyof typeof JOB_FILTERS;

export function jobMatchesFilter(status: JobStatus, filter: JobFilter): boolean {
  return (JOB_FILTERS[filter] as readonly JobStatus[]).includes(status);
}

/** How the customer approved, when the owner records it (mark_quote_approved). */
export const APPROVAL_METHODS = ['phone', 'whatsapp', 'in_person'] as const;
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];

export const MarkQuoteApprovedSchema = z.object({
  method: z.enum(APPROVAL_METHODS, 'approval_method_required'),
  note: z.string().trim().max(500, 'approval_note_too_long').optional(),
});
export type MarkQuoteApproved = z.infer<typeof MarkQuoteApprovedSchema>;

/** The visit the owner sets for a job (schedule_job): one time, at most 12 hours. */
export const ScheduleJobSchema = QuoteSlotSchema;
