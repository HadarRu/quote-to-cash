import { describe, expect, it } from 'vitest';
import {
  discountValue,
  displayTotals,
  filterQuotes,
  newDraft,
  parsePercentInput,
  quoteTimeline,
  toServerDraft,
  validateForSend,
  type LocalLine,
  type LocalQuote,
} from './model.ts';

const line = (over: Partial<LocalLine> = {}): LocalLine => ({
  id: '6f9619ff-8b86-4d11-b42d-00c04fc96401',
  serviceId: null,
  description: 'נקודת חשמל',
  quantity: '2',
  priceText: '250',
  unit: 'point',
  vatIncluded: false,
  ...over,
});
const base = newDraft({
  id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
  businessId: 'b1',
  customer: { id: '6f9619ff-8b86-4d11-b42d-00c04fc96402', fullName: 'דנה', phone: '+972541112222' },
  now: '2026-10-03T08:00:00Z',
});
const quote = (over: Partial<LocalQuote> = {}): LocalQuote => ({
  ...base,
  lines: [line()],
  ...over,
});

describe('discounts as typed', () => {
  it('reads percents with up to 2 decimals', () => {
    expect(parsePercentInput('10')).toBe(1000);
    expect(parsePercentInput('12.5%')).toBe(1250);
    expect(parsePercentInput('1.234')).toBeNull();
    expect(parsePercentInput('abc')).toBeNull();
  });

  it('turns the typed discount into what is stored', () => {
    expect(discountValue({ discountType: 'percent', discountText: '10' })).toEqual({
      type: 'percent',
      value: 1000,
      valid: true,
    });
    expect(discountValue({ discountType: 'amount', discountText: '150' })).toEqual({
      type: 'amount',
      value: 15000,
      valid: true,
    });
    expect(discountValue({ discountType: 'percent', discountText: '' }).type).toBe('none');
    expect(discountValue({ discountType: 'percent', discountText: '120' }).valid).toBe(false);
  });
});

describe('toServerDraft', () => {
  it('sends complete lines with totals and keeps half-typed lines on the device', () => {
    const payload = toServerDraft(
      quote({
        discountType: 'percent',
        discountText: '10',
        lines: [
          line(),
          line({ id: '6f9619ff-8b86-4d11-b42d-00c04fc96403', description: '' }),
          line({ id: '6f9619ff-8b86-4d11-b42d-00c04fc96404', quantity: '1.5', priceText: '10' }),
        ],
      }),
      1800,
    );
    expect(
      payload?.items.map((i) => [i.quantity, i.unit_price_minor, i.line_total_minor, i.sort_order]),
    ).toEqual([
      ['2', 25000, 50000, 0],
      ['1.5', 1000, 1500, 1],
    ]);
    expect(payload).toMatchObject({
      discount_type: 'percent',
      discount_value: 1000,
      subtotal_minor: 51500,
      discount_minor: 5150,
      total_minor: 54693,
    });
  });

  it('waits for a customer', () => {
    expect(toServerDraft(quote({ customerId: null }), 1800)).toBeNull();
  });
});

describe('validateForSend', () => {
  it('passes a complete quote', () => {
    expect(validateForSend(quote())).toEqual({});
  });

  it('points at each problem', () => {
    expect(
      validateForSend(
        quote({
          customerId: null,
          discountType: 'percent',
          discountText: '150',
          lines: [line({ description: ' ', quantity: '0', priceText: 'abc' })],
        }),
      ),
    ).toEqual({
      discountValue: 'discount_percent_invalid',
      customerId: 'quote_customer_required',
      'lines.0.description': 'line_description_required',
      'lines.0.quantity': 'quantity_invalid',
      'lines.0.unitPriceMinor': 'price_invalid',
    });
    expect(validateForSend(quote({ lines: [] }))).toEqual({ lines: 'quote_lines_required' });
  });
});

describe('totals shown', () => {
  it('live for drafts, the server totals once sent', () => {
    expect(displayTotals(quote(), 1800).totalMinor).toBe(59000);
    const serverTotals = {
      subtotalMinor: 1,
      discountMinor: 0,
      vatRateBp: 1800,
      vatMinor: 0,
      totalMinor: 1,
    };
    expect(displayTotals(quote({ status: 'sent', serverTotals }), 1800)).toBe(serverTotals);
  });
});

describe('list and timeline', () => {
  it('filters by status, newest first', () => {
    const a = quote({ id: 'a', status: 'sent', updatedAt: '2026-10-01T00:00:00Z' });
    const b = quote({ id: 'b', status: 'draft', updatedAt: '2026-10-03T00:00:00Z' });
    const c = quote({ id: 'c', status: 'sent', updatedAt: '2026-10-02T00:00:00Z' });
    expect(filterQuotes([a, b, c], 'all').map((q) => q.id)).toEqual(['b', 'c', 'a']);
    expect(filterQuotes([a, b, c], 'sent').map((q) => q.id)).toEqual(['c', 'a']);
  });

  it('builds the history from the timestamps, including expiry', () => {
    const sent = quote({
      status: 'viewed',
      sentAt: '2026-10-03T09:00:00Z',
      viewedAt: '2026-10-03T10:00:00Z',
      tokenExpiresAt: '2026-10-17T20:59:59Z',
    });
    expect(quoteTimeline(sent, new Date('2026-10-05T00:00:00Z')).map((e) => e.event)).toEqual([
      'created',
      'sent',
      'viewed',
    ]);
    expect(quoteTimeline(sent, new Date('2026-10-20T00:00:00Z')).map((e) => e.event)).toEqual([
      'created',
      'sent',
      'viewed',
      'expired',
    ]);
  });
});
