import { Constants, type BusinessTrade, type TaxStatus } from '@q2c/types';
import { errorMessage, radius, space, strings } from '@q2c/ui';
import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useAuth } from '../src/auth/AuthProvider';
import {
  setupClient,
  submitBusinessSetup,
  validateSetup,
  type FieldErrors,
  type PickedLogo,
} from '../src/business/setup';
import { AppText } from '../src/components/AppText';
import { Banner } from '../src/components/Banner';
import { Button } from '../src/components/Button';
import { ChoiceChips } from '../src/components/ChoiceChips';
import { Screen } from '../src/components/Screen';
import { TextField } from '../src/components/TextField';
import { getSupabase } from '../src/lib/supabase';
import { useThemeColors } from '../src/theme';

const tradeOptions = Constants.public.Enums.business_trade.map((value) => ({
  value,
  label: strings.setup.trades[value],
}));
const taxStatusOptions = Constants.public.Enums.tax_status.map((value) => ({
  value,
  label: strings.setup.taxStatuses[value],
}));

function mimeFromUri(uri: string): string {
  if (/\.png$/i.test(uri)) return 'image/png';
  if (/\.webp$/i.test(uri)) return 'image/webp';
  return 'image/jpeg';
}

/** Creates the user's business (OWNER membership and settings come with it). */
export default function BusinessSetupScreen() {
  const colors = useThemeColors();
  const { refreshBusiness } = useAuth();
  // Generated once, so retries after a failure reuse the same business.
  const [businessId] = useState(() => randomUUID());
  const [name, setName] = useState('');
  const [trade, setTrade] = useState<BusinessTrade | null>(null);
  const [taxStatus, setTaxStatus] = useState<TaxStatus | null>(null);
  const [logo, setLogo] = useState<PickedLogo | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setLogo({
      uri: asset.uri,
      mimeType: asset.mimeType ?? mimeFromUri(asset.uri),
      // Unknown size (some platforms): Storage still enforces the limit.
      sizeBytes: asset.fileSize ?? asset.file?.size ?? 1,
    });
    clearError('logo');
  };

  const submit = async () => {
    setSubmitError(null);
    const validation = validateSetup({ businessId, name, trade, taxStatus }, logo);
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    const result = await submitBusinessSetup(setupClient(getSupabase()), validation.data, logo);
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(errorMessage(result.error));
      return;
    }
    // The router moves on to Home once the business is loaded.
    refreshBusiness();
  };

  const clearError = (key: keyof FieldErrors) =>
    setFieldErrors((e) => ({ ...e, [key]: undefined }));

  const fieldError = (key: keyof FieldErrors) => {
    const code = fieldErrors[key];
    return code ? errorMessage(code) : null;
  };

  return (
    <Screen
      title={strings.setup.title}
      subtitle={strings.setup.subtitle}
      footer={
        <Button
          testID="setup-submit"
          label={strings.setup.submit}
          onPress={submit}
          loading={submitting}
        />
      }
    >
      <TextField
        testID="setup-name"
        label={strings.setup.nameLabel}
        placeholder={strings.setup.namePlaceholder}
        value={name}
        onChangeText={(value) => {
          setName(value);
          clearError('name');
        }}
        error={fieldError('name')}
        maxLength={80}
        autoCapitalize="words"
      />
      <ChoiceChips
        testID="setup-trade"
        label={strings.setup.tradeLabel}
        options={tradeOptions}
        value={trade}
        onChange={(value) => {
          setTrade(value);
          clearError('trade');
        }}
        error={fieldError('trade')}
      />
      <ChoiceChips
        testID="setup-tax-status"
        label={strings.setup.taxStatusLabel}
        options={taxStatusOptions}
        value={taxStatus}
        onChange={(value) => {
          setTaxStatus(value);
          clearError('taxStatus');
        }}
        error={fieldError('taxStatus')}
      />
      <View style={styles.logo}>
        <AppText variant="muted">{strings.setup.logoLabel}</AppText>
        <View style={styles.logoRow}>
          {logo ? (
            <Image
              source={{ uri: logo.uri }}
              style={[styles.preview, { borderColor: colors.border }]}
            />
          ) : null}
          <View style={styles.logoActions}>
            <Button
              testID="setup-logo"
              variant="secondary"
              label={logo ? strings.setup.logoChange : strings.setup.logoPick}
              onPress={pickLogo}
            />
            {logo ? (
              <Button
                variant="ghost"
                label={strings.setup.logoRemove}
                onPress={() => setLogo(null)}
              />
            ) : null}
          </View>
        </View>
        {fieldError('logo') ? (
          <AppText accessibilityRole="alert" style={{ color: colors.danger }}>
            {fieldError('logo')}
          </AppText>
        ) : (
          <AppText variant="muted">{strings.setup.logoHint}</AppText>
        )}
      </View>
      {submitError ? <Banner tone="error" message={submitError} testID="setup-error" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { gap: space(1) },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  logoActions: { flex: 1, gap: space(1) },
  preview: { width: 72, height: 72, borderRadius: radius.md, borderWidth: 1 },
});
