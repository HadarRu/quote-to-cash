import type { ErrorKey } from '@q2c/ui';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuoteListItem } from './model';
import type { LocalPhoto } from './store';
import { getQuotesApi, getQuoteStore, onQuotesChanged, refreshQuotes } from './sync';

export type LocalQueryState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ErrorKey }
  /** `offline`: the server could not be reached; the device copy is shown. */
  | { status: 'success'; data: T; offline: boolean };

/** The business's quotes from the device, refreshed from the server whenever the screen is shown. */
export function useQuoteList(businessId: string) {
  const [state, setState] = useState<LocalQueryState<QuoteListItem[]>>({ status: 'loading' });
  const [offline, setOffline] = useState(false);
  const refreshed = useRef(false);

  const loadLocal = useCallback(async () => {
    try {
      const data = await (await getQuoteStore()).listQuotes(businessId);
      // A device with no copy yet waits for the server instead of showing "no quotes".
      if (data.length === 0 && !refreshed.current) return;
      setState({ status: 'success', data, offline: false });
    } catch {
      setState({ status: 'error', error: 'generic' });
    }
  }, [businessId]);

  useEffect(() => onQuotesChanged(() => void loadLocal()), [loadLocal]);

  const refresh = useCallback(async () => {
    await loadLocal();
    const result = await refreshQuotes(businessId).catch(() => ({ offline: true }));
    refreshed.current = true;
    setOffline(result.offline);
    await loadLocal();
  }, [businessId, loadLocal]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const withOffline: LocalQueryState<QuoteListItem[]> =
    state.status === 'success' ? { ...state, offline } : state;
  return { state: withOffline, reload: refresh };
}

/** Reads a quote from the device, or from the server when this device has no copy yet. */
async function loadQuote(quoteId: string): Promise<LocalQueryState<QuoteListItem | null>> {
  try {
    const store = await getQuoteStore();
    const local = await store.getQuote(quoteId);
    if (local) return { status: 'success', data: local, offline: false };
    const result = await getQuotesApi().fetchQuote(quoteId);
    if (result.error)
      return { status: 'error', error: result.error.retryable ? 'network' : 'generic' };
    if (result.data) await store.putQuote(result.data);
    return { status: 'success', data: await store.getQuote(quoteId), offline: false };
  } catch {
    return { status: 'error', error: 'generic' };
  }
}

/** Bumps whenever local quote data changes, to re-read it. */
function useQuotesVersion(): [number, () => void] {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => onQuotesChanged(bump), [bump]);
  return [version, bump];
}

/** One quote, kept current as the outbox and refreshes change it. */
export function useQuote(quoteId: string) {
  const [state, setState] = useState<LocalQueryState<QuoteListItem | null>>({ status: 'loading' });
  const [version, reload] = useQuotesVersion();

  useEffect(() => {
    let cancelled = false;
    void loadQuote(quoteId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [quoteId, version]);

  return { state, reload };
}

type PhotoWithUri = LocalPhoto & { uri: string | null };

async function loadPhotos(quoteId: string, businessId: string): Promise<PhotoWithUri[]> {
  const store = await getQuoteStore();
  const api = getQuotesApi();
  const server = await api.listPhotos(quoteId);
  if (server.data) {
    await store.mergeServerPhotos(
      quoteId,
      server.data.filter((p) => p.businessId === businessId),
    );
  }
  const local = await store.listPhotos(quoteId);
  return Promise.all(
    local.map(async (p) => ({
      ...p,
      uri: p.data ? `data:image/jpeg;base64,${p.data}` : await api.photoUrl(p.path),
    })),
  );
}

/** Photos of a quote: this device's (shown from local data) plus those already on the server. */
export function useQuotePhotos(quoteId: string, businessId: string) {
  const [photos, setPhotos] = useState<PhotoWithUri[] | null>(null);
  const [version] = useQuotesVersion();

  useEffect(() => {
    let cancelled = false;
    loadPhotos(quoteId, businessId)
      .then((next) => {
        if (!cancelled) setPhotos(next);
      })
      .catch(() => {
        if (!cancelled) setPhotos((current) => current ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [quoteId, businessId, version]);

  return { photos };
}
