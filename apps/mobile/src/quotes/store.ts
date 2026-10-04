import type { QuoteSlot } from '@q2c/types';
import type { LocalQuote, QuoteLink, QuoteListItem, SyncState } from './model';

type SqlValue = string | number | null;

/** The part of expo-sqlite's SQLiteDatabase the store uses (tests use node:sqlite). */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: SqlValue[]): Promise<T | null>;
}

export type OutboxKind = 'save' | 'photo' | 'photo_delete' | 'send';

export interface OutboxOp {
  id: number;
  key: string;
  kind: OutboxKind;
  quoteId: string;
  payload: unknown;
  /** Bumped whenever a coalesced op gets a newer payload. */
  version: number;
  attempts: number;
  nextAttemptAt: number;
  failed: boolean;
  lastError: string | null;
}

export interface LocalPhoto {
  id: string;
  quoteId: string;
  businessId: string;
  /** Path in the quote-photos bucket: <business>/quotes/<quote>/<photo>.jpg */
  path: string;
  /** JPEG as base64 for photos taken on this device (shown offline, uploaded by the outbox). */
  data: string | null;
  uploaded: boolean;
  createdAt: string;
}

const SCHEMA = `
create table if not exists quotes (
  id text primary key not null,
  business_id text not null,
  data text not null,
  updated_at text not null,
  -- Sent from this device: the customer link (the server keeps only its hash).
  link text
);
create index if not exists quotes_business on quotes (business_id, updated_at);
create table if not exists outbox (
  id integer primary key autoincrement,
  key text not null unique,
  kind text not null,
  quote_id text not null,
  payload text not null,
  version integer not null default 1,
  attempts integer not null default 0,
  next_attempt_at integer not null default 0,
  failed integer not null default 0,
  last_error text
);
create table if not exists photos (
  id text primary key not null,
  quote_id text not null,
  business_id text not null,
  path text not null,
  data text,
  uploaded integer not null default 0,
  deleted integer not null default 0,
  created_at text not null
);
create index if not exists photos_quote on photos (quote_id, created_at);
`;

interface OutboxRow {
  id: number;
  key: string;
  kind: OutboxKind;
  quote_id: string;
  payload: string;
  version: number;
  attempts: number;
  next_attempt_at: number;
  failed: number;
  last_error: string | null;
}

const toOp = (r: OutboxRow): OutboxOp => ({
  id: r.id,
  key: r.key,
  kind: r.kind,
  quoteId: r.quote_id,
  payload: JSON.parse(r.payload) as unknown,
  version: r.version,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at,
  failed: r.failed === 1,
  lastError: r.last_error,
});

/** Retry delay after `attempts` failures: 2s, 4s, 8s … capped at 5 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(2000 * 2 ** Math.max(attempts - 1, 0), 5 * 60_000);
}

/**
 * Quotes on the device plus the outbox of changes waiting for the server.
 * Everything survives app restarts; the outbox is replayed until the server
 * confirms each change (every operation is idempotent on the server).
 */
export class QuoteStore {
  private constructor(private readonly db: SqlDb) {}

  static async open(db: SqlDb): Promise<QuoteStore> {
    await db.execAsync(SCHEMA);
    return new QuoteStore(db);
  }

  // ---------------------------------------------------------------- quotes

  async getQuote(id: string): Promise<QuoteListItem | null> {
    const row = await this.db.getFirstAsync<{ data: string; link: string | null }>(
      'select data, link from quotes where id = ?',
      [id],
    );
    if (!row) return null;
    const [item] = await this.withSyncState([row]);
    return item ?? null;
  }

  async listQuotes(businessId: string): Promise<QuoteListItem[]> {
    const rows = await this.db.getAllAsync<{ data: string; link: string | null }>(
      'select data, link from quotes where business_id = ? order by updated_at desc',
      [businessId],
    );
    return this.withSyncState(rows);
  }

  private async withSyncState(
    rows: { data: string; link: string | null }[],
  ): Promise<QuoteListItem[]> {
    const ops = await this.db.getAllAsync<{
      quote_id: string;
      kind: OutboxKind;
      failed: number;
      last_error: string | null;
    }>('select quote_id, kind, failed, last_error from outbox order by id', []);
    return rows.map((row) => {
      const quote = JSON.parse(row.data) as LocalQuote;
      const mine = ops.filter((o) => o.quote_id === quote.id);
      const sync: SyncState = mine.some((o) => o.failed)
        ? 'failed'
        : mine.length
          ? 'pending'
          : 'synced';
      return {
        ...quote,
        sync,
        pendingSend: mine.some((o) => o.kind === 'send'),
        syncError: mine.find((o) => o.failed)?.last_error ?? null,
        link: row.link ? (JSON.parse(row.link) as QuoteLink) : null,
      };
    });
  }

