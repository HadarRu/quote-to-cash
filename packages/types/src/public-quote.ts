import { z } from 'zod';
import type { TaxStatus } from './business.ts';
import type { PublicQuoteAppointment, PublicQuoteSlot } from './scheduling.ts';

/**
 * What the customer sees, frozen when the quote is sent (quote.sent_snapshot,
 * written by the `quotes` Edge Function; send_quote adds number and time).
 */
export interface QuoteSnapshot {
  quote_number?: number;
  sent_at?: string;
  revision: number;
  title: string | null;
  notes: string | null;
  valid_until: string;
  business: {
    name: string;
    tax_status: TaxStatus;
    tax_id: string | null;
    phone: string | null;
    email: string | null;
    logo_path: string | null;
  };
  customer: { full_name: string; phone: string; address: string | null };
  items: {
    description: string;
    quantity: string;
    unit: string;
    unit_price_minor: number;
    vat_included: boolean;
    line_total_minor: number;
  }[];
  discount_type: 'none' | 'percent' | 'amount';
  discount_value: number;
  totals: {
    subtotal_minor: number;
    discount_minor: number;
    vat_rate_bp: number;
    vat_minor: number;
    total_minor: number;
  };
  /** quote-photos storage paths. */
  photos: string[];
}

/** How the customer's page presents the quote. */
export type PublicQuoteState =
  'open' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'superseded';

/** A link that no longer shows the quote, only why. */
type ClosedQuoteView<S extends PublicQuoteState> = { state: S; business: { name: string } };

/** GET /public-quote/:token (one member per closed state, so checks on `state` narrow). */
export type PublicQuoteView =
  | ClosedQuoteView<'cancelled'>
  | ClosedQuoteView<'superseded'>
  | {
      state: 'open' | 'approved' | 'rejected' | 'expired';
      quote: QuoteSnapshot;
      expiresAt: string | null;
      approval: { name: string; at: string } | null;
      rejection: { reason: string | null; at: string } | null;
      /** Short-lived signed URLs (the buckets are private). */
      logoUrl: string | null;
      photoUrls: string[];
      /** Visit times the business proposed; one can be booked once approved. */
      slots: PublicQuoteSlot[];
      appointment: PublicQuoteAppointment | null;
    };

/** Approving requires typing a name (the customer's signature). */
export const PublicQuoteApproveSchema = z.object({
  name: z.string().trim().min(2, 'approve_name_required').max(200, 'approve_name_too_long'),
});

export const PublicQuoteRejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(1000, 'reject_reason_too_long')
    .optional()
    .transform((value) => value || undefined),
});

export const PublicQuoteCommentSchema = z.object({
  body: z.string().trim().min(1, 'comment_required').max(2000, 'comment_too_long'),
});

/** Link tokens are 32 random bytes in base64url. */
export const QUOTE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
