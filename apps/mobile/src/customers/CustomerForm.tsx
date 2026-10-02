import { errorMessage, format, space, strings } from '@q2c/ui';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../auth/AuthProvider';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { getSupabase } from '../lib/supabase';
import { supabaseCustomersDb } from './db';
import {
  validateCustomerForm,
  type CustomerFieldErrors,
  type CustomerFormField,
  type CustomerFormValues,
} from './model';
import { saveCustomer } from './service';

type Address = NonNullable<CustomerFormValues['address']>;

const emptyAddress = (): Address => ({
  id: randomUUID(),
  street: '',
  houseNumber: '',
  apartment: '',
  city: '',
  postalCode: '',
  accessNotes: '',
});

export function newCustomerValues(
  prefill: { fullName?: string; phone?: string } = {},
): CustomerFormValues {
  return {
    id: randomUUID(),
    fullName: prefill.fullName ?? '',
    phone: prefill.phone ?? '',
    email: '',
    notes: '',
    address: null,
  };
}

interface CustomerFormProps {
  /** `quick`: name and phone only (used from the quote flow). */
  mode: 'full' | 'quick';
  initial: CustomerFormValues;
  /** Primary address loaded for editing; removed if the user clears the address. */
  previousAddressId?: string | null;
  onSaved: (customerId: string) => void;
}

/** Add / Edit Customer. A phone already used by another customer offers to open that customer. */
export function CustomerForm({
  mode,
  initial,
  previousAddressId = null,
  onSaved,
}: CustomerFormProps) {
  const { business } = useCurrentBusiness();
  const db = useMemo(() => supabaseCustomersDb(getSupabase()), []);
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; fullName: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: 'fullName' | 'phone' | 'email' | 'notes') => (text: string) => {
    setValues((v) => ({ ...v, [field]: text }));
    setFieldErrors((e) => ({ ...e, [field]: undefined }));
    if (field === 'phone') setDuplicate(null);
  };
  const setAddress = (field: Exclude<keyof Address, 'id'>) => (text: string) => {
    setValues((v) => (v.address ? { ...v, address: { ...v.address, [field]: text } } : v));
    setFieldErrors((e) => ({ ...e, [`address.${field}`]: undefined }));
  };
  const fieldError = (field: CustomerFormField) => {
    const key = fieldErrors[field];
    return key ? errorMessage(key) : null;
  };

  const save = async () => {
    setError(null);
    setDuplicate(null);
    const validation = validateCustomerForm(values, mode);
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    const result = await saveCustomer(db, business.id, validation.data, {
      current: mode === 'full' ? (values.address?.id ?? null) : null,
      previous: mode === 'full' ? previousAddressId : null,
    });
    setSaving(false);
    if (result.ok) return onSaved(result.id);
    if (result.error === 'duplicate_phone') return setDuplicate(result.existing);
    setError(errorMessage(result.error));
  };

  return (
    <View style={styles.form}>
      <TextField
        testID="customer-name"
        label={strings.customers.nameLabel}
        placeholder={strings.customers.namePlaceholder}
        value={values.fullName}
        onChangeText={set('fullName')}
        error={fieldError('fullName')}
        autoCapitalize="words"
        autoFocus={!initial.fullName}
      />
      <TextField
        testID="customer-phone"
        label={strings.customers.phoneLabel}
        placeholder={strings.auth.phonePlaceholder}
        value={values.phone}
        onChangeText={set('phone')}
        error={fieldError('phone')}
        keyboardType="phone-pad"
        inputMode="tel"
        autoComplete="tel"
      />
      {duplicate ? (
        <View style={styles.duplicate}>
          <Banner
            tone="info"
            testID="customer-duplicate"
            message={format(strings.customers.duplicate, { name: duplicate.fullName })}
          />
          <Button
            testID="customer-open-existing"
            variant="secondary"
            label={strings.customers.openExisting}
            onPress={() => router.push(`/customers/${duplicate.id}`)}
          />
        </View>
      ) : null}
      {mode === 'full' ? (
        <>
          <TextField
            testID="customer-email"
            label={strings.customers.emailLabel}
            placeholder={strings.recoveryEmail.placeholder}
            value={values.email}
            onChangeText={set('email')}
            error={fieldError('email')}
            keyboardType="email-address"
            inputMode="email"
            autoCapitalize="none"
          />
          {values.address ? (
            <View style={styles.address}>
              <AppText variant="heading">{strings.customers.addressTitle}</AppText>
              <TextField
                testID="customer-street"
                label={strings.customers.streetLabel}
                value={values.address.street}
                onChangeText={setAddress('street')}
                error={fieldError('address.street')}
              />
              <View style={styles.row}>
                <View style={styles.cell}>
                  <TextField
                    testID="customer-house-number"
                    label={strings.customers.houseNumberLabel}
                    value={values.address.houseNumber}
                    onChangeText={setAddress('houseNumber')}
                    error={fieldError('address.houseNumber')}
                  />
                </View>
                <View style={styles.cell}>
                  <TextField
                    label={strings.customers.apartmentLabel}
                    value={values.address.apartment}
                    onChangeText={setAddress('apartment')}
                    error={fieldError('address.apartment')}
                  />
                </View>
              </View>
              <TextField
                testID="customer-city"
                label={strings.customers.cityLabel}
                value={values.address.city}
                onChangeText={setAddress('city')}
                error={fieldError('address.city')}
              />
              <TextField
                label={strings.customers.postalCodeLabel}
                value={values.address.postalCode}
                onChangeText={setAddress('postalCode')}
                error={fieldError('address.postalCode')}
                keyboardType="number-pad"
                inputMode="numeric"
              />
              <TextField
                label={strings.customers.accessNotesLabel}
                value={values.address.accessNotes}
                onChangeText={setAddress('accessNotes')}
                error={fieldError('address.accessNotes')}
              />
              <Button
                variant="ghost"
                label={strings.customers.removeAddress}
                onPress={() => setValues((v) => ({ ...v, address: null }))}
              />
            </View>
          ) : (
            <Button
              testID="customer-add-address"
              variant="secondary"
              label={strings.customers.addAddress}
              onPress={() => setValues((v) => ({ ...v, address: emptyAddress() }))}
            />
          )}
          <TextField
            testID="customer-notes"
            label={strings.customers.notesLabel}
            value={values.notes}
            onChangeText={set('notes')}
            error={fieldError('notes')}
            multiline
          />
        </>
      ) : null}
      {error ? <Banner tone="error" testID="customer-error" message={error} /> : null}
      <Button
        testID="customer-save"
        label={strings.customers.save}
        onPress={save}
        loading={saving}
      />
    </View>
  );
}

/** Name + phone only, for creating a customer without leaving another flow (e.g. a new quote). */
export function QuickCreateCustomer({
  prefill,
  onCreated,
}: {
  prefill?: { fullName?: string; phone?: string };
  onCreated: (customerId: string) => void;
}) {
  const [initial] = useState(() => newCustomerValues(prefill));
  return <CustomerForm mode="quick" initial={initial} onSaved={onCreated} />;
}

const styles = StyleSheet.create({
  form: { gap: space(2) },
  duplicate: { gap: space(1) },
  address: { gap: space(2) },
  row: { flexDirection: 'row', gap: space(2) },
  cell: { flex: 1 },
});
