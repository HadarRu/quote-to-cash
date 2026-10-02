import { format, MIN_TOUCH_TARGET, radius, space, strings } from '@q2c/ui';
import { formatPhoneIL } from '@q2c/utils';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { TextField } from '../../../src/components/TextField';
import { supabaseCustomersDb } from '../../../src/customers/db';
import {
  filterCustomers,
  prefillFromQuery,
  type CustomerListItem,
} from '../../../src/customers/model';
import { getSupabase } from '../../../src/lib/supabase';
import { useCachedQuery } from '../../../src/lib/useCachedQuery';
import { useThemeColors } from '../../../src/theme';

/** Customers, most recently updated first, with instant search by name or phone (works offline). */
export default function CustomersList() {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const db = useMemo(() => supabaseCustomersDb(getSupabase()), []);
  const fetcher = useCallback(() => db.listCustomers(business.id), [db, business.id]);
  const { state, reload } = useCachedQuery<CustomerListItem[]>(`customers:${business.id}`, fetcher);
  const [query, setQuery] = useState('');

  const addCustomer = (q = '') => {
    const prefill = prefillFromQuery(q);
    router.push({
      pathname: '/customers/new',
      params: { name: prefill.fullName, phone: prefill.phone },
    });
  };

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
        body={errorBody(state.error)}
        actionLabel={strings.states.retry}
        onAction={() => void reload()}
      />
    );
  }

  const all = state.data;
  const visible = filterCustomers(all, query);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <AppText variant="title" accessibilityRole="header">
                {strings.customers.title}
              </AppText>
              <Button
                testID="customers-add"
                label={strings.customers.add}
                onPress={() => addCustomer()}
              />
            </View>
            {state.offline ? (
              <Banner tone="info" testID="customers-offline" message={strings.customers.offline} />
            ) : null}
            {all.length > 0 ? (
              <TextField
                testID="customers-search"
                label={strings.customers.searchLabel}
                placeholder={strings.customers.searchPlaceholder}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                returnKeyType="search"
              />
            ) : null}
            {all.length > 0 && !query ? (
              <AppText variant="muted">
                {format(strings.customers.count, { count: all.length })}
              </AppText>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          all.length === 0 ? (
            <View style={styles.empty} testID="customers-empty">
              <AppText variant="heading">{strings.customers.emptyTitle}</AppText>
              <AppText variant="muted">{strings.customers.emptyBody}</AppText>
            </View>
          ) : (
            <View style={styles.empty} testID="customers-no-results">
              <AppText>{format(strings.customers.noResults, { query: query.trim() })}</AppText>
              <Button
                testID="customers-add-from-search"
                variant="secondary"
                label={strings.customers.addWithQuery}
                onPress={() => addCustomer(query)}
              />
            </View>
          )
        }
        renderItem={({ item }) => <CustomerRow customer={item} />}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
        )}
      />
    </SafeAreaView>
  );
}

function CustomerRow({ customer }: { customer: CustomerListItem }) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID="customer-row"
      accessibilityRole="button"
      onPress={() => router.push(`/customers/${customer.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.border : colors.surface },
      ]}
    >
      <AppText variant="heading" style={styles.rowName}>
        {customer.fullName}
      </AppText>
      <AppText variant="muted">{formatPhoneIL(customer.phone)}</AppText>
    </Pressable>
  );
}

function errorBody(error: string) {
  return error === 'network' ? strings.errors.network : strings.errors.generic;
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
    minHeight: MIN_TOUCH_TARGET + space(2),
    padding: space(1.5),
    borderRadius: radius.md,
    gap: space(0.5),
  },
  rowName: { fontSize: 17 },
  separator: { height: StyleSheet.hairlineWidth },
});
