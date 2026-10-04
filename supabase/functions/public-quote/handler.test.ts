import type { QuoteSnapshot } from '@q2c/types';
import { describe, expect, it, vi } from 'vitest';
import { hashToken, newToken } from '../_shared/token.ts';
import { clientIp, handlePublicQuote, LIMITS, type DbView, type Deps } from './handler.ts';

const PEPPER = 'test-pepper';
const snapshot = {
  revision: 1,
  quote_number: 7,
  title: 'החלפת לוח',
  business: { name: 'כהן חשמל', logo_path: 'b/logo.png' },
  photos: ['b/quotes/q/1.jpg'],
} as unknown as QuoteSnapshot;

type Row = {
  status: 'sent' | 'viewed' | 'approved' | 'rejected' | 'cancelled' | 'superseded';
  expired: boolean;
  revoked: boolean;
  approval: { name: string; at: string; ip: string | null } | null;
  rejection: { reason: string | null; at: string } | null;
  comments: string[];
};

/** In-memory version of the public_quote_* SQL functions (same rules). */
function fakeDb() {
  const rows = new Map<string, Row>();
  const hits = new Map<string, number>();
  const find = (hash: string) => {
    const row = rows.get(hash);
    if (!row || (row.revoked && row.status !== 'cancelled' && row.status !== 'superseded'))
      return null;
    return row;
  };
  const state = (row: Row) =>
    row.status === 'cancelled' ||
    row.status === 'superseded' ||
    row.status === 'approved' ||
    row.status === 'rejected'
      ? row.status
      : row.expired
        ? 'expired'
        : 'open';
  const view = (row: Row, already?: boolean): DbView => {
    const s = state(row);
    if (s === 'cancelled' || s === 'superseded')
      return { state: s, business: { name: 'כהן חשמל' } };
    return {
      state: s,
      quote: snapshot,
      expires_at: '2026-10-17T20:59:59Z',
      approval: row.approval && { name: row.approval.name, at: row.approval.at },
      rejection: row.rejection,
      ...(already === undefined ? {} : { already }),
    };
  };
  const deps: Deps = {
    tokenPepper: PEPPER,
    hitRateLimit: async (bucket, limit) => {
      const n = (hits.get(bucket) ?? 0) + 1;
      hits.set(bucket, n);
      return n <= limit;
    },
    open: async (hash) => {
      const row = find(hash);
      if (!row) return { data: null, error: null };
      if (row.status === 'sent' && !row.expired) row.status = 'viewed';
      return { data: view(row), error: null };
    },
    respond: async (hash, action, name, reason, ip) => {
      const row = find(hash);
      if (!row) return { data: null, error: null };
      const s = state(row);
      if ((action === 'approve' && s === 'approved') || (action === 'reject' && s === 'rejected'))
        return { data: view(row, true), error: null };
      if (s !== 'open') return { data: null, error: { code: '55000', message: `quote is ${s}` } };
      if (action === 'approve') {
        row.status = 'approved';
        row.approval = { name: name!, at: '2026-10-03T12:00:00Z', ip };
      } else {
        row.status = 'rejected';
        row.rejection = { reason, at: '2026-10-03T12:00:00Z' };
      }
      return { data: view(row, false), error: null };
    },
    comment: async (hash, body) => {
      const row = find(hash);
      if (!row) return { data: null, error: null };
      row.comments.push(body);
      return { data: true, error: null };
    },
    signUrls: async (logo, photos) => ({
      logoUrl: logo ? `https://storage.test/${logo}?sig` : null,
      photoUrls: photos.map((p) => `https://storage.test/${p}?sig`),
    }),
  };
  const add = async (over: Partial<Row> = {}) => {
    const token = newToken();
    rows.set(await hashToken(token, PEPPER), {
      status: 'sent',
      expired: false,
      revoked: false,
      approval: null,
      rejection: null,
      comments: [],
      ...over,
    });
    return token;
  };
  return { deps, rows, add };
}

