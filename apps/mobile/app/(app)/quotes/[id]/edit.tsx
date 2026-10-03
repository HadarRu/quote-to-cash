import { errorMessage, radius, space, strings } from '@q2c/ui';
import { formatMoney, formatPhoneIL } from '@q2c/utils';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../../../../src/auth/AuthProvider';
import { AppText } from '../../../../src/components/AppText';
import { Banner } from '../../../../src/components/Banner';
import { Button } from '../../../../src/components/Button';
import { ChoiceChips } from '../../../../src/components/ChoiceChips';
import { FullScreenMessage } from '../../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../../src/components/LoadingView';
import { Screen } from '../../../../src/components/Screen';
import { TextField } from '../../../../src/components/TextField';
import { quotePhotoPath } from '../../../../src/quotes/api';
import {
  CustomerPicker,
  LineEditor,
  lineFromService,
  PhotoStrip,
  Section,
  ServicePicker,
} from '../../../../src/quotes/EditorParts';
import { useQuotePhotos } from '../../../../src/quotes/hooks';
import { draftTotals, validateForSend, type QuoteFieldErrors } from '../../../../src/quotes/model';
import { takeQuotePhoto } from '../../../../src/quotes/photos';
import {
  getQuotesApi,
  getQuoteStore,
  notifyQuotesChanged,
  syncQuotes,
} from '../../../../src/quotes/sync';
import { useDraftEditor } from '../../../../src/quotes/useDraftEditor';
import { useThemeColors } from '../../../../src/theme';

type SectionKey = 'customer' | 'services' | 'notes' | 'photos';

const discountOptions = [
  { value: 'none', label: strings.quotes.discountNone },
  { value: 'percent', label: strings.quotes.discountPercent },
  { value: 'amount', label: strings.quotes.discountAmount },
] as const;

/** Create / edit a draft on one screen: customer, services, notes, photos, and a floating total. */
export default function EditQuote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, sync, update, flush, vatRateBp } = useDraftEditor(id);

  useEffect(() => {
    // Sent (or waiting to be sent): the details screen shows it read-only.
    if (state.status === 'locked') router.replace({ pathname: '/quotes/[id]', params: { id } });
  }, [state.status, id]);

  if (state.status === 'loading' || state.status === 'locked') return <LoadingView />;
  if (state.status === 'missing' || state.status === 'error')
    return (
      <FullScreenMessage
        title={state.status === 'missing' ? strings.quotes.notFound : strings.states.error}
        actionLabel={strings.quotes.backToList}
        onAction={() => router.replace('/quotes')}
      />
    );
  return <Editor key={id} {...{ quote: state.quote, sync, update, flush, vatRateBp }} />;
}

type EditorProps = Pick<
  ReturnType<typeof useDraftEditor>,
  'sync' | 'update' | 'flush' | 'vatRateBp'
> & {
  quote: Extract<ReturnType<typeof useDraftEditor>['state'], { status: 'ready' }>['quote'];
};

