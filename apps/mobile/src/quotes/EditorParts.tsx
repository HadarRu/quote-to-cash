import { errorMessage, format, MIN_TOUCH_TARGET, radius, space, strings } from '@q2c/ui';
import { formatMoney, formatPhoneIL, lineTotalMinor, parseMoneyInput } from '@q2c/utils';
import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../auth/AuthProvider';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ChoiceChips } from '../components/ChoiceChips';
import { TextField } from '../components/TextField';
import { Toggle } from '../components/Toggle';
import { supabaseCustomersDb } from '../customers/db';
import { filterCustomers, type CustomerListItem } from '../customers/model';
import { getSupabase } from '../lib/supabase';
import { useCachedQuery } from '../lib/useCachedQuery';
import { filterServices, priceInputValue, type PriceListService } from '../price-list/model';
import { usePriceList } from '../price-list/usePriceList';
import { useThemeColors } from '../theme';
import type { LocalLine, QuoteFieldErrors } from './model';
import { unitLabel } from './QuoteDocument';

/** A card whose body folds away, with a one-line summary while folded. */
export function Section({
  title,
  summary,
  open,
  onToggle,
  testID,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  testID?: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID={testID}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? strings.quotes.collapse : strings.quotes.expand}
        style={styles.sectionHeader}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        <View style={styles.grow}>
          <AppText variant="heading">{title}</AppText>
          {!open && summary ? <AppText variant="muted">{summary}</AppText> : null}
        </View>
        <AppText variant="muted">{open ? '▴' : '▾'}</AppText>
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

/** Search the business's customers (offline copy included) and pick one. */
export function CustomerPicker({
  onPick,
  error,
}: {
  onPick: (customer: CustomerListItem) => void;
  error?: string | null;
}) {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const db = useMemo(() => supabaseCustomersDb(getSupabase()), []);
  const fetcher = useCallback(() => db.listCustomers(business.id), [db, business.id]);
  const { state, reload } = useCachedQuery<CustomerListItem[]>(`customers:${business.id}`, fetcher);
  const [query, setQuery] = useState('');

  if (state.status === 'loading') return <ActivityIndicator color={colors.primary} />;
  if (state.status === 'error')
    return (
      <View style={styles.stack}>
        <Banner tone="error" message={errorMessage(state.error)} />
        <Button variant="secondary" label={strings.states.retry} onPress={() => void reload()} />
      </View>
    );

  const matches = filterCustomers(state.data, query).slice(0, 8);
  return (
    <View style={styles.stack}>
      <TextField
        testID="quote-customer-search"
        label={strings.quotes.customerSearch}
        value={query}
        onChangeText={setQuery}
        error={error}
      />
      {matches.length === 0 ? (
        <AppText variant="muted">{strings.quotes.noCustomers}</AppText>
      ) : (
        matches.map((c) => (
          <Pressable
            key={c.id}
            testID="quote-customer-option"
            accessibilityRole="button"
            onPress={() => onPick(c)}
            style={[styles.option, { borderColor: colors.border }]}
          >
            <AppText>{c.fullName}</AppText>
            <AppText variant="muted" style={styles.ltr}>
              {formatPhoneIL(c.phone)}
            </AppText>
          </Pressable>
        ))
      )}
      <Button
        variant="ghost"
        label={strings.quotes.addCustomer}
        onPress={() => router.push('/customers/new')}
      />
    </View>
  );
}

type PickerTab = 'favorites' | 'recent' | 'all';

/** Price list services: favorites, recently used, or search. Stays open to add several. */
export function ServicePicker({
  onPick,
  onClose,
}: {
  onPick: (service: PriceListService) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const { state, reload } = usePriceList();
  const [tab, setTab] = useState<PickerTab>('favorites');
  const [query, setQuery] = useState('');

  const services = useMemo(() => {
    if (state.status !== 'success') return [];
    if (query.trim()) return filterServices(state.data.services, query);
    if (tab === 'favorites') return filterServices(state.data.services, '', { kind: 'favorites' });
    if (tab === 'recent')
      return state.data.services
        .filter((s) => s.lastUsedAt)
        .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
        .slice(0, 10);
    return filterServices(state.data.services, '');
  }, [state, tab, query]);

  return (
    <View style={[styles.picker, { borderColor: colors.border }]} testID="service-picker">
      <TextField
        testID="service-picker-search"
        label={strings.quotes.pickerSearch}
        value={query}
        onChangeText={setQuery}
      />
      {query.trim() ? null : (
        <ChoiceChips
          testID="service-picker-tab"
          label={strings.quotes.addService}
          options={[
            { value: 'favorites', label: strings.quotes.pickerFavorites },
            { value: 'recent', label: strings.quotes.pickerRecent },
            { value: 'all', label: strings.quotes.pickerAll },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {state.status === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
      {state.status === 'error' ? (
        <View style={styles.stack}>
          <Banner tone="error" message={errorMessage(state.error)} />
          <Button variant="secondary" label={strings.states.retry} onPress={() => void reload()} />
        </View>
      ) : null}
      {state.status === 'success' && services.length === 0 ? (
        <AppText variant="muted">{strings.quotes.pickerEmpty}</AppText>
      ) : null}
      {services.map((s) => (
        <Pressable
          key={s.id}
          testID="service-picker-option"
          accessibilityRole="button"
          onPress={() => onPick(s)}
          style={[styles.option, styles.optionRow, { borderColor: colors.border }]}
        >
          <AppText style={styles.grow}>{`${s.isFavorite ? '★ ' : ''}${s.name}`}</AppText>
          <AppText variant="muted">{`${formatMoney(s.priceMinor)} / ${unitLabel(s.unit)}`}</AppText>
        </Pressable>
      ))}
      <Button variant="secondary" label={strings.quotes.pickerClose} onPress={onClose} />
    </View>
  );
}

/** A quote line from a price list service: the price and VAT flag are copied, then editable. */
export function lineFromService(service: PriceListService, id: string): LocalLine {
  return {
    id,
    serviceId: service.id,
    description: service.name,
    quantity: '1',
    priceText: priceInputValue(service.priceMinor),
    unit: service.unit,
    vatIncluded: service.vatIncluded,
  };
}

/** One line: description, quantity (decimals allowed), unit price, VAT flag. */
export function LineEditor({
  line,
  index,
  errors,
  onChange,
  onRemove,
}: {
  line: LocalLine;
  index: number;
  errors: QuoteFieldErrors;
  onChange: (line: LocalLine) => void;
  onRemove: () => void;
}) {
  const colors = useThemeColors();
  const error = (field: string) => {
    const key = errors[`lines.${index}.${field}`];
    return key ? errorMessage(key) : null;
  };
  const price = parseMoneyInput(line.priceText);
  let total: number | null = null;
  try {
    if (price !== null) total = lineTotalMinor({ quantity: line.quantity, unitPriceMinor: price });
  } catch {
    total = null;
  }
  return (
    <View style={[styles.line, { borderColor: colors.border }]} testID="quote-line">
      <TextField
        testID="quote-line-description"
        label={strings.quotes.lineDescription}
        value={line.description}
        onChangeText={(description) => onChange({ ...line, description })}
        error={error('description')}
        multiline
      />
      <View style={styles.lineRow}>
        <View style={styles.grow}>
          <TextField
            testID="quote-line-quantity"
            label={`${strings.quotes.lineQuantity} (${unitLabel(line.unit)})`}
            value={line.quantity}
            onChangeText={(quantity) => onChange({ ...line, quantity })}
            error={error('quantity')}
            keyboardType="decimal-pad"
            inputMode="decimal"
          />
        </View>
        <View style={styles.grow}>
          <TextField
            testID="quote-line-price"
            label={strings.quotes.linePrice}
            value={line.priceText}
            onChangeText={(priceText) => onChange({ ...line, priceText })}
            error={error('unitPriceMinor')}
            keyboardType="decimal-pad"
            inputMode="decimal"
          />
        </View>
      </View>
      <Toggle
        label={strings.quotes.lineVatIncluded}
        value={line.vatIncluded}
        onChange={(vatIncluded) => onChange({ ...line, vatIncluded })}
      />
      <View style={styles.lineRow}>
        <AppText variant="muted" style={styles.grow} testID="quote-line-total">
          {total === null ? '' : format(strings.quotes.lineTotal, { amount: formatMoney(total) })}
        </AppText>
        <Button
          testID="quote-line-remove"
          variant="ghost"
          label={strings.quotes.lineRemove}
          onPress={onRemove}
        />
      </View>
    </View>
  );
}

/** Thumbnails with remove buttons, plus camera and gallery buttons. */
export function PhotoStrip({
  photos,
  busy,
  onTake,
  onRemove,
}: {
  photos: { id: string; uri: string | null; uploaded: boolean }[] | null;
  busy: boolean;
  onTake: (source: 'camera' | 'library') => void;
  onRemove: (id: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <View style={styles.stack}>
      {photos === null ? <ActivityIndicator color={colors.primary} /> : null}
      {photos?.length === 0 ? <AppText variant="muted">{strings.quotes.noPhotos}</AppText> : null}
      <View style={styles.photos}>
        {photos?.map((p) => (
          <View key={p.id} style={styles.photoBox} testID="quote-photo">
            {p.uri ? <Image source={{ uri: p.uri }} style={styles.photo} /> : null}
            {!p.uploaded ? (
              <AppText variant="muted">{strings.quotes.photoUploading}</AppText>
            ) : null}
            <Button
              variant="ghost"
              label={strings.quotes.photoRemove}
              onPress={() => onRemove(p.id)}
            />
          </View>
        ))}
      </View>
      <View style={styles.lineRow}>
        <View style={styles.grow}>
          <Button
            testID="quote-photo-camera"
            variant="secondary"
            label={strings.quotes.addPhoto}
            onPress={() => onTake('camera')}
            loading={busy}
          />
        </View>
        <View style={styles.grow}>
          <Button
            testID="quote-photo-library"
            variant="secondary"
            label={strings.quotes.pickPhoto}
            onPress={() => onTake('library')}
            disabled={busy}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  sectionHeader: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    padding: space(2),
  },
  sectionBody: { paddingHorizontal: space(2), paddingBottom: space(2), gap: space(2) },
  grow: { flex: 1 },
  stack: { gap: space(1) },
  ltr: { writingDirection: 'ltr', textAlign: 'right' },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space(1.5),
    paddingVertical: space(1),
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  picker: { gap: space(1), borderWidth: 1, borderRadius: radius.md, padding: space(1.5) },
  line: {
    gap: space(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(1.5),
  },
  lineRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space(1) },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  photoBox: { alignItems: 'center', gap: space(0.5) },
  photo: { width: 96, height: 96, borderRadius: radius.md },
});
