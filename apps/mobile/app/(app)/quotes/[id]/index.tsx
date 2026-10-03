import { canQuote } from '@q2c/types';
import { errorMessage, format, radius, space, strings } from '@q2c/ui';
import { DISPLAY_TIME_ZONE } from '@q2c/utils';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../../../../src/auth/AuthProvider';
import { useLogoUrl } from '../../../../src/business/useLogoUrl';
import { AppText } from '../../../../src/components/AppText';
import { Banner } from '../../../../src/components/Banner';
import { Button } from '../../../../src/components/Button';
import { FullScreenMessage } from '../../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../../src/components/LoadingView';
import { Screen } from '../../../../src/components/Screen';
import { useQuote, useQuotePhotos } from '../../../../src/quotes/hooks';
import {
  displayTotals,
  quoteTimeline,
  type QuoteListItem,
  type TimelineEvent,
} from '../../../../src/quotes/model';
import { QuoteDocument, quoteLabel } from '../../../../src/quotes/QuoteDocument';
import {
  getQuotesApi,
  getQuoteStore,
  notifyQuotesChanged,
  syncQuotes,
} from '../../../../src/quotes/sync';
import { useThemeColors } from '../../../../src/theme';

const timeFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const eventLabels: Record<TimelineEvent, string> = {
  created: strings.quotes.eventCreated,
  sent: strings.quotes.eventSent,
  viewed: strings.quotes.eventViewed,
  approved: strings.quotes.eventApproved,
  rejected: strings.quotes.eventRejected,
  cancelled: strings.quotes.eventCancelled,
  superseded: strings.quotes.eventSuperseded,
  expired: strings.quotes.eventExpired,
};

/** Quote details: status, the customer's version, history, and revise / cancel. */
export default function QuoteDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useQuote(id);

  const editable =
    state.status === 'success' &&
    state.data !== null &&
    canQuote('edit', state.data.status) &&
    !state.data.pendingSend;
  useEffect(() => {
    // Drafts open in the editor.
    if (editable) router.replace({ pathname: '/quotes/[id]/edit', params: { id } });
  }, [editable, id]);

  if (state.status === 'loading' || editable) return <LoadingView />;
  if (state.status === 'error')
    return (
      <FullScreenMessage
        title={strings.states.error}
        body={errorMessage(state.error)}
        actionLabel={strings.states.retry}
        onAction={() => void reload()}
      />
    );
  if (!state.data)
    return (
      <FullScreenMessage
        title={strings.quotes.notFound}
        actionLabel={strings.quotes.backToList}
        onAction={() => router.replace('/quotes')}
      />
    );
  return <Details quote={state.data} />;
}

