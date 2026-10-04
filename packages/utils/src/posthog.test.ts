import { describe, expect, it, vi } from 'vitest';
import { captureBatch, DEFAULT_POSTHOG_HOST } from './posthog.ts';

describe('captureBatch', () => {
  it('posts the events to the batch endpoint with the project key', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    const accepted = await captureBatch(
      [{ event: 'app_opened', distinctId: 'user-1', properties: { platform: 'ios' } }],
      { apiKey: 'phc_test', fetch: fetchMock },
    );
    expect(accepted).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe(`${DEFAULT_POSTHOG_HOST}/batch/`);
    expect(JSON.parse(init.body)).toEqual({
      api_key: 'phc_test',
      batch: [{ event: 'app_opened', distinct_id: 'user-1', properties: { platform: 'ios' } }],
    });
  });

  it('reports failure instead of throwing', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(
      await captureBatch([{ event: 'app_opened', distinctId: 'u' }], {
        apiKey: 'k',
        host: 'https://ph.example.com/',
        fetch: offline,
      }),
    ).toBe(false);
    expect(await captureBatch([], { apiKey: 'k', fetch: offline })).toBe(true);
    expect(offline).toHaveBeenCalledTimes(1);
  });
});
