import { describe, expect, it } from 'vitest';
import {
  businessVatRateBp,
  canQuote,
  QuoteDraftSchema,
  QuoteSendableSchema,
  SendQuoteRequestSchema,
  type QuoteStatus,
} from './quote.ts';

const ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
const line = {
  id: '6f9619ff-8b86-4d11-b42d-00c04fc96401',
  serviceId: null,
  description: ' נקודת חשמל ',
  quantity: '1.5',
  unit: 'point',
  unitPriceMinor: 25000,
  vatIncluded: false,
};
const draft = {
  id: ID,
  customerId: '6f9619ff-8b86-4d11-b42d-00c04fc96402',
  title: '',
  discountType: 'none' as const,
  discountValue: 0,
  lines: [line],
};

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe('quote state transitions', () => {
  const all: QuoteStatus[] = [
    'draft',
    'sent',
    'viewed',
    'approved',
    'rejected',
    'expired',
    'cancelled',
    'superseded',
  ];
  const allowed = (action: Parameters<typeof canQuote>[0]) =>
    all.filter((status) => canQuote(action, status));

  it('only drafts are editable and sendable', () => {
    expect(allowed('edit')).toEqual(['draft']);
    expect(allowed('send')).toEqual(['draft']);
  });

  it('sent quotes not yet decided can be revised', () => {
    expect(allowed('revise')).toEqual(['sent', 'viewed', 'rejected', 'expired']);
  });

  it('approved, cancelled and superseded quotes cannot be cancelled', () => {
    expect(allowed('cancel')).toEqual(['draft', 'sent', 'viewed', 'rejected', 'expired']);
  });
});

describe('QuoteDraftSchema', () => {
  it('accepts a draft, trims text and drops an empty title', () => {
    const parsed = QuoteDraftSchema.parse(draft);
    expect(parsed.title).toBeUndefined();
    expect(parsed.lines[0]?.description).toBe('נקודת חשמל');
  });

  it('accepts decimal quantities up to 3 places only', () => {
    for (const quantity of ['1', '0.5', '2.125', '999999999.999']) {
      expect(QuoteDraftSchema.safeParse({ ...draft, lines: [{ ...line, quantity }] }).success).toBe(
        true,
      );
    }
    for (const quantity of ['0', '0.000', '-1', '1.2345', 'abc', '', '1,5']) {
      const result = QuoteDraftSchema.safeParse({ ...draft, lines: [{ ...line, quantity }] });
      expect(messages(result)).toContain('quantity_invalid');
    }
  });

  it('requires a customer and a description on every line', () => {
    const result = QuoteDraftSchema.safeParse({
      ...draft,
      customerId: '',
      lines: [{ ...line, description: '  ' }],
    });
    expect(messages(result)).toEqual(['quote_customer_required', 'line_description_required']);
  });

  it('rejects negative prices and discounts, and percents above 100%', () => {
    expect(
      messages(QuoteDraftSchema.safeParse({ ...draft, lines: [{ ...line, unitPriceMinor: -1 }] })),
    ).toContain('price_negative');
    expect(messages(QuoteDraftSchema.safeParse({ ...draft, discountValue: -5 }))).toContain(
      'discount_invalid',
    );
    expect(
      messages(
        QuoteDraftSchema.safeParse({ ...draft, discountType: 'percent', discountValue: 10001 }),
      ),
    ).toEqual(['discount_percent_invalid']);
    expect(
      QuoteDraftSchema.safeParse({ ...draft, discountType: 'percent', discountValue: 10000 })
        .success,
    ).toBe(true);
  });

  it('a draft may have no lines, but a sent quote needs one', () => {
    expect(QuoteDraftSchema.safeParse({ ...draft, lines: [] }).success).toBe(true);
    expect(messages(QuoteSendableSchema.safeParse({ ...draft, lines: [] }))).toEqual([
      'quote_lines_required',
    ]);
  });
});

describe('send request and VAT', () => {
  it('requires a UUID send key', () => {
    expect(SendQuoteRequestSchema.safeParse({ sendKey: ID }).success).toBe(true);
    expect(SendQuoteRequestSchema.safeParse({ sendKey: 'again' }).success).toBe(false);
  });

  it('an exempt dealer charges no VAT', () => {
    expect(businessVatRateBp('osek_patur', 1800)).toBe(0);
    expect(businessVatRateBp('osek_murshe', 1800)).toBe(1800);
    expect(businessVatRateBp('company', 1700)).toBe(1700);
  });
});
