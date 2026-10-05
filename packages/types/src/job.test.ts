import { describe, expect, it } from 'vitest';
import {
  canJob,
  canScheduleJob,
  canTransitionJob,
  JOB_FILTERS,
  JOB_STATUSES,
  jobMatchesFilter,
  MarkQuoteApprovedSchema,
  ScheduleJobSchema,
  type JobStatus,
} from './job.ts';

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe('job status transitions', () => {
  const allowed: [JobStatus, JobStatus][] = [
    ['pending_schedule', 'scheduled'],
    ['pending_schedule', 'in_progress'],
    ['pending_schedule', 'cancelled'],
    ['scheduled', 'in_progress'],
    ['scheduled', 'cancelled'],
    ['in_progress', 'on_hold'],
    ['in_progress', 'completed'],
    ['in_progress', 'cancelled'],
    ['on_hold', 'in_progress'],
    ['on_hold', 'cancelled'],
  ];

  it('allows exactly the listed moves (same as app.job_transition_allowed)', () => {
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransitionJob(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('starts, completes and cancels only where the transitions allow', () => {
    expect(canJob('start', 'pending_schedule')).toBe(true);
    expect(canJob('start', 'scheduled')).toBe(true);
    expect(canJob('complete', 'scheduled')).toBe(false);
    expect(canJob('complete', 'in_progress')).toBe(true);
    expect(canJob('cancel', 'completed')).toBe(false);
    expect(canJob('start', 'cancelled')).toBe(false);
  });

  it('schedules only a job waiting for a visit', () => {
    expect(JOB_STATUSES.filter(canScheduleJob)).toEqual(['pending_schedule']);
  });

  it('puts every status in exactly one filter', () => {
    for (const status of JOB_STATUSES) {
      const filters = (Object.keys(JOB_FILTERS) as (keyof typeof JOB_FILTERS)[]).filter((f) =>
        jobMatchesFilter(status, f),
      );
      expect(filters, status).toHaveLength(1);
    }
  });
});

describe('MarkQuoteApprovedSchema', () => {
  it('needs a method and keeps the trimmed note', () => {
    expect(MarkQuoteApprovedSchema.parse({ method: 'phone', note: '  אישר  ' })).toEqual({
      method: 'phone',
      note: 'אישר',
    });
    expect(messages(MarkQuoteApprovedSchema.safeParse({}))).toEqual(['approval_method_required']);
    expect(messages(MarkQuoteApprovedSchema.safeParse({ method: 'fax' }))).toEqual([
      'approval_method_required',
    ]);
    expect(
      messages(MarkQuoteApprovedSchema.safeParse({ method: 'in_person', note: 'א'.repeat(501) })),
    ).toEqual(['approval_note_too_long']);
  });
});

describe('ScheduleJobSchema', () => {
  it('takes one visit of at most 12 hours that ends after it starts', () => {
    const startsAt = '2031-03-03T07:00:00.000Z';
    expect(
      ScheduleJobSchema.safeParse({ startsAt, endsAt: '2031-03-03T09:00:00.000Z' }).success,
    ).toBe(true);
    expect(messages(ScheduleJobSchema.safeParse({ startsAt, endsAt: startsAt }))).toEqual([
      'slot_invalid',
    ]);
    expect(
      messages(ScheduleJobSchema.safeParse({ startsAt, endsAt: '2031-03-03T20:00:00.000Z' })),
    ).toEqual(['slot_too_long']);
  });
});
