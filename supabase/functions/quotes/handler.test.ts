import { describe, expect, it, vi } from 'vitest';
import {
  handleQuotes,
  hashToken,
  toQuoteForSend,
  type Deps,
  type QuoteRow,
  type SendQuoteArgs,
  type SendQuoteRow,
} from './handler.ts';

const QUOTE_ID = '70000000-0000-4000-a000-000000000001';
const SEND_KEY = '71000000-0000-4000-a000-000000000001';
const USER_ID = '00000000-0000-4000-a000-000000000001';
const NOW = new Date('2026-10-03T09:00:00Z');

const row: QuoteRow = {
  id: QUOTE_ID,
  business_id: '10000000-0000-4000-a000-000000000001',
  status: 'draft',
  title: 'החלפת לוח',
  notes: null,
  valid_until: null,
  discount_type: 'percent',
  discount_value: 1000,
  revision: 1,
  business: {
    name: 'כהן חשמל',
    tax_status: 'osek_murshe',
    phone_e164: '+972521234567',
    email: null,
    tax_id: null,
    logo_path: 'b/logo.png',
    business_settings: [{ vat_rate_bp: 1800, quote_valid_days: 14 }],
  },
  customer: { full_name: 'דנה לוי', phone_e164: '+972541112222' },
  customer_address: { street: 'הרצל', house_number: '5', apartment: '3', city: 'חיפה' },
  quote_item: [
    {
      description: 'שקע',
      quantity: 2,
      unit: 'point',
      unit_price_minor: 25000,
      vat_included: false,
      sort_order: 2,
      deleted_at: null,
    },
    {
      description: 'הוסר',
      quantity: 1,
      unit: 'unit',
      unit_price_minor: 999,
      vat_included: false,
      sort_order: 0,
      deleted_at: '2026-10-01T00:00:00Z',
    },
    {
      description: 'חיווט',
      quantity: 1.5,
      unit: 'meter',
      unit_price_minor: 1000,
      vat_included: false,
      sort_order: 1,
      deleted_at: null,
    },
  ],
  file: [
    { storage_path: 'b/quotes/q/2.jpg', created_at: '2026-10-02T10:00:00Z', deleted_at: null },
    { storage_path: 'b/quotes/q/1.jpg', created_at: '2026-10-02T09:00:00Z', deleted_at: null },
    { storage_path: 'b/quotes/q/x.jpg', created_at: '2026-10-02T08:00:00Z', deleted_at: 'x' },
  ],
};

