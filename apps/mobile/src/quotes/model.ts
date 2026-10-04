import {
  QuoteLineSchema,
  QuoteSendableSchema,
  type QuoteStatus,
  type ServiceUnit,
} from '@q2c/types';
import type { ErrorKey } from '@q2c/ui';
import {
  computeQuoteTotals,
  parseMoneyInput,
  type DiscountType,
  type QuoteTotals,
} from '@q2c/utils';

/** A line as the editor holds it: quantity and price as typed. */
export interface LocalLine {
  id: string;
  serviceId: string | null;
  description: string;
  quantity: string;
  priceText: string;
  unit: ServiceUnit | string;
  vatIncluded: boolean;
}

/** A quote as stored on the device (SQLite) and shown by the app. */
export interface LocalQuote {
  id: string;
  businessId: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  title: string;
  notes: string;
  validUntil: string | null;
  discountType: DiscountType;
  /** Percent ("10", "12.5") or shekels ("150"), as typed. */
  discountText: string;
  lines: LocalLine[];
  status: QuoteStatus;
  quoteNumber: number | null;
  revision: number;
  supersedesQuoteId: string | null;
  /** Totals the server stored when the quote was sent (authoritative after sending). */
  serverTotals: Pick<
    QuoteTotals,
    'subtotalMinor' | 'discountMinor' | 'vatRateBp' | 'vatMinor' | 'totalMinor'
  > | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  supersededAt: string | null;
  tokenExpiresAt: string | null;
  /** Visit times proposed when sending (absent on quotes stored before scheduling). */
  slots?: LocalSlot[];
}

/** A proposed visit time; `selected` is the one the customer booked. */
export interface LocalSlot {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'offered' | 'selected' | 'declined';
}

/** Customer link returned when this device sent the quote. */
export interface QuoteLink {
  url: string;
  whatsappUrl: string;
}

/** Where a quote's local changes stand. */
export type SyncState = 'synced' | 'pending' | 'failed';

export interface QuoteListItem extends LocalQuote {
  sync: SyncState;
  /** A send is queued (offline or not confirmed yet); the quote is not SENT until the server says so. */
  pendingSend: boolean;
  /** Error code of a change the server refused (shown with a retry). */
  syncError: string | null;
  link: QuoteLink | null;
}

export function newDraft(init: {
  id: string;
  businessId: string;
  customer?: { id: string; fullName: string; phone: string } | null;
  now: string;
}): LocalQuote {
  return {
    id: init.id,
    businessId: init.businessId,
    customerId: init.customer?.id ?? null,
    customerName: init.customer?.fullName ?? null,
    customerPhone: init.customer?.phone ?? null,
    title: '',
    notes: '',
    validUntil: null,
    discountType: 'none',
    discountText: '',
    lines: [],
    status: 'draft',
    quoteNumber: null,
    revision: 1,
    supersedesQuoteId: null,
    serverTotals: null,
    createdAt: init.now,
    updatedAt: init.now,
    sentAt: null,
    viewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    supersededAt: null,
    tokenExpiresAt: null,
  };
}

