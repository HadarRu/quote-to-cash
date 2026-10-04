import { FunctionsHttpError } from '@supabase/supabase-js';
import type { ApiResult } from '../quotes/outbox';
import type { AppSupabaseClient } from './supabase';

/**
 * Calls an Edge Function. Its `{ error }` body becomes the error code; 5xx,
 * 429 and requests that may not have arrived are retryable.
 */
export async function invokeFunction<T>(
  supabase: AppSupabaseClient,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke<T>(path, {
      method: options.method ?? 'POST',
      body: options.body as never,
    });
    if (!error && data) return { data, error: null };
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response;
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        data: null,
        error: {
          code: body.error,
          message: body.error ?? error.message,
          retryable: response.status >= 500 || response.status === 429,
        },
      };
    }
    // Relay and fetch errors: the request may not have arrived.
    return { data: null, error: { message: error?.message ?? 'network', retryable: true } };
  } catch (e) {
    return {
      data: null,
      error: { message: e instanceof Error ? e.message : 'network', retryable: true },
    };
  }
}
