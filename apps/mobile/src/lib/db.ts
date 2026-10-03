import type { ErrorKey } from '@q2c/ui';
import { isNetworkError } from './errors';

/** Error shape returned by the Supabase Data API (PostgrestError and friends). */
export interface DbError {
  code?: string;
  message: string;
}

export type DbResult<T> = { data: T; error: null } | { data: null; error: DbError };

/** User-facing error key for a failed write. */
export function dbErrorKey(error: DbError): ErrorKey {
  if (error.code === '42501') return 'forbidden';
  if (isNetworkError(error)) return 'offline_write';
  return 'generic';
}
