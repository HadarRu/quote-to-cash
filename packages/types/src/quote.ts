import { z } from 'zod';
import type { TaxStatus } from './business.ts';
import type { Database } from './database.types.ts';
import { priceMinorSchema } from './price-list.ts';

export type QuoteStatus = Database['public']['Enums']['quote_status'];

/**
 * What can be done to a quote in each status. Mirrors the database rules in
 * supabase/migrations/20261003200100_quote_lifecycle.sql, which decide.
 */
const QUOTE_ACTIONS = {
  /** Change content (customer, lines, discount, notes, photos). */
  edit: ['draft'],
  send: ['draft'],
  /** Copy into a new draft revision; the old quote becomes superseded. */
  revise: ['sent', 'viewed', 'rejected', 'expired'],
  cancel: ['draft', 'sent', 'viewed', 'rejected', 'expired'],
} as const satisfies Record<string, readonly QuoteStatus[]>;

export type QuoteAction = keyof typeof QUOTE_ACTIONS;

export function canQuote(action: QuoteAction, status: QuoteStatus): boolean {
  return (QUOTE_ACTIONS[action] as readonly QuoteStatus[]).includes(status);
}

/** VAT rate a business charges: none for an exempt dealer (osek patur). */
export function businessVatRateBp(taxStatus: TaxStatus, settingsVatRateBp: number): number {
  return taxStatus === 'osek_patur' ? 0 : settingsVatRateBp;
}

export const DISCOUNT_TYPES = ['none', 'percent', 'amount'] as const;

/** Up to 3 decimals, more than 0, within numeric(12, 3). */
export const quantitySchema = z
  .string('quantity_invalid')
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'quantity_invalid')
  .refine((value) => Number(value) > 0, 'quantity_invalid');

export const QuoteLineSchema = z.object({
  id: z.uuid('quote_id_invalid'),
  /** The price list service it came from; null for a free-form line. */
  serviceId: z.uuid().nullable(),
  description: z
    .string()
    .trim()
    .min(1, 'line_description_required')
    .max(500, 'line_description_too_long'),
  quantity: quantitySchema,
  unit: z.string().trim().min(1, 'unit_invalid').max(30, 'unit_invalid'),
  unitPriceMinor: priceMinorSchema,
  vatIncluded: z.boolean(),
});
export type QuoteLineInput = z.infer<typeof QuoteLineSchema>;

export const QuoteDraftSchema = z
  .object({
    /** Client-generated, so the offline outbox can replay saves safely. */
    id: z.uuid('quote_id_invalid'),
    customerId: z.uuid('quote_customer_required'),
    title: z
      .string()
      .trim()
      .max(200, 'quote_title_too_long')
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
    notes: z
      .string()
      .trim()
      .max(4000, 'notes_too_long')
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
    discountType: z.enum(DISCOUNT_TYPES),
    /** Basis points for 'percent' (1000 = 10%), agorot for 'amount'. */
    discountValue: z.number().int('discount_invalid').min(0, 'discount_invalid'),
    lines: z.array(QuoteLineSchema).max(200, 'quote_too_many_lines'),
  })
  .superRefine((quote, ctx) => {
    if (quote.discountType === 'percent' && quote.discountValue > 10000) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'discount_percent_invalid',
      });
    }
    if (quote.discountType === 'amount' && quote.discountValue > 100_000_000) {
      ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'discount_invalid' });
    }
  });
export type QuoteDraftInput = z.input<typeof QuoteDraftSchema>;
export type QuoteDraft = z.output<typeof QuoteDraftSchema>;

/** A quote that can be sent: a valid draft with at least one line. */
export const QuoteSendableSchema = QuoteDraftSchema.refine((quote) => quote.lines.length > 0, {
  path: ['lines'],
  message: 'quote_lines_required',
});

/** Body of POST /quotes/:id/send. The key makes retries return the same result. */
export const SendQuoteRequestSchema = z.object({
  sendKey: z.uuid('send_key_invalid'),
});
export type SendQuoteRequest = z.infer<typeof SendQuoteRequestSchema>;

export interface SendQuoteResponse {
  quoteNumber: number;
  sentAt: string;
  /** Customer link; null when a retry finds the quote already opened (the link went out before). */
  url: string | null;
  /** wa.me link with the Hebrew message prefilled; null with `url`. */
  whatsappUrl: string | null;
  alreadySent: boolean;
}
