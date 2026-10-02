import { MIN_TOUCH_TARGET, radius, space, strings } from '@q2c/ui';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../src/components/AppText';
import { useThemeColors } from '../src/theme';

export default function NotFoundScreen() {
  const colors = useThemeColors();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <AppText variant="heading">{strings.states.notFound}</AppText>
      <Link href="/" style={[styles.button, { backgroundColor: colors.primary }]}>
        <AppText style={{ color: colors.onPrimary }}>{strings.states.backHome}</AppText>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(2) },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.md,
  },
});
