// Security checks on the public surface: link-token guessing and rate limits,
// stored XSS payloads, file upload validation. Cross-tenant access is in
// tenant-isolation.test.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  businesses,
  callFunction,
  freshIp,
  sentQuoteOfA,
  signIn,
  storageStatus,
  users,
  type SignedIn,
} from '../stack.ts';

/** Same limits as supabase/functions/public-quote/handler.ts (LIMITS). */
const LIMITS = { ipRead: 60, ipWrite: 10, token: 30 };

const randomToken = () => randomBytes(32).toString('base64url');

/**
 * Rate limits count per wall-clock minute. Start a burst early in a window so
 * it can't straddle two of them and reset halfway.
 */
async function freshWindow() {
  const intoWindow = Date.now() % 60_000;
  if (intoWindow > 30_000) await sleep(60_000 - intoWindow + 250);
}

describe('link tokens', () => {
  it('random well-formed tokens all get the same 404 (no oracle)', async () => {
    const ip = freshIp();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        callFunction(`public-quote/${randomToken()}`, { headers: { 'X-Forwarded-For': ip } }),
      ),
    );
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'not_found' });
    }
  });

  it('malformed tokens get that same 404', async () => {
    const ip = freshIp();
    for (const token of [
      'short',
      'A'.repeat(44),
      `${'A'.repeat(42)}=`,
      encodeURIComponent(`' or 1=1 --${'A'.repeat(32)}`),
      encodeURIComponent('<script>alert(1)</script>'.padEnd(43, 'A')),
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    ]) {
      const r = await callFunction(`public-quote/${token}`, {
        headers: { 'X-Forwarded-For': ip },
      });
      expect(r.status, token).toBe(404);
      expect(r.body, token).toEqual({ error: 'not_found' });
    }
  });

  it('a superseded link reveals only its state, not the old quote', async () => {
    // The token of a superseded quote shows only "there is a newer version";
    // no prices, customer or business details leak through it.
    const sent = await sentQuoteOfA({ title: 'סודי' });
    const owner = await signIn(users.ownerA.phone);
    await owner.client.rpc('revise_quote', {
      p_quote_id: sent.quoteId,
      p_new_quote_id: randomUUID(),
    });
    const r = await callFunction(`public-quote/${sent.token}`, {
      headers: { 'X-Forwarded-For': freshIp() },
    });
    expect(JSON.stringify(r.body)).not.toContain('סודי');
    expect(Object.keys(r.body!).sort()).toEqual(['business', 'state']);
  });

  it(`limits page loads to ${LIMITS.ipRead}/min per IP`, async () => {
    await freshWindow();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.ipRead + 1; i++) {
      // A different token each time, so only the per-IP limit applies.
      const r = await callFunction(`public-quote/${randomToken()}`, {
        headers: { 'X-Forwarded-For': ip },
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, LIMITS.ipRead).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it(`limits answers and comments to ${LIMITS.ipWrite}/min per IP`, async () => {
    await freshWindow();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.ipWrite + 1; i++) {
      const r = await callFunction(`public-quote/${randomToken()}/comment`, {
        body: { body: 'x' },
        headers: { 'X-Forwarded-For': ip },
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, LIMITS.ipWrite).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it(`limits any one link to ${LIMITS.token}/min from anywhere`, async () => {
    await freshWindow();
    const token = randomToken();
    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.token + 1; i++) {
      const r = await callFunction(`public-quote/${token}`, {
        headers: { 'X-Forwarded-For': freshIp() },
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, LIMITS.token).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  // FINDING (medium): the per-IP limits and the approval's recorded IP trust the
  // first X-Forwarded-For entry, which the caller controls (clientIp() in
  // public-quote/handler.ts). The per-link limit above still caps guessing, and
  // a 256-bit token can't be guessed anyway. Already in FUTURE.md (trusted client IP
  // header); remove `.fails` once fixed.
  it.fails('per-IP limits cannot be dodged by rotating X-Forwarded-For', async () => {
    await freshWindow();
    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.ipWrite + 1; i++) {
      const r = await callFunction(`public-quote/${randomToken()}/comment`, {
        body: { body: 'x' },
        headers: { 'X-Forwarded-For': freshIp() },
      });
      statuses.push(r.status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('stored XSS payloads stay inert data', () => {
  const payload = `<script>alert('x')</script><img src=x onerror="alert(1)">"'&`;

  it('approval names, rejection reasons and comments are stored and returned verbatim as JSON', async () => {
    const approved = await sentQuoteOfA();
    const ip = freshIp();
    const approve = await callFunction(`public-quote/${approved.token}/approve`, {
      body: { name: payload },
      headers: { 'X-Forwarded-For': ip },
    });
    expect(approve.status).toBe(200);
    expect(approve.headers.get('content-type')).toContain('application/json');
    expect((approve.body!.approval as { name: string }).name).toBe(payload);

    const comment = await callFunction(`public-quote/${approved.token}/comment`, {
      body: { body: payload },
      headers: { 'X-Forwarded-For': ip },
    });
    expect(comment.status).toBe(200);

    const { data } = await adminClient()
      .from('quote_comment')
      .select('body')
      .eq('quote_id', approved.quoteId);
    expect(data).toEqual([{ body: payload }]);
  });

  it('owner-entered HTML in a quote reaches the customer as plain text fields', async () => {
    const sent = await sentQuoteOfA({ title: payload, notes: payload, description: payload });
    const r = await callFunction(`public-quote/${sent.token}`, {
      headers: { 'X-Forwarded-For': freshIp() },
    });
    const quote = r.body!.quote as {
      title: string;
      notes: string;
      items: { description: string }[];
    };
    expect(quote.title).toBe(payload);
    expect(quote.notes).toBe(payload);
    expect(quote.items[0]!.description).toBe(payload);
    // Rendering is checked in the browser by tests/portal/portal.spec.ts.
  });
});

describe('file uploads', () => {
  let owner: SignedIn;
  beforeAll(async () => {
    owner = await signIn(users.ownerA.phone);
  });
  const photoPath = (ext: string) =>
    `${businesses.a}/quotes/${randomUUID()}/${randomUUID()}.${ext}`;
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

  it('accepts a JPEG photo in the business’s own folder', async () => {
    const { error } = await owner.client.storage
      .from('quote-photos')
      .upload(photoPath('jpg'), jpeg, { contentType: 'image/jpeg' });
    expect(error).toBeNull();
  });

  it.each([
    ['text/html', '<script>alert(1)</script>', 'html'],
    ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'svg'],
    ['application/javascript', 'alert(1)', 'js'],
    ['application/pdf', '%PDF-1.4', 'pdf'],
  ])('refuses %s in quote-photos and business-assets', async (contentType, content, ext) => {
    const bytes = new TextEncoder().encode(content);
    const photo = await owner.client.storage
      .from('quote-photos')
      .upload(photoPath(ext), bytes, { contentType });
    expect(storageStatus(photo.error)).toBe('415');
    const logo = await owner.client.storage
      .from('business-assets')
      .upload(`${businesses.a}/logo-${randomUUID()}.${ext}`, bytes, { contentType });
    expect(storageStatus(logo.error)).toBe('415');
  });

  it('refuses photos over 5 MB and logos over 2 MB', async () => {
    const photo = await owner.client.storage
      .from('quote-photos')
      .upload(photoPath('jpg'), new Uint8Array(5 * 1024 * 1024 + 1), {
        contentType: 'image/jpeg',
      });
    expect(storageStatus(photo.error)).toBe('413');
    const logo = await owner.client.storage
      .from('business-assets')
      .upload(`${businesses.a}/logo-${randomUUID()}.png`, new Uint8Array(2 * 1024 * 1024 + 1), {
        contentType: 'image/png',
      });
    expect(storageStatus(logo.error)).toBe('413');
  });

  it('serves an uploaded photo with the declared image type, never as HTML', async () => {
    // Storage checks the declared type, not the bytes: HTML declared as JPEG is
    // accepted, but it is served back as image/jpeg, so a browser will not run it.
    const path = photoPath('jpg');
    await owner.client.storage
      .from('quote-photos')
      .upload(path, new TextEncoder().encode('<script>alert(1)</script>'), {
        contentType: 'image/jpeg',
      });
    const { data } = await owner.client.storage.from('quote-photos').createSignedUrl(path, 60);
    const res = await fetch(data!.signedUrl);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    await res.arrayBuffer();
  });

  it('the file table refuses a row pointing into another business', async () => {
    const { error } = await owner.client.from('file').insert({
      id: randomUUID(),
      business_id: businesses.b,
      kind: 'quote_attachment',
      bucket: 'quote-photos',
      storage_path: `${businesses.b}/quotes/x/y.jpg`,
      mime_type: 'image/jpeg',
      size_bytes: 10,
    });
    expect(error?.code).toBe('42501');
  });
});
