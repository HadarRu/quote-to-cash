import {
  isUnpaidInvoice,
  type InvoiceSnapshot,
  type InvoiceStatus,
  type PaymentMethod,
} from '@q2c/types';
import { format, strings } from '@q2c/ui';
import { formatDateIL, formatMoney, formatPhoneIL, whatsappUrl } from '@q2c/utils';

export interface InvoiceListItem {
  id: string;
  status: InvoiceStatus;
  /** Internal running number; the legal number is `documentNumber`. */
  invoiceNumber: number;
  documentNumber: string | null;
  totalMinor: number;
  customerName: string | null;
  customerPhone: string | null;
  jobTitle: string | null;
  createdAt: string;
  issuedAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  failureReason: string | null;
  paymentMethod: PaymentMethod | null;
  /** Null only for invoices created before invoicing existed (seed data). */
  snapshot: InvoiceSnapshot | null;
}

/** A job as the invoices screen lists it. */
export interface JobSummary {
  id: string;
  title: string;
  customerName: string | null;
  completedAt: string | null;
  totalMinor: number | null;
}

export type InvoiceFilter = 'unpaid' | 'all';

export function filterInvoices(invoices: InvoiceListItem[], filter: InvoiceFilter) {
  return filter === 'all' ? invoices : invoices.filter((i) => isUnpaidInvoice(i.status));
}

/** "חשבונית 30045", or a placeholder until the document is issued. */
export function invoiceLabel(invoice: Pick<InvoiceListItem, 'documentNumber'>): string {
  return invoice.documentNumber
    ? format(strings.invoices.label, { number: invoice.documentNumber })
    : strings.invoices.labelPending;
}

/**
 * Everything the owner needs to issue the document in their invoicing
 * software, as plain text to copy or share.
 */
export function invoiceDataSheet(invoice: InvoiceListItem): string {
  const s = invoice.snapshot;
  const t = strings.invoices;
  if (!s) return format(t.sheetReference, { number: invoice.invoiceNumber });
  const lines = [
    format(t.sheetBusiness, { name: s.business.name }),
    s.business.tax_id ? format(t.sheetTaxId, { id: s.business.tax_id }) : null,
    '',
    format(t.sheetCustomer, { name: s.customer.full_name }),
    format(t.sheetPhone, { phone: formatPhoneIL(s.customer.phone) }),
    s.customer.address ? format(t.sheetAddress, { address: s.customer.address }) : null,
    '',
    format(t.sheetJob, { title: s.job.title }),
    s.job.completed_at
      ? format(t.sheetCompleted, { date: formatDateIL(s.job.completed_at) })
      : null,
    s.quote_number ? format(t.sheetQuote, { number: s.quote_number }) : null,
    '',
    t.sheetItems,
    ...s.items.map(
      (item) =>
        format(t.sheetLine, {
          description: item.description,
          quantity: item.quantity,
          price: formatMoney(item.unit_price_minor),
          total: formatMoney(item.line_total_minor),
        }) + (item.vat_included ? ` ${t.sheetVatIncluded}` : ''),
    ),
    '',
    format(t.sheetSubtotal, { amount: formatMoney(s.totals.subtotal_minor) }),
    s.totals.discount_minor > 0
      ? format(t.sheetDiscount, { amount: formatMoney(s.totals.discount_minor) })
      : null,
    s.totals.vat_rate_bp > 0
      ? format(t.sheetVat, {
          rate: s.totals.vat_rate_bp / 100,
          amount: formatMoney(s.totals.vat_minor),
        })
      : t.sheetNoVat,
    format(t.sheetTotal, { amount: formatMoney(s.totals.total_minor) }),
    '',
    format(t.sheetReference, { number: invoice.invoiceNumber }),
  ];
  return lines.filter((line) => line !== null).join('\n');
}

/** wa.me link with a prepared payment reminder, or null without a customer phone. */
export function paymentReminderUrl(invoice: InvoiceListItem, businessName: string): string | null {
  if (!invoice.customerPhone) return null;
  const message = format(strings.invoices.reminderMessage, {
    customer: invoice.customerName ?? '',
    business: businessName,
    number: invoice.documentNumber ?? invoice.invoiceNumber,
    amount: formatMoney(invoice.totalMinor),
    job: invoice.jobTitle ?? '',
  });
  return `${whatsappUrl(invoice.customerPhone)}?text=${encodeURIComponent(message)}`;
}
