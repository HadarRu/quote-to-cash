import { strings } from '@q2c/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { Screen } from '../../../src/components/Screen';
import { ServiceForm } from '../../../src/price-list/ServiceForm';
import { usePriceList } from '../../../src/price-list/usePriceList';
import { useThemeColors } from '../../../src/theme';

export default function EditService() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = usePriceList();

  if (state.status === 'loading') {
    return (
      <Screen title={strings.priceList.editTitle}>
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
  const service = state.data.services.find((s) => s.id === id);
  if (!service) {
    return (
      <FullScreenMessage
        title={strings.priceList.notFound}
        actionLabel={strings.priceList.back}
        onAction={() => router.dismissTo('/price-list')}
      />
    );
  }
  return (
    <Screen title={strings.priceList.editTitle}>
      <ServiceForm
        key={service.id}
        service={service}
        categories={state.data.categories}
        onSaved={() => router.dismissTo('/price-list')}
        onDeleted={() => router.dismissTo('/price-list')}
        onCategoryCreated={() => void reload()}
      />
    </Screen>
  );
}
