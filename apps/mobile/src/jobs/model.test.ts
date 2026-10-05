import { describe, expect, it } from 'vitest';
import { filterJobs, fromJobRow, jobErrorKey, type JobRow } from './model';

const row = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: 'job-1',
  status: 'pending_schedule',
  title: 'החלפת לוח',
  quote_id: 'quote-1',
  updated_at: '2026-10-05T10:00:00Z',
  started_at: null,
  completed_at: null,
  customer: { full_name: 'משה ישראלי' },
  quote: { quote_number: 12, total_minor: 59000 },
  appointment: [],
  invoice: [],
  ...overrides,
});

describe('fromJobRow', () => {
  it('maps the job with its customer and quote', () => {
    expect(fromJobRow(row())).toEqual({
      id: 'job-1',
      status: 'pending_schedule',
      title: 'החלפת לוח',
      quoteId: 'quote-1',
      quoteNumber: 12,
      totalMinor: 59000,
      customerName: 'משה ישראלי',
      visit: null,
      invoice: null,
      updatedAt: '2026-10-05T10:00:00Z',
      startedAt: null,
      completedAt: null,
    });
  });

  it('shows the booked visit, not cancelled or deleted ones', () => {
    const visit = (
      id: string,
      status: string,
      startsAt: string,
      deletedAt: string | null = null,
    ) => ({
      id,
      status,
      starts_at: startsAt,
      ends_at: startsAt,
      deleted_at: deletedAt,
    });
    const job = fromJobRow(
      row({
        appointment: [
          visit('cancelled', 'cancelled', '2026-10-09T07:00:00Z'),
          visit('deleted', 'confirmed', '2026-10-10T07:00:00Z', '2026-10-05T00:00:00Z'),
          visit('booked', 'confirmed', '2026-10-08T07:00:00Z'),
        ],
      }),
    );
    expect(job.visit?.id).toBe('booked');
  });

  it('keeps the live invoice, not a voided one', () => {
    const job = fromJobRow(
      row({
        invoice: [
          { id: 'old', status: 'voided', deleted_at: null },
          { id: 'live', status: 'issued', deleted_at: null },
        ],
      }),
    );
    expect(job.invoice).toEqual({ id: 'live', status: 'issued' });
    expect(
      fromJobRow(row({ invoice: [{ id: 'v', status: 'voided', deleted_at: null }] })).invoice,
    ).toBe(null);
  });
});

describe('filterJobs', () => {
  const jobs = (
    [
      ['a', 'pending_schedule', null],
      ['b', 'scheduled', '2026-10-09T07:00:00Z'],
      ['c', 'scheduled', '2026-10-08T07:00:00Z'],
      ['d', 'in_progress', null],
      ['e', 'on_hold', null],
      ['f', 'completed', null],
      ['g', 'cancelled', null],
    ] as const
  ).map(([id, status, startsAt]) =>
    fromJobRow(
      row({
        id,
        status,
        appointment: startsAt
          ? [
              {
                id: `v-${id}`,
                status: 'confirmed',
                starts_at: startsAt,
                ends_at: startsAt,
                deleted_at: null,
              },
            ]
          : [],
      }),
    ),
  );

  it('splits jobs by stage, scheduled ones by visit time', () => {
    expect(filterJobs(jobs, 'to_schedule').map((j) => j.id)).toEqual(['a']);
    expect(filterJobs(jobs, 'scheduled').map((j) => j.id)).toEqual(['c', 'b']);
    expect(filterJobs(jobs, 'in_progress').map((j) => j.id)).toEqual(['d', 'e']);
    expect(filterJobs(jobs, 'done').map((j) => j.id)).toEqual(['f', 'g']);
  });
});

describe('jobErrorKey', () => {
  const error = (code: string, message = '') => ({ code, message, retryable: false });

  it('maps the database answers to messages', () => {
    expect(jobErrorKey(error('23P01'))).toBe('schedule_conflict');
    expect(jobErrorKey(error('23505'))).toBe('job_already_scheduled');
    expect(jobErrorKey(error('55000'))).toBe('job_status_conflict');
    expect(jobErrorKey(error('55000'), 'quote')).toBe('quote_not_approvable');
    expect(jobErrorKey(error('22007', 'visit time in the past'))).toBe('visit_in_past');
    expect(jobErrorKey(error('22007', 'invalid visit time'))).toBe('slot_invalid');
    expect(jobErrorKey(error('42501'))).toBe('job_not_found');
    expect(jobErrorKey(error('22023'), 'quote')).toBe('approval_method_required');
    expect(jobErrorKey({ message: 'Failed to fetch', retryable: true })).toBe('network');
  });
});