  /** Stores the device's copy of a quote (no outbox entry: see saveDraft). */
  async putQuote(quote: LocalQuote): Promise<void> {
    await this.db.runAsync(
      `insert into quotes (id, business_id, data, updated_at) values (?, ?, ?, ?)
       on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at`,
      [quote.id, quote.businessId, JSON.stringify(quote), quote.updatedAt],
    );
  }

  /**
   * Saves a draft edit on the device and queues it for the server. Repeated
   * edits replace the queued payload, so only the latest version is sent.
   */
  async saveDraft(quote: LocalQuote, serverPayload: unknown | null): Promise<void> {
    await this.putQuote(quote);
    if (serverPayload) await this.enqueue(`save:${quote.id}`, 'save', quote.id, serverPayload);
  }

  /**
   * Queues sending, with the proposed visit times (if any). A second tap keeps
   * the first send key and times: if the first request already reached the
   * server, the retry must be recognised as the same send.
   */
  async queueSend(quoteId: string, sendKey: string, slots: QuoteSlot[] = []): Promise<void> {
    const payload = slots.length ? { sendKey, slots } : { sendKey };
    await this.db.runAsync(
      `insert into outbox (key, kind, quote_id, payload) values (?, 'send', ?, ?)
       on conflict (key) do update set failed = 0, next_attempt_at = 0`,
      [`send:${quoteId}`, quoteId, JSON.stringify(payload)],
    );
  }

  /** Gives up a queued send that the server refused (the quote goes back to being a draft). */
  async cancelQueuedSend(quoteId: string): Promise<void> {
    await this.db.runAsync('delete from outbox where key = ?', [`send:${quoteId}`]);
  }

  async setLink(quoteId: string, link: QuoteLink): Promise<void> {
    await this.db.runAsync('update quotes set link = ? where id = ?', [
      JSON.stringify(link),
      quoteId,
    ]);
  }

  async deleteQuote(quoteId: string): Promise<void> {
    await this.db.runAsync('delete from quotes where id = ?', [quoteId]);
    await this.db.runAsync('delete from outbox where quote_id = ?', [quoteId]);
    await this.db.runAsync('delete from photos where quote_id = ?', [quoteId]);
  }

  /**
   * Takes the server's quotes, except those with changes still waiting in the
   * outbox (the device's version is newer until the outbox delivers it).
   */
  async mergeServerQuotes(businessId: string, quotes: LocalQuote[]): Promise<void> {
    const pending = new Set(
      (
        await this.db.getAllAsync<{ quote_id: string }>('select distinct quote_id from outbox', [])
      ).map((r) => r.quote_id),
    );
    for (const quote of quotes) {
      if (!pending.has(quote.id)) await this.putQuote(quote);
    }
    // Drafts deleted or moved elsewhere: drop local copies that are not pending.
    const serverIds = new Set(quotes.map((q) => q.id));
    const local = await this.db.getAllAsync<{ id: string }>(
      'select id from quotes where business_id = ?',
      [businessId],
    );
    for (const { id } of local) {
      if (!serverIds.has(id) && !pending.has(id)) await this.deleteQuote(id);
    }
  }

  // ---------------------------------------------------------------- photos

  async addPhoto(photo: Omit<LocalPhoto, 'uploaded'>): Promise<void> {
    await this.db.runAsync(
      `insert into photos (id, quote_id, business_id, path, data, created_at) values (?, ?, ?, ?, ?, ?)
       on conflict (id) do nothing`,
      [photo.id, photo.quoteId, photo.businessId, photo.path, photo.data, photo.createdAt],
    );
    await this.enqueue(`photo:${photo.id}`, 'photo', photo.quoteId, { photoId: photo.id });
  }

  async removePhoto(photoId: string): Promise<void> {
    const photo = await this.getPhoto(photoId);
    if (!photo) return;
    await this.db.runAsync('update photos set deleted = 1 where id = ?', [photoId]);
    const queuedUpload = await this.db.runAsync(
      'delete from outbox where key = ? and attempts = 0',
      [`photo:${photoId}`],
    );
    // Never reached the server: nothing to delete there.
    if (queuedUpload.changes === 0 || photo.uploaded)
      await this.enqueue(`photo_delete:${photoId}`, 'photo_delete', photo.quoteId, { photoId });
  }

