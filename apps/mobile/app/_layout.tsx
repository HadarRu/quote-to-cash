import {
  Heebo_400Regular,
  Heebo_500Medium,
  Heebo_700Bold,
  useFonts,
} from '@expo-google-fonts/heebo';
import { MIN_TOUCH_TARGET, radius, space, strings, typography } from '@q2c/ui';
import { type ErrorBoundaryProps, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../src/components/AppText';
import { forceRtl } from '../src/rtl';
import { useThemeColors } from '../src/theme';

forceRtl();

export default function RootLayout() {
  const colors = useThemeColors();
  const [fontsLoaded, fontError] = useFonts({
    [typography.nativeFamily.regular]: Heebo_400Regular,
    [typography.nativeFamily.medium]: Heebo_500Medium,
    [typography.nativeFamily.bold]: Heebo_700Bold,
  });

  // A font failure is not fatal: render with the system font instead of blocking the app.
  if (!fontsLoaded && !fontError) {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        accessibilityRole="progressbar"
        accessibilityLabel={strings.states.loading}
      >
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      />
    </>
  );
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const colors = useThemeColors();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]} accessibilityRole="alert">
      <AppText variant="heading">{strings.states.error}</AppText>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={[styles.button, { backgroundColor: colors.primary }]}
      >
        <AppText style={{ color: colors.onPrimary }}>{strings.states.retry}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    padding: space(2),
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: space(3),
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
