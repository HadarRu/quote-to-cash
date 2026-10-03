import { errorMessage, format, radius, space, strings } from '@q2c/ui';
import {
  formatAddressLine,
  formatDateIL,
  formatMoney,
  formatPhoneIL,
  telUrl,
  whatsappUrl,
} from '@q2c/utils';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../../src/components/AppText';
import { Banner } from '../../../../src/components/Banner';
import { Button } from '../../../../src/components/Button';
import { FullScreenMessage } from '../../../../src/components/FullScreenMessage';
import { Screen } from '../../../../src/components/Screen';
import { supabaseCustomersDb } from '../../../../src/customers/db';
import type {
  CustomerAddress,
  CustomerDetail,
  CustomerQuoteSummary,
} from '../../../../src/customers/model';
import { deleteCustomer } from '../../../../src/customers/service';
import { getSupabase } from '../../../../src/lib/supabase';
import { useCachedQuery } from '../../../../src/lib/useCachedQuery';
import { useThemeColors } from '../../../../src/theme';

/** Customer Details: contact actions, addresses and quote history. */
export default function CustomerDetails() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useMemo(() => supabaseCustomersDb(getSupabase()), []);
  const fetcher = useCallback(() => db.getCustomer(id), [db, id]);
  const { state, reload } = useCachedQuery<CustomerDetail | null>(`customer:${id}`, fetcher);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <Screen>
        <ActivityIndicator
          color={colors.primary}
          size="large"
          accessibilityLabel={strings.states.loading}
        />
      </Screen>
    );
  }
  if (state.status === 'error') {
    return (
      <FullScreenMessage
        title={strings.states.error}
        body={state.error === 'network' ? strings.errors.network : strings.errors.generic}
        actionLabel={strings.states.retry}
        onAction={() => void reload()}
      />
    );
  }
  const customer = state.data;
  if (!customer) {
    return (
      <FullScreenMessage
        title={strings.customers.notFound}
        actionLabel={strings.customers.backToList}
        onAction={() => router.dismissTo('/customers')}
      />
    );
  }

  const open = (url: string) => {
    setActionError(null);
    Linking.openURL(url).catch(() => setActionError(strings.errors.generic));
  };

  const remove = async () => {
    setDeleting(true);
    setActionError(null);
    const result = await deleteCustomer(db, customer.id);
    setDeleting(false);
    if (!result.ok) {
      setActionError(errorMessage(result.error));
      return;
    }
    router.dismissTo('/customers');
  };

  const deleted = customer.deletedAt !== null;

  return (
    <Screen title={customer.fullName}>
      {state.offline ? <Banner tone="info" message={strings.customers.offline} /> : null}
      {deleted ? (
        <Banner tone="info" testID="customer-deleted" message={strings.customers.deletedNotice} />
      ) : null}

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <AppText testID="customer-phone-display" style={styles.ltr}>
          {formatPhoneIL(customer.phone)}
        </AppText>
        {customer.email ? <AppText variant="muted">{customer.email}</AppText> : null}
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              testID="customer-call"
              label={strings.customers.call}
              onPress={() => open(telUrl(customer.phone))}
            />
          </View>
          <View style={styles.action}>
            <Button
              testID="customer-whatsapp"
              variant="secondary"
              label={strings.customers.whatsapp}
              onPress={() => open(whatsappUrl(customer.phone))}
            />
          </View>
        </View>
      </View>

      {customer.notes ? (
        <Section title={strings.customers.notes}>
          <AppText>{customer.notes}</AppText>
        </Section>
      ) : null}

      <Section title={strings.customers.addresses}>
        {customer.addresses.length === 0 ? (
          <AppText variant="muted">{strings.customers.noAddresses}</AppText>
        ) : (
          customer.addresses.map((a) => <AddressLine key={a.id} address={a} />)
        )}
      </Section>

      {deleted ? null : (
        <Button
          testID="customer-new-quote"
          label={strings.customers.newQuote}
          onPress={() =>
            router.push({
              pathname: '/quotes/new',
              params: {
                customerId: customer.id,
                customerName: customer.fullName,
                customerPhone: customer.phone,
              },
            })
          }
        />
      )}

      <Section title={strings.customers.quotes}>
        {customer.quotes.length === 0 ? (
          <AppText variant="muted" testID="customer-no-quotes">
            {strings.customers.noQuotes}
          </AppText>
        ) : (
          customer.quotes.map((q) => <QuoteLine key={q.id} quote={q} />)
        )}
      </Section>

      {actionError ? (
        <Banner tone="error" testID="customer-action-error" message={actionError} />
      ) : null}

      {deleted ? null : (
        <View style={styles.footer}>
          <Button
            testID="customer-edit"
            variant="secondary"
            label={strings.customers.edit}
            onPress={() => router.push(`/customers/${customer.id}/edit`)}
          />
          {confirming ? (
            <View style={styles.confirm}>
              <AppText>
                {format(strings.customers.deleteConfirm, { name: customer.fullName })}
              </AppText>
              <Button
                testID="customer-delete-confirm"
                variant="danger"
                label={strings.customers.deleteYes}
                onPress={remove}
                loading={deleting}
              />
              <Button
                variant="ghost"
                label={strings.settings.cancel}
                onPress={() => setConfirming(false)}
              />
            </View>
          ) : (
            <Button
              testID="customer-delete"
              variant="ghost"
              label={strings.customers.delete}
              onPress={() => setConfirming(true)}
            />
          )}
        </View>
      )}
      <Button
        variant="ghost"
        label={strings.customers.backToList}
        onPress={() => router.dismissTo('/customers')}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText variant="heading">{title}</AppText>
      {children}
    </View>
  );
}

function AddressLine({ address }: { address: CustomerAddress }) {
  const line = formatAddressLine(address, strings.customers.apartmentLabel);
  return (
    <View style={styles.line}>
      <AppText>{address.isPrimary ? `${line} · ${strings.customers.primary}` : line}</AppText>
      {address.accessNotes ? <AppText variant="muted">{address.accessNotes}</AppText> : null}
    </View>
  );
}

function QuoteLine({ quote }: { quote: CustomerQuoteSummary }) {
  const status = (strings.quoteStatus as Record<string, string>)[quote.status] ?? quote.status;
  return (
    <Pressable
      style={styles.quote}
      testID="customer-quote"
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/quotes/[id]', params: { id: quote.id } })}
    >
      <View style={styles.line}>
        <AppText>
          {quote.quoteNumber === null
            ? strings.quotes.draftLabel
            : format(strings.customers.quoteNumber, { number: quote.quoteNumber })}
        </AppText>
        {quote.title ? <AppText variant="muted">{quote.title}</AppText> : null}
      </View>
      <View style={styles.quoteMeta}>
        <AppText>{formatMoney(quote.totalMinor)}</AppText>
        <AppText variant="muted">{`${status} · ${formatDateIL(quote.createdAt)}`}</AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
  ltr: { writingDirection: 'ltr' },
  actions: { flexDirection: 'row', gap: space(1) },
  action: { flex: 1 },
  line: { gap: space(0.5), flexShrink: 1 },
  quote: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space(2),
    paddingVertical: space(0.5),
  },
  quoteMeta: { alignItems: 'flex-end', gap: space(0.5) },
  footer: { gap: space(1) },
  confirm: { gap: space(1) },
});
