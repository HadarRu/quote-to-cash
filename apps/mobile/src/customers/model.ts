import { CustomerSchema, QuickCustomerSchema, type CustomerInput } from '@q2c/types';
import type { ErrorKey } from '@q2c/ui';
import { phoneMatches, searchText, textMatches } from '@q2c/utils';

export interface CustomerListItem {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  updatedAt: string;
}

export interface CustomerAddress {
  id: string;
  street: string;
  houseNumber: string | null;
  apartment: string | null;
  city: string;
  postalCode: string | null;
  accessNotes: string | null;
  isPrimary: boolean;
}

export interface CustomerQuoteSummary {
  id: string;
  quoteNumber: number;
  title: string | null;
  status: string;
  totalMinor: number;
  createdAt: string;
}

export interface CustomerDetail extends CustomerListItem {
  notes: string | null;
  deletedAt: string | null;
  addresses: CustomerAddress[];
  quotes: CustomerQuoteSummary[];
}

/**
 * Search by name (every word must appear) or by any part of the phone number
 * in any common format. Keeps the incoming order (most recent first).
 */
export function filterCustomers(
  customers: readonly CustomerListItem[],
  query: string,
): CustomerListItem[] {
  if (!searchText(query)) return [...customers];
  return customers.filter((c) => textMatches(c.fullName, query) || phoneMatches(c.phone, query));
}

/** Prefill for "add customer" from a search that found nothing: digits go to phone, text to name. */
export function prefillFromQuery(query: string): { fullName: string; phone: string } {
  const q = query.trim();
  return /^[\d\s()+-]+$/.test(q) && /\d/.test(q)
    ? { fullName: '', phone: q }
    : { fullName: q, phone: '' };
}

/** Raw text of the form (what the inputs hold). */
export interface CustomerFormValues {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  notes: string;
  /** null = no address section. */
  address: {
    id: string;
    street: string;
    houseNumber: string;
    apartment: string;
    city: string;
    postalCode: string;
    accessNotes: string;
  } | null;
}

export type CustomerFormField =
  | 'fullName'
  | 'phone'
  | 'email'
  | 'notes'
  | 'address.street'
  | 'address.houseNumber'
  | 'address.apartment'
  | 'address.city'
  | 'address.postalCode'
  | 'address.accessNotes';

export type CustomerFieldErrors = Partial<Record<CustomerFormField, ErrorKey>>;

/** Validates with the shared schema; `quick` checks name and phone only. */
export function validateCustomerForm(
  values: CustomerFormValues,
  mode: 'full' | 'quick',
): { ok: true; data: CustomerInput } | { ok: false; fieldErrors: CustomerFieldErrors } {
  const input =
    mode === 'quick'
      ? { id: values.id, fullName: values.fullName, phone: values.phone }
      : {
          id: values.id,
          fullName: values.fullName,
          phone: values.phone,
          email: values.email,
          notes: values.notes,
          address: values.address ?? undefined,
        };
  const parsed = (mode === 'quick' ? QuickCustomerSchema : CustomerSchema).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: CustomerFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.join('.') as CustomerFormField;
    fieldErrors[field] ??= issue.message as ErrorKey;
  }
  return { ok: false, fieldErrors };
}

/** Form values for editing an existing customer (primary address only). */
export function formValuesFromDetail(detail: CustomerDetail): CustomerFormValues {
  const primary = detail.addresses.find((a) => a.isPrimary) ?? detail.addresses[0];
  return {
    id: detail.id,
    fullName: detail.fullName,
    phone: detail.phone,
    email: detail.email ?? '',
    notes: detail.notes ?? '',
    address: primary
      ? {
          id: primary.id,
          street: primary.street,
          houseNumber: primary.houseNumber ?? '',
          apartment: primary.apartment ?? '',
          city: primary.city,
          postalCode: primary.postalCode ?? '',
          accessNotes: primary.accessNotes ?? '',
        }
      : null,
  };
}
