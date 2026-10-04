import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QuoteSlot, SendQuoteResponse } from '@q2c/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDraft, toServerDraft, type LocalQuote, type ServerDraftPayload } from './model.ts';
import { processOutbox, type ApiError, type QuotesApi } from './outbox.ts';
import { nodeSqlDb } from './node-sql-db.ts';
import { backoffMs, QuoteStore } from './store.ts';

const offline: ApiError = { message: 'TypeError: Network request failed', retryable: true };

/** A server with the database's rules: drafts editable until sent, sends idempotent per key. */
function fakeServer() {
  const drafts = new Map<string, ServerDraftPayload & { status: string }>();
  const photos = new Map<string, boolean>();
  const sends = new Map<string, { key: string; number: number; slots: QuoteSlot[] }>();
  let nextNumber = 1;
  const state = { online: true, loseNextSendResponse: false, calls: [] as string[] };
  const api: QuotesApi = {
    async saveDraft(payload) {
      state.calls.push(`save:${payload.id}:${payload.items.length}`);
      if (!state.online) return { data: null, error: offline };
      const existing = drafts.get(payload.id);
      if (existing && existing.status !== 'draft')
        return { data: null, error: { code: '55000', message: 'not a draft', retryable: false } };
      drafts.set(payload.id, { ...payload, status: 'draft' });
      return { data: null, error: null };
    },
    async uploadPhoto(photo) {
      state.calls.push(`photo:${photo.id}`);
      if (!state.online) return { data: null, error: offline };
      if (!drafts.has(photo.quoteId))
        return { data: null, error: { code: '23503', message: 'fk', retryable: false } };
      photos.set(photo.id, true);
      return { data: null, error: null };
    },
    async deletePhoto(photoId) {
      state.calls.push(`photo_delete:${photoId}`);
      if (!state.online) return { data: null, error: offline };
      photos.set(photoId, false);
      return { data: null, error: null };
    },
    async send(quoteId, sendKey, slots = []) {
      state.calls.push(`send:${quoteId}`);
      if (!state.online) return { data: null, error: offline };
      const draft = drafts.get(quoteId);
      if (!draft)
        return { data: null, error: { code: 'quote_not_found', message: '', retryable: false } };
      let sent = sends.get(quoteId);
      if (sent && sent.key !== sendKey)
        return { data: null, error: { code: 'quote_not_draft', message: '', retryable: false } };
      const alreadySent = !!sent;
      if (!sent) {
        sent = { key: sendKey, number: nextNumber++, slots };
        sends.set(quoteId, sent);
        draft.status = 'sent';
      }
      if (state.loseNextSendResponse) {
        state.loseNextSendResponse = false;
        return { data: null, error: { message: 'timed out', retryable: true } };
      }
      const data: SendQuoteResponse = {
        quoteNumber: sent.number,
        sentAt: '2026-10-03T10:00:00Z',
        url: `https://app.test/quote/t${sent.number}`,
        whatsappUrl: `https://wa.me/972541112222?text=t${sent.number}`,
        alreadySent,
      };
      return { data, error: null };
    },
    async fetchQuote() {
      return { data: null, error: null };
    },
  };
  return { api, drafts, photos, sends, state };
}

const BUSINESS = '10000000-0000-4000-a000-000000000001';
const customer = {
  id: 'c0000000-0000-4000-a000-000000000001',
  fullName: 'דנה',
  phone: '+972541112222',
};
const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;

function draftWithLines(id: string, lines: number): LocalQuote {
  return {
    ...newDraft({ id, businessId: BUSINESS, customer, now: `2026-10-03T08:00:0${lines}Z` }),
    lines: Array.from({ length: lines }, (_, i) => ({
      id: uuid(100 + i),
      serviceId: null,
      description: `שקע ${i + 1}`,
      quantity: '1',
      priceText: '250',
      unit: 'point',
      vatIncluded: false,
    })),
  };
}

async function save(store: QuoteStore, quote: LocalQuote) {
  await store.saveDraft(quote, toServerDraft(quote, 1800));
}

