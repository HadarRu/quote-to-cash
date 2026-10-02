import { radius, space } from '@q2c/ui';
import { StyleSheet, View } from 'react-native';
import { useThemeColors } from '../theme';
import { AppText } from './AppText';

interface BannerProps {
  tone: 'error' | 'success' | 'info';
  message: string;
  testID?: string;
}

export function Banner({ tone, message, testID }: BannerProps) {
  const colors = useThemeColors();
  const accent = { error: colors.danger, success: colors.success, info: colors.primary }[tone];
  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      style={[styles.banner, { borderColor: accent, backgroundColor: colors.surface }]}
    >
      <AppText style={{ color: accent }}>{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: radius.md, padding: space(1.5) },
});