let ipCounter = 0;
function call(
  deps: Deps,
  token: string,
  init: { action?: 'approve' | 'reject' | 'comment'; body?: unknown; ip?: string } = {},
) {
  const path = `/public-quote/${token}${init.action ? `/${init.action}` : ''}`;
  return handlePublicQuote(
    new Request(`http://localhost${path}`, {
      method: init.action ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': init.ip ?? `203.0.113.${(ipCounter++ % 250) + 1}, 10.0.0.1`,
      },
      body: init.action ? JSON.stringify(init.body ?? {}) : undefined,
    }),
    deps,
  );
}

const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].sort(),
});

describe('public quote: token security', () => {
  it('unknown, malformed and revoked links get byte-identical responses', async () => {
    const { deps, add } = fakeDb();
    const revoked = await add({ revoked: true });
    const responses = await Promise.all(
      [
        call(deps, newToken()), // a well-formed guess
        call(deps, 'short'), // malformed
        call(deps, revoked), // revoked
      ].map(async (r) => snapshotOf(await r)),
    );
    expect(responses[0]).toEqual({ ...responses[0], status: 404, body: '{"error":"not_found"}' });
    expect(responses[1]).toEqual(responses[0]);
    expect(responses[2]).toEqual(responses[0]);
  });

  it('a guessed token never finds a quote, and the database only ever sees peppered hashes', async () => {
    const { deps, add } = fakeDb();
    const real = await add();
    const open = vi.spyOn(deps, 'open');
    for (let i = 0; i < 20; i++) expect((await call(deps, newToken())).status).toBe(404);
    expect((await call(deps, real)).status).toBe(200);
    for (const [hash] of open.mock.calls) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toBe(real);
    }
    expect(open.mock.calls.at(-1)![0]).toBe(await hashToken(real, PEPPER));
  });

  it('a link stops working once revoked, but says why when the quote was cancelled or revised', async () => {
    const { deps, add, rows } = fakeDb();
    const token = await add();
    expect((await call(deps, token)).status).toBe(200);
    const row = rows.get(await hashToken(token, PEPPER))!;
    row.revoked = true;
    expect((await call(deps, token)).status).toBe(404);
    expect((await call(deps, token, { action: 'approve', body: { name: 'דנה' } })).status).toBe(
      404,
    );
    row.status = 'superseded';
    expect(await (await call(deps, token)).json()).toEqual({
      state: 'superseded',
      business: { name: 'כהן חשמל' },
    });
  });

  it('an expired link shows the expired state and cannot be approved', async () => {
    const { deps, add } = fakeDb();
    const token = await add({ expired: true });
    expect(((await (await call(deps, token)).json()) as { state: string }).state).toBe('expired');
    const res = await call(deps, token, { action: 'approve', body: { name: 'דנה לוי' } });
    expect([res.status, await res.json()]).toEqual([409, { error: 'quote_closed' }]);
  });

  it('rate limits per IP and per token', async () => {
    const { deps, add } = fakeDb();
    const token = await add();
    const fromOneIp = [];
    for (let i = 0; i <= LIMITS.ipRead; i++)
      fromOneIp.push((await call(deps, newToken(), { ip: '198.51.100.9' })).status);
    expect(fromOneIp.slice(0, LIMITS.ipRead).every((s) => s === 404)).toBe(true);
    expect(fromOneIp.at(-1)).toBe(429);

    const oneToken = [];
    for (let i = 0; i <= LIMITS.token; i++) oneToken.push((await call(deps, token)).status); // many IPs
    expect(oneToken.at(-1)).toBe(429);
    expect(oneToken.slice(0, LIMITS.token).every((s) => s === 200)).toBe(true);
  });
});

