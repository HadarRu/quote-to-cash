import { getStarterPriceList } from '@q2c/types';
import { errorMessage, format, MIN_TOUCH_TARGET, radius, space, strings } from '@q2c/ui';
import { formatMoney } from '@q2c/utils';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { ChoiceChips } from '../../../src/components/ChoiceChips';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { TextField } from '../../../src/components/TextField';
import {
  filterServices,
  priceInputValue,
  type CategoryFilter,
  type PriceListService,
} from '../../../src/price-list/model';
import {
  changePrice,
  importStarterPriceList,
  setFavorite,
  type PriceListDb,
} from '../../../src/price-list/service';
import { usePriceList } from '../../../src/price-list/usePriceList';
import { useThemeColors } from '../../../src/theme';

const STAR_ON = '★';
const STAR_OFF = '☆';

function filterFromKey(key: string): CategoryFilter {
  if (key === 'favorites') return { kind: 'favorites' };
  if (key === 'none') return { kind: 'category', id: null };
  if (key.startsWith('cat:')) return { kind: 'category', id: key.slice(4) };
  return { kind: 'all' };
}

/** Price list: favorites and recently used first, Hebrew search, quick price edit. */
export default function PriceListScreen() {
  const colors = useThemeColors();
  const { state, reload, db, business } = usePriceList();
  const [query, setQuery] = useState('');
  const [filterKey, setFilterKey] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const starter = getStarterPriceList(business.trade);

  if (state.status === 'loading') {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        accessibilityLabel={strings.states.loading}
      >
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <FullScreenMessage
        title={strings.states.error}
        body={state.error === 'network' ? strings.errors.network : strings.errors.generic}
        actionLabel={strings.states.retry}
        onAction={() => void reload()}
      />
    );
  }

  const { services, categories } = state.data;
  const visible = filterServices(services, query, filterFromKey(filterKey));
  const filterOptions = [
    { value: 'all', label: strings.priceList.all },
    ...(services.some((s) => s.isFavorite)
      ? [{ value: 'favorites', label: strings.priceList.favorites }]
      : []),
    ...categories.map((c) => ({ value: `cat:${c.id}`, label: c.name })),
    ...(services.some((s) => s.categoryId === null)
      ? [{ value: 'none', label: strings.priceList.noCategory }]
      : []),
  ];

  const runImport = async () => {
    setImporting(true);
    setError(null);
    const result = await importStarterPriceList(db, business.id, business.trade);
    setImporting(false);
    if (!result.ok) return setError(errorMessage(result.error));
    setNotice(
      result.added > 0
        ? format(strings.priceList.imported, { count: result.added })
        : strings.priceList.importedNone,
    );
    await reload();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <FlatList
        data={visible}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <AppText variant="title" accessibilityRole="header">
                {strings.priceList.title}
              </AppText>
              <Button
                testID="price-list-add"
                label={strings.priceList.add}
                onPress={() => router.push('/price-list/new')}
              />
            </View>
            {state.offline ? <Banner tone="info" message={strings.priceList.offline} /> : null}
            {notice ? <Banner tone="success" testID="price-list-notice" message={notice} /> : null}
            {error ? <Banner tone="error" testID="price-list-error" message={error} /> : null}
            {services.length > 0 ? (
              <>
                <TextField
                  testID="price-list-search"
                  label={strings.priceList.searchLabel}
                  placeholder={strings.priceList.searchPlaceholder}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                />
                <ChoiceChips
                  testID="price-list-filter"
                  label={strings.priceList.categoryLabel}
                  options={filterOptions}
                  value={filterKey}
                  onChange={setFilterKey}
                />
                <View style={styles.titleRow}>
                  <AppText variant="muted">
                    {format(strings.priceList.count, { count: visible.length })}
                  </AppText>
                  <Button
                    testID="price-list-categories"
                    variant="ghost"
                    label={strings.priceList.categories}
                    onPress={() => router.push('/price-list/categories')}
                  />
                </View>
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          services.length === 0 ? (
            <View style={styles.empty} testID="price-list-empty">
              <AppText variant="heading">{strings.priceList.emptyTitle}</AppText>
              <AppText variant="muted">
                {starter ? strings.priceList.emptyBody : strings.priceList.emptyBodyNoStarter}
              </AppText>
              {starter ? (
                <Button
                  testID="price-list-import"
                  label={strings.priceList.importStarter}
                  onPress={runImport}
                  loading={importing}
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.empty} testID="price-list-no-results">
              <AppText>{format(strings.priceList.noResults, { query: query.trim() })}</AppText>
            </View>
          )
        }
        renderItem={({ item }) => (
          <ServiceRow
            service={item}
            db={db}
            editing={editingId === item.id}
            onEdit={() => setEditingId(item.id)}
            onDone={() => {
              setEditingId(null);
              void reload();
            }}
            onChanged={() => void reload()}
          />
        )}
      />
    </SafeAreaView>
  );
}

interface ServiceRowProps {
  service: PriceListService;
  db: PriceListDb;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChanged: () => void;
}

function ServiceRow({ service, db, editing, onEdit, onDone, onChanged }: ServiceRowProps) {
  const colors = useThemeColors();
  const [priceText, setPriceText] = useState(priceInputValue(service.priceMinor));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const vatLabel = service.vatIncluded
    ? strings.priceList.vatIncluded
    : strings.priceList.vatExcluded;

  const toggleFavorite = async () => {
    const result = await setFavorite(db, service.id, !service.isFavorite);
    if (result.ok) onChanged();
  };

  const savePrice = async () => {
    setSaving(true);
    setError(null);
    const result = await changePrice(db, service.id, priceText);
    setSaving(false);
    if (!result.ok) return setError(errorMessage(result.error));
    onDone();
  };

  return (
    <View
      testID="service-row"
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.rowMain}>
        <Pressable
          testID="service-favorite-toggle"
          accessibilityRole="button"
          accessibilityLabel={
            service.isFavorite ? strings.priceList.unfavorite : strings.priceList.favorite
          }
          onPress={toggleFavorite}
          style={styles.star}
        >
          <AppText
            style={[
              styles.starText,
              { color: service.isFavorite ? colors.accent : colors.textMuted },
            ]}
          >
            {service.isFavorite ? STAR_ON : STAR_OFF}
          </AppText>
        </Pressable>
        <Pressable
          testID="service-open"
          accessibilityRole="button"
          onPress={() => router.push(`/price-list/${service.id}`)}
          style={styles.rowText}
        >
          <AppText variant="heading" style={styles.name}>
            {service.name}
          </AppText>
          <AppText variant="muted">
            {[strings.units[service.unit], service.categoryName].filter(Boolean).join(' · ')}
          </AppText>
        </Pressable>
        {editing ? null : (
          <Pressable
            testID="service-price-button"
            accessibilityRole="button"
            accessibilityLabel={format(strings.priceList.editPrice, { name: service.name })}
            onPress={() => {
              setPriceText(priceInputValue(service.priceMinor));
              setError(null);
              onEdit();
            }}
            style={[styles.price, { borderColor: colors.border }]}
          >
            <AppText testID="service-price" variant="heading">
              {formatMoney(service.priceMinor)}
            </AppText>
            <AppText variant="muted" style={styles.small}>
              {vatLabel}
            </AppText>
          </Pressable>
        )}
      </View>
      {editing ? (
        <View style={styles.editor}>
          <TextField
            testID="service-price-input"
            label={strings.priceList.priceLabel}
            value={priceText}
            onChangeText={setPriceText}
            error={error}
            keyboardType="decimal-pad"
            inputMode="decimal"
            autoFocus
            selectTextOnFocus
            onSubmitEditing={savePrice}
          />
          <View style={styles.editorActions}>
            <View style={styles.grow}>
              <Button
                testID="service-price-save"
                label={strings.priceList.savePrice}
                onPress={savePrice}
                loading={saving}
              />
            </View>
            <View style={styles.grow}>
              <Button variant="ghost" label={strings.priceList.cancel} onPress={onDone} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space(2), gap: space(1), width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { gap: space(2), marginBottom: space(1) },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space(2),
  },
  empty: { gap: space(2), paddingVertical: space(3) },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(1),
    gap: space(1),
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  star: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starText: { fontSize: 24, lineHeight: 28 },
  rowText: { flex: 1, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', gap: space(0.5) },
  name: { fontSize: 17 },
  price: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: space(1.5),
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { fontSize: 12, lineHeight: 16 },
  editor: { gap: space(1) },
  editorActions: { flexDirection: 'row', gap: space(1) },
  grow: { flex: 1 },
});
