import { PhoneSchema, type PhoneE164 } from '@q2c/types';

/** Codes are 6 digits (GoTrue default). */
export const OTP_LENGTH = 6;
/** Seconds between sends; the server enforces the same (config.toml auth.sms.max_frequency). */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** Wrong codes allowed per sent code before the user must request a new one. */
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
/** Codes that may be sent to one number within OTP_SEND_WINDOW_MS. */
export const OTP_MAX_SENDS = 3;
export const OTP_SEND_WINDOW_MS = 10 * 60 * 1000;

export type OtpErrorKey =
  | 'phone_invalid'
  | 'code_format'
  | 'code_invalid'
  | 'too_many_attempts'
  | 'cooldown'
  | 'too_many_sends'
  | 'rate_limited'
  | 'not_authenticated'
  | 'network'
  | 'generic';

export type OtpResult = { ok: true } | { ok: false; error: OtpErrorKey };

/** Error shape returned by supabase-js auth calls (AuthError). */
export interface ProviderError {
  status?: number;
  code?: string;
  name?: string;
  message: string;
}

/** The SMS side of a flow: sign-in, re-verifying the current number, or a phone change. */
export interface OtpProvider {
  send(phone: PhoneE164): Promise<{ error: ProviderError | null }>;
  verify(phone: PhoneE164, code: string): Promise<{ error: ProviderError | null }>;
}

export function mapProviderError(error: ProviderError): OtpErrorKey {
  if (error.status === 429 || error.code?.startsWith('over_')) return 'rate_limited';
  if (error.code === 'otp_expired' || error.code === 'otp_disabled') return 'code_invalid';
  if (error.code === 'phone_exists' || error.code === 'validation_failed') return 'phone_invalid';
  if (error.status === 401 || error.code === 'session_not_found') return 'not_authenticated';
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return 'network';
  return 'generic';
}

/**
 * Client-side rules for one OTP conversation (phone -> code). The server applies
 * its own rate limits; these give immediate, specific feedback and stop
 * hammering it.
 */
export class OtpFlow {
  private phoneE164: PhoneE164 | null = null;
  private sentAt: number[] = [];
  private attempts = 0;

  constructor(
    private readonly provider: OtpProvider,
    private readonly now: () => number = Date.now,
  ) {}

  get phone(): PhoneE164 | null {
    return this.phoneE164;
  }

  get attemptsLeft(): number {
    return Math.max(0, OTP_MAX_VERIFY_ATTEMPTS - this.attempts);
  }

  /** Whole seconds until another code may be sent (0 when allowed). */
  secondsUntilResend(): number {
    const last = this.sentAt.at(-1);
    if (last === undefined) return 0;
    const remainingMs = last + OTP_RESEND_COOLDOWN_SECONDS * 1000 - this.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  /** Validates and normalizes the typed phone, then sends the first code. */
  async start(rawPhone: string): Promise<OtpResult> {
    const parsed = PhoneSchema.safeParse(rawPhone);
    if (!parsed.success) return { ok: false, error: 'phone_invalid' };
    if (parsed.data !== this.phoneE164) {
      this.phoneE164 = parsed.data;
      this.sentAt = [];
      this.attempts = 0;
    }
    return this.send();
  }

  /** Sends another code to the same number. */
  async resend(): Promise<OtpResult> {
    if (!this.phoneE164) return { ok: false, error: 'phone_invalid' };
    return this.send();
  }

  async verify(rawCode: string): Promise<OtpResult> {
    if (!this.phoneE164) return { ok: false, error: 'phone_invalid' };
    const code = rawCode.replace(/\s/g, '');
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) return { ok: false, error: 'code_format' };
    if (this.attempts >= OTP_MAX_VERIFY_ATTEMPTS) return { ok: false, error: 'too_many_attempts' };

    this.attempts += 1;
    const { error } = await this.call(() => this.provider.verify(this.phoneE164!, code));
    if (!error) return { ok: true };
    const key = mapProviderError(error);
    if (key === 'code_invalid' && this.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      return { ok: false, error: 'too_many_attempts' };
    }
    return { ok: false, error: key };
  }

  private async send(): Promise<OtpResult> {
    if (this.secondsUntilResend() > 0) return { ok: false, error: 'cooldown' };
    const windowStart = this.now() - OTP_SEND_WINDOW_MS;
    this.sentAt = this.sentAt.filter((t) => t > windowStart);
    if (this.sentAt.length >= OTP_MAX_SENDS) return { ok: false, error: 'too_many_sends' };

    const { error } = await this.call(() => this.provider.send(this.phoneE164!));
    if (error) return { ok: false, error: mapProviderError(error) };
    this.sentAt.push(this.now());
    this.attempts = 0;
    return { ok: true };
  }

  /** Turns thrown network failures into the same `{ error }` shape. */
  private async call(fn: () => Promise<{ error: ProviderError | null }>) {
    try {
      return await fn();
    } catch {
      return { error: { status: 0, name: 'AuthRetryableFetchError', message: 'network' } };
    }
  }
}
