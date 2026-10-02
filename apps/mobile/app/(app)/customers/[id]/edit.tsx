import { strings } from '@q2c/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator } from 'react-native';
import { FullScreenMessage } from '../../../../src/components/FullScreenMessage';
import { Screen } from '../../../../src/components/Screen';
import { CustomerForm } from '../../../../src/customers/CustomerForm';
import { supabaseCustomersDb } from '../../../../src/customers/db';
import { formValuesFromDetail, type CustomerDetail } from '../../../../src/customers/model';
import { getSupabase } from '../../../../src/lib/supabase';
import { useCachedQuery } from '../../../../src/lib/useCachedQuery';
import { useThemeColors } from '../../../../src/theme';

export default function EditCustomer() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useMemo(() => supabaseCustomersDb(getSupabase()), []);
  const fetcher = useCallback(() => db.getCustomer(id), [db, id]);
  const { state, reload } = useCachedQuery<CustomerDetail | null>(`customer:${id}`, fetcher);

  if (state.status === 'loading') {
    return (
      <Screen title={strings.customers.editTitle}>
        <ActivityIndicator color={colors.primary} />
      </Screen>
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
  const detail = state.data;
  if (!detail || detail.deletedAt) {
    return (
      <FullScreenMessage
        title={strings.customers.notFound}
        actionLabel={strings.customers.backToList}
        onAction={() => router.dismissTo('/customers')}
      />
    );
  }
  const initial = formValuesFromDetail(detail);
  return (
    <Screen title={strings.customers.editTitle}>
      <CustomerForm
        key={detail.id}
        mode="full"
        initial={initial}
        previousAddressId={initial.address?.id ?? null}
        onSaved={() => router.back()}
      />
    </Screen>
  );
}
