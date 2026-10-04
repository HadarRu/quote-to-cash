import { InvoiceProviderRegistry } from '@q2c/types';
import { ManualInvoiceProvider } from './manual.ts';

export { ManualInvoiceProvider };

/**
 * Every provider a business can select (business_settings.invoice_provider).
 * A real provider is added here once it implements InvoiceProvider, with its
 * id added to INVOICE_PROVIDER_IDS and the database check constraints.
 */
export function invoiceProviders(): InvoiceProviderRegistry {
  return new InvoiceProviderRegistry([new ManualInvoiceProvider()]);
}
