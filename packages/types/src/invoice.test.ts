import { describe, expect, it } from 'vitest';
import {
  canTransitionInvoice,
  CreateInvoiceRequestSchema,
  INVOICE_STATUSES,
  InvoiceProviderRegistry,
  isUnpaidInvoice,
  IssueInvoiceRequestSchema,
  MarkInvoicePaidRequestSchema,
  VoidInvoiceRequestSchema,
  type InvoiceProvider,
  type InvoiceStatus,
} from './invoice.ts';

const ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe('invoice status transitions', () => {
  const allowed: [InvoiceStatus, InvoiceStatus][] = [
    ['not_issued', 'issued'],
    ['not_issued', 'failed'],
    ['not_issued', 'voided'],
    ['failed', 'issued'],
    ['failed', 'voided'],
    ['issued', 'sent'],
    ['issued', 'paid'],
    ['issued', 'voided'],
    ['sent', 'paid'],
    ['sent', 'voided'],
  ];

  it('allows exactly the listed moves', () => {
    for (const from of INVOICE_STATUSES) {
      for (const to of INVOICE_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransitionInvoice(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('cannot be paid before it is issued', () => {
    expect(canTransitionInvoice('not_issued', 'paid')).toBe(false);
    expect(canTransitionInvoice('failed', 'paid')).toBe(false);
  });

  it('keeps PAID and VOIDED final (void instead of delete, no void after payment)', () => {
    for (const to of INVOICE_STATUSES) {
      expect(canTransitionInvoice('paid', to)).toBe(false);
      expect(canTransitionInvoice('voided', to)).toBe(false);
    }
  });

  it('lists issued and sent invoices as unpaid', () => {
    expect(INVOICE_STATUSES.filter(isUnpaidInvoice)).toEqual(['issued', 'sent']);
  });
});

describe('InvoiceProviderRegistry', () => {
  const manual: InvoiceProvider = {
    id: 'manual',
    createInvoice: () => Promise.resolve({ status: 'not_issued' }),
    getStatus: (invoice) => Promise.resolve({ status: invoice.status }),
    voidInvoice: () => Promise.resolve({ status: 'voided' }),
  };

  it('returns the provider a business selected', () => {
    expect(new InvoiceProviderRegistry([manual]).get('manual')).toBe(manual);
  });

  it('throws for a provider that is not registered', () => {
    expect(() => new InvoiceProviderRegistry([manual]).get('green-invoice')).toThrow(
      'unknown invoice provider',
    );
  });
});

describe('invoice requests', () => {
  it('needs a job and an idempotency key', () => {
    expect(CreateInvoiceRequestSchema.safeParse({ jobId: ID, idempotencyKey: ID }).success).toBe(
      true,
    );
    expect(
      messages(CreateInvoiceRequestSchema.safeParse({ jobId: 'x', idempotencyKey: ID })),
    ).toEqual(['job_id_invalid']);
    expect(messages(CreateInvoiceRequestSchema.safeParse({ jobId: ID }))).toEqual([
      'idempotency_key_invalid',
    ]);
  });

  it('trims the document number and requires it', () => {
    expect(IssueInvoiceRequestSchema.parse({ documentNumber: ' 30045 ' })).toEqual({
      documentNumber: '30045',
    });
    expect(messages(IssueInvoiceRequestSchema.safeParse({ documentNumber: '  ' }))).toEqual([
      'document_number_required',
    ]);
    expect(messages(IssueInvoiceRequestSchema.safeParse({}))).toEqual(['document_number_required']);
    expect(
      messages(IssueInvoiceRequestSchema.safeParse({ documentNumber: '1'.repeat(51) })),
    ).toEqual(['document_number_too_long']);
  });

  it('needs a known payment method to mark paid', () => {
    expect(MarkInvoicePaidRequestSchema.safeParse({ method: 'bit' }).success).toBe(true);
    expect(
      MarkInvoicePaidRequestSchema.safeParse({ method: 'cash', paidAt: '2026-10-04T09:00:00Z' })
        .success,
    ).toBe(true);
    expect(messages(MarkInvoicePaidRequestSchema.safeParse({ method: 'gold' }))).toEqual([
      'payment_method_required',
    ]);
    expect(
      messages(MarkInvoicePaidRequestSchema.safeParse({ method: 'cash', paidAt: 'yesterday' })),
    ).toEqual(['paid_at_invalid']);
  });

  it('makes the void reason optional', () => {
    expect(VoidInvoiceRequestSchema.parse({})).toEqual({ reason: null });
    expect(VoidInvoiceRequestSchema.parse({ reason: ' נרשם בטעות ' })).toEqual({
      reason: 'נרשם בטעות',
    });
  });
});
