import { afterEach, describe, expect, it, vi } from 'vitest';
import { approveQuote, loadQuote, rejectQuote, scheduleVisit, sendComment } from './api';

const TOKEN = 'T'.repeat(43);

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public quote API client', () => {
  it('GETs the quote and returns it', async () => {
    const fetchMock = respond(200, { state: 'open' });
    expect(await loadQuote(TOKEN)).toEqual({ kind: 'ok', data: { state: 'open' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(new RegExp(`/functions/v1/public-quote/${TOKEN}$`));
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('POSTs answers and comments as JSON to their action path', async () => {
    const fetchMock = respond(200, { ok: true });
    await approveQuote(TOKEN, 'דנה');
    await rejectQuote(TOKEN, 'יקר');
    await sendComment(TOKEN, 'שאלה');
    expect(
      fetchMock.mock.calls.map(([url, init]) => [
        url.split('/public-quote/')[1],
        init?.method,
        init?.body,
      ]),
    ).toEqual([
      [`${TOKEN}/approve`, 'POST', JSON.stringify({ name: 'דנה' })],
      [`${TOKEN}/reject`, 'POST', JSON.stringify({ reason: 'יקר' })],
      [`${TOKEN}/comment`, 'POST', JSON.stringify({ body: 'שאלה' })],
    ]);
  });

  it('escapes the token into one path segment', async () => {
    const fetchMock = respond(404, { error: 'not_found' });
    await loadQuote('../../rest/v1/quote?select=*');
    expect(fetchMock.mock.calls[0]![0]).toMatch(
      /\/public-quote\/\.\.%2F\.\.%2Frest%2Fv1%2Fquote%3Fselect%3D\*$/,
    );
  });

  it.each([
    [404, { error: 'not_found' }, { kind: 'not_found' }],
    [429, { error: 'rate_limited' }, { kind: 'rate_limited' }],
    [409, { error: 'quote_closed' }, { kind: 'closed' }],
    [422, { error: 'approve_name_required' }, { kind: 'invalid', error: 'approve_name_required' }],
    [422, 'not json', { kind: 'invalid', error: 'generic' }],
    [500, { error: 'internal_error' }, { kind: 'error' }],
    [200, 'not json', { kind: 'error' }],
  ])('maps %i %j', async (status, body, expected) => {
    respond(status, body);
    expect(await approveQuote(TOKEN, 'דנה')).toEqual(expected);
  });

  it('maps a network failure to an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await loadQuote(TOKEN)).toEqual({ kind: 'error' });
  });
});

describe('scheduleVisit', () => {
  it('posts the chosen slot to the schedule endpoint', async () => {
    const fetchMock = respond(200, { state: 'approved' });
    expect(await scheduleVisit('tok', 'slot-1')).toEqual({
      kind: 'ok',
      data: { state: 'approved' },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/functions\/v1\/public-quote\/tok\/schedule$/);
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ slotId: 'slot-1' }) });
  });

  it('tells a taken time apart from a closed quote', async () => {
    respond(409, { error: 'conflict' });
    expect(await scheduleVisit('tok', 'slot-1')).toEqual({ kind: 'conflict' });
    respond(409, { error: 'already_scheduled' });
    expect(await scheduleVisit('tok', 'slot-1')).toEqual({ kind: 'closed' });
  });
});