let dir: string;
let file: string;
const opened: { close(): void }[] = [];
async function openStore() {
  const db = nodeSqlDb(file);
  opened.push(db);
  return QuoteStore.open(db);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'q2c-outbox-'));
  file = join(dir, 'q2c.db');
});
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('outbox', () => {
  it('replays a draft created offline after the app restarts and the connection returns', async () => {
    const server = fakeServer();
    server.state.online = false;
    const before = await openStore();
    await save(before, draftWithLines(uuid(1), 1));
    await save(before, draftWithLines(uuid(1), 2)); // a later edit, still offline
    expect(await processOutbox(before, server.api, { now: 0 })).toEqual({ done: 0, offline: true });
    expect((await before.getQuote(uuid(1)))?.sync).toBe('pending');
    opened.pop()!.close(); // the app is killed

    const after = await openStore(); // restart: same database file
    expect((await after.listQuotes(BUSINESS)).map((q) => [q.id, q.lines.length, q.sync])).toEqual([
      [uuid(1), 2, 'pending'],
    ]);
    server.state.online = true;
    expect(await processOutbox(after, server.api, { now: 0, force: true })).toEqual({
      done: 1,
      offline: false,
    });
    // One save, with the latest version.
    expect(server.drafts.get(uuid(1))?.items).toHaveLength(2);
    expect((await after.getQuote(uuid(1)))?.sync).toBe('synced');
    expect(await after.pendingOps()).toEqual([]);
  });

  it('keeps a newer edit made while the previous save was in flight', async () => {
    const server = fakeServer();
    const store = await openStore();
    await save(store, draftWithLines(uuid(1), 1));
    const realSave = server.api.saveDraft;
    server.api.saveDraft = async (payload) => {
      await save(store, draftWithLines(uuid(1), 3)); // the user keeps typing
      return realSave(payload);
    };
    await processOutbox(store, server.api, { now: 0 });
    server.api.saveDraft = realSave;
    expect(await store.pendingOps()).toHaveLength(1);
    await processOutbox(store, server.api, { now: 0 });
    expect(server.drafts.get(uuid(1))?.items).toHaveLength(3);
    expect(await store.pendingOps()).toEqual([]);
  });

  it('a send made offline stays pending, and the quote becomes SENT only when the server confirms', async () => {
    const server = fakeServer();
    server.state.online = false;
    const store = await openStore();
    await save(store, draftWithLines(uuid(1), 1));
    await store.queueSend(uuid(1), uuid(900));
    await processOutbox(store, server.api, { now: 0 });

    let quote = await store.getQuote(uuid(1));
    expect([quote?.status, quote?.pendingSend, quote?.quoteNumber]).toEqual(['draft', true, null]);

    server.state.online = true;
    await processOutbox(store, server.api, { now: 0, force: true });
    quote = await store.getQuote(uuid(1));
    expect([quote?.status, quote?.pendingSend, quote?.quoteNumber, quote?.sync]).toEqual([
      'sent',
      false,
      1,
      'synced',
    ]);
    expect(quote?.link?.url).toBe('https://app.test/quote/t1');
    // Offline: the save failed and nothing else was tried. Online: the draft first, then the send.
    expect(server.state.calls).toEqual([
      `save:${uuid(1)}:1`,
      `save:${uuid(1)}:1`,
      `send:${uuid(1)}`,
    ]);
  });

  it('sends the proposed visit times with the quote, and a second tap keeps the first ones', async () => {
    const server = fakeServer();
    const store = await openStore();
    await save(store, draftWithLines(uuid(1), 1));
    const slots = [
      { startsAt: '2026-10-06T05:00:00.000Z', endsAt: '2026-10-06T07:00:00.000Z' },
      { startsAt: '2026-10-07T05:00:00.000Z', endsAt: '2026-10-07T07:00:00.000Z' },
    ];
    await store.queueSend(uuid(1), uuid(900), slots);
    await store.queueSend(uuid(1), uuid(901), []);
    await processOutbox(store, server.api, { now: 0 });
    expect(server.sends.get(uuid(1))).toEqual({ key: uuid(900), number: 1, slots });
  });

  it('retries a send whose response was lost with the same key: one number, never two', async () => {
    const server = fakeServer();
    const store = await openStore();
    await save(store, draftWithLines(uuid(1), 1));
    await store.queueSend(uuid(1), uuid(900));
    await store.queueSend(uuid(1), uuid(901)); // a second tap keeps the first key
    server.state.loseNextSendResponse = true;
    expect((await processOutbox(store, server.api, { now: 0 })).offline).toBe(true);
    expect((await store.getQuote(uuid(1)))?.status).toBe('draft');

    // Not due before its backoff, unless forced (e.g. the connection came back).
    await processOutbox(store, server.api, { now: 1 });
    expect(server.state.calls.filter((c) => c.startsWith('send:'))).toHaveLength(1);
    await processOutbox(store, server.api, { now: backoffMs(1) });
    expect(server.state.calls.filter((c) => c.startsWith('send:'))).toHaveLength(2);
    expect(server.sends.size).toBe(1);
    expect((await store.getQuote(uuid(1)))?.quoteNumber).toBe(1);
  });

  it('a draft sent from another device stops syncing and takes the server version', async () => {
    const server = fakeServer();
    const store = await openStore();
    await save(store, draftWithLines(uuid(1), 1));
    await processOutbox(store, server.api, { now: 0 });
    server.drafts.get(uuid(1))!.status = 'sent';
    const serverCopy = { ...draftWithLines(uuid(1), 1), status: 'sent' as const, quoteNumber: 9 };
    server.api.fetchQuote = async () => ({ data: serverCopy, error: null });

    await save(store, draftWithLines(uuid(1), 2));
    await processOutbox(store, server.api, { now: 0 });
    const quote = await store.getQuote(uuid(1));
    expect([quote?.status, quote?.quoteNumber, quote?.sync]).toEqual(['sent', 9, 'synced']);
  });

  it('shows a refused change as failed until the user retries', async () => {
    const server = fakeServer();
    const store = await openStore();
    await save(store, draftWithLines(uuid(1), 1));
    server.api.saveDraft = async () => ({
      data: null,
      error: { code: '42501', message: 'forbidden', retryable: false },
    });
    expect(await processOutbox(store, server.api, { now: 0 })).toEqual({ done: 0, offline: false });
    expect((await store.getQuote(uuid(1)))?.sync).toBe('failed');
    expect((await store.pendingOps())[0]?.lastError).toBe('42501');

    server.api.saveDraft = fakeServer().api.saveDraft;
    await store.resetOps(uuid(1));
    await processOutbox(store, server.api, { now: 0 });
    expect((await store.getQuote(uuid(1)))?.sync).toBe('synced');
  });

  it('uploads photos after the draft exists, before the send, and skips photos removed before upload', async () => {
    const server = fakeServer();
    server.state.online = false;
    const store = await openStore();
    const photo = (n: number) => ({
      id: uuid(500 + n),
      quoteId: uuid(1),
      businessId: BUSINESS,
      path: `${BUSINESS}/quotes/${uuid(1)}/${uuid(500 + n)}.jpg`,
      data: 'aGVsbG8=',
      createdAt: `2026-10-03T08:00:0${n}Z`,
    });
    await store.addPhoto(photo(1)); // queued before the draft's first save
    await store.addPhoto(photo(2));
    await save(store, draftWithLines(uuid(1), 1));
    await store.removePhoto(uuid(502));
    await store.queueSend(uuid(1), uuid(900));

    server.state.online = true;
    await processOutbox(store, server.api, { now: 0, force: true });
    expect(server.state.calls).toEqual([
      `save:${uuid(1)}:1`,
      `photo:${uuid(501)}`,
      `send:${uuid(1)}`,
    ]);
    expect((await store.listPhotos(uuid(1))).map((p) => [p.id, p.uploaded])).toEqual([
      [uuid(501), true],
    ]);
  });

  it('server lists do not overwrite changes still waiting in the outbox', async () => {
    const server = fakeServer();
    server.state.online = false;
    const store = await openStore();
    await save(store, draftWithLines(uuid(1), 2));
    await store.putQuote(draftWithLines(uuid(2), 1));
    await store.putQuote(draftWithLines(uuid(3), 1));
    await store.mergeServerQuotes(BUSINESS, [
      draftWithLines(uuid(1), 1),
      { ...draftWithLines(uuid(2), 1), status: 'viewed' },
    ]);
    const quotes = await store.listQuotes(BUSINESS);
    expect(quotes.map((q) => [q.id, q.lines.length, q.status]).sort()).toEqual([
      [uuid(1), 2, 'draft'], // local edit kept
      [uuid(2), 1, 'viewed'], // server update taken
      // uuid(3) is gone on the server and had nothing pending
    ]);
  });

  it('backs off exponentially, capped at 5 minutes', () => {
    expect([1, 2, 3, 10, 30].map(backoffMs)).toEqual([2000, 4000, 8000, 300_000, 300_000]);
  });
});
