import { describe, expect, it } from 'vitest';
import { fromInvoiceRow, jobsToInvoice } from './api';
import {
  filterInvoices,
  invoiceDataSheet,
  invoiceLabel,
  paymentReminderUrl,
  type InvoiceListItem,
} from './model';

const snapshot = {
  quote_number: 7,
  business: {
    name: 'כהן חשמל',
    tax_status: 'osek_murshe' as const,
    tax_id: '123456789',
    phone: '+972500000001',
    email: null,
    logo_path: null,
  },
  customer: { full_name: 'משה ישראלי', phone: '+972541112222', address: 'הרצל 5, חיפה' },
  items: [
    {
      description: 'גוף תאורה',
      quantity: '2',
      unit: 'unit',
      unit_price_minor: 20000,
      vat_included: false,
      line_total_minor: 40000,
    },
    {
      description: 'חיווט',
      quantity: '12.5',
      unit: 'meter',
      unit_price_minor: 1600,
      vat_included: true,
      line_total_minor: 20000,
    },
  ],
  discount_type: 'amount' as const,
  discount_value: 5000,
  totals: {
    subtotal_minor: 60000,
    discount_minor: 5000,
    vat_rate_bp: 1800,
    vat_minor: 9900,
    total_minor: 64900,
  },
  job: { title: 'תאורה בחצר', completed_at: '2026-10-04T10:00:00Z' },
};

const row = {
  id: 'inv-1',
  status: 'issued' as const,
  invoice_number: 12,
  document_number: '30045',
  total_minor: 64900,
  created_at: '2026-10-04T11:00:00Z',
  issued_at: '2026-10-04T12:00:00Z',
  sent_at: null,
  paid_at: null,
  voided_at: null,
  failure_reason: null,
  snapshot,
  customer: { full_name: 'שם ישן', phone_e164: '+972500000009' },
  job: { title: 'כותרת ישנה' },
  payment: [],
};
const invoice: InvoiceListItem = fromInvoiceRow(row);

describe('fromInvoiceRow', () => {
  it('takes the customer and job from the invoice snapshot', () => {
    expect(invoice).toMatchObject({
      customerName: 'משה ישראלי',
      customerPhone: '+972541112222',
      jobTitle: 'תאורה בחצר',
      paymentMethod: null,
    });
  });

  it('reads the method of the succeeded payment', () => {
    const paid = fromInvoiceRow({
      ...row,
      status: 'paid',
      payment: [{ method: 'bit', status: 'succeeded', paid_at: '2026-10-05T08:00:00Z' }],
    });
    expect(paid.paymentMethod).toBe('bit');
  });
});

describe('invoiceDataSheet', () => {
  it('lists business, customer, job, lines and totals for the owner to copy', () => {
    const sheet = invoiceDataSheet(invoice);
    expect(sheet).toContain('עסק: כהן חשמל');
    expect(sheet).toContain('ע.מ / ח.פ: 123456789');
    expect(sheet).toContain('לקוח: משה ישראלי');
    expect(sheet).toContain('טלפון: 054-111-2222');
    expect(sheet).toContain('כתובת: הרצל 5, חיפה');
    expect(sheet).toContain('עבודה: תאורה בחצר');
    expect(sheet).toContain('לפי הצעת מחיר 7');
    expect(sheet).toMatch(/גוף תאורה: 2 × .*200\.00.* = .*400\.00/);
    expect(sheet).toMatch(/חיווט: 12\.5 × .* \(כולל מע״מ\)$/m);
    expect(sheet).toMatch(/הנחה: .*50\.00/);
    expect(sheet).toMatch(/מע״מ \(18%\): .*99\.00/);
    expect(sheet).toMatch(/סה״כ לתשלום: .*649\.00/);
    expect(sheet).toContain('מספר פנימי: 12');
  });

  it('says there is no VAT for an exempt dealer and skips an empty discount', () => {
    const sheet = invoiceDataSheet({
      ...invoice,
      snapshot: {
        ...snapshot,
        totals: { ...snapshot.totals, discount_minor: 0, vat_rate_bp: 0, vat_minor: 0 },
      },
    });
    expect(sheet).toContain('ללא מע״מ');
    expect(sheet).not.toContain('הנחה:');
  });
});

describe('payment reminder', () => {
  it('prepares a WhatsApp message with the document number, amount and job', () => {
    const url = new URL(paymentReminderUrl(invoice, 'כהן חשמל')!);
    expect(url.origin + url.pathname).toBe('https://wa.me/972541112222');
    const text = url.searchParams.get('text')!;
    expect(text).toContain('שלום משה ישראלי, כאן כהן חשמל');
    expect(text).toContain('חשבונית 30045');
    expect(text).toMatch(/649\.00/);
    expect(text).toContain('"תאורה בחצר"');
  });

  it('has no link without a customer phone', () => {
    expect(paymentReminderUrl({ ...invoice, customerPhone: null }, 'x')).toBeNull();
  });
});

describe('lists', () => {
  it('shows only issued and sent invoices as unpaid', () => {
    const all = (['not_issued', 'issued', 'sent', 'paid', 'failed', 'voided'] as const).map(
      (status) => ({ ...invoice, id: status, status }),
    );
    expect(filterInvoices(all, 'unpaid').map((i) => i.id)).toEqual(['issued', 'sent']);
    expect(filterInvoices(all, 'all')).toHaveLength(6);
  });

  it('labels an invoice by its document number once issued', () => {
    expect(invoiceLabel(invoice)).toBe('חשבונית 30045');
    expect(invoiceLabel({ documentNumber: null })).toBe('חשבונית (טרם הופקה)');
  });

  it('offers completed jobs with no live invoice to invoice', () => {
    const job = {
      title: 'עבודה',
      completed_at: null,
      customer: { full_name: 'דנה' },
      quote: { total_minor: 100 },
    };
    const toInvoice = jobsToInvoice([
      { ...job, id: 'scheduled', status: 'scheduled', invoice: [] },
      { ...job, id: 'none', status: 'completed', invoice: [] },
      {
        ...job,
        id: 'voided',
        status: 'completed',
        invoice: [{ status: 'voided', deleted_at: null }],
      },
      {
        ...job,
        id: 'live',
        status: 'completed',
        invoice: [{ status: 'not_issued', deleted_at: null }],
      },
    ]);
    expect(toInvoice.map((j) => j.id)).toEqual(['none', 'voided']);
    expect(toInvoice[0]).toEqual({
      id: 'none',
      title: 'עבודה',
      customerName: 'דנה',
      completedAt: null,
      totalMinor: 100,
    });
  });
});
