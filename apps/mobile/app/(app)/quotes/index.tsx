import { Constants } from '@q2c/types';
import { errorMessage, MIN_TOUCH_TARGET, radius, space, strings } from '@q2c/ui';
import { formatDateIL, formatMoney } from '@q2c/utils';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { ChoiceChips } from '../../../src/components/ChoiceChips';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../src/components/LoadingView';
import { useQuoteList } from '../../../src/quotes/hooks';
import {
  displayTotals,
  filterQuotes,
  type QuoteFilter,
  type QuoteListItem,
} from '../../../src/quotes/model';
import { quoteLabel } from '../../../src/quotes/QuoteDocument';
import { useThemeColors } from '../../../src/theme';

const filterOptions: { value: QuoteFilter; label: string }[] = [
  { value: 'all', label: strings.quotes.filterAll },
  ...Constants.public.Enums.quote_status.map((status) => ({
    value: status,
    label: strings.quoteStatus[status],
  })),
];

/** Quotes, newest first, filtered by status. Works offline from the device copy. */
export default function QuotesList() {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const { state, reload } = useQuoteList(business.id);
  const [filter, setFilter] = useState<QuoteFilter>('all');

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

  const all = state.data;
  const visible = filterQuotes(all, filter);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <FlatList
        data={visible}
        keyExtractor={(q) => q.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <AppText variant="title" accessibilityRole="header">
                {strings.quotes.title}
              </AppText>
              <Button
                testID="quotes-add"
                label={strings.quotes.add}
                onPress={() => router.push('/quotes/new')}
              />
            </View>
            {state.offline ? (
              <Banner tone="info" testID="quotes-offline" message={strings.quotes.offline} />
            ) : null}
            {all.length > 0 ? (
              <ChoiceChips
                testID="quotes-filter"
                label={strings.quotes.filterLabel}
                options={filterOptions}
                value={filter}
                onChange={setFilter}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          all.length === 0 ? (
            <View
              style={[
                styles.empty,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              testID="quotes-empty"
            >
              <AppText variant="heading">{strings.quotes.emptyTitle}</AppText>
              <AppText variant="muted">{strings.quotes.emptyBody}</AppText>
            </View>
          ) : (
            <AppText variant="muted" testID="quotes-no-results">
              {strings.quotes.noResults}
            </AppText>
          )
        }
        renderItem={({ item }) => <QuoteRow quote={item} vatRateBp={business.vatRateBp} />}
      />
    </SafeAreaView>
  );
}

function QuoteRow({ quote, vatRateBp }: { quote: QuoteListItem; vatRateBp: number }) {
  const colors = useThemeColors();
  const syncLabel = quote.pendingSend
    ? strings.quotes.pendingSend
    : quote.sync === 'failed'
      ? strings.quotes.syncFailed
      : quote.sync === 'pending'
        ? strings.quotes.pendingSync
        : null;
  return (
    <Pressable
      testID="quote-row"
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/quotes/[id]', params: { id: quote.id } })}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.grow}>
        <AppText>{`${quoteLabel(quote)} · ${quote.customerName ?? strings.quotes.chooseCustomer}`}</AppText>
        {quote.title ? <AppText variant="muted">{quote.title}</AppText> : null}
        {syncLabel ? (
          <AppText
            testID="quote-row-sync"
            style={{ color: quote.sync === 'failed' ? colors.danger : colors.textMuted }}
          >
            {syncLabel}
          </AppText>
        ) : null}
      </View>
      <View style={styles.meta}>
        <AppText>{formatMoney(displayTotals(quote, vatRateBp).totalMinor)}</AppText>
        <AppText variant="muted" testID="quote-row-status">
          {`${strings.quoteStatus[quote.status]} · ${formatDateIL(quote.updatedAt)}`}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: space(2),
    gap: space(1),
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  header: { gap: space(2), marginBottom: space(1) },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(1.5),
  },
  grow: { flex: 1, gap: space(0.5) },
  meta: { alignItems: 'flex-end', gap: space(0.5) },
});
