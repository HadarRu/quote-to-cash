import { canQuote, QuoteSlotsSchema, slotsInFuture } from '@q2c/types';
import { errorMessage, format, strings } from '@q2c/ui';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Share } from 'react-native';
import { useCurrentBusiness } from '../../../../src/auth/AuthProvider';
import { useLogoUrl } from '../../../../src/business/useLogoUrl';
import { AppText } from '../../../../src/components/AppText';
import { Banner } from '../../../../src/components/Banner';
import { Button } from '../../../../src/components/Button';
import { FullScreenMessage } from '../../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../../src/components/LoadingView';
import { Screen } from '../../../../src/components/Screen';
import { useQuote, useQuotePhotos } from '../../../../src/quotes/hooks';
import { displayTotals, type QuoteListItem } from '../../../../src/quotes/model';
import { QuoteDocument } from '../../../../src/quotes/QuoteDocument';
import { SlotPicker } from '../../../../src/quotes/SlotPicker';
import { toSlot, type SlotChoice } from '../../../../src/quotes/slots';
import { getQuoteStore, notifyQuotesChanged, syncQuotes } from '../../../../src/quotes/sync';

/** The quote exactly as the customer will see it, and the Send button. */
export default function PreviewQuote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { business } = useCurrentBusiness();
  const { state, reload } = useQuote(id);
  const { photos } = useQuotePhotos(id, business.id);
  const logoUrl = useLogoUrl(business.logoPath);
  // Proposed visit times, sent with the quote.
  const [choices, setChoices] = useState<SlotChoice[]>([]);

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error')
    return (
      <FullScreenMessage
        title={strings.states.error}
        body={errorMessage(state.error)}
        actionLabel={strings.states.retry}
        onAction={() => void reload()}
      />
    );
  const quote = state.data;
  if (!quote)
    return (
      <FullScreenMessage
        title={strings.quotes.notFound}
        actionLabel={strings.quotes.backToList}
        onAction={() => router.replace('/quotes')}
      />
    );

  return (
    <Screen
      title={strings.quotes.previewTitle}
      footer={<SendPanel quote={quote} choices={choices} />}
    >
      <QuoteDocument
        quote={quote}
        totals={displayTotals(quote, business.vatRateBp)}
        business={{ name: business.name, logoUrl }}
        photoUris={(photos ?? []).flatMap((p) => (p.uri ? [p.uri] : []))}
      />
      {quote.status === 'draft' && !quote.pendingSend ? (
        <SlotPicker value={choices} onChange={setChoices} />
      ) : null}
    </Screen>
  );
}

/** Send, then: sent (share links), waiting for a connection, or refused. */
function SendPanel({ quote, choices }: { quote: QuoteListItem; choices: SlotChoice[] }) {
  // One key for this quote's send; queueSend keeps the first one on repeated taps.
  const [sendKey] = useState(() => randomUUID());
  const [sending, setSending] = useState(false);
  // Shown until the times change.
  const [refused, setRefused] = useState<{ choices: SlotChoice[]; error: string } | null>(null);
  const slotError = refused?.choices === choices ? refused.error : null;
  const setSlotError = (error: string) => setRefused({ choices, error });

  const send = async () => {
    // Same rules as the server (packages/types): none, or 2-3 future times that do not overlap.
    const slots = choices.map(toSlot);
    if (slots.length) {
      const parsed = QuoteSlotsSchema.safeParse(slots);
      if (!parsed.success)
        return setSlotError(errorMessage(parsed.error.issues[0]?.message ?? 'generic'));
      if (!slotsInFuture(slots, new Date())) return setSlotError(errorMessage('slot_in_past'));
    }
    setRefused(null);
    setSending(true);
    const store = await getQuoteStore();
    await store.queueSend(quote.id, sendKey, slots);
    notifyQuotesChanged();
    await syncQuotes(true);
    setSending(false);
  };

  const retry = async () => {
    await (await getQuoteStore()).resetOps(quote.id);
    notifyQuotesChanged();
    await syncQuotes(true);
  };

  const backToEdit = async () => {
    await (await getQuoteStore()).cancelQueuedSend(quote.id);
    notifyQuotesChanged();
    router.back();
  };

  if (quote.status !== 'draft') {
    return (
      <>
        <Banner
          tone="success"
          testID="quote-sent"
          message={`${strings.quotes.sentTitle}. ${format(strings.quotes.sentBody, {
            number: quote.quoteNumber ?? '',
          })}`}
        />
        {quote.link ? (
          <>
            <Button
              testID="quote-share-whatsapp"
              label={strings.quotes.shareWhatsapp}
              onPress={() => void Linking.openURL(quote.link!.whatsappUrl)}
            />
            <Button
              testID="quote-share-link"
              variant="secondary"
              label={strings.quotes.shareLink}
              onPress={() => void Share.share({ message: quote.link!.url }).catch(() => undefined)}
            />
          </>
        ) : (
          <AppText variant="muted">{strings.quotes.linkUnavailable}</AppText>
        )}
        <Button
          testID="quote-to-details"
          variant="ghost"
          label={strings.quotes.toQuote}
          onPress={() => router.dismissTo({ pathname: '/quotes/[id]', params: { id: quote.id } })}
        />
      </>
    );
  }

  if (quote.pendingSend && quote.sync === 'failed') {
    return (
      <>
        <Banner
          tone="error"
          testID="quote-send-failed"
          message={`${strings.quotes.sendFailed}: ${errorMessage(quote.syncError ?? 'generic')}`}
        />
        <Button label={strings.quotes.retrySend} onPress={() => void retry()} />
        <Button
          variant="ghost"
          label={strings.quotes.cancelSend}
          onPress={() => void backToEdit()}
        />
      </>
    );
  }

  if (quote.pendingSend && !sending) {
    return (
      <>
        <Banner
          tone="info"
          testID="quote-send-pending"
          message={`${strings.quotes.pendingTitle}. ${strings.quotes.pendingBody}`}
        />
        <Button variant="secondary" label={strings.quotes.retrySend} onPress={() => void retry()} />
      </>
    );
  }

  return (
    <>
      {slotError ? <Banner tone="error" testID="quote-slots-error" message={slotError} /> : null}
      <Button
        testID="quote-send"
        label={sending ? strings.quotes.sending : strings.quotes.send}
        onPress={() => void send()}
        loading={sending}
        disabled={!canQuote('send', quote.status)}
      />
      <Button variant="ghost" label={strings.quotes.backToEdit} onPress={() => router.back()} />
    </>
  );
}
