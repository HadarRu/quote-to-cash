import { isUnpaidInvoice } from '@q2c/types';
import { errorMessage, MIN_TOUCH_TARGET, radius, space, strings } from '@q2c/ui';
import { formatDateIL, formatMoney } from '@q2c/utils';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { ChoiceChips } from '../../../src/components/ChoiceChips';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../src/components/LoadingView';
import { Screen } from '../../../src/components/Screen';
import { getInvoicesApi, useInvoicesOverview } from '../../../src/invoices/hooks';
import {
  filterInvoices,
  invoiceLabel,
  paymentReminderUrl,
  type InvoiceFilter,
  type InvoiceListItem,
  type JobSummary,
} from '../../../src/invoices/model';
import { useThemeColors } from '../../../src/theme';

const filterOptions: { value: InvoiceFilter; label: string }[] = [
  { value: 'unpaid', label: strings.invoices.filterUnpaid },
  { value: 'all', label: strings.invoices.filterAll },
];

/** Completed jobs to invoice, then invoices (unpaid first view) with payment reminders. */
export default function InvoicesList() {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const { state, reload } = useInvoicesOverview(business.id);
  const [filter, setFilter] = useState<InvoiceFilter>('unpaid');
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per job while this screen is open: a retried tap returns the same invoice.
  const keys = useRef(new Map<string, string>());

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error')
    return (
      <FullScreenMessage
        title={strings.states.error}
        body={errorMessage(state.error)}
        actionLabel={strings.states.retry}
        onAction={() => void reload()}
      />
    );

  const { invoices, jobsToInvoice } = state.data;
  const visible = filterInvoices(invoices, filter);
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  const create = async (job: JobSummary) => {
    setBusyJob(job.id);
    setError(null);
    let key = keys.current.get(job.id);
    if (!key) {
      key = randomUUID();
      keys.current.set(job.id, key);
    }
    const result = await getInvoicesApi().create(job.id, key);
    setBusyJob(null);
    if (result.error) {
      return setError(errorMessage(result.error.retryable ? 'network' : (result.error.code ?? '')));
    }
    router.push({ pathname: '/invoices/[id]', params: { id: result.data.invoiceId } });
  };

  return (
    <Screen title={strings.invoices.title}>
      {state.offline ? (
        <Banner tone="info" testID="invoices-offline" message={strings.invoices.offline} />
      ) : null}
      {error ? <Banner tone="error" testID="invoices-error" message={error} /> : null}

      {invoices.length === 0 && jobsToInvoice.length === 0 ? (
        <View style={card} testID="invoices-empty">
          <AppText variant="heading">{strings.invoices.emptyTitle}</AppText>
          <AppText variant="muted">{strings.invoices.emptyBody}</AppText>
        </View>
      ) : null}

      {jobsToInvoice.length > 0 ? (
        <View style={styles.section} testID="invoices-ready">
          <AppText variant="heading">{strings.invoices.readyTitle}</AppText>
          <AppText variant="muted">{strings.invoices.readyBody}</AppText>
          {jobsToInvoice.map((job) => (
            <View key={job.id} style={[card, styles.row]} testID="job-to-invoice">
              <View style={styles.grow}>
                <AppText>
                  {job.customerName ? `${job.title} · ${job.customerName}` : job.title}
                </AppText>
                <AppText variant="muted">
                  {[
                    job.totalMinor !== null ? formatMoney(job.totalMinor) : null,
                    job.completedAt ? formatDateIL(job.completedAt) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
              </View>
              <Button
                testID="job-create-invoice"
                label={strings.invoices.create}
                loading={busyJob === job.id}
                disabled={busyJob !== null || state.offline}
                onPress={() => void create(job)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {invoices.length > 0 ? (
        <View style={styles.section}>
          <ChoiceChips
            testID="invoices-filter"
            label={strings.invoices.filterLabel}
            options={filterOptions}
            value={filter}
            onChange={setFilter}
          />
          {visible.length === 0 ? (
            <AppText variant="muted" testID="invoices-no-results">
              {filter === 'unpaid' ? strings.invoices.noUnpaid : strings.invoices.noInvoices}
            </AppText>
          ) : (
            visible.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} businessName={business.name} />
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function InvoiceRow({ invoice, businessName }: { invoice: InvoiceListItem; businessName: string }) {
  const colors = useThemeColors();
  const reminder = isUnpaidInvoice(invoice.status)
    ? paymentReminderUrl(invoice, businessName)
    : null;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        testID="invoice-row"
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/invoices/[id]', params: { id: invoice.id } })}
        style={styles.row}
      >
        <View style={styles.grow}>
          <AppText>{`${invoiceLabel(invoice)} · ${invoice.customerName ?? ''}`}</AppText>
          {invoice.jobTitle ? <AppText variant="muted">{invoice.jobTitle}</AppText> : null}
        </View>
        <View style={styles.meta}>
          <AppText>{formatMoney(invoice.totalMinor)}</AppText>
          <AppText variant="muted" testID="invoice-row-status">
            {`${strings.invoiceStatus[invoice.status]} · ${formatDateIL(invoice.issuedAt ?? invoice.createdAt)}`}
          </AppText>
        </View>
      </Pressable>
      {reminder ? (
        <Button
          testID="invoice-remind"
          variant="secondary"
          label={strings.invoices.remind}
          onPress={() => void Linking.openURL(reminder)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space(1) },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(1.5),
    gap: space(1),
  },
  row: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: space(1) },
  grow: { flex: 1, gap: space(0.5) },
  meta: { alignItems: 'flex-end', gap: space(0.5) },
});