function request(
  body: unknown,
  init: { method?: string; auth?: string | null; path?: string } = {},
) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.auth !== null) headers.set('Authorization', init.auth ?? 'Bearer user-jwt');
  return new Request(`http://localhost${init.path ?? `/quotes/${QUOTE_ID}/send`}`, {
    method: init.method ?? 'POST',
    headers,
    body:
      init.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** A fake send_quote with the database's idempotency rules. */
function fakeDatabase() {
  let sent: { sendKey: string; number: number; sentAt: string; status: string } | null = null;
  let nextNumber = 7;
  const tokenHashes: string[] = [];
  const sendQuote = vi.fn(async (args: SendQuoteArgs) => {
    if (sent) {
      if (sent.sendKey !== args.p_send_key)
        return { data: null, error: { code: '55000', message: 'only draft quotes can be sent' } };
      const stored = sent.status === 'sent';
      if (stored) tokenHashes.push(args.p_token_hash);
      const data: SendQuoteRow = {
        quote_number: sent.number,
        sent_at: sent.sentAt,
        already_sent: true,
        token_stored: stored,
      };
      return { data, error: null };
    }
    sent = {
      sendKey: args.p_send_key,
      number: nextNumber++,
      sentAt: NOW.toISOString(),
      status: 'sent',
    };
    tokenHashes.push(args.p_token_hash);
    const data: SendQuoteRow = {
      quote_number: sent.number,
      sent_at: sent.sentAt,
      already_sent: false,
      token_stored: true,
    };
    return { data, error: null };
  });
  return {
    sendQuote,
    tokenHashes,
    markViewed: () => {
      if (sent) sent.status = 'viewed';
    },
  };
}

function deps(overrides: Partial<Deps> = {}) {
  const db = fakeDatabase();
  let counter = 0;
  const d: Deps = {
    tokenPepper: 'test-pepper',
    publicAppUrl: 'https://app.example.com/',
    getUserId: vi.fn(async () => USER_ID),
    loadQuote: vi.fn(async () => ({ data: toQuoteForSend(row), error: null })),
    sendQuote: db.sendQuote,
    now: () => NOW,
    randomBytes: (length) => new Uint8Array(length).fill(++counter),
    ...overrides,
  };
  return { d, db };
}

const send = async (d: Deps, body: unknown = { sendKey: SEND_KEY }) => {
  const res = await handleQuotes(request(body), d);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('quotes send handler', () => {
  it('sends with server-computed totals, a snapshot and a random token stored only as a peppered hash', async () => {
    const { d, db } = deps();
    const { status, body } = await send(d);
    expect(status).toBe(200);
    expect(body).toMatchObject({ quoteNumber: 7, alreadySent: false });

    const args = db.sendQuote.mock.calls[0]![0];
    expect(args.p_user_id).toBe(USER_ID);
    expect(args.p_send_key).toBe(SEND_KEY);
    // 2 × 250 + 1.5 × 10 = 515.00; 10% off = 463.50; + 18% VAT.
    expect(args.p_totals).toEqual({
      subtotal_minor: 51500,
      discount_minor: 5150,
      vat_rate_bp: 1800,
      vat_minor: 8343,
      total_minor: 54693,
    });
    expect(args.p_snapshot).toMatchObject({
      valid_until: '2026-10-17',
      customer: { full_name: 'דנה לוי', address: 'הרצל 5, דירה 3, חיפה' },
      items: [
        { description: 'חיווט', quantity: '1.5', line_total_minor: 1500 },
        { description: 'שקע', quantity: '2', line_total_minor: 50000 },
      ],
      photos: ['b/quotes/q/1.jpg', 'b/quotes/q/2.jpg'],
    });
    // Valid for 14 days, until the end of that day in Israel (UTC+3 in October).
    expect(args.p_token_expires_at).toBe('2026-10-17T20:59:59.000Z');

    const url = body.url as string;
    const token = url.split('/quote/')[1]!;
    expect(url).toBe(`https://app.example.com/quote/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_token_hash).toBe(await hashToken(token, 'test-pepper'));
    expect(args.p_token_hash).not.toBe(await hashToken(token, 'other-pepper'));
    expect(JSON.stringify(args)).not.toContain(token);
  });

  it('returns a wa.me link to the customer with the Hebrew message', async () => {
    const { d } = deps();
    const { body } = await send(d);
    const wa = new URL(body.whatsappUrl as string);
    expect(wa.origin + wa.pathname).toBe('https://wa.me/972541112222');
    expect(wa.searchParams.get('text')).toBe(
      `שלום דנה לוי, כאן כהן חשמל. הצעת מחיר מספר 7 מחכה לך כאן: ${body.url as string}`,
    );
  });

  it('is idempotent per send key: same number, and the retry gets a working link', async () => {
    const { d, db } = deps();
    const first = await send(d);
    const retry = await send(d);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ quoteNumber: 7, alreadySent: true });
    // The first response was lost, so the stored hash is now the retry's token.
    const retryToken = (retry.body.url as string).split('/quote/')[1]!;
    expect(retry.body.url).not.toBe(first.body.url);
    expect(db.tokenHashes.at(-1)).toBe(await hashToken(retryToken, 'test-pepper'));
  });

  it('a retry after the customer opened the quote keeps their link and returns no new one', async () => {
    const { d, db } = deps();
    await send(d);
    db.markViewed();
    const retry = await send(d);
    expect(retry.body).toMatchObject({
      quoteNumber: 7,
      alreadySent: true,
      url: null,
      whatsappUrl: null,
    });
  });

  it('refuses to send a quote that is no longer a draft', async () => {
    const { d } = deps();
    await send(d);
    const other = await send(d, { sendKey: '71000000-0000-4000-a000-000000000002' });
    expect(other).toEqual({ status: 409, body: { error: 'quote_not_draft' } });
  });

  it('charges no VAT for an exempt dealer', async () => {
    const { d, db } = deps({
      loadQuote: async () => ({
        data: toQuoteForSend({ ...row, business: { ...row.business, tax_status: 'osek_patur' } }),
        error: null,
      }),
    });
    await send(d);
    expect(db.sendQuote.mock.calls[0]![0].p_totals).toMatchObject({ vat_rate_bp: 0, vat_minor: 0 });
  });

  it('uses the quote validity date when set, and refuses one in the past', async () => {
    const withDate = (valid_until: string) =>
      deps({
        loadQuote: async () => ({ data: toQuoteForSend({ ...row, valid_until }), error: null }),
      });
    const later = withDate('2026-12-01');
    await send(later.d);
    expect(later.db.sendQuote.mock.calls[0]![0].p_token_expires_at).toBe(
      '2026-12-01T21:59:59.000Z',
    );

    const past = withDate('2026-10-02');
    expect(await send(past.d)).toEqual({ status: 422, body: { error: 'quote_valid_until_past' } });
    expect(past.db.sendQuote).not.toHaveBeenCalled();
  });

  it('requires a valid user and hides quotes of other businesses', async () => {
    const noUser = deps({ getUserId: async () => null });
    expect((await send(noUser.d)).status).toBe(401);
    expect(
      (await handleQuotes(request({ sendKey: SEND_KEY }, { auth: null }), deps().d)).status,
    ).toBe(401);
    const notVisible = deps({ loadQuote: async () => ({ data: null, error: null }) });
    expect(await send(notVisible.d)).toEqual({ status: 404, body: { error: 'quote_not_found' } });
    expect(notVisible.db.sendQuote).not.toHaveBeenCalled();
  });

  it('maps database refusals', async () => {
    const failing = (code: string) =>
      deps({ sendQuote: async () => ({ data: null, error: { code, message: code } }) }).d;
    expect((await send(failing('42501'))).status).toBe(404);
    expect(await send(failing('22023'))).toEqual({
      status: 422,
      body: { error: 'quote_lines_required' },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await send(failing('XX000'))).status).toBe(500);
    consoleError.mockRestore();
  });

  it('passes the proposed visit times on, and sends none by default', async () => {
    const { d, db } = deps();
    await send(d);
    expect(db.sendQuote.mock.calls[0]![0].p_slots).toEqual([]);

    const withSlots = deps();
    const slots = [
      { startsAt: '2026-10-05T05:00:00Z', endsAt: '2026-10-05T07:00:00Z' },
      { startsAt: '2026-10-06T10:00:00+03:00', endsAt: '2026-10-06T12:00:00+03:00' },
    ];
    expect((await send(withSlots.d, { sendKey: SEND_KEY, slots })).status).toBe(200);
    expect(withSlots.db.sendQuote.mock.calls[0]![0].p_slots).toEqual([
      { starts_at: '2026-10-05T05:00:00Z', ends_at: '2026-10-05T07:00:00Z' },
      { starts_at: '2026-10-06T10:00:00+03:00', ends_at: '2026-10-06T12:00:00+03:00' },
    ]);
  });

  it('refuses bad proposed times before touching the database', async () => {
    const { d, db } = deps();
    const later = { startsAt: '2026-10-05T05:00:00Z', endsAt: '2026-10-05T07:00:00Z' };
    expect(await send(d, { sendKey: SEND_KEY, slots: [later] })).toEqual({
      status: 422,
      body: { error: 'slots_too_few' },
    });
    expect(await send(d, { sendKey: SEND_KEY, slots: [later, later] })).toEqual({
      status: 422,
      body: { error: 'slots_overlap' },
    });
    // NOW is 2026-10-03T09:00Z.
    const past = { startsAt: '2026-10-03T08:00:00Z', endsAt: '2026-10-03T10:00:00Z' };
    expect(await send(d, { sendKey: SEND_KEY, slots: [past, later] })).toEqual({
      status: 422,
      body: { error: 'slot_in_past' },
    });
    expect(db.sendQuote).not.toHaveBeenCalled();

    const refused = deps({
      sendQuote: async () => ({ data: null, error: { code: '22007', message: 'x' } }),
    }).d;
    const next = { startsAt: '2026-10-06T05:00:00Z', endsAt: '2026-10-06T07:00:00Z' };
    expect(await send(refused, { sendKey: SEND_KEY, slots: [later, next] })).toEqual({
      status: 422,
      body: { error: 'slots_invalid' },
    });
  });

  it('validates the request', async () => {
    const { d } = deps();
    expect((await send(d, { sendKey: 'nope' })).status).toBe(422);
    expect((await handleQuotes(request('{oops'), d)).status).toBe(400);
    expect((await handleQuotes(request(null, { method: 'GET' }), d)).status).toBe(405);
    expect((await handleQuotes(request({}, { path: '/quotes/not-a-uuid/send' }), d)).status).toBe(
      404,
    );
    expect((await handleQuotes(request({}, { path: `/quotes/${QUOTE_ID}` }), d)).status).toBe(404);
  });

  it('refuses to run without its secrets', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await send(deps({ tokenPepper: '' }).d)).status).toBe(500);
    consoleError.mockRestore();
  });

  it('fails closed when the quote cannot be read, and refuses lines the totals reject', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unreadable = deps({
      loadQuote: async () => ({ data: null, error: { message: 'connection reset' } }),
    }).d;
    expect(await send(unreadable)).toEqual({ status: 500, body: { error: 'internal_error' } });
    consoleError.mockRestore();

    // A stored line the totals can't price (e.g. a corrupted quantity) is never sent.
    const broken = toQuoteForSend({
      ...row,
      quote_item: [{ ...row.quote_item[0]!, quantity: 'abc' as unknown as number }],
    });
    const { d, db } = deps({ loadQuote: async () => ({ data: broken, error: null }) });
    expect(await send(d)).toEqual({ status: 422, body: { error: 'validation_failed' } });
    expect(db.sendQuote).not.toHaveBeenCalled();
  });
});
