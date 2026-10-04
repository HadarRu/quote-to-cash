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

  it('rejects a body that is not JSON', async () => {
    const d = deps();
    const response = await handleDevices(
      new Request('http://localhost/devices', {
        method: 'POST',
        headers: { Authorization: 'Bearer user-jwt' },
        body: '{not json',
      }),
      d,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_json' });
    expect(d.register).not.toHaveBeenCalled();
  });

  it('requires a Bearer token, not just any Authorization header', async () => {
    const d = deps();
    const response = await handleDevices(request('DELETE', { token: TOKEN }, 'Basic abc'), d);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'not_authenticated' });
    expect(d.unregister).not.toHaveBeenCalled();
  });

  it('validates the token when unregistering', async () => {
    const d = deps();
    const response = await handleDevices(request('DELETE', { token: 'abc' }), d);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'push_token_invalid' });
    expect(d.unregister).not.toHaveBeenCalled();
  });

  it('answers unregister with ok, and maps its database errors', async () => {
    const ok = await handleDevices(request('DELETE', { token: TOKEN }), deps());
    expect(await ok.json()).toEqual({ ok: true });
    const forbidden = await handleDevices(
      request('DELETE', { token: TOKEN }),
      deps({ unregister: async () => ({ error: { code: '42501', message: 'denied' } }) }),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'forbidden' });
  });

  it.each([
    ['23514', 422, 'push_token_invalid'],
    ['22P02', 422, 'push_token_invalid'],
    ['PGRST301', 401, 'not_authenticated'],
    ['401', 401, 'not_authenticated'],
  ])('maps database error %s to %i %s', async (code, status, error) => {
    const response = await handleDevices(
      request('POST', { businessId: BUSINESS, token: TOKEN, platform: 'android' }),
      deps({ register: async () => ({ data: null, error: { code, message: code } }) }),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it('answers 500 for an unknown database error or a missing id, and logs it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unknown = await handleDevices(
      request('POST', { businessId: BUSINESS, token: TOKEN, platform: 'web' }),
      deps({ register: async () => ({ data: null, error: { code: 'XX000', message: 'boom' } }) }),
    );
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: 'internal_error' });
    const noId = await handleDevices(
      request('POST', { businessId: BUSINESS, token: TOKEN, platform: 'web' }),
      deps({ register: async () => ({ data: null, error: null }) }),
    );
    expect(noId.status).toBe(500);
    expect(await noId.json()).toEqual({ error: 'internal_error' });
    const unregister = await handleDevices(
      request('DELETE', { token: TOKEN }),
      deps({ unregister: async () => ({ error: { message: 'no code' } }) }),
    );
    expect(unregister.status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledWith('devices: database error', null);
    consoleError.mockRestore();
  });

  it('sends CORS headers that allow DELETE on every answer', async () => {
    const preflight = await handleDevices(
      new Request('http://localhost/devices', { method: 'OPTIONS' }),
      deps(),
    );
    expect(await preflight.text()).toBe('ok');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('POST, DELETE, OPTIONS');
    for (const response of [
      await handleDevices(new Request('http://localhost/other', { method: 'POST' }), deps()),
      await handleDevices(request('POST', { token: 'abc' }, null), deps()),
      await handleDevices(request('DELETE', { token: TOKEN }), deps()),
    ]) {
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, DELETE, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
  });

  it('accepts a trailing slash on the path', async () => {
    const response = await handleDevices(
      new Request('http://localhost/functions/v1/devices/', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer user-jwt' },
        body: JSON.stringify({ token: TOKEN }),
      }),
      deps(),
    );
    expect(response.status).toBe(200);
  });
});