  async getPhoto(photoId: string): Promise<LocalPhoto | null> {
    const row = await this.db.getFirstAsync<{
      id: string;
      quote_id: string;
      business_id: string;
      path: string;
      data: string | null;
      uploaded: number;
      created_at: string;
    }>('select * from photos where id = ?', [photoId]);
    return row
      ? {
          id: row.id,
          quoteId: row.quote_id,
          businessId: row.business_id,
          path: row.path,
          data: row.data,
          uploaded: row.uploaded === 1,
          createdAt: row.created_at,
        }
      : null;
  }

  async listPhotos(quoteId: string): Promise<LocalPhoto[]> {
    const rows = await this.db.getAllAsync<{ id: string }>(
      'select id from photos where quote_id = ? and deleted = 0 order by created_at',
      [quoteId],
    );
    const photos = await Promise.all(rows.map((r) => this.getPhoto(r.id)));
    return photos.filter((p): p is LocalPhoto => p !== null);
  }

  /** Photos already on the server (taken on another device, or before a reinstall). */
  async mergeServerPhotos(
    quoteId: string,
    photos: Omit<LocalPhoto, 'data' | 'uploaded' | 'quoteId'>[],
  ): Promise<void> {
    for (const p of photos) {
      await this.db.runAsync(
        `insert into photos (id, quote_id, business_id, path, uploaded, created_at) values (?, ?, ?, ?, 1, ?)
         on conflict (id) do nothing`,
        [p.id, quoteId, p.businessId, p.path, p.createdAt],
      );
    }
  }

  async markPhotoUploaded(photoId: string): Promise<void> {
    await this.db.runAsync('update photos set uploaded = 1 where id = ?', [photoId]);
  }

  // ---------------------------------------------------------------- outbox

  async enqueue(key: string, kind: OutboxKind, quoteId: string, payload: unknown): Promise<void> {
    await this.db.runAsync(
      `insert into outbox (key, kind, quote_id, payload) values (?, ?, ?, ?)
       on conflict (key) do update set payload = excluded.payload, version = version + 1,
         attempts = 0, next_attempt_at = 0, failed = 0, last_error = null`,
      [key, kind, quoteId, JSON.stringify(payload)],
    );
  }

  /** Every queued operation, oldest first (the order they must reach the server in). */
  async pendingOps(): Promise<OutboxOp[]> {
    const rows = await this.db.getAllAsync<OutboxRow>('select * from outbox order by id', []);
    return rows.map(toOp);
  }

  async hasPendingOps(quoteId: string): Promise<boolean> {
    return (
      (await this.db.getFirstAsync<{ n: number }>(
        'select count(*) as n from outbox where quote_id = ?',
        [quoteId],
      ))!.n > 0
    );
  }

  /** Done, unless the payload was replaced meanwhile (then the newer one still has to go). */
  async completeOp(op: OutboxOp): Promise<void> {
    await this.db.runAsync('delete from outbox where id = ? and version = ?', [op.id, op.version]);
  }

  async retryOpLater(op: OutboxOp, error: string, now: number): Promise<void> {
    const attempts = op.attempts + 1;
    await this.db.runAsync(
      'update outbox set attempts = ?, next_attempt_at = ?, last_error = ? where id = ? and version = ?',
      [attempts, now + backoffMs(attempts), error, op.id, op.version],
    );
  }

  /** The server refused it: kept (and shown as failed) until the user retries or discards. */
  async failOp(op: OutboxOp, error: string): Promise<void> {
    await this.db.runAsync(
      'update outbox set failed = 1, attempts = attempts + 1, last_error = ? where id = ? and version = ?',
      [error, op.id, op.version],
    );
  }

  async dropOp(op: OutboxOp): Promise<void> {
    await this.db.runAsync('delete from outbox where id = ?', [op.id]);
  }

  /** "Try again": failed and backed-off operations become due now. */
  async resetOps(quoteId?: string): Promise<void> {
    await this.db.runAsync(
      `update outbox set failed = 0, next_attempt_at = 0 where ${quoteId ? 'quote_id = ?' : '1 = 1'}`,
      quoteId ? [quoteId] : [],
    );
  }

  /** Signing out: nothing of this user's stays on the device. */
  async clear(): Promise<void> {
    await this.db.execAsync('delete from quotes; delete from outbox; delete from photos;');
  }
}
