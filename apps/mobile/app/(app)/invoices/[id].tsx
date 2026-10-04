import {
  canTransitionInvoice,
  Constants,
  isUnpaidInvoice,
  IssueInvoiceRequestSchema,
  type PaymentMethod,
} from '@q2c/types';
import { errorMessage, format, radius, space, strings } from '@q2c/ui';
import { formatDateIL, formatMoney } from '@q2c/utils';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { ChoiceChips } from '../../../src/components/ChoiceChips';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../src/components/LoadingView';
import { Screen } from '../../../src/components/Screen';
import { TextField } from '../../../src/components/TextField';
import { getInvoicesApi, useInvoice } from '../../../src/invoices/hooks';
import {
  invoiceDataSheet,
  invoiceLabel,
  paymentReminderUrl,
  type InvoiceListItem,
} from '../../../src/invoices/model';
import type { ApiResult } from '../../../src/quotes/outbox';
import { useThemeColors } from '../../../src/theme';

const methodOptions = Constants.public.Enums.payment_method.map((method) => ({
  value: method,
  label: strings.paymentMethod[method],
}));

/** One invoice: its data sheet, recording the document number, sent, paid, and void. */
export default function InvoiceDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useInvoice(id);

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
  if (!state.data)
    return (
      <FullScreenMessage
        title={strings.invoices.notFound}
        actionLabel={strings.invoices.backToList}
        onAction={() => router.replace('/invoices')}
      />
    );
  return <Details invoice={state.data} offline={state.offline} reload={reload} />;
}

