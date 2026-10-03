import { strings } from '@q2c/ui';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../src/components/LoadingView';
import { newDraft } from '../../../src/quotes/model';
import { getQuoteStore } from '../../../src/quotes/sync';

/**
 * Starts a draft on the device (works offline) and opens the editor. From a
 * customer's page the customer is already chosen.
 */
export default function NewQuote() {
  const { business } = useCurrentBusiness();
  const params = useLocalSearchParams<{
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
  }>();
  // One id per screen, so a repeated effect saves the same draft.
  const [id] = useState(() => randomUUID());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const customer =
      params.customerId && params.customerName && params.customerPhone
        ? { id: params.customerId, fullName: params.customerName, phone: params.customerPhone }
        : null;
    void getQuoteStore()
      .then((store) =>
        store.saveDraft(
          newDraft({ id, businessId: business.id, customer, now: new Date().toISOString() }),
          null,
        ),
      )
      .then(() => router.replace({ pathname: '/quotes/[id]/edit', params: { id } }))
      .catch(() => setFailed(true));
  }, [attempt, id, business.id, params.customerId, params.customerName, params.customerPhone]);

  if (failed)
    return (
      <FullScreenMessage
        title={strings.states.error}
        body={strings.errors.generic}
        actionLabel={strings.states.retry}
        onAction={() => {
          setFailed(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  return <LoadingView />;
}
