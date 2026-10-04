import type { InvoiceDocument, InvoiceProvider, InvoiceProviderResult } from '@q2c/types';

/**
 * No external service: the owner issues the legal document in their own
 * invoicing software, copying the invoice's data sheet from the app, then
 * records the document's number here (recordIssued). Sending and payment are
 * recorded by the owner too, as for every provider.
 *
 * TODO(tax-authority): no Israeli Tax Authority logic (allocation numbers /
 * מספר הקצאה, document types, numbering rules). With this provider the owner's
 * invoicing software is responsible for it; a real provider must handle it.
 */
export class ManualInvoiceProvider implements InvoiceProvider {
  readonly id = 'manual' as const;

  /** Nothing to create anywhere: the invoice stays NOT_ISSUED until the owner records a number. */
  createInvoice(invoice: InvoiceDocument): Promise<InvoiceProviderResult> {
    return Promise.resolve({ status: invoice.status });
  }

  /** The status is whatever the owner recorded. */
  getStatus(invoice: InvoiceDocument): Promise<InvoiceProviderResult> {
    return Promise.resolve({ status: invoice.status, documentNumber: invoice.documentNumber });
  }

  /** Nothing to cancel remotely; the owner cancels the document in their own software. */
  voidInvoice(): Promise<InvoiceProviderResult> {
    return Promise.resolve({ status: 'voided' });
  }

  /** The owner issued the document elsewhere and typed its number. */
  recordIssued(documentNumber: string): InvoiceProviderResult {
    return { status: 'issued', documentNumber };
  }
}
