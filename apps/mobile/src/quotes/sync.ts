import * as Network from 'expo-network';
import { openDatabaseAsync } from 'expo-sqlite';
import { AppState } from 'react-native';
import { getSupabase } from '../lib/supabase';
import { supabaseQuotesApi, type SupabaseQuotesApi } from './api';
import { processOutbox } from './outbox';
import { QuoteStore } from './store';

let storePromise: Promise<QuoteStore> | null = null;

/** The device's quote database (opened once, survives restarts). */
export function getQuoteStore(): Promise<QuoteStore> {
  storePromise ??= openDatabaseAsync('q2c.db').then((db) => QuoteStore.open(db));
  return storePromise;
}

let api: SupabaseQuotesApi | null = null;
export function getQuotesApi(): SupabaseQuotesApi {
  api ??= supabaseQuotesApi(getSupabase());
  return api;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Re-render hooks after local data changed (edits, outbox progress, server refresh). */
export function onQuotesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyQuotesChanged(): void {
  for (const listener of listeners) listener();
}

/**
 * Delivers the outbox now. `force` ignores retry backoff (the connection just
 * came back, or the user asked). Concurrent calls share one run.
 */
export function syncQuotes(force = false): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const store = await getQuoteStore();
        const result = await processOutbox(store, getQuotesApi(), { now: Date.now(), force });
        if (result.done > 0 || result.offline) notifyQuotesChanged();
        scheduleNext(store);
      } while (again);
    } catch (error) {
      console.warn('quote sync failed', error);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Wakes up for the next retry that is due (backoff), if any. */
function scheduleNext(store: QuoteStore) {
  if (timer) clearTimeout(timer);
  timer = null;
  void store.pendingOps().then((ops) => {
    const waiting = ops.filter((o) => !o.failed).map((o) => o.nextAttemptAt);
    if (!waiting.length) return;
    const delay = Math.max(Math.min(...waiting) - Date.now(), 1000);
    timer = setTimeout(() => void syncQuotes(), delay);
  });
}

/** Starts background delivery: now, whenever the connection returns, and when the app is reopened. */
export function startQuoteSync(): void {
  if (started) return;
  started = true;
  void syncQuotes(true);
  Network.addNetworkStateListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) void syncQuotes(true);
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncQuotes(true);
  });
}

/** Pulls the business's quotes from the server into the device copy (after delivering local changes). */
export async function refreshQuotes(businessId: string): Promise<{ offline: boolean }> {
  await syncQuotes(true);
  const result = await getQuotesApi().listQuotes(businessId);
  if (result.error) return { offline: true };
  const store = await getQuoteStore();
  await store.mergeServerQuotes(businessId, result.data);
  notifyQuotesChanged();
  return { offline: false };
}

/** Signing out: the next user starts with an empty device copy. */
export async function clearQuotes(): Promise<void> {
  const store = await getQuoteStore();
  await store.clear();
  notifyQuotesChanged();
}
