import { describe, expect, it } from 'vitest';
import { SendQuoteRequestSchema } from './quote.ts';
import {
  PublicQuoteScheduleSchema,
  QuoteSlotsSchema,
  slotsInFuture,
  type QuoteSlot,
} from './scheduling.ts';

const slot = (start: string, end: string): QuoteSlot => ({ startsAt: start, endsAt: end });
const morning = slot('2030-01-01T06:00:00Z', '2030-01-01T08:00:00Z');
const noon = slot('2030-01-01T08:00:00Z', '2030-01-01T10:00:00Z');
const nextDay = slot('2030-01-02T06:00:00Z', '2030-01-02T09:00:00Z');

const firstError = (value: unknown) =>
  QuoteSlotsSchema.safeParse(value).error?.issues[0]?.message ?? null;

describe('QuoteSlotsSchema', () => {
  it('accepts 2-3 separate times, back to back included', () => {
    expect(firstError([morning, noon])).toBeNull();
    expect(firstError([morning, noon, nextDay])).toBeNull();
  });

  it('wants 2-3 times', () => {
    expect(firstError([morning])).toBe('slots_too_few');
    expect(
      firstError([morning, noon, nextDay, slot('2030-01-03T06:00:00Z', '2030-01-03T07:00:00Z')]),
    ).toBe('slots_too_many');
  });

  it('refuses overlapping, reversed, overlong and malformed times', () => {
    expect(firstError([morning, slot('2030-01-01T07:00:00Z', '2030-01-01T09:00:00Z')])).toBe(
      'slots_overlap',
    );
    expect(firstError([slot('2030-01-01T08:00:00Z', '2030-01-01T06:00:00Z'), noon])).toBe(
      'slot_invalid',
    );
    expect(firstError([slot('2030-01-01T06:00:00Z', '2030-01-01T19:00:00Z'), nextDay])).toBe(
      'slot_too_long',
    );
    expect(firstError([slot('tomorrow', '2030-01-01T06:00:00Z'), noon])).toBe('slot_invalid');
  });
});

describe('slotsInFuture', () => {
  it('is true only when every time is still ahead', () => {
    expect(slotsInFuture([morning, noon], new Date('2029-12-31T00:00:00Z'))).toBe(true);
    expect(slotsInFuture([morning, noon], new Date('2030-01-01T07:00:00Z'))).toBe(false);
  });
});

describe('send and schedule bodies', () => {
  it('send takes optional proposed times', () => {
    const sendKey = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
    expect(SendQuoteRequestSchema.safeParse({ sendKey }).success).toBe(true);
    expect(SendQuoteRequestSchema.safeParse({ sendKey, slots: [morning, noon] }).success).toBe(
      true,
    );
    expect(SendQuoteRequestSchema.safeParse({ sendKey, slots: [morning] }).success).toBe(false);
  });

  it('schedule needs a slot id', () => {
    expect(PublicQuoteScheduleSchema.safeParse({ slotId: 'x' }).error?.issues[0]?.message).toBe(
      'slot_required',
    );
    expect(
      PublicQuoteScheduleSchema.safeParse({ slotId: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' })
        .success,
    ).toBe(true);
  });
});
