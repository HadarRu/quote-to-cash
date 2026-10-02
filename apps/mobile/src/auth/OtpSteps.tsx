import { PhoneSchema, type PhoneE164 } from '@q2c/types';
import { errorMessage, format, space, strings } from '@q2c/ui';
import { formatPhoneIL } from '@q2c/utils';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { OTP_LENGTH, OtpFlow, type OtpErrorKey, type OtpProvider } from './otp';

interface OtpStepsProps {
  provider: OtpProvider;
  /** Number to verify without asking for one (re-verifying the current number). */
  fixedPhone?: PhoneE164;
  phoneLabel?: string;
  phoneIntro?: string;
  sendLabel: string;
  /** Extra check on the normalized number before sending; returns a message to show. */
  validatePhone?: (phone: PhoneE164) => string | null;
  onVerified: (phone: PhoneE164) => void;
  testID?: string;
}

/** Phone -> 6-digit code, with resend cooldown and attempt limits (see otp.ts). */
export function OtpSteps({
  provider,
  fixedPhone,
  phoneLabel = strings.auth.phoneLabel,
  phoneIntro,
  sendLabel,
  validatePhone,
  onVerified,
  testID = 'otp',
}: OtpStepsProps) {
  const [flow] = useState(() => new OtpFlow(provider));
  const [sentTo, setSentTo] = useState<PhoneE164 | null>(null);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft(flow.secondsUntilResend()), 1000);
    return () => clearInterval(id);
  }, [flow]);

  const message = (key: OtpErrorKey) =>
    errorMessage(key, { seconds: flow.secondsUntilResend(), attempts: flow.attemptsLeft });

  const sendFirst = async () => {
    setError(null);
    setNotice(null);
    const raw = fixedPhone ?? phoneInput;
    const parsed = PhoneSchema.safeParse(raw);
    if (parsed.success && validatePhone) {
      const problem = validatePhone(parsed.data);
      if (problem) return setError(problem);
    }
    setBusy(true);
    const result = await flow.start(raw);
    setBusy(false);
    setSecondsLeft(flow.secondsUntilResend());
    if (!result.ok) return setError(message(result.error));
    setSentTo(flow.phone);
    setCode('');
    setStep('code');
  };

  const resend = async () => {
    setError(null);
    setBusy(true);
    const result = await flow.resend();
    setBusy(false);
    setSecondsLeft(flow.secondsUntilResend());
    if (!result.ok) return setError(message(result.error));
    setCode('');
    setNotice(strings.auth.codeResent);
  };

  const verify = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await flow.verify(code);
    setBusy(false);
    if (result.ok && flow.phone) return onVerified(flow.phone);
    if (!result.ok) {
      const text = message(result.error);
      setError(
        result.error === 'code_invalid'
          ? `${text}. ${format(strings.auth.attemptsLeft, { attempts: flow.attemptsLeft })}`
          : text,
      );
    }
  };

  if (step === 'phone') {
    return (
      <View style={styles.stack}>
        {phoneIntro ? <AppText>{phoneIntro}</AppText> : null}
        {fixedPhone ? null : (
          <TextField
            testID={`${testID}-phone`}
            label={phoneLabel}
            placeholder={strings.auth.phonePlaceholder}
            value={phoneInput}
            onChangeText={setPhoneInput}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            inputMode="tel"
            onSubmitEditing={sendFirst}
          />
        )}
        {error ? <Banner tone="error" message={error} testID={`${testID}-error`} /> : null}
        <Button testID={`${testID}-send`} label={sendLabel} onPress={sendFirst} loading={busy} />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <AppText>
        {format(strings.auth.codeSentTo, { phone: sentTo ? formatPhoneIL(sentTo) : '' })}
      </AppText>
      <TextField
        testID={`${testID}-code`}
        label={strings.auth.codeLabel}
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={OTP_LENGTH}
        autoFocus
        onSubmitEditing={verify}
      />
      {error ? <Banner tone="error" message={error} testID={`${testID}-error`} /> : null}
      {notice ? <Banner tone="success" message={notice} /> : null}
      <Button
        testID={`${testID}-verify`}
        label={strings.auth.verify}
        onPress={verify}
        loading={busy}
      />
      <Button
        testID={`${testID}-resend`}
        variant="ghost"
        label={
          secondsLeft > 0
            ? format(strings.auth.resendIn, { seconds: secondsLeft })
            : strings.auth.resend
        }
        onPress={resend}
        disabled={secondsLeft > 0 || busy}
      />
      {fixedPhone ? null : (
        <Button
          variant="ghost"
          label={strings.auth.changeNumber}
          onPress={() => {
            setError(null);
            setStep('phone');
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space(2) },
});
