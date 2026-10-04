import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { AppSupabaseClient } from '../lib/supabase';
import { fromServerRow, quotePhotoPath, supabaseQuotesApi } from './api.ts';

type Row = Parameters<typeof fromServerRow>[0];

const row: Row = {
  id: 'q1',
  business_id: 'b1',
  customer_id: 'c1',
  status: 'sent',
  quote_number: 12,
  title: null,
  notes: 'הערה',
  valid_until: '2026-10-20',
  discount_type: 'percent',
  discount_value: 1250,
  revision: 2,
  supersedes_quote_id: 'q0',
  subtotal_minor: 25050,
  discount_minor: 3131,
  vat_rate_bp: 1800,
  vat_minor: 3945,
  total_minor: 25864,
  created_at: '2026-10-01T08:00:00Z',
  updated_at: '2026-10-02T08:00:00Z',
  sent_at: '2026-10-02T08:00:00Z',
  viewed_at: null,
  approved_at: null,
  rejected_at: null,
  cancelled_at: null,
  superseded_at: null,
  token_expires_at: '2026-10-20T20:59:59Z',
  customer: { full_name: 'דנה', phone_e164: '+972541112222' },
  quote_item: [
    {
      id: 'i2',
      service_id: null,
      description: 'שני',
      quantity: 1.5,
      unit: 'hour',
      unit_price_minor: 10000,
      vat_included: true,
      sort_order: 1,
      deleted_at: null,
    },
    {
      id: 'gone',
      service_id: null,
      description: 'נמחק',
      quantity: 1,
      unit: 'unit',
      unit_price_minor: 1,
      vat_included: false,
      sort_order: 0,
      deleted_at: '2026-10-01T09:00:00Z',
    },
    {
      id: 'i1',
      service_id: 's1',
      description: 'ראשון',
      quantity: 1,
      unit: 'point',
      unit_price_minor: 25050,
      vat_included: false,
      sort_order: 0,
      deleted_at: null,
    },
  ],
  quote_slot_option: [
    {
      id: 's2',
      starts_at: '2026-10-08T07:00:00Z',
      ends_at: '2026-10-08T09:00:00Z',
      status: 'offered',
      sort_order: 1,
      deleted_at: null,
    },
    {
      id: 'old',
      starts_at: '2026-10-06T07:00:00Z',
      ends_at: '2026-10-06T09:00:00Z',
      status: 'offered',
      sort_order: 0,
      deleted_at: '2026-10-02T07:00:00Z',
    },
    {
      id: 's1',
      starts_at: '2026-10-07T07:00:00Z',
      ends_at: '2026-10-07T09:00:00Z',
      status: 'selected',
      sort_order: 0,
      deleted_at: null,
    },
  ],
};

describe('fromServerRow', () => {
  it('turns a server quote into the editor’s text fields, in line order, without deleted lines', () => {
    const quote = fromServerRow(row);
    expect(quote).toMatchObject({
      title: '',
      notes: 'הערה',
      customerName: 'דנה',
      discountType: 'percent',
      discountText: '12.5',
      serverTotals: { totalMinor: 25864, vatRateBp: 1800 },
    });
    expect(quote.lines.map((l) => [l.id, l.quantity, l.priceText, l.vatIncluded])).toEqual([
      ['i1', '1', '250.5', false],
      ['i2', '1.5', '100', true],
    ]);
  });

  it('keeps the offered visit times in order, without deleted ones', () => {
    expect(fromServerRow(row).slots).toEqual([
      {
        id: 's1',
        startsAt: '2026-10-07T07:00:00Z',
        endsAt: '2026-10-07T09:00:00Z',
        status: 'selected',
      },
      {
        id: 's2',
        startsAt: '2026-10-08T07:00:00Z',
        endsAt: '2026-10-08T09:00:00Z',
        status: 'offered',
      },
    ]);
  });

  it('shows an amount discount in shekels and none as empty', () => {
    expect(
      fromServerRow({ ...row, discount_type: 'amount', discount_value: 5050 }).discountText,
    ).toBe('50.5');
    expect(fromServerRow({ ...row, discount_type: 'none', discount_value: 0 }).discountText).toBe(
      '',
    );
  });

  it('copes with a customer the user can no longer see', () => {
    expect(fromServerRow({ ...row, customer: null })).toMatchObject({
      customerName: null,
      customerPhone: null,
    });
  });
});

describe('quotePhotoPath', () => {
  it('keeps photos under the business folder the Storage policies check', () => {
    expect(quotePhotoPath('b1', 'q1', 'p1')).toBe('b1/quotes/q1/p1.jpg');
  });
});

function apiWith(invoke: (...args: unknown[]) => Promise<unknown>, rpcError: unknown = null) {
  const supabase = {
    functions: { invoke: vi.fn(invoke) },
    rpc: vi.fn(async () => ({ error: rpcError })),
  } as unknown as AppSupabaseClient;
  return { api: supabaseQuotesApi(supabase), supabase };
}

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status }));

describe('supabaseQuotesApi.send', () => {
  it('calls the quotes function with the send key', async () => {
    const data = {
      quoteNumber: 3,
      sentAt: 'x',
      url: 'u',
      whatsappUrl: 'w',
      alreadySent: false,
    };
    const { api, supabase } = apiWith(async () => ({ data, error: null }));
    expect(await api.send('q1', 'k1', undefined)).toEqual({ data, error: null });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('quotes/q1/send', {
      method: 'POST',
      body: { sendKey: 'k1' },
    });
    const slots = [{ startsAt: '2026-10-07T07:00:00Z', endsAt: '2026-10-07T09:00:00Z' }];
    await api.send('q1', 'k2', slots);
    expect(supabase.functions.invoke).toHaveBeenLastCalledWith('quotes/q1/send', {
      method: 'POST',
      body: { sendKey: 'k2', slots },
    });
  });

  it.each([
    [409, { error: 'quote_not_draft' }, 'quote_not_draft', false],
    [422, { error: 'quote_lines_required' }, 'quote_lines_required', false],
    [404, { error: 'quote_not_found' }, 'quote_not_found', false],
    [429, { error: 'rate_limited' }, 'rate_limited', true],
    [500, { error: 'internal_error' }, 'internal_error', true],
    [502, 'gateway', undefined, true],
  ])('HTTP %i → code %s, retryable %s', async (status, body, code, retryable) => {
    const { api } = apiWith(async () => ({ data: null, error: httpError(status, body) }));
    const result = await api.send('q1', 'k1', undefined);
    expect(result.error).toMatchObject({ code, retryable });
  });

  it('treats a request that may not have arrived as retryable', async () => {
    const relay = apiWith(async () => ({
      data: null,
      error: new FunctionsFetchError(new TypeError('Network request failed')),
    }));
    expect((await relay.api.send('q1', 'k1', undefined)).error?.retryable).toBe(true);
    const thrown = apiWith(async () => {
      throw new TypeError('Network request failed');
    });
    expect((await thrown.api.send('q1', 'k1', undefined)).error?.retryable).toBe(true);
  });
});

describe('supabaseQuotesApi RPC errors', () => {
  it('a refusal is final; a network failure is retried', async () => {
    const refused = apiWith(async () => null, { code: '55000', message: 'not a draft' }).api;
    expect((await refused.cancel('q1')).error).toEqual({
      code: '55000',
      message: 'not a draft',
      retryable: false,
    });
    const offline = apiWith(async () => null, { message: 'TypeError: fetch failed' }).api;
    expect((await offline.revise('q1', 'q2')).error?.retryable).toBe(true);
  });
});
