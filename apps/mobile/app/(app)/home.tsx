import { format, radius, space, strings } from '@q2c/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../../src/auth/AuthProvider';
import { LOGO_BUCKET } from '../../src/business/setup';
import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { getSupabase } from '../../src/lib/supabase';
import { useThemeColors } from '../../src/theme';

export default function Home() {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // The bucket is private: show the logo through a short-lived signed URL.
  useEffect(() => {
    if (!business.logoPath) return;
    let cancelled = false;
    getSupabase()
      .storage.from(LOGO_BUCKET)
      .createSignedUrl(business.logoPath, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setLogoUrl(data?.signedUrl ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [business.logoPath]);

  return (
    <Screen
      footer={
        <>
          <Button
            testID="home-customers"
            label={strings.appHome.customers}
            onPress={() => router.push('/customers')}
          />
          <Button
            testID="home-price-list"
            variant="secondary"
            label={strings.appHome.priceList}
            onPress={() => router.push('/price-list')}
          />
          <Button
            testID="home-settings"
            variant="secondary"
            label={strings.appHome.settings}
            onPress={() => router.push('/settings')}
          />
        </>
      }
    >
      <View style={styles.header}>
        {logoUrl ? (
          <Image testID="home-logo" source={{ uri: logoUrl }} style={styles.logo} />
        ) : null}
        <View style={styles.headerText}>
          <AppText variant="title" accessibilityRole="header" testID="home-business-name">
            {business.name}
          </AppText>
          <AppText variant="muted">{strings.app.tagline}</AppText>
        </View>
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <AppText variant="heading">{strings.appHome.emptyTitle}</AppText>
        <AppText variant="muted">{strings.appHome.emptyBody}</AppText>
      </View>
      <AppText variant="muted">{format(strings.appHome.greeting, { name: business.name })}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  headerText: { flex: 1, gap: space(0.5) },
  logo: { width: 56, height: 56, borderRadius: radius.md },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
});
