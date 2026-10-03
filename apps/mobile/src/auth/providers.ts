import type { AppSupabaseClient } from '../lib/supabase';
import type { OtpProvider } from './otp';

/** Sign in or sign up with a code sent to the phone. */
export function signInProvider(supabase: AppSupabaseClient): OtpProvider {
  return {
    send: async (phone) => ({ error: (await supabase.auth.signInWithOtp({ phone })).error }),
    verify: async (phone, token) => ({
      error: (await supabase.auth.verifyOtp({ phone, token, type: 'sms' })).error,
    }),
  };
}

/** Proves the signed-in user still controls their current number (never creates a user). */
export function currentPhoneProvider(supabase: AppSupabaseClient): OtpProvider {
  return {
    send: async (phone) => ({
      error: (await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } }))
        .error,
    }),
    verify: async (phone, token) => ({
      error: (await supabase.auth.verifyOtp({ phone, token, type: 'sms' })).error,
    }),
  };
}

/** Moves the account to a new number once a code sent to that number is confirmed. */
export function phoneChangeProvider(supabase: AppSupabaseClient): OtpProvider {
  return {
    send: async (phone) => ({ error: (await supabase.auth.updateUser({ phone })).error }),
    verify: async (phone, token) => ({
      error: (await supabase.auth.verifyOtp({ phone, token, type: 'phone_change' })).error,
    }),
  };
}
