import { z } from 'zod';
import { Constants, type Database } from './database.types.ts';
import type { QuoteSnapshot } from './public-quote.ts';

export type InvoiceStatus = Database['public']['Enums']['invoice_status'];
export const INVOICE_STATUSES = Constants.public.Enums.invoice_status;

export const paymentMethodSchema = z.enum(
  Constants.public.Enums.payment_method,
  'payment_method_required',
);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * Allowed status changes. Mirrors app.invoice_transition_allowed() in
 * supabase/migrations/20261005000000_invoicing.sql, which decides.
 * PAID and VOIDED are final; nothing is ever deleted.
 */
export const INVOICE_TRANSITIONS = {
  not_issued: ['issued', 'failed', 'voided'],
  failed: ['issued', 'voided'],
  issued: ['sent', 'paid', 'voided'],
  sent: ['paid', 'voided'],
  paid: [],
  voided: [],
} as const satisfies Record<InvoiceStatus, readonly InvoiceStatus[]>;

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return (INVOICE_TRANSITIONS[from] as readonly InvoiceStatus[]).includes(to);
}

/** Issued to the customer and not paid yet: the unpaid list. */
export const UNPAID_INVOICE_STATUSES = ['issued', 'sent'] as const satisfies InvoiceStatus[];

export function isUnpaidInvoice(status: InvoiceStatus): boolean {
  return (UNPAID_INVOICE_STATUSES as readonly InvoiceStatus[]).includes(status);
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Values of business_settings.invoice_provider (and invoice.provider). */
export const INVOICE_PROVIDER_IDS = ['manual'] as const;
export type InvoiceProviderId = (typeof INVOICE_PROVIDER_IDS)[number];

/**
 * What an invoice bills, frozen when it is created (invoice.snapshot): the
 * quote snapshot of the job's quote, plus the job.
 */
export type InvoiceSnapshot = Pick<
  QuoteSnapshot,
  'quote_number' | 'business' | 'customer' | 'items' | 'discount_type' | 'discount_value' | 'totals'
> & {
  job: { title: string; completed_at: string | null };
};

/** An invoice as a provider receives it. */
export interface InvoiceDocument {
  id: string;
  businessId: string;
  /** Internal running number (invoice.invoice_number); not the legal document number. */
  invoiceNumber: number;
  /** Stable per invoice: a provider passes it on so a retried create never makes two documents. */
  idempotencyKey: string;
  provider: InvoiceProviderId;
  status: InvoiceStatus;
  /** Number of the legal document, once issued. */
  documentNumber: string | null;
  /** The provider's own id for the document, once it has one. */
  providerDocumentId: string | null;
  snapshot: InvoiceSnapshot;
}

/** Where a provider says the invoice stands. The core records it (transition_invoice). */
export interface InvoiceProviderResult {
  status: InvoiceStatus;
  documentNumber?: string | null;
  providerDocumentId?: string | null;
  /** Why the provider could not issue the document (status 'failed'). */
  failureReason?: string | null;
}

/**
 * An invoicing provider. The core creates the invoice and its lines from the
 * job's quote snapshot, then hands it to the provider of the business
 * (business_settings.invoice_provider) and records what the provider returns.
 * Adding a real provider means implementing this interface and registering it.
 */
export interface InvoiceProvider {
  readonly id: InvoiceProviderId;
  /** Creates the document. Must be idempotent per `invoice.idempotencyKey`. */
  createInvoice(invoice: InvoiceDocument): Promise<InvoiceProviderResult>;
  /** The document's current status at the provider. */
  getStatus(invoice: InvoiceDocument): Promise<InvoiceProviderResult>;
  /** Cancels the document at the provider; the result's status is 'voided' on success. */
  voidInvoice(invoice: InvoiceDocument, reason: string | null): Promise<InvoiceProviderResult>;
}

/** Providers by id; the one used for an invoice is the one its business selected. */
export class InvoiceProviderRegistry {
  private readonly providers: Map<InvoiceProviderId, InvoiceProvider>;

  constructor(providers: readonly InvoiceProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  get(id: string): InvoiceProvider {
    const provider = this.providers.get(id as InvoiceProviderId);
    if (!provider) throw new Error(`unknown invoice provider: ${id}`);
    return provider;
  }
}

// ---------------------------------------------------------------------------
// Requests to the `invoices` Edge Function
// ---------------------------------------------------------------------------

/** POST /invoices. The key makes retries return the same invoice. */
export const CreateInvoiceRequestSchema = z.object({
  jobId: z.uuid('job_id_invalid'),
  idempotencyKey: z.uuid('idempotency_key_invalid'),
});
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequestSchema>;

/** POST /invoices/:id/issue: the owner records the number of the document they issued. */
export const IssueInvoiceRequestSchema = z.object({
  documentNumber: z
    .string('document_number_required')
    .trim()
    .min(1, 'document_number_required')
    .max(50, 'document_number_too_long'),
});
export type IssueInvoiceRequest = z.input<typeof IssueInvoiceRequestSchema>;

/** POST /invoices/:id/paid */
export const MarkInvoicePaidRequestSchema = z.object({
  method: paymentMethodSchema,
  /** When the money arrived; defaults to now. */
  paidAt: z.iso.datetime({ offset: true, message: 'paid_at_invalid' }).optional(),
});
export type MarkInvoicePaidRequest = z.infer<typeof MarkInvoicePaidRequestSchema>;

/** POST /invoices/:id/void */
export const VoidInvoiceRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, 'void_reason_too_long')
    .optional()
    .transform((value) => value || null),
});
export type VoidInvoiceRequest = z.input<typeof VoidInvoiceRequestSchema>;

/** Every `invoices` endpoint answers with where the invoice stands. */
export interface InvoiceActionResponse {
  invoiceId: string;
  status: InvoiceStatus;
  /** True when the request changed nothing (a retry, or the invoice was already there). */
  alreadyDone: boolean;
}
