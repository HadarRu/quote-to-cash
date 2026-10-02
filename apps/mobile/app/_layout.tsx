import {
  Heebo_400Regular,
  Heebo_500Medium,
  Heebo_700Bold,
  useFonts,
} from '@expo-google-fonts/heebo';
import { MIN_TOUCH_TARGET, radius, space, strings, typography } from '@q2c/ui';
import { type ErrorBoundaryProps, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { AppText } from '../src/components/AppText';
import { FullScreenMessage } from '../src/components/FullScreenMessage';
import { Splash } from '../src/components/Splash';
import { forceRtl } from '../src/rtl';
import { useThemeColors } from '../src/theme';

forceRtl();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [typography.nativeFamily.regular]: Heebo_400Regular,
    [typography.nativeFamily.medium]: Heebo_500Medium,
    [typography.nativeFamily.bold]: Heebo_700Bold,
  });

  // A font failure is not fatal: render with the system font instead of blocking the app.
  if (!fontsLoaded && !fontError) return <Splash />;

  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </AuthProvider>
  );
}

/**
 * Every route is reachable only in the auth state it belongs to. Screens inside
 * the (app) group require a signed-in user with a business; when the state
 * changes (sign-in, setup done, sign-out) the router moves to `index`, which
 * redirects to the right place.
 */
function RootNavigator() {
  const colors = useThemeColors();
  const { state, onboardingSeen, refreshBusiness } = useAuth();

  if (state.status === 'loading') return <Splash />;
  if (state.status === 'error') {
    return state.error === 'config' ? (
      <FullScreenMessage title={strings.states.error} body={strings.errors.config} />
    ) : (
      <FullScreenMessage
        title={strings.states.error}
        body={state.error === 'network' ? strings.errors.network : strings.errors.generic}
        actionLabel={strings.states.retry}
        onAction={refreshBusiness}
      />
    );
  }

  const signedOut = state.status === 'signedOut';
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      <Stack.Screen name="index" />
      <Stack.Protected guard={signedOut && !onboardingSeen}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={signedOut}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'needsBusiness'}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'ready'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
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
