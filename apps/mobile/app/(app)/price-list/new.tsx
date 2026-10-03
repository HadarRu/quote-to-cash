import { strings } from '@q2c/ui';
import { router } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { ServiceForm } from '../../../src/price-list/ServiceForm';
import { usePriceList } from '../../../src/price-list/usePriceList';
import { useThemeColors } from '../../../src/theme';

export default function NewService() {
  const colors = useThemeColors();
  const { state, reload } = usePriceList();
  return (
    <Screen title={strings.priceList.newTitle}>
      {state.status === 'loading' ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <ServiceForm
          categories={state.status === 'success' ? state.data.categories : []}
          onSaved={() => router.dismissTo('/price-list')}
          onCategoryCreated={() => void reload()}
        />
      )}
    </Screen>
  );
}