function Details({ quote }: { quote: QuoteListItem }) {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const { photos } = useQuotePhotos(quote.id, business.id);
  const logoUrl = useLogoUrl(business.logoPath);
  const [confirm, setConfirm] = useState<'revise' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newerRevision, setNewerRevision] = useState<string | null>(null);

  useEffect(() => {
    if (quote.status !== 'superseded') return;
    void getQuoteStore()
      .then((store) => store.listQuotes(quote.businessId))
      .then((all) =>
        setNewerRevision(all.find((q) => q.supersedesQuoteId === quote.id)?.id ?? null),
      );
  }, [quote.status, quote.id, quote.businessId]);

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  const status = strings.quoteStatus[quote.status];

  const revise = async () => {
    setBusy(true);
    setError(null);
    const api = getQuotesApi();
    const newId = randomUUID();
    const result = await api.revise(quote.id, newId);
    if (result.error) {
      setBusy(false);
      setConfirm(null);
      return setError(errorMessage(result.error.retryable ? 'network' : (result.error.code ?? '')));
    }
    const store = await getQuoteStore();
    const [created, old] = await Promise.all([api.fetchQuote(newId), api.fetchQuote(quote.id)]);
    if (created.data) await store.putQuote(created.data);
    if (old.data) await store.putQuote(old.data);
    notifyQuotesChanged();
    setBusy(false);
    router.replace({ pathname: '/quotes/[id]/edit', params: { id: newId } });
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    await syncQuotes(true);
    const api = getQuotesApi();
    const result = await api.cancel(quote.id);
    const store = await getQuoteStore();
    if (result.error) {
      setBusy(false);
      setConfirm(null);
      return setError(errorMessage(result.error.retryable ? 'network' : (result.error.code ?? '')));
    }
    const fresh = await api.fetchQuote(quote.id);
    if (fresh.data) await store.putQuote(fresh.data);
    notifyQuotesChanged();
    setBusy(false);
    setConfirm(null);
  };

  return (
    <Screen title={quoteLabel(quote)} subtitle={quote.customerName ?? undefined}>
      <View style={card}>
        <AppText variant="heading" testID="quote-status">
          {quote.pendingSend ? strings.quotes.pendingSend : status}
        </AppText>
        {quote.revision > 1 ? (
          <AppText variant="muted">
            {format(strings.quotes.revisionLabel, { revision: quote.revision })}
          </AppText>
        ) : null}
        {quote.pendingSend ? <AppText variant="muted">{strings.quotes.pendingBody}</AppText> : null}
        {newerRevision ? (
          <Button
            variant="secondary"
            label={strings.quotes.openRevision}
            onPress={() => router.push({ pathname: '/quotes/[id]', params: { id: newerRevision } })}
          />
        ) : null}
      </View>

      {error ? <Banner tone="error" testID="quote-action-error" message={error} /> : null}

      {quote.link && (quote.status === 'sent' || quote.status === 'viewed') ? (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Button
              testID="quote-share-whatsapp"
              label={strings.quotes.shareWhatsapp}
              onPress={() => void Linking.openURL(quote.link!.whatsappUrl)}
            />
          </View>
          <View style={styles.grow}>
            <Button
              variant="secondary"
              label={strings.quotes.shareLink}
              onPress={() => void Share.share({ message: quote.link!.url }).catch(() => undefined)}
            />
          </View>
        </View>
      ) : null}

      <QuoteDocument
        quote={quote}
        totals={displayTotals(quote, business.vatRateBp)}
        business={{ name: business.name, logoUrl }}
        photoUris={(photos ?? []).flatMap((p) => (p.uri ? [p.uri] : []))}
      />

      <View style={card} testID="quote-timeline">
        <AppText variant="heading">{strings.quotes.timeline}</AppText>
        {quoteTimeline(quote).map((e) => (
          <View key={e.event} style={styles.event} testID={`quote-event-${e.event}`}>
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <AppText style={styles.grow}>{eventLabels[e.event]}</AppText>
            <AppText variant="muted">{timeFormatter.format(new Date(e.at))}</AppText>
          </View>
        ))}
      </View>

      {confirm ? (
        <View style={card}>
          <AppText>
            {confirm === 'revise' ? strings.quotes.reviseConfirm : strings.quotes.cancelConfirm}
          </AppText>
          <Button
            testID="quote-confirm"
            variant={confirm === 'cancel' ? 'danger' : 'primary'}
            label={confirm === 'revise' ? strings.quotes.reviseYes : strings.quotes.cancelYes}
            onPress={() => void (confirm === 'revise' ? revise() : cancel())}
            loading={busy}
          />
          <Button variant="ghost" label={strings.quotes.keep} onPress={() => setConfirm(null)} />
        </View>
      ) : (
        <>
          {canQuote('revise', quote.status) ? (
            <Button
              testID="quote-revise"
              variant="secondary"
              label={strings.quotes.revise}
              onPress={() => setConfirm('revise')}
            />
          ) : null}
          {canQuote('cancel', quote.status) && !quote.pendingSend ? (
            <Button
              testID="quote-cancel"
              variant="ghost"
              label={strings.quotes.cancelQuote}
              onPress={() => setConfirm('cancel')}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
  row: { flexDirection: 'row', gap: space(1) },
  grow: { flex: 1 },
  event: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