function Details({
  invoice,
  offline,
  reload,
}: {
  invoice: InvoiceListItem;
  offline: boolean;
  reload: () => Promise<void>;
}) {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const [documentNumber, setDocumentNumber] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  const sheet = invoiceDataSheet(invoice);
  const reminder = isUnpaidInvoice(invoice.status)
    ? paymentReminderUrl(invoice, business.name)
    : null;
  const can = (to: Parameters<typeof canTransitionInvoice>[1]) =>
    !offline && canTransitionInvoice(invoice.status, to);

  const run = async (name: string, action: () => Promise<ApiResult<unknown>>) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    const result = await action();
    if (result.error) {
      setBusy(null);
      return setError(errorMessage(result.error.retryable ? 'network' : (result.error.code ?? '')));
    }
    await reload();
    setBusy(null);
    setConfirmVoid(false);
  };

  const issue = () => {
    const parsed = IssueInvoiceRequestSchema.safeParse({ documentNumber });
    if (!parsed.success) return setFieldError(errorMessage(parsed.error.issues[0]!.message));
    setFieldError(null);
    void run('issue', () => getInvoicesApi().issue(invoice.id, parsed.data.documentNumber));
  };

  const markPaid = () => {
    if (!method) return setError(errorMessage('payment_method_required'));
    void run('paid', () => getInvoicesApi().markPaid(invoice.id, method));
  };

  const copy = async () => {
    await Clipboard.setStringAsync(sheet);
    setNotice(strings.invoices.copied);
  };

  const dates = [
    invoice.issuedAt
      ? format(strings.invoices.issuedOn, { date: formatDateIL(invoice.issuedAt) })
      : null,
    invoice.sentAt ? format(strings.invoices.sentOn, { date: formatDateIL(invoice.sentAt) }) : null,
    invoice.paidAt
      ? format(strings.invoices.paidOn, {
          date: formatDateIL(invoice.paidAt),
          method: invoice.paymentMethod ? strings.paymentMethod[invoice.paymentMethod] : '',
        })
      : null,
    invoice.voidedAt
      ? format(strings.invoices.voidedOn, { date: formatDateIL(invoice.voidedAt) })
      : null,
  ].filter((line): line is string => line !== null);

  return (
    <Screen title={invoiceLabel(invoice)} subtitle={invoice.customerName ?? undefined}>
      {offline ? <Banner tone="info" message={strings.invoices.offline} /> : null}

      <View style={card}>
        <AppText variant="heading" testID="invoice-status">
          {strings.invoiceStatus[invoice.status]}
        </AppText>
        <AppText>{formatMoney(invoice.totalMinor)}</AppText>
        {invoice.documentNumber ? (
          <AppText testID="invoice-document-number">
            {format(strings.invoices.documentNumber, { number: invoice.documentNumber })}
          </AppText>
        ) : null}
        <AppText variant="muted">
          {format(strings.invoices.internalNumber, { number: invoice.invoiceNumber })}
        </AppText>
        {dates.map((line) => (
          <AppText key={line} variant="muted">
            {line}
          </AppText>
        ))}
        {invoice.status === 'failed' && invoice.failureReason ? (
          <AppText variant="muted">
            {format(strings.invoices.failure, { reason: invoice.failureReason })}
          </AppText>
        ) : null}
      </View>

      {error ? <Banner tone="error" testID="invoice-action-error" message={error} /> : null}
      {notice ? <Banner tone="success" testID="invoice-notice" message={notice} /> : null}

      {reminder ? (
        <Button
          testID="invoice-remind"
          label={strings.invoices.remind}
          onPress={() => void Linking.openURL(reminder)}
        />
      ) : null}

      <View style={card} testID="invoice-sheet">
        <AppText variant="heading">{strings.invoices.sheetTitle}</AppText>
        {can('issued') ? <AppText variant="muted">{strings.invoices.sheetBody}</AppText> : null}
        <AppText selectable style={[styles.sheet, { borderColor: colors.border }]}>
          {sheet}
        </AppText>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Button
              testID="invoice-copy"
              variant="secondary"
              label={strings.invoices.copy}
              onPress={() => void copy()}
            />
          </View>
          <View style={styles.grow}>
            <Button
              testID="invoice-share"
              variant="secondary"
              label={strings.invoices.share}
              onPress={() => void Share.share({ message: sheet }).catch(() => undefined)}
            />
          </View>
        </View>
      </View>

      {can('issued') ? (
        <View style={card}>
          <TextField
            testID="invoice-document-number-input"
            label={strings.invoices.documentNumberLabel}
            placeholder={strings.invoices.documentNumberPlaceholder}
            value={documentNumber}
            onChangeText={setDocumentNumber}
            error={fieldError}
            maxLength={50}
          />
          <Button
            testID="invoice-issue"
            label={strings.invoices.markIssued}
            loading={busy === 'issue'}
            disabled={busy !== null}
            onPress={issue}
          />
        </View>
      ) : null}

      {can('sent') ? (
        <Button
          testID="invoice-mark-sent"
          variant="secondary"
          label={strings.invoices.markSent}
          loading={busy === 'sent'}
          disabled={busy !== null}
          onPress={() => void run('sent', () => getInvoicesApi().markSent(invoice.id))}
        />
      ) : null}

      {can('paid') ? (
        <View style={card}>
          <AppText variant="heading">{strings.invoices.paymentTitle}</AppText>
          <ChoiceChips
            testID="invoice-payment-method"
            label={strings.invoices.paymentMethodLabel}
            options={methodOptions}
            value={method}
            onChange={setMethod}
          />
          <Button
            testID="invoice-mark-paid"
            label={strings.invoices.markPaid}
            loading={busy === 'paid'}
            disabled={busy !== null}
            onPress={markPaid}
          />
        </View>
      ) : null}

      {can('voided') ? (
        confirmVoid ? (
          <View style={card}>
            <AppText>{strings.invoices.voidConfirm}</AppText>
            <TextField
              testID="invoice-void-reason"
              label={strings.invoices.voidReasonLabel}
              value={voidReason}
              onChangeText={setVoidReason}
              maxLength={500}
            />
            <Button
              testID="invoice-void-confirm"
              variant="danger"
              label={strings.invoices.voidYes}
              loading={busy === 'void'}
              disabled={busy !== null}
              onPress={() => void run('void', () => getInvoicesApi().void(invoice.id, voidReason))}
            />
            <Button
              variant="ghost"
              label={strings.invoices.keep}
              onPress={() => setConfirmVoid(false)}
            />
          </View>
        ) : (
          <Button
            testID="invoice-void"
            variant="ghost"
            label={strings.invoices.voidInvoice}
            onPress={() => setConfirmVoid(true)}
          />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
  sheet: { borderWidth: 1, borderRadius: radius.md, padding: space(1.5) },
  row: { flexDirection: 'row', gap: space(1) },
  grow: { flex: 1 },
});
