import type { PublicQuoteView } from '@q2c/types';

export type QuoteView = PublicQuoteView & { already?: boolean };

/** Every way a call can end, as the page shows it. */
export type Failure =
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'closed' }
  | { kind: 'invalid'; error: string }
  | { kind: 'error' };

export type Result<T> = { kind: 'ok'; data: T } | Failure;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Calls the `public-quote` Edge Function straight from the customer's browser,
 * so the function sees their IP (for rate limits and the approval record).
 */
async function call<T>(token: string, action?: string, body?: unknown): Promise<Result<T>> {
  const path = `${encodeURIComponent(token)}${action ? `/${action}` : ''}`;
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/public-quote/${path}`, {
      method: action ? 'POST' : 'GET',
      headers: { apikey: anonKey, ...(action ? { 'Content-Type': 'application/json' } : {}) },
      body: action ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error' };
  }
  if (res.status === 404) return { kind: 'not_found' };
  if (res.status === 429) return { kind: 'rate_limited' };
  if (res.status === 409) return { kind: 'closed' };
  const json = (await res.json().catch(() => null)) as unknown;
  if (res.status === 422)
    return { kind: 'invalid', error: (json as { error?: string } | null)?.error ?? 'generic' };
  if (!res.ok || json === null) return { kind: 'error' };
  return { kind: 'ok', data: json as T };
}

export const loadQuote = (token: string) => call<QuoteView>(token);

export const approveQuote = (token: string, name: string) =>
  call<QuoteView>(token, 'approve', { name });

export const rejectQuote = (token: string, reason: string) =>
  call<QuoteView>(token, 'reject', { reason });

export const sendComment = (token: string, body: string) =>
  call<{ ok: true }>(token, 'comment', { body });
