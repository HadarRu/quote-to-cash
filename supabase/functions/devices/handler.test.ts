import { describe, expect, it, vi } from 'vitest';
import { handleDevices, type Deps } from './handler.ts';

const BUSINESS = '10000000-0000-4000-a000-000000000001';
const TOKEN = 'ExponentPushToken[abc-123]';

function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    register: vi.fn(async () => ({ data: 'device-id', error: null })),
    unregister: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

const request = (method: string, body: unknown, auth: string | null = 'Bearer user-jwt') =>
  new Request('http://localhost/devices', {
    method,
    headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  });

describe('handleDevices', () => {
  it('registers a token for the signed-in member', async () => {
    const d = deps();
    const response = await handleDevices(
      request('POST', { businessId: BUSINESS, token: TOKEN, platform: 'ios' }),
      d,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'device-id' });
    expect(d.register).toHaveBeenCalledWith('Bearer user-jwt', {
      businessId: BUSINESS,
      token: TOKEN,
      platform: 'ios',
    });
  });

  it('validates the token and platform on the server', async () => {
    const d = deps();
    const bad = await handleDevices(
      request('POST', { businessId: BUSINESS, token: 'abc', platform: 'ios' }),
      d,
    );
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: 'push_token_invalid' });
    const platform = await handleDevices(
      request('POST', { businessId: BUSINESS, token: TOKEN, platform: 'symbian' }),
      d,
    );
    expect(platform.status).toBe(422);
    expect(d.register).not.toHaveBeenCalled();
  });

  it('requires sign-in and membership', async () => {
    const anonymous = await handleDevices(
      request('POST', { businessId: BUSINESS, token: TOKEN, platform: 'ios' }, null),
      deps(),
    );
    expect(anonymous.status).toBe(401);
    const outsider = await handleDevices(
      request('POST', { businessId: BUSINESS, token: TOKEN, platform: 'ios' }),
      deps({
        register: async () => ({ data: null, error: { code: '42501', message: 'not a member' } }),
      }),
    );
    expect(outsider.status).toBe(403);
  });

  it('unregisters a token', async () => {
    const d = deps();
    const response = await handleDevices(request('DELETE', { token: TOKEN }), d);
    expect(response.status).toBe(200);
    expect(d.unregister).toHaveBeenCalledWith('Bearer user-jwt', TOKEN);
  });

  it('answers CORS preflight and rejects other paths and methods', async () => {
    expect(
      (await handleDevices(new Request('http://localhost/devices', { method: 'OPTIONS' }), deps()))
        .status,
    ).toBe(200);
    expect(
      (await handleDevices(new Request('http://localhost/devices', { method: 'GET' }), deps()))
        .status,
    ).toBe(405);
    expect(
      (await handleDevices(new Request('http://localhost/other', { method: 'POST' }), deps()))
        .status,
    ).toBe(404);
  });
});
