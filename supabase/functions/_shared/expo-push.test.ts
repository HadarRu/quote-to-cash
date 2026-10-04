import { describe, expect, it, vi } from 'vitest';
import { EXPO_PUSH_URL, sendExpoPush, type ExpoMessage } from './expo-push.ts';

const message = (n: number): ExpoMessage => ({
  to: `ExponentPushToken[${n}]`,
  title: 't',
  body: 'b',
});

describe('sendExpoPush', () => {
  it('posts in chunks of 100 with the access token and returns tickets in order', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const chunk = JSON.parse(init.body as string) as ExpoMessage[];
      return new Response(JSON.stringify({ data: chunk.map((m) => ({ status: 'ok', id: m.to })) }));
    });
    const tickets = await sendExpoPush(
      Array.from({ length: 150 }, (_, i) => message(i)),
      { accessToken: 'secret', fetch: fetchMock as unknown as typeof fetch },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe(EXPO_PUSH_URL);
    expect((fetchMock.mock.calls[0]![1].headers as Record<string, string>).Authorization).toBe(
      'Bearer secret',
    );
    expect(tickets).toHaveLength(150);
    expect(tickets[149]).toEqual({ status: 'ok', id: 'ExponentPushToken[149]' });
  });

  it('turns server errors and lost connections into retryable tickets', async () => {
    const down = await sendExpoPush([message(1)], {
      fetch: (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    });
    expect(down[0]).toMatchObject({ status: 'error', details: { error: 'HTTPError' } });

    const offline = await sendExpoPush([message(1)], {
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(offline[0]).toMatchObject({ status: 'error', details: { error: 'NetworkError' } });
  });

  it('treats a rejected request as final', async () => {
    const tickets = await sendExpoPush([message(1)], {
      fetch: (async () => new Response('', { status: 400 })) as unknown as typeof fetch,
    });
    expect(tickets[0]).toMatchObject({ status: 'error', details: { error: 'HTTP400' } });
  });
});
