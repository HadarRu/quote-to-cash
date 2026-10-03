import type { PhoneE164 } from '@q2c/types';
import { format, strings } from '@q2c/ui';
import { formatPhoneIL } from '@q2c/utils';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { OtpSteps } from '../../../src/auth/OtpSteps';
import { currentPhoneProvider, phoneChangeProvider } from '../../../src/auth/providers';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { Screen } from '../../../src/components/Screen';
import { getSupabase } from '../../../src/lib/supabase';

/** Change the account's phone: verify the current number first, then the new one. */
export default function ChangePhone() {
  const { session } = useCurrentBusiness();
  const currentPhone = `+${session.user.phone ?? ''}` as PhoneE164;
  const supabase = getSupabase();
  const current = useMemo(() => currentPhoneProvider(supabase), [supabase]);
  const next = useMemo(() => phoneChangeProvider(supabase), [supabase]);
  const [step, setStep] = useState<'current' | 'new' | 'done'>('current');
  const [newPhone, setNewPhone] = useState<PhoneE164 | null>(null);

  return (
    <Screen title={strings.changePhone.title}>
      {step === 'current' ? (
        <OtpSteps
          key="current"
          testID="change-current"
          provider={current}
          fixedPhone={currentPhone}
          phoneIntro={format(strings.changePhone.stepCurrent, {
            phone: formatPhoneIL(currentPhone),
          })}
          sendLabel={strings.changePhone.sendToCurrent}
          onVerified={() => setStep('new')}
        />
      ) : step === 'new' ? (
        <OtpSteps
          key="new"
          testID="change-new"
          provider={next}
          phoneIntro={strings.changePhone.stepNew}
          phoneLabel={strings.changePhone.newPhoneLabel}
          sendLabel={strings.changePhone.sendToNew}
          validatePhone={(phone) => (phone === currentPhone ? strings.changePhone.samePhone : null)}
          onVerified={(phone) => {
            setNewPhone(phone);
            setStep('done');
          }}
        />
      ) : (
        <Banner
          tone="success"
          testID="change-done"
          message={format(strings.changePhone.done, {
            phone: newPhone ? formatPhoneIL(newPhone) : '',
          })}
        />
      )}
      <Button variant="ghost" label={strings.settings.back} onPress={() => router.back()} />
    </Screen>
  );
}