/** "12.5" -> 1250 basis points; null when not a percent with up to 2 decimals. */
export function parsePercentInput(text: string): number | null {
  const cleaned = text.replace(/[\s%]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** The discount as stored: basis points or agorot. Invalid input counts as no discount. */
export function discountValue(quote: Pick<LocalQuote, 'discountType' | 'discountText'>): {
  type: DiscountType;
  value: number;
  valid: boolean;
} {
  if (quote.discountType === 'none' || quote.discountText.trim() === '')
    return { type: 'none', value: 0, valid: true };
  const value =
    quote.discountType === 'percent'
      ? parsePercentInput(quote.discountText)
      : parseMoneyInput(quote.discountText);
  if (value === null || (quote.discountType === 'percent' && value > 10000))
    return { type: 'none', value: 0, valid: false };
  return { type: quote.discountType, value, valid: true };
}

/** A line in the shape of the shared schema, or null when what was typed is not valid yet. */
function lineInput(line: LocalLine) {
  const parsed = QuoteLineSchema.safeParse({
    id: line.id,
    serviceId: line.serviceId,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceMinor: parseMoneyInput(line.priceText) ?? Number.NaN,
    vatIncluded: line.vatIncluded,
  });
  return parsed.success ? parsed.data : null;
}

/** Totals of the valid lines (incomplete lines count once they are filled in). */
export function draftTotals(quote: LocalQuote, vatRateBp: number): QuoteTotals {
  const discount = discountValue(quote);
  return computeQuoteTotals({
    lines: quote.lines.flatMap((l) => {
      const input = lineInput(l);
      return input ? [input] : [];
    }),
    discountType: discount.type,
    discountValue: discount.value,
    vatRateBp,
  });
}

/** Totals to show: the server's once sent, the live preview while a draft. */
export function displayTotals(
  quote: LocalQuote,
  vatRateBp: number,
): NonNullable<LocalQuote['serverTotals']> {
  if (quote.status !== 'draft' && quote.serverTotals) return quote.serverTotals;
  return draftTotals(quote, vatRateBp);
}

/** Argument of the save_quote_draft RPC (snake_case, as the database expects). */
export interface ServerDraftPayload {
  id: string;
  business_id: string;
  customer_id: string;
  title: string | null;
  notes: string | null;
  valid_until: string | null;
  discount_type: DiscountType;
  discount_value: number;
  vat_rate_bp: number;
  subtotal_minor: number;
  discount_minor: number;
  vat_minor: number;
  total_minor: number;
  items: {
    id: string;
    service_id: string | null;
    description: string;
    quantity: string;
    unit: string;
    unit_price_minor: number;
    line_total_minor: number;
    vat_included: boolean;
    sort_order: number;
  }[];
}

/**
 * What the outbox sends for a draft: the lines that are complete so far (a
 * half-typed line stays on the device until it is valid). Null while the draft
 * has no customer, as the server requires one.
 */
export function toServerDraft(quote: LocalQuote, vatRateBp: number): ServerDraftPayload | null {
  if (!quote.customerId) return null;
  const discount = discountValue(quote);
  const lines = quote.lines.flatMap((l) => {
    const input = lineInput(l);
    return input ? [input] : [];
  });
  const totals = computeQuoteTotals({
    lines,
    discountType: discount.type,
    discountValue: discount.value,
    vatRateBp,
  });
  return {
    id: quote.id,
    business_id: quote.businessId,
    customer_id: quote.customerId,
    title: quote.title.trim().slice(0, 200) || null,
    notes: quote.notes.trim().slice(0, 4000) || null,
    valid_until: quote.validUntil,
    discount_type: discount.type,
    discount_value: discount.value,
    vat_rate_bp: totals.vatRateBp,
    subtotal_minor: totals.subtotalMinor,
    discount_minor: totals.discountMinor,
    vat_minor: totals.vatMinor,
    total_minor: totals.totalMinor,
    items: lines.map((l, i) => ({
      id: l.id,
      service_id: l.serviceId,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price_minor: l.unitPriceMinor,
      line_total_minor: totals.lineTotalsMinor[i]!,
      vat_included: l.vatIncluded,
      sort_order: i,
    })),
  };
}

/** Field errors keyed like "lines.0.quantity", "customerId", "discountValue". */
export type QuoteFieldErrors = Partial<Record<string, ErrorKey>>;

/** Checks everything a sent quote needs, with the shared schema (the server checks again). */
export function validateForSend(quote: LocalQuote): QuoteFieldErrors {
  const discount = discountValue(quote);
  const parsed = QuoteSendableSchema.safeParse({
    id: quote.id,
    customerId: quote.customerId ?? '',
    title: quote.title,
    notes: quote.notes,
    discountType: discount.type,
    discountValue: discount.value,
    lines: quote.lines.map((l) => ({
      id: l.id,
      serviceId: l.serviceId,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceMinor: parseMoneyInput(l.priceText) ?? Number.NaN,
      vatIncluded: l.vatIncluded,
    })),
  });
  const errors: QuoteFieldErrors = {};
  if (!discount.valid)
    errors.discountValue =
      quote.discountType === 'percent' ? 'discount_percent_invalid' : 'discount_invalid';
  if (parsed.success) return errors;
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.');
    const field = issue.path.at(-1);
    errors[key] ??= (
      field === 'unitPriceMinor' && !issue.message.startsWith('price_')
        ? 'price_invalid'
        : issue.message
    ) as ErrorKey;
  }
  return errors;
}

export type QuoteFilter = 'all' | QuoteStatus;

/** Newest first; a filter keeps one status. */
export function filterQuotes<T extends LocalQuote>(quotes: readonly T[], filter: QuoteFilter): T[] {
  return quotes
    .filter((q) => filter === 'all' || q.status === filter)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type TimelineEvent =
  'created' | 'sent' | 'viewed' | 'approved' | 'rejected' | 'cancelled' | 'superseded' | 'expired';

/** The quote's history, oldest first, from its timestamps. */
export function quoteTimeline(
  quote: LocalQuote,
  now: Date = new Date(),
): { event: TimelineEvent; at: string }[] {
  const events: { event: TimelineEvent; at: string | null }[] = [
    { event: 'created', at: quote.createdAt },
    { event: 'sent', at: quote.sentAt },
    { event: 'viewed', at: quote.viewedAt },
    { event: 'approved', at: quote.approvedAt },
    { event: 'rejected', at: quote.rejectedAt },
    { event: 'cancelled', at: quote.cancelledAt },
    { event: 'superseded', at: quote.supersededAt },
  ];
  const open = quote.status === 'sent' || quote.status === 'viewed' || quote.status === 'expired';
  if (open && quote.tokenExpiresAt && new Date(quote.tokenExpiresAt) <= now)
    events.push({ event: 'expired', at: quote.tokenExpiresAt });
  return events
    .filter((e): e is { event: TimelineEvent; at: string } => e.at !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
}
