import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { startQuoteSync } from '../../src/quotes/sync';
import { useThemeColors } from '../../src/theme';

/** Screens for a signed-in user with a business (guarded in the root layout). */
export default function AppLayout() {
  const colors = useThemeColors();
  // Delivers changes made offline (drafts, photos, sends) in the background.
  useEffect(() => startQuoteSync(), []);
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
