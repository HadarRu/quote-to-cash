import { Stack } from 'expo-router';
import { useThemeColors } from '../../src/theme';

/** Screens for a signed-in user with a business (guarded in the root layout). */
export default function AppLayout() {
  const colors = useThemeColors();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
