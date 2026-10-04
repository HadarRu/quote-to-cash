// Critical path 2: a quote created and sent offline survives an app restart and
// is delivered once the connection returns. Runs the app's own outbox, device
// store (SQLite file) and Supabase API layer against the real local stack;
// only the network switch and the restart are simulated.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@q2c/types';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supabaseQuotesApi } from '../../apps/mobile/src/quotes/api.ts';
import { newDraft, toServerDraft } from '../../apps/mobile/src/quotes/model.ts';
import { nodeSqlDb } from '../../apps/mobile/src/quotes/node-sql-db.ts';
import { processOutbox } from '../../apps/mobile/src/quotes/outbox.ts';
import { QuoteStore } from '../../apps/mobile/src/quotes/store.ts';
import {
  adminClient,
  businesses,
  callFunction,
  createCustomer,
  freshIp,
  signIn,
  stackEnv,
  TEST_OTP,
  users,
} from '../stack.ts';

/** A device: a Supabase client behind a network switch, signed in as owner A. */
async function device() {
  const network = { online: true };
  const client = createClient<Database>(stackEnv().url, stackEnv().anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        network.online ? fetch(input, init) : Promise.reject(new TypeError('fetch failed')),
    },
  });
  const { error } = await client.auth.verifyOtp({
    phone: users.ownerA.phone,
    token: TEST_OTP,
    type: 'sms',
  });
  if (error) throw error;
  return { network, api: supabaseQuotesApi(client as never) };
}

let dir: string;
let open: { close(): void }[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'q2c-device-'));
});
afterEach(() => {
  for (const db of open) db.close();
  open = [];
  rmSync(dir, { recursive: true, force: true });
});

async function openStore() {
  const db = nodeSqlDb(join(dir, 'q2c.db'));
  open.push(db);
  return { store: await QuoteStore.open(db), db };
}

describe('offline quote: create, restart, reconnect, sync and send', () => {
  it('delivers the draft and the send exactly once, with the latest edit', async () => {
    const owner = await signIn(users.ownerA.phone);
    const customerId = await createCustomer(owner, businesses.a, { fullName: 'רות אופליין' });
    const quoteId = randomUUID();
    const sendKey = randomUUID();

    // 1. Offline: the electrician writes the quote, edits it, and taps send.
    const first = await device();
    first.network.online = false;
    const { store: before, db } = await openStore();
    const draft = {
      ...newDraft({
        id: quoteId,
        businessId: businesses.a,
        customer: { id: customerId, fullName: 'רות אופליין', phone: '+972521234567' },
        now: new Date().toISOString(),
      }),
      title: 'תאורה בחצר',
      lines: [
        {
          id: randomUUID(),
          serviceId: null,
          description: 'גוף תאורה',
          quantity: '3',
          priceText: '180',
          unit: 'unit',
          vatIncluded: false,
        },
      ],
    };
    await before.saveDraft(draft, toServerDraft(draft, 1800));
    const edited = { ...draft, title: 'תאורה בחצר ובכניסה' };
    await before.saveDraft(edited, toServerDraft(edited, 1800));
    await before.queueSend(quoteId, sendKey);

    expect(await processOutbox(before, first.api, { now: Date.now() })).toEqual({
      done: 0,
      offline: true,
    });
    expect((await before.getQuote(quoteId))?.pendingSend).toBe(true);
    const { data: nothingYet } = await adminClient().from('quote').select('id').eq('id', quoteId);
    expect(nothingYet).toEqual([]);

    // 2. The app is killed and reopened, still offline.
    db.close();
    open = open.filter((d) => d !== db);
    const second = await device();
    second.network.online = false;
    const { store: after } = await openStore();
    const restored = await after.getQuote(quoteId);
    expect([restored?.title, restored?.status, restored?.pendingSend]).toEqual([
      'תאורה בחצר ובכניסה',
      'draft',
      true,
    ]);
    // Reopening the app retries at once (force), and is still offline.
    expect(await processOutbox(after, second.api, { now: Date.now(), force: true })).toEqual({
      done: 0,
      offline: true,
    });

    // 3. The connection returns: one run delivers the draft, then the send.
    second.network.online = true;
    expect(await processOutbox(after, second.api, { now: Date.now(), force: true })).toEqual({
      done: 2,
      offline: false,
    });
    const local = await after.getQuote(quoteId);
    expect(local?.status).toBe('sent');
    expect(local?.quoteNumber).toEqual(expect.any(Number));
    expect(local?.link?.url).toMatch(/\/quote\/[A-Za-z0-9_-]{43}$/);
    expect(await after.pendingOps()).toEqual([]);

    const { data: server } = await adminClient()
      .from('quote')
      .select('status, title, quote_number, total_minor')
      .eq('id', quoteId)
      .single();
    expect(server).toEqual({
      status: 'sent',
      title: 'תאורה בחצר ובכניסה',
      quote_number: local!.quoteNumber,
      // 3 × ₪180 = ₪540 + 18% VAT
      total_minor: 63720,
    });

    // 4. The customer link works.
    const token = local!.link!.url.split('/quote/')[1]!;
    const page = await callFunction(`public-quote/${token}`, {
      headers: { 'X-Forwarded-For': freshIp() },
    });
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ state: 'open', quote: { title: 'תאורה בחצר ובכניסה' } });

    // 5. Running the outbox again sends nothing twice.
    expect(await processOutbox(after, second.api, { now: Date.now(), force: true })).toEqual({
      done: 0,
      offline: false,
    });
  });

  it('a send whose response was lost is retried with the same key and not duplicated', async () => {
    const owner = await signIn(users.ownerA.phone);
    const customerId = await createCustomer(owner, businesses.a);
    const quoteId = randomUUID();
    const phone = await device();
    const { store } = await openStore();
    const draft = {
      ...newDraft({
        id: quoteId,
        businessId: businesses.a,
        customer: { id: customerId, fullName: 'לקוח', phone: '+972521234567' },
        now: new Date().toISOString(),
      }),
      lines: [
        {
          id: randomUUID(),
          serviceId: null,
          description: 'שקע',
          quantity: '1',
          priceText: '250',
          unit: 'point',
          vatIncluded: false,
        },
      ],
    };
    await store.saveDraft(draft, toServerDraft(draft, 1800));
    await store.queueSend(quoteId, randomUUID());

    // The send reaches the server, but the connection drops before the answer.
    const realSend = phone.api.send;
    phone.api.send = async (id, key) => {
      await realSend(id, key);
      return { data: null, error: { message: 'Network request failed', retryable: true } };
    };
    await processOutbox(store, phone.api, { now: Date.now() });
    expect((await store.getQuote(quoteId))?.status).toBe('draft');

    phone.api.send = realSend;
    await processOutbox(store, phone.api, { now: Date.now(), force: true });
    const local = await store.getQuote(quoteId);
    expect(local?.status).toBe('sent');

    const { data } = await adminClient()
      .from('quote')
      .select('quote_number')
      .eq('business_id', businesses.a)
      .eq('quote_number', local!.quoteNumber!);
    expect(data).toHaveLength(1);
  });
});