describe('public quote: answers', () => {
  it('approving requires a typed name and stores it with the IP', async () => {
    const { deps, add, rows } = fakeDb();
    const token = await add();
    const empty = await call(deps, token, { action: 'approve', body: { name: ' א ' } });
    expect([empty.status, await empty.json()]).toEqual([422, { error: 'approve_name_required' }]);

    const res = await call(deps, token, {
      action: 'approve',
      body: { name: '  דנה לוי ' },
      ip: '203.0.113.50, 10.0.0.1',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: 'approved',
      already: false,
      approval: { name: 'דנה לוי' },
    });
    expect(rows.get(await hashToken(token, PEPPER))!.approval).toMatchObject({
      name: 'דנה לוי',
      ip: '203.0.113.50',
    });
  });

  it('a double approval is harmless and the IP never reaches the page', async () => {
    const { deps, add } = fakeDb();
    const token = await add();
    await call(deps, token, { action: 'approve', body: { name: 'דנה לוי' } });
    const again = await call(deps, token, { action: 'approve', body: { name: 'מישהו אחר' } });
    const body = await again.text();
    expect(again.status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ already: true, approval: { name: 'דנה לוי' } });
    expect(body).not.toMatch(/203\.0\.113/);
  });

  it('rejects with an optional reason; an approved quote cannot be rejected', async () => {
    const { deps, add } = fakeDb();
    const a = await add();
    expect(
      ((await (await call(deps, a, { action: 'reject' })).json()) as { state: string }).state,
    ).toBe('rejected');
    const b = await add();
    await call(deps, b, { action: 'approve', body: { name: 'דנה לוי' } });
    expect((await call(deps, b, { action: 'reject', body: { reason: 'יקר' } })).status).toBe(409);
  });

  it('stores comments as plain text', async () => {
    const { deps, add, rows } = fakeDb();
    const token = await add();
    const body = '<script>alert(1)</script> אפשר מחר?';
    expect((await call(deps, token, { action: 'comment', body: { body } })).status).toBe(200);
    expect(rows.get(await hashToken(token, PEPPER))!.comments).toEqual([body]);
    expect((await call(deps, token, { action: 'comment', body: { body: '  ' } })).status).toBe(422);
  });

  it('returns signed URLs for the logo and photos', async () => {
    const { deps, add } = fakeDb();
    expect(await (await call(deps, await add())).json()).toMatchObject({
      logoUrl: 'https://storage.test/b/logo.png?sig',
      photoUrls: ['https://storage.test/b/quotes/q/1.jpg?sig'],
    });
  });

  it('checks methods and request bodies', async () => {
    const { deps, add } = fakeDb();
    const token = await add();
    const res = await handlePublicQuote(
      new Request(`http://localhost/public-quote/${token}/approve`, {
        method: 'POST',
        body: '{oops',
      }),
      deps,
    );
    expect(res.status).toBe(400);
    const get = await handlePublicQuote(
      new Request(`http://localhost/public-quote/${token}/approve`),
      deps,
    );
    expect(get.status).toBe(405);
  });
});

describe('clientIp', () => {
  it('takes the first forwarded address and ignores junk', () => {
    const req = (value: string) =>
      new Request('http://x', { headers: { 'X-Forwarded-For': value } });
    expect(clientIp(req('203.0.113.7, 10.0.0.1'))).toBe('203.0.113.7');
    expect(clientIp(req('2001:db8::1'))).toBe('2001:db8::1');
    expect(clientIp(req('<script>'))).toBeNull();
    expect(clientIp(new Request('http://x'))).toBeNull();
  });
});

describe('public quote: failures', () => {
  it('maps database errors, and never leaks their text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, add } = fakeDb();
    const token = await add();
    const failing = (code: string | undefined): Deps => ({
      ...deps,
      respond: async () => ({ data: null, error: { code, message: 'secret detail' } }),
      open: async () => ({ data: null, error: { code, message: 'secret detail' } }),
    });
    const approve = (d: Deps) => call(d, token, { action: 'approve', body: { name: 'דנה לוי' } });
    expect((await approve(failing('22023'))).status).toBe(422);
    const res = await approve(failing('XX000'));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
    expect((await call(failing(undefined), token)).status).toBe(500);
    consoleError.mockRestore();
  });

  it('answers 500 when a dependency throws, and when the pepper is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, add } = fakeDb();
    const token = await add();
    const throwing: Deps = {
      ...deps,
      open: async () => {
        throw new Error('boom');
      },
    };
    const res = await call(throwing, token);
    expect(res.status).toBe(500);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await call({ ...deps, tokenPepper: '' }, token)).status).toBe(500);
    consoleError.mockRestore();
  });
});
