import type { SendQuoteResponse } from '@q2c/types';
import type { LocalQuote, ServerDraftPayload } from './model';
import type { LocalPhoto, OutboxOp, QuoteStore } from './store';

export interface ApiError {
  code?: string;
  message: string;
  /** No connection, a timeout or a server hiccup: the same request may succeed later. */
  retryable: boolean;
}

export type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };

/** Server calls the outbox makes (Supabase implementation in api.ts). */
export interface QuotesApi {
  saveDraft(payload: ServerDraftPayload): Promise<ApiResult<null>>;
  uploadPhoto(photo: LocalPhoto): Promise<ApiResult<null>>;
  deletePhoto(photoId: string): Promise<ApiResult<null>>;
  send(quoteId: string, sendKey: string): Promise<ApiResult<SendQuoteResponse>>;
  fetchQuote(quoteId: string): Promise<ApiResult<LocalQuote | null>>;
}

export interface OutboxRunResult {
  done: number;
  /** Stopped early because the server could not be reached. */
  offline: boolean;
}

/** Errors meaning "the quote is no longer a draft on the server" (sent or cancelled elsewhere). */
const NOT_DRAFT = new Set(['55000', 'quote_not_draft']);

/**
 * Delivers queued changes. Drafts are saved first, then photos (their file
 * rows need the quote to exist), then sends; a send waits until every other
 * change of its quote has arrived, so the customer sees the final version.
 * A quote becomes SENT on the device only after the server confirms.
 */
export async function processOutbox(
  store: QuoteStore,
  api: QuotesApi,
  options: { now: number; force?: boolean },
): Promise<OutboxRunResult> {
  const order = { save: 0, photo: 1, photo_delete: 1, send: 2 } as const;
  const ops = (await store.pendingOps()).sort(
    (a, b) => order[a.kind] - order[b.kind] || a.id - b.id,
  );
  const unfinished = new Set<string>();
  let done = 0;

  for (const op of ops) {
    const due = !op.failed && (options.force || op.nextAttemptAt <= options.now);
    if (!due || (op.kind === 'send' && unfinished.has(op.quoteId))) {
      unfinished.add(op.quoteId);
      continue;
    }
    const error = await run(store, api, op);
    if (!error) {
      done++;
      continue;
    }
    unfinished.add(op.quoteId);
    if (error.retryable) {
      await store.retryOpLater(op, error.message, options.now);
      // Most likely offline: the remaining requests would fail the same way.
      return { done, offline: true };
    }
    if (NOT_DRAFT.has(error.code ?? '')) {
      // Another device sent or cancelled it: the server's version wins.
      await store.dropOp(op);
      await refresh(store, api, op.quoteId);
      continue;
    }
    await store.failOp(op, error.code ?? error.message);
  }
  return { done, offline: false };
}

/** Runs one operation; returns its error, or null once it is done and recorded. */
async function run(store: QuoteStore, api: QuotesApi, op: OutboxOp): Promise<ApiError | null> {
  switch (op.kind) {
    case 'save': {
      const result = await api.saveDraft(op.payload as ServerDraftPayload);
      if (result.error) return result.error;
      await store.completeOp(op);
      return null;
    }
    case 'photo': {
      const { photoId } = op.payload as { photoId: string };
      const photo = await store.getPhoto(photoId);
      if (photo && !photo.uploaded) {
        const result = await api.uploadPhoto(photo);
        if (result.error) return result.error;
        await store.markPhotoUploaded(photoId);
      }
      await store.completeOp(op);
      return null;
    }
    case 'photo_delete': {
      const { photoId } = op.payload as { photoId: string };
      const result = await api.deletePhoto(photoId);
      if (result.error) return result.error;
      await store.completeOp(op);
      return null;
    }
    case 'send': {
      const { sendKey } = op.payload as { sendKey: string };
      const result = await api.send(op.quoteId, sendKey);
      if (result.error) return result.error;
      const local = await store.getQuote(op.quoteId);
      if (local) {
        const {
          sync: _sync,
          pendingSend: _pending,
          syncError: _error,
          link: _link,
          ...quote
        } = local;
        await store.putQuote({
          ...quote,
          status: 'sent',
          quoteNumber: result.data.quoteNumber,
          sentAt: result.data.sentAt,
          updatedAt: result.data.sentAt,
        });
      }
      if (result.data.url && result.data.whatsappUrl)
        await store.setLink(op.quoteId, {
          url: result.data.url,
          whatsappUrl: result.data.whatsappUrl,
        });
      await store.completeOp(op);
      // Server totals, validity and timestamps (best-effort; the list refresh also brings them).
      await refresh(store, api, op.quoteId);
      return null;
    }
  }
}

async function refresh(store: QuoteStore, api: QuotesApi, quoteId: string): Promise<void> {
  const result = await api.fetchQuote(quoteId);
  if (result.data && !(await store.hasPendingOps(quoteId))) await store.putQuote(result.data);
}
