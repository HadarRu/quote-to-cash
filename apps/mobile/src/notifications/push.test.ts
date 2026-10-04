import { describe, expect, it, vi } from 'vitest';
import {
  pushTarget,
  registerForPush,
  withDefaults,
  type DevicesApi,
  type PushDevice,
} from './push.ts';

const BUSINESS = '10000000-0000-4000-a000-000000000001';
const TOKEN = 'ExponentPushToken[abc]';

function device(overrides: Partial<PushDevice> = {}): PushDevice {
  return {
    platform: 'ios',
    canReceivePush: true,
    getPermission: vi.fn(async () => 'granted' as const),
    requestPermission: vi.fn(async () => 'granted' as const),
    getToken: vi.fn(async () => TOKEN),
    ...overrides,
  };
}

const api = (error: { message: string } | null = null): DevicesApi => ({
  register: vi.fn(async () => ({ error })),
});

describe('registerForPush', () => {
  it('registers the token for the business', async () => {
    const devices = api();
    expect(await registerForPush(BUSINESS, device(), devices)).toEqual({
      status: 'registered',
      token: TOKEN,
    });
    expect(devices.register).toHaveBeenCalledWith({
      businessId: BUSINESS,
      token: TOKEN,
      platform: 'ios',
    });
  });

  it('asks for permission only when it was never asked', async () => {
    const d = device({ getPermission: vi.fn(async () => 'undetermined' as const) });
    await registerForPush(BUSINESS, d, api());
    expect(d.requestPermission).toHaveBeenCalledTimes(1);

    const granted = device();
    await registerForPush(BUSINESS, granted, api());
    expect(granted.requestPermission).not.toHaveBeenCalled();
  });

  it('stops when permission is denied or push is unavailable', async () => {
    const devices = api();
    expect(
      (
        await registerForPush(
          BUSINESS,
          device({ getPermission: vi.fn(async () => 'denied' as const) }),
          devices,
        )
      ).status,
    ).toBe('denied');
    expect(
      (await registerForPush(BUSINESS, device({ canReceivePush: false }), devices)).status,
    ).toBe('unsupported');
    expect(devices.register).not.toHaveBeenCalled();
  });

  it('reports failures instead of throwing', async () => {
    expect(
      (
        await registerForPush(
          BUSINESS,
          device({
            getToken: vi.fn(async () => {
              throw new Error('no project id');
            }),
          }),
          api(),
        )
      ).status,
    ).toBe('failed');
    expect((await registerForPush(BUSINESS, device(), api({ message: 'offline' }))).status).toBe(
      'failed',
    );
    expect(
      (await registerForPush(BUSINESS, device({ getToken: vi.fn(async () => 'garbage') }), api()))
        .status,
    ).toBe('failed');
  });
});

describe('withDefaults', () => {
  it('turns every event on unless the member turned it off', () => {
    const prefs = withDefaults([{ event: 'quote_viewed', push_enabled: false }]);
    expect(prefs.quote_viewed).toBe(false);
    expect(prefs.payment_received).toBe(true);
    expect(Object.keys(prefs)).toHaveLength(8);
  });
});

describe('pushTarget', () => {
  it('opens in-app paths only', () => {
    expect(pushTarget({ url: '/quotes/80000000-0000-4000-a000-000000000001' })).toBe(
      '/quotes/80000000-0000-4000-a000-000000000001',
    );
    expect(pushTarget({ url: 'https://evil.example' })).toBeNull();
    expect(pushTarget(null)).toBeNull();
  });
});
