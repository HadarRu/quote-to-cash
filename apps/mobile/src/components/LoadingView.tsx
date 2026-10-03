import { strings } from '@q2c/ui';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useThemeColors } from '../theme';

/** Full-screen loading state. */
export function LoadingView() {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.center, { backgroundColor: colors.background }]}
      accessibilityLabel={strings.states.loading}
    >
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
