// Edge Functions end to end through the local gateway: real JWTs, real RLS,
// real SQL functions. Covers the happy paths and every documented error.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  businesses,
  callFunction,
  createDraft,
  freshIp,
  sendQuote,
  sentQuoteOfA,
  signIn,
  users,
  type SignedIn,
} from '../stack.ts';

let ownerA: SignedIn;
let ownerB: SignedIn;
let employeeA: SignedIn;

beforeAll(async () => {
  [ownerA, ownerB, employeeA] = await Promise.all([
    signIn(users.ownerA.phone),
    signIn(users.ownerB.phone),
    signIn(users.employeeA.phone),
  ]);
});

describe('quotes: POST /quotes/:id/send', () => {
  it('sends a draft: number, customer link, WhatsApp link, server totals', async () => {
    const draft = await createDraft(ownerA, businesses.a);
    const sendKey = randomUUID();
    const res = await callFunction(`quotes/${draft.quoteId}/send`, {
      accessToken: ownerA.accessToken,
      body: { sendKey },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ alreadySent: false, quoteNumber: expect.any(Number) });
    expect(res.body!.url).toMatch(/^http:\/\/localhost:3000\/quote\/[A-Za-z0-9_-]{43}$/);
    expect(res.body!.whatsappUrl).toMatch(/^https:\/\/wa\.me\/972\d+\?text=/);

    const { data } = await adminClient()
      .from('quote')
      .select('status, quote_number, total_minor, token_hash, sent_snapshot')
      .eq('id', draft.quoteId)
      .single();
    expect(data).toMatchObject({ status: 'sent', quote_number: res.body!.quoteNumber });
    expect(data!.total_minor).toBe(59000);
    // Only the peppered hash is stored, never the token itself.
    const token = (res.body!.url as string).split('/quote/')[1]!;
    expect(data!.token_hash).not.toContain(token);
    expect(JSON.stringify(data!.sent_snapshot)).not.toContain(token);

    // Retrying with the same key is idempotent: same number, no second send.
    const retry = await callFunction(`quotes/${draft.quoteId}/send`, {
      accessToken: ownerA.accessToken,
      body: { sendKey },
    });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ quoteNumber: res.body!.quoteNumber, alreadySent: true });
  });

  it('recomputes totals on the server instead of trusting the client', async () => {
    const draft = await createDraft(ownerA, businesses.a);
    // A tampered client preview: the stored lines still say ₪500 + VAT.
    await adminClient().from('quote').update({ total_minor: 1 }).eq('id', draft.quoteId);
    await sendQuote(ownerA, draft);
    const { data } = await adminClient()
      .from('quote')
      .select('total_minor')
      .eq('id', draft.quoteId)
      .single();
    expect(data!.total_minor).toBe(59000);
  });

  it('lets an employee of the business send', async () => {
    const draft = await createDraft(employeeA, businesses.a);
    await expect(sendQuote(employeeA, draft)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('401 without a bearer token, or with a forged one', async () => {
    const draft = await createDraft(ownerA, businesses.a);
    const path = `quotes/${draft.quoteId}/send`;
    expect((await callFunction(path, { body: { sendKey: randomUUID() } })).status).toBe(401);
    const forged = `${ownerA.accessToken.slice(0, -4)}AAAA`;
    const res = await callFunction(path, { accessToken: forged, body: { sendKey: randomUUID() } });
    expect(res.status).toBe(401);
  });

  it('404 for another business’s quote (no hint that it exists)', async () => {
    const draft = await createDraft(ownerA, businesses.a);
    const res = await callFunction(`quotes/${draft.quoteId}/send`, {
      accessToken: ownerB.accessToken,
      body: { sendKey: randomUUID() },
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'quote_not_found' });
    const { data } = await adminClient().from('quote').select('status').eq('id', draft.quoteId);
    expect(data![0]!.status).toBe('draft');
  });

  it('404 for an unknown id and for paths that are not a send', async () => {
    const unknown = await callFunction(`quotes/${randomUUID()}/send`, {
      accessToken: ownerA.accessToken,
      body: { sendKey: randomUUID() },
    });
    expect(unknown.status).toBe(404);
    const bad = await callFunction('quotes/not-a-uuid/send', {
      accessToken: ownerA.accessToken,
      body: { sendKey: randomUUID() },
    });
    expect(bad.status).toBe(404);
  });

  it('405 for GET', async () => {
    const res = await callFunction(`quotes/${randomUUID()}/send`, {
      method: 'GET',
      accessToken: ownerA.accessToken,
    });
    expect(res.status).toBe(405);
  });

  it('400 for a body that is not JSON, 422 for an invalid send key', async () => {
    const draft = await createDraft(ownerA, businesses.a);
    const path = `quotes/${draft.quoteId}/send`;
    const notJson = await callFunction(path, { accessToken: ownerA.accessToken, rawBody: '{' });
    expect(notJson.status).toBe(400);
    expect(notJson.body).toEqual({ error: 'invalid_json' });
    const badKey = await callFunction(path, {
      accessToken: ownerA.accessToken,
      body: { sendKey: 'nope' },
    });
    expect(badKey.status).toBe(422);
    expect(badKey.body).toEqual({ error: 'validation_failed' });
  });

  it('409 when the quote is no longer a draft (a different send key)', async () => {
    const sent = await sendQuote(ownerA, await createDraft(ownerA, businesses.a));
    const res = await callFunction(`quotes/${sent.quoteId}/send`, {
      accessToken: ownerA.accessToken,
      body: { sendKey: randomUUID() },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'quote_not_draft' });
  });

  it('422 for a draft without lines', async () => {
    const draft = await createDraft(ownerA, businesses.a);
    await adminClient()
      .from('quote_item')
      .update({ deleted_at: new Date().toISOString() })
      .eq('quote_id', draft.quoteId);
    const res = await callFunction(`quotes/${draft.quoteId}/send`, {
      accessToken: ownerA.accessToken,
      body: { sendKey: randomUUID() },
    });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'quote_lines_required' });
  });

  it('422 when the validity date is already past', async () => {
    const draft = await createDraft(ownerA, businesses.a);
    await adminClient().from('quote').update({ valid_until: '2020-01-01' }).eq('id', draft.quoteId);
    const res = await callFunction(`quotes/${draft.quoteId}/send`, {
      accessToken: ownerA.accessToken,
      body: { sendKey: randomUUID() },
    });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'quote_valid_until_past' });
  });
});

