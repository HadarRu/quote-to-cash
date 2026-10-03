import { canQuote } from '@q2c/types';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentBusiness } from '../auth/AuthProvider';
import { toServerDraft, type LocalQuote, type SyncState } from './model';
import { getQuoteStore, onQuotesChanged, syncQuotes } from './sync';

const AUTOSAVE_MS = 400;

export type DraftEditorState =
  | { status: 'loading' }
  | { status: 'missing' }
  /** Not a draft any more (sent, or a send is waiting): open the details instead. */
  | { status: 'locked' }
  | { status: 'error' }
  | { status: 'ready'; quote: LocalQuote };

/**
 * A draft being edited. Every change is saved on the device right away
 * (debounced) and queued for the server, so nothing is lost offline or if
 * the app is closed mid-edit.
 */
export function useDraftEditor(quoteId: string) {
  const { business } = useCurrentBusiness();
  const [state, setState] = useState<DraftEditorState>({ status: 'loading' });
  const [sync, setSync] = useState<SyncState | 'unsaved'>('synced');
  const latest = useRef<LocalQuote | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [focusCount, setFocusCount] = useState(0);
  // Coming back from Preview after sending: the draft is no longer editable.
  useFocusEffect(useCallback(() => setFocusCount((n) => n + 1), []));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const quote = await (await getQuoteStore()).getQuote(quoteId);
        if (cancelled) return;
        if (!quote) return setState({ status: 'missing' });
        if (!canQuote('edit', quote.status) || quote.pendingSend)
          return setState({ status: 'locked' });
        if (latest.current) return; // already editing: keep what is on screen
        const { sync: initialSync, pendingSend: _p, syncError: _e, link: _l, ...local } = quote;
        latest.current = local;
        setSync(initialSync);
        setState({ status: 'ready', quote: local });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quoteId, focusCount]);

  // Follow the outbox (pending -> synced) while editing.
  useEffect(
    () =>
      onQuotesChanged(() => {
        void getQuoteStore()
          .then((store) => store.getQuote(quoteId))
          .then((q) => {
            if (q && !timer.current) setSync(q.sync);
          });
      }),
    [quoteId],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const quote = latest.current;
    if (!quote) return;
    const store = await getQuoteStore();
    await store.saveDraft(quote, toServerDraft(quote, business.vatRateBp));
    const saved = await store.getQuote(quote.id);
    setSync(saved?.sync ?? 'pending');
    void syncQuotes();
  }, [business.vatRateBp]);

  const update = useCallback(
    (change: (quote: LocalQuote) => LocalQuote) => {
      const current = latest.current;
      if (!current) return;
      const next = { ...change(current), updatedAt: new Date().toISOString() };
      latest.current = next;
      setState({ status: 'ready', quote: next });
      setSync('unsaved');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush],
  );

  // Leaving the screen saves what was typed last.
  useEffect(
    () => () => {
      if (timer.current) void flush();
    },
    [flush],
  );

  return { state, sync, update, flush, vatRateBp: business.vatRateBp };
}
