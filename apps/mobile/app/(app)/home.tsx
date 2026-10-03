import { format, radius, space, strings } from '@q2c/ui';
import { router } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../../src/auth/AuthProvider';
import { useLogoUrl } from '../../src/business/useLogoUrl';
import { AppText } from '../../src/components/AppText';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';

export default function Home() {
  const { business } = useCurrentBusiness();
  const logoUrl = useLogoUrl(business.logoPath);

  return (
    <Screen
      footer={
        <>
          <Button
            testID="home-new-quote"
            label={strings.appHome.newQuote}
            onPress={() => router.push('/quotes/new')}
          />
          <Button
            testID="home-quotes"
            variant="secondary"
            label={strings.appHome.quotes}
            onPress={() => router.push('/quotes')}
          />
          <Button
            testID="home-customers"
            variant="secondary"
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
      <AppText variant="muted">{format(strings.appHome.greeting, { name: business.name })}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  headerText: { flex: 1, gap: space(0.5) },
  logo: { width: 56, height: 56, borderRadius: radius.md },
});