describe('business-setup', () => {
  it('401 without a token, 405 for GET', async () => {
    expect((await callFunction('business-setup', { body: {} })).status).toBe(401);
    const get = await callFunction('business-setup', {
      method: 'GET',
      accessToken: ownerA.accessToken,
    });
    expect(get.status).toBe(405);
  });

  it('422 with field issues for an invalid body, 400 for non-JSON', async () => {
    const res = await callFunction('business-setup', {
      accessToken: ownerA.accessToken,
      body: { businessId: 'x', name: '', trade: 'pilot', taxStatus: 'nope' },
    });
    expect(res.status).toBe(422);
    expect(res.body!.error).toBe('validation_failed');
    const paths = (res.body!.issues as { path: string }[]).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['businessId', 'name', 'trade', 'taxStatus']));
    const raw = await callFunction('business-setup', {
      accessToken: ownerA.accessToken,
      rawBody: 'name=x',
    });
    expect(raw.status).toBe(400);
  });

  it('refuses to set up an existing business of another tenant', async () => {
    const res = await callFunction('business-setup', {
      accessToken: ownerB.accessToken,
      body: {
        businessId: businesses.a,
        name: 'השתלטות',
        trade: 'electrician',
        taxStatus: 'osek_murshe',
      },
    });
    expect([403, 422]).toContain(res.status);
    const { data } = await adminClient().from('business').select('name').eq('id', businesses.a);
    expect(data![0]!.name).toBe('כהן חשמל');
  });
});

