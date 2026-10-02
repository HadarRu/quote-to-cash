import { space, strings } from '@q2c/ui';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useThemeColors } from '../theme';
import { AppText } from './AppText';

/** Shown while fonts load and the saved session is restored. */
export function Splash() {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.center, { backgroundColor: colors.primary }]}
      accessibilityRole="progressbar"
      accessibilityLabel={strings.splash.loading}
      testID="splash"
    >
      <AppText variant="title" style={{ color: colors.onPrimary }}>
        {strings.app.name}
      </AppText>
      <ActivityIndicator color={colors.onPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(2) },
});
