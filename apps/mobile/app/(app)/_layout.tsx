import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { createAnalytics } from '../../src/analytics/analytics';
import { useCurrentBusiness } from '../../src/auth/AuthProvider';
import { getAnalyticsConfig } from '../../src/lib/config';
import { usePushNotifications } from '../../src/notifications/expo';
import { startQuoteSync } from '../../src/quotes/sync';
import { useThemeColors } from '../../src/theme';

const analytics = createAnalytics(getAnalyticsConfig());

/** Screens for a signed-in user with a business (guarded in the root layout). */
export default function AppLayout() {
  const colors = useThemeColors();
  const { business, session } = useCurrentBusiness();
  // Delivers changes made offline (drafts, photos, sends) in the background.
  useEffect(() => startQuoteSync(), []);
  usePushNotifications(business.id);
  useEffect(() => {
    void analytics.track('app_opened', session.user.id, {
      business_id: business.id,
      platform: Platform.OS,
      $groups: { business: business.id },
    });
  }, [business.id, session.user.id]);
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