describe('public-quote: the customer link', () => {
  const headers = () => ({ 'X-Forwarded-For': freshIp() });

  it('opens without sign-in, marks the quote VIEWED, and hides internal fields', async () => {
    const sent = await sentQuoteOfA();
    const res = await callFunction(`public-quote/${sent.token}`, { headers: headers() });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toMatchObject({ state: 'open', approval: null, rejection: null });
    const body = JSON.stringify(res.body);
    for (const leak of ['token_hash', 'business_id', sent.businessId, 'customer_id'])
      expect(body).not.toContain(leak);
    const { data } = await adminClient()
      .from('quote')
      .select('status, viewed_at')
      .eq('id', sent.quoteId)
      .single();
    expect(data!.status).toBe('viewed');
    expect(data!.viewed_at).not.toBeNull();
  });

  it('approves with a typed name; approving twice is idempotent', async () => {
    const sent = await sentQuoteOfA();
    const ip = freshIp();
    const first = await callFunction(`public-quote/${sent.token}/approve`, {
      body: { name: 'משה ישראלי' },
      headers: { 'X-Forwarded-For': ip },
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: 'approved', approval: { name: 'משה ישראלי' } });
    const again = await callFunction(`public-quote/${sent.token}/approve`, {
      body: { name: 'משה ישראלי' },
      headers: { 'X-Forwarded-For': ip },
    });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ state: 'approved', already: true });
    const { data } = await adminClient()
      .from('quote')
      .select('status, approved_name')
      .eq('id', sent.quoteId)
      .single();
    expect(data).toEqual({ status: 'approved', approved_name: 'משה ישראלי' });
  });

  it('409 when rejecting an approved quote', async () => {
    const sent = await sentQuoteOfA();
    await callFunction(`public-quote/${sent.token}/approve`, {
      body: { name: 'משה ישראלי' },
      headers: headers(),
    });
    const res = await callFunction(`public-quote/${sent.token}/reject`, {
      body: {},
      headers: headers(),
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'quote_closed' });
  });

  it('rejects with an optional reason', async () => {
    const sent = await sentQuoteOfA();
    const res = await callFunction(`public-quote/${sent.token}/reject`, {
      body: { reason: 'יקר מדי' },
      headers: headers(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'rejected', rejection: { reason: 'יקר מדי' } });
  });

  it('stores a comment for the business', async () => {
    const sent = await sentQuoteOfA();
    const res = await callFunction(`public-quote/${sent.token}/comment`, {
      body: { body: 'אפשר ביום חמישי?' },
      headers: headers(),
    });
    expect(res.status).toBe(200);
    const { data } = await ownerA.client
      .from('quote_comment')
      .select('author, body')
      .eq('quote_id', sent.quoteId);
    expect(data).toEqual([{ author: 'customer', body: 'אפשר ביום חמישי?' }]);
  });

  it('422 with the schema’s error key for invalid bodies, 400 for non-JSON', async () => {
    const sent = await sentQuoteOfA();
    const cases: [string, unknown, string][] = [
      ['approve', { name: ' ' }, 'approve_name_required'],
      ['approve', { name: 'א'.repeat(201) }, 'approve_name_too_long'],
      ['reject', { reason: 'x'.repeat(1001) }, 'reject_reason_too_long'],
      ['comment', { body: '' }, 'comment_required'],
      ['comment', { body: 'x'.repeat(2001) }, 'comment_too_long'],
    ];
    for (const [action, body, error] of cases) {
      const res = await callFunction(`public-quote/${sent.token}/${action}`, {
        body,
        headers: headers(),
      });
      expect(res.status, `${action} ${error}`).toBe(422);
      expect(res.body).toEqual({ error });
    }
    const raw = await callFunction(`public-quote/${sent.token}/approve`, {
      rawBody: 'not json',
      headers: headers(),
    });
    expect(raw.status).toBe(400);
  });

  it('405 for the wrong method on each route', async () => {
    const sent = await sentQuoteOfA();
    const post = await callFunction(`public-quote/${sent.token}`, {
      method: 'POST',
      body: {},
      headers: headers(),
    });
    expect(post.status).toBe(405);
    const get = await callFunction(`public-quote/${sent.token}/approve`, { headers: headers() });
    expect(get.status).toBe(405);
  });

  it('shows cancelled and superseded quotes by state only', async () => {
    const cancelled = await sentQuoteOfA();
    const { error } = await ownerA.client.rpc('cancel_quote', { p_quote_id: cancelled.quoteId });
    expect(error).toBeNull();
    const res = await callFunction(`public-quote/${cancelled.token}`, { headers: headers() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'cancelled', business: { name: 'כהן חשמל' } });

    const revised = await sentQuoteOfA();
    const { error: reviseError } = await ownerA.client.rpc('revise_quote', {
      p_quote_id: revised.quoteId,
      p_new_quote_id: randomUUID(),
    });
    expect(reviseError).toBeNull();
    const old = await callFunction(`public-quote/${revised.token}`, { headers: headers() });
    expect(old.body).toEqual({ state: 'superseded', business: { name: 'כהן חשמל' } });
  });

  it('shows an expired quote as expired and refuses to approve it', async () => {
    const sent = await sentQuoteOfA();
    await adminClient()
      .from('quote')
      .update({ token_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', sent.quoteId);
    const open = await callFunction(`public-quote/${sent.token}`, { headers: headers() });
    expect(open.body).toMatchObject({ state: 'expired' });
    const approve = await callFunction(`public-quote/${sent.token}/approve`, {
      body: { name: 'משה ישראלי' },
      headers: headers(),
    });
    expect(approve.status).toBe(409);
  });
});
