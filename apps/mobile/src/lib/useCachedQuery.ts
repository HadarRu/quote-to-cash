import type { ErrorKey } from '@q2c/ui';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { cache } from './cache';
import { isNetworkError } from './errors';

type FetchResult<T> = { data: T; error: null } | { data: null; error: { message: string } };

export type CachedQueryState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ErrorKey }
  /** `offline`: the server could not be reached and `data` is the last saved copy. */
  | { status: 'success'; data: T; offline: boolean };

/**
 * Loads data with an offline copy: the cached value shows immediately, the
 * fetch replaces it, and when the fetch fails the cached value stays (marked
 * offline). Refetches whenever the screen regains focus.
 */
export function useCachedQuery<T>(cacheKey: string, fetcher: () => Promise<FetchResult<T>>) {
  const [state, setState] = useState<CachedQueryState<T>>({ status: 'loading' });

  const load = useCallback(async () => {
    const cached = await cache.get<T>(cacheKey);
    if (cached !== null) {
      setState((prev) =>
        prev.status === 'success' ? prev : { status: 'success', data: cached, offline: false },
      );
    }
    let result: FetchResult<T>;
    try {
      result = await fetcher();
    } catch (error) {
      result = {
        data: null,
        error: { message: error instanceof Error ? error.message : 'network' },
      };
    }
    if (result.error === null) {
      setState({ status: 'success', data: result.data, offline: false });
      await cache.set(cacheKey, result.data);
      return;
    }
    if (cached !== null) {
      setState({ status: 'success', data: cached, offline: true });
      return;
    }
    setState({ status: 'error', error: isNetworkError(result.error) ? 'network' : 'generic' });
  }, [cacheKey, fetcher]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { state, reload: load };
}
