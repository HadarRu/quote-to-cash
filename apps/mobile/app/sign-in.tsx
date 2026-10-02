import { strings } from '@q2c/ui';
import { useMemo } from 'react';
import { OtpSteps } from '../src/auth/OtpSteps';
import { signInProvider } from '../src/auth/providers';
import { Screen } from '../src/components/Screen';
import { getSupabase } from '../src/lib/supabase';

/** Sign in or sign up: phone, then the 6-digit code. Navigation follows the auth state. */
export default function SignIn() {
  const provider = useMemo(() => signInProvider(getSupabase()), []);
  return (
    <Screen title={strings.auth.phoneTitle} subtitle={strings.auth.phoneSubtitle}>
      <OtpSteps
        testID="sign-in"
        provider={provider}
        sendLabel={strings.auth.sendCode}
        onVerified={() => undefined}
      />
    </Screen>
  );
}
