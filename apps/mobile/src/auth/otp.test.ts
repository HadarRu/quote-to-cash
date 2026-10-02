import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OTP_MAX_SENDS,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OtpFlow,
  type OtpProvider,
  type ProviderError,
} from './otp.ts';

/** Mock SMS provider: remembers the last code "sent" to each number, like GoTrue's test OTP. */
function mockProvider() {
  const codes = new Map<string, string>();
  const provider = {
    send: vi.fn<OtpProvider['send']>(async (phone) => {
      codes.set(phone, '123456');
      return { error: null };
    }),
    verify: vi.fn<OtpProvider['verify']>(async (phone, code) =>
      codes.get(phone) === code
        ? { error: null }
        : {
            error: { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
          },
    ),
  };
  return provider;
}

describe('OtpFlow', () => {
  let clock: number;
  let provider: ReturnType<typeof mockProvider>;
  let flow: OtpFlow;

  beforeEach(() => {
    clock = 1_000_000;
    provider = mockProvider();
    flow = new OtpFlow(provider, () => clock);
  });

  it('normalizes the phone to E.164 and signs in with the right code', async () => {
    expect(await flow.start('052-123-4567')).toEqual({ ok: true });
    expect(provider.send).toHaveBeenCalledWith('+972521234567');
    expect(flow.phone).toBe('+972521234567');

    expect(await flow.verify('123 456')).toEqual({ ok: true });
    expect(provider.verify).toHaveBeenCalledWith('+972521234567', '123456');
  });

  it('rejects invalid phones without calling the provider', async () => {
    expect(await flow.start('12345')).toEqual({ ok: false, error: 'phone_invalid' });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('checks the code format locally', async () => {
    await flow.start('0521234567');
    expect(await flow.verify('12a45')).toEqual({ ok: false, error: 'code_format' });
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it('enforces the resend cooldown', async () => {
    await flow.start('0521234567');
    expect(flow.secondsUntilResend()).toBe(OTP_RESEND_COOLDOWN_SECONDS);
    expect(await flow.resend()).toEqual({ ok: false, error: 'cooldown' });

    clock += 30_000;
    expect(flow.secondsUntilResend()).toBe(30);

    clock += 30_000;
    expect(flow.secondsUntilResend()).toBe(0);
    expect(await flow.resend()).toEqual({ ok: true });
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('locks verification after too many wrong codes until a new code is sent', async () => {
    await flow.start('0521234567');
    for (let i = 1; i < OTP_MAX_VERIFY_ATTEMPTS; i++) {
      expect(await flow.verify('000000')).toEqual({ ok: false, error: 'code_invalid' });
      expect(flow.attemptsLeft).toBe(OTP_MAX_VERIFY_ATTEMPTS - i);
    }
    expect(await flow.verify('000000')).toEqual({ ok: false, error: 'too_many_attempts' });
    // Even the right code is refused now, without reaching the server.
    expect(await flow.verify('123456')).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(provider.verify).toHaveBeenCalledTimes(OTP_MAX_VERIFY_ATTEMPTS);

    clock += OTP_RESEND_COOLDOWN_SECONDS * 1000;
    expect(await flow.resend()).toEqual({ ok: true });
    expect(flow.attemptsLeft).toBe(OTP_MAX_VERIFY_ATTEMPTS);
    expect(await flow.verify('123456')).toEqual({ ok: true });
  });

  it('limits how many codes one number can receive', async () => {
    await flow.start('0521234567');
    for (let i = 1; i < OTP_MAX_SENDS; i++) {
      clock += OTP_RESEND_COOLDOWN_SECONDS * 1000;
      expect(await flow.resend()).toEqual({ ok: true });
    }
    clock += OTP_RESEND_COOLDOWN_SECONDS * 1000;
    expect(await flow.resend()).toEqual({ ok: false, error: 'too_many_sends' });
    expect(provider.send).toHaveBeenCalledTimes(OTP_MAX_SENDS);
  });

  it('maps provider rate limits and network failures', async () => {
    const rateLimited: ProviderError = {
      status: 429,
      code: 'over_sms_send_rate_limit',
      message: '...',
    };
    provider.send.mockResolvedValueOnce({ error: rateLimited });
    expect(await flow.start('0521234567')).toEqual({ ok: false, error: 'rate_limited' });

    provider.send.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await flow.start('0521234567')).toEqual({ ok: false, error: 'network' });
  });

  it('a failed send does not start the cooldown', async () => {
    provider.send.mockResolvedValueOnce({ error: { status: 500, message: 'boom' } });
    expect(await flow.start('0521234567')).toEqual({ ok: false, error: 'generic' });
    expect(flow.secondsUntilResend()).toBe(0);
    expect(await flow.start('0521234567')).toEqual({ ok: true });
  });
});
