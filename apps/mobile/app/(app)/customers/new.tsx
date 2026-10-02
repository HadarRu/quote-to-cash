import { strings } from '@q2c/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Screen } from '../../../src/components/Screen';
import { CustomerForm, newCustomerValues } from '../../../src/customers/CustomerForm';

/** Add Customer. `?mode=quick` shows name + phone only; `name` / `phone` prefill the form. */
export default function NewCustomer() {
  const params = useLocalSearchParams<{ mode?: string; name?: string; phone?: string }>();
  const mode = params.mode === 'quick' ? 'quick' : 'full';
  const [initial] = useState(() =>
    newCustomerValues({ fullName: params.name, phone: params.phone }),
  );
  return (
    <Screen title={mode === 'quick' ? strings.customers.quickTitle : strings.customers.newTitle}>
      <CustomerForm
        mode={mode}
        initial={initial}
        onSaved={(id) => router.replace(`/customers/${id}`)}
      />
    </Screen>
  );
}
