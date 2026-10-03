import { emailSchema } from '@q2c/types';
import { errorMessage, format, strings } from '@q2c/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { Screen } from '../../../src/components/Screen';
import { TextField } from '../../../src/components/TextField';
import { isNetworkError } from '../../../src/lib/errors';
import { getSupabase } from '../../../src/lib/supabase';

/** Optional email for account recovery; it becomes active after the emailed confirmation. */
export default function RecoveryEmail() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setFieldError(errorMessage('email_invalid'));
    setFieldError(null);
    setSaving(true);
    const { error: updateError } = await getSupabase().auth.updateUser({ email: parsed.data });
    setSaving(false);
    if (updateError)
      return setError(errorMessage(isNetworkError(updateError) ? 'network' : 'generic'));
    setSentTo(parsed.data);
  };

  return (
    <Screen title={strings.recoveryEmail.title}>
      <AppText>{strings.recoveryEmail.body}</AppText>
      {sentTo ? (
        <Banner
          tone="success"
          testID="recovery-sent"
          message={format(strings.recoveryEmail.sent, { email: sentTo })}
        />
      ) : (
        <>
          <TextField
            testID="recovery-email"
            label={strings.recoveryEmail.label}
            placeholder={strings.recoveryEmail.placeholder}
            value={email}
            onChangeText={setEmail}
            error={fieldError}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
          />
          {error ? <Banner tone="error" message={error} /> : null}
          <Button
            testID="recovery-save"
            label={strings.recoveryEmail.save}
            onPress={save}
            loading={saving}
          />
        </>
      )}
      <Button variant="ghost" label={strings.settings.back} onPress={() => router.back()} />
    </Screen>
  );
}
