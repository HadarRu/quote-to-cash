import { format, radius, space, strings } from '@q2c/ui';
import { formatPhoneIL } from '@q2c/utils';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth, useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { Screen } from '../../../src/components/Screen';
import { useThemeColors } from '../../../src/theme';

export default function Settings() {
  const colors = useThemeColors();
  const { signOut } = useAuth();
  const { session } = useCurrentBusiness();
  const user = session.user;
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phone = user.phone ? formatPhoneIL(`+${user.phone}`) : strings.settings.notSet;
  const email = user.email
    ? user.email
    : user.new_email
      ? format(strings.settings.pendingConfirmation, { email: user.new_email })
      : strings.settings.notSet;

  const logout = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch {
      setSigningOut(false);
      setError(strings.errors.generic);
    }
  };

  return (
    <Screen title={strings.settings.title}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <AppText variant="heading">{strings.settings.account}</AppText>
        <Row label={strings.settings.phone} value={phone} testID="settings-phone" />
        <Row label={strings.settings.recoveryEmail} value={email} testID="settings-email" />
      </View>
      <Button
        testID="settings-change-phone"
        variant="secondary"
        label={strings.settings.changePhone}
        onPress={() => router.push('/settings/change-phone')}
      />
      <Button
        testID="settings-recovery-email"
        variant="secondary"
        label={strings.settings.setRecoveryEmail}
        onPress={() => router.push('/settings/recovery-email')}
      />
      {error ? <Banner tone="error" message={error} /> : null}
      {confirming ? (
        <View style={styles.confirm}>
          <AppText>{strings.settings.logoutConfirm}</AppText>
          <Button
            testID="settings-logout-confirm"
            variant="danger"
            label={strings.settings.logoutYes}
            onPress={logout}
            loading={signingOut}
          />
          <Button
            variant="ghost"
            label={strings.settings.cancel}
            onPress={() => setConfirming(false)}
          />
        </View>
      ) : (
        <Button
          testID="settings-logout"
          variant="ghost"
          label={strings.settings.logout}
          onPress={() => setConfirming(true)}
        />
      )}
      <Button variant="ghost" label={strings.settings.back} onPress={() => router.back()} />
    </Screen>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="muted">{label}</AppText>
      <AppText testID={testID}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space(2), flexWrap: 'wrap' },
  confirm: { gap: space(1) },
});
