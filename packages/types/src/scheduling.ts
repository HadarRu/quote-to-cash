import { z } from 'zod';

/** Visit times the owner proposes when sending a quote: none, or 2-3. */
export const SLOTS_MIN = 2;
export const SLOTS_MAX = 3;
/** Longest proposed visit (the database checks the same). */
export const SLOT_MAX_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;
const isoDateTime = z.iso.datetime({ offset: true, error: 'slot_invalid' });

/** One proposed visit time (UTC instants). */
export const QuoteSlotSchema = z
  .object({ startsAt: isoDateTime, endsAt: isoDateTime })
  .refine((slot) => Date.parse(slot.endsAt) > Date.parse(slot.startsAt), 'slot_invalid')
  .refine(
    (slot) => Date.parse(slot.endsAt) - Date.parse(slot.startsAt) <= SLOT_MAX_HOURS * HOUR_MS,
    'slot_too_long',
  );
export type QuoteSlot = z.infer<typeof QuoteSlotSchema>;

const overlaps = (a: QuoteSlot, b: QuoteSlot) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/** The proposed times of one quote: 2-3 that do not overlap each other. */
export const QuoteSlotsSchema = z
  .array(QuoteSlotSchema)
  .refine((slots) => slots.length >= SLOTS_MIN, 'slots_too_few')
  .refine((slots) => slots.length <= SLOTS_MAX, 'slots_too_many')
  .refine(
    (slots) => slots.every((a, i) => slots.slice(i + 1).every((b) => !overlaps(a, b))),
    'slots_overlap',
  );

/** Whether every proposed time is still ahead of `now` (checked again by the server). */
export function slotsInFuture(slots: readonly QuoteSlot[], now: Date): boolean {
  return slots.every((slot) => Date.parse(slot.startsAt) > now.getTime());
}

/** A proposed time as the customer's page shows it. */
export interface PublicQuoteSlot {
  id: string;
  startsAt: string;
  endsAt: string;
  /** Still ahead and not overlapping another confirmed visit of the business. */
  available: boolean;
}

/** The booked visit: the proposed time the customer picked, or one the business set (no slot). */
export interface PublicQuoteAppointment {
  slotId: string | null;
  startsAt: string;
  endsAt: string;
}

/** Body of POST /public-quote/:token/schedule. */
export const PublicQuoteScheduleSchema = z.object({
  slotId: z.uuid('slot_required'),
});