function Editor({ quote, sync, update, flush, vatRateBp }: EditorProps) {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    customer: !quote.customerId,
    services: true,
    notes: false,
    photos: false,
  });
  const [picking, setPicking] = useState(false);
  const [changingCustomer, setChangingCustomer] = useState(false);
  const [errors, setErrors] = useState<QuoteFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const { photos } = useQuotePhotos(quote.id, business.id);

  const totals = draftTotals(quote, vatRateBp);
  const toggle = (key: SectionKey) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const clearError = (key: string) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  const preview = async () => {
    const found = validateForSend(quote);
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setBanner(
        errorMessage(found.customerId ?? found.lines ?? found.discountValue ?? 'quote_incomplete'),
      );
      setOpen((o) => ({ ...o, customer: o.customer || !!found.customerId, services: true }));
      return;
    }
    setBanner(null);
    await flush();
    router.push({ pathname: '/quotes/[id]/preview', params: { id: quote.id } });
  };

  const takePhoto = async (source: 'camera' | 'library') => {
    setPhotoBusy(true);
    const result = await takeQuotePhoto(source);
    if (result.ok) {
      // The draft must reach the server before its photos.
      await flush();
      const store = await getQuoteStore();
      const photoId = randomUUID();
      await store.addPhoto({
        id: photoId,
        quoteId: quote.id,
        businessId: business.id,
        path: quotePhotoPath(business.id, quote.id, photoId),
        data: result.base64,
        createdAt: new Date().toISOString(),
      });
      notifyQuotesChanged();
      void syncQuotes();
    } else if (result.reason === 'failed') {
      setBanner(errorMessage('photo_failed'));
    }
    setPhotoBusy(false);
  };

  const discard = async () => {
    setDiscarding(true);
    await flush();
    const store = await getQuoteStore();
    if (quote.customerId) {
      // On the server: cancel it there (after delivering pending changes).
      await syncQuotes(true);
      const api = getQuotesApi();
      const result = await api.cancel(quote.id);
      if (result.error?.retryable) {
        setDiscarding(false);
        setConfirmDiscard(false);
        return setBanner(errorMessage('offline_write'));
      }
      const fresh = result.error ? null : (await api.fetchQuote(quote.id)).data;
      if (fresh) await store.putQuote(fresh);
      else await store.deleteQuote(quote.id);
    } else {
      // Never left the device.
      await store.deleteQuote(quote.id);
    }
    notifyQuotesChanged();
    router.replace('/quotes');
  };

  const removePhoto = async (photoId: string) => {
    await (await getQuoteStore()).removePhoto(photoId);
    notifyQuotesChanged();
    void syncQuotes();
  };

  const syncLabel =
    sync === 'unsaved'
      ? ''
      : sync === 'synced'
        ? strings.quotes.savedServer
        : sync === 'failed'
          ? strings.quotes.syncFailed
          : strings.quotes.savedLocal;

  const showCustomerPicker = !quote.customerId || changingCustomer;

  return (
    <Screen
      title={quote.revision > 1 ? strings.quotes.editTitle : strings.quotes.newTitle}
      subtitle={syncLabel}
      footer={
        <View
          style={[styles.totalBar, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.grow}>
            <AppText variant="muted">{strings.quotes.total}</AppText>
            <AppText variant="title" testID="quote-floating-total">
              {formatMoney(totals.totalMinor)}
            </AppText>
          </View>
          <Button testID="quote-preview" label={strings.quotes.preview} onPress={preview} />
        </View>
      }
    >
      {banner ? <Banner tone="error" testID="quote-error" message={banner} /> : null}

      <Section
        testID="quote-section-customer"
        title={strings.quotes.customerSection}
        summary={quote.customerName ?? strings.quotes.chooseCustomer}
        open={open.customer}
        onToggle={() => toggle('customer')}
      >
        {quote.customerId && !changingCustomer ? (
          <View style={styles.row}>
            <View style={styles.grow}>
              <AppText testID="quote-customer-name">{quote.customerName}</AppText>
              {quote.customerPhone ? (
                <AppText variant="muted" style={styles.ltr}>
                  {formatPhoneIL(quote.customerPhone)}
                </AppText>
              ) : null}
            </View>
            <Button
              variant="ghost"
              label={strings.quotes.changeCustomer}
              onPress={() => setChangingCustomer(true)}
            />
          </View>
        ) : null}
        {showCustomerPicker ? (
          <CustomerPicker
            error={errors.customerId ? errorMessage(errors.customerId) : null}
            onPick={(c) => {
              update((q) => ({
                ...q,
                customerId: c.id,
                customerName: c.fullName,
                customerPhone: c.phone,
              }));
              clearError('customerId');
              setChangingCustomer(false);
              setOpen((o) => ({ ...o, customer: false, services: true }));
            }}
          />
        ) : null}
      </Section>

      <Section
        testID="quote-section-services"
        title={strings.quotes.servicesSection}
        summary={`${quote.lines.length} · ${formatMoney(totals.subtotalMinor)}`}
        open={open.services}
        onToggle={() => toggle('services')}
      >
        {quote.lines.length === 0 ? (
          <AppText variant="muted" testID="quote-no-lines">
            {errors.lines ? errorMessage(errors.lines) : strings.quotes.noLines}
          </AppText>
        ) : null}
        {quote.lines.map((line, index) => (
          <LineEditor
            key={line.id}
            line={line}
            index={index}
            errors={errors}
            onChange={(changed) => {
              update((q) => ({
                ...q,
                lines: q.lines.map((l) => (l.id === changed.id ? changed : l)),
              }));
              for (const field of ['description', 'quantity', 'unitPriceMinor'])
                clearError(`lines.${index}.${field}`);
            }}
            onRemove={() =>
              update((q) => ({ ...q, lines: q.lines.filter((l) => l.id !== line.id) }))
            }
          />
        ))}
        {picking ? (
          <ServicePicker
            onPick={(service) => {
              update((q) => ({
                ...q,
                lines: [...q.lines, lineFromService(service, randomUUID())],
              }));
              clearError('lines');
            }}
            onClose={() => setPicking(false)}
          />
        ) : (
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button
                testID="quote-add-service"
                label={strings.quotes.addService}
                onPress={() => setPicking(true)}
              />
            </View>
            <View style={styles.grow}>
              <Button
                testID="quote-add-free-line"
                variant="secondary"
                label={strings.quotes.addFreeLine}
                onPress={() => {
                  update((q) => ({
                    ...q,
                    lines: [
                      ...q.lines,
                      {
                        id: randomUUID(),
                        serviceId: null,
                        description: '',
                        quantity: '1',
                        priceText: '',
                        unit: 'unit',
                        vatIncluded: false,
                      },
                    ],
                  }));
                  clearError('lines');
                }}
              />
            </View>
          </View>
        )}
        <ChoiceChips
          testID="quote-discount-type"
          label={strings.quotes.discountLabel}
          options={discountOptions}
          value={quote.discountType}
          onChange={(discountType) => {
            update((q) => ({ ...q, discountType }));
            clearError('discountValue');
          }}
        />
        {quote.discountType !== 'none' ? (
          <TextField
            testID="quote-discount-value"
            label={
              quote.discountType === 'percent'
                ? strings.quotes.discountPercentLabel
                : strings.quotes.discountAmountLabel
            }
            value={quote.discountText}
            onChangeText={(discountText) => {
              update((q) => ({ ...q, discountText }));
              clearError('discountValue');
            }}
            error={errors.discountValue ? errorMessage(errors.discountValue) : null}
            keyboardType="decimal-pad"
            inputMode="decimal"
          />
        ) : null}
      </Section>

      <Section
        testID="quote-section-notes"
        title={strings.quotes.notesSection}
        summary={quote.title || quote.notes || undefined}
        open={open.notes}
        onToggle={() => toggle('notes')}
      >
        <TextField
          testID="quote-title"
          label={strings.quotes.titleLabel}
          placeholder={strings.quotes.titlePlaceholder}
          value={quote.title}
          onChangeText={(title) => update((q) => ({ ...q, title }))}
          maxLength={200}
        />
        <TextField
          testID="quote-notes"
          label={strings.quotes.notesLabel}
          placeholder={strings.quotes.notesPlaceholder}
          value={quote.notes}
          onChangeText={(notes) => update((q) => ({ ...q, notes }))}
          maxLength={4000}
          multiline
        />
      </Section>

      <Section
        testID="quote-section-photos"
        title={strings.quotes.photosSection}
        summary={photos?.length ? String(photos.length) : undefined}
        open={open.photos}
        onToggle={() => toggle('photos')}
      >
        {quote.customerId ? (
          <PhotoStrip
            photos={photos}
            busy={photoBusy}
            onTake={(source) => void takePhoto(source)}
            onRemove={(photoId) => void removePhoto(photoId)}
          />
        ) : (
          <AppText variant="muted">{errorMessage('quote_customer_required')}</AppText>
        )}
      </Section>

      {confirmDiscard ? (
        <View style={styles.confirm}>
          <AppText>{strings.quotes.discardConfirm}</AppText>
          <Button
            testID="quote-discard-confirm"
            variant="danger"
            label={strings.quotes.discardYes}
            onPress={() => void discard()}
            loading={discarding}
          />
          <Button
            variant="ghost"
            label={strings.quotes.keep}
            onPress={() => setConfirmDiscard(false)}
          />
        </View>
      ) : (
        <Button
          testID="quote-discard"
          variant="ghost"
          label={strings.quotes.discardDraft}
          onPress={() => setConfirmDiscard(true)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  ltr: { writingDirection: 'ltr', textAlign: 'right' },
  confirm: { gap: space(1) },
  totalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(1.5),
  },
});
