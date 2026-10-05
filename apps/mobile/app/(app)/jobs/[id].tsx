import {
  canJob,
  canScheduleJob,
  ScheduleJobSchema,
  slotsInFuture,
  type JobAction,
} from '@q2c/types';
import { errorMessage, format, radius, space, strings } from '@q2c/ui';
import { formatDateIL, formatMoney, formatSlotIL } from '@q2c/utils';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../src/components/LoadingView';
import { Screen } from '../../../src/components/Screen';
import { getInvoicesApi } from '../../../src/invoices/hooks';
import { getJobsApi, useJob } from '../../../src/jobs/hooks';
import { jobErrorKey, type JobListItem } from '../../../src/jobs/model';
import { defaultSlotChoice, SlotChoiceFields } from '../../../src/quotes/SlotPicker';
import { slotDayOptions, toSlot, type SlotChoice } from '../../../src/quotes/slots';
import { useThemeColors } from '../../../src/theme';

const actionLabels: Record<JobAction, string> = {
  start: strings.jobs.start,
  complete: strings.jobs.complete,
  cancel: strings.jobs.cancel,
};

/** One job: its visit ("קבע מועד"), start, complete, cancel, and then the invoice. */
export default function JobDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useJob(id);

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
        title={strings.jobs.notFound}
        actionLabel={strings.jobs.backToList}
        onAction={() => router.replace('/jobs')}
      />
    );
  return <Details job={state.data} offline={state.offline} reload={reload} />;
}

function Details({
  job,
  offline,
  reload,
}: {
  job: JobListItem;
  offline: boolean;
  reload: () => Promise<void>;
}) {
  const colors = useThemeColors();
  const days = useMemo(() => slotDayOptions(new Date()), []);
  const [choice, setChoice] = useState<SlotChoice | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState<JobAction | 'schedule' | 'invoice' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key while this screen is open: a retried tap returns the same invoice.
  const invoiceKey = useRef(randomUUID());

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  const schedule = async () => {
    if (!choice) return;
    const slot = toSlot(choice);
    const parsed = ScheduleJobSchema.safeParse(slot);
    if (!parsed.success) return setError(errorMessage(parsed.error.issues[0]?.message ?? ''));
    if (!slotsInFuture([slot], new Date())) return setError(errorMessage('visit_in_past'));
    setBusy('schedule');
    setError(null);
    const result = await getJobsApi().schedule(job.id, slot.startsAt, slot.endsAt);
    setBusy(null);
    if (result.error) return setError(errorMessage(jobErrorKey(result.error)));
    setChoice(null);
    await reload();
  };

  const move = async (action: JobAction) => {
    setBusy(action);
    setError(null);
    const result = await getJobsApi().transition(job.id, action);
    setBusy(null);
    setConfirmCancel(false);
    if (result.error) return setError(errorMessage(jobErrorKey(result.error)));
    await reload();
  };

  const invoice = async () => {
    setBusy('invoice');
    setError(null);
    const result = await getInvoicesApi().create(job.id, invoiceKey.current);
    setBusy(null);
    if (result.error)
      return setError(errorMessage(result.error.retryable ? 'network' : (result.error.code ?? '')));
    router.push({ pathname: '/invoices/[id]', params: { id: result.data.invoiceId } });
  };

  const disabled = busy !== null || offline;

  return (
    <Screen title={job.title} subtitle={job.customerName ?? undefined}>
      {offline ? <Banner tone="info" testID="job-offline" message={strings.jobs.offline} /> : null}

      <View style={card}>
        <AppText variant="heading" testID="job-status">
          {strings.jobStatus[job.status]}
        </AppText>
        {job.totalMinor !== null ? <AppText>{formatMoney(job.totalMinor)}</AppText> : null}
        {job.startedAt ? (
          <AppText variant="muted">
            {format(strings.jobs.startedOn, { date: formatDateIL(job.startedAt) })}
          </AppText>
        ) : null}
        {job.completedAt ? (
          <AppText variant="muted">
            {format(strings.jobs.completedOn, { date: formatDateIL(job.completedAt) })}
          </AppText>
        ) : null}
        {job.quoteId ? (
          <Button
            testID="job-open-quote"
            variant="ghost"
            label={strings.jobs.openQuote}
            onPress={() => router.push({ pathname: '/quotes/[id]', params: { id: job.quoteId! } })}
          />
        ) : null}
      </View>

      {error ? <Banner tone="error" testID="job-error" message={error} /> : null}

      <View style={card} testID="job-visit">
        <AppText variant="heading">{strings.jobs.visitTitle}</AppText>
        {job.visit ? (
          <AppText testID="job-visit-time">
            {formatSlotIL(job.visit.startsAt, job.visit.endsAt)}
          </AppText>
        ) : (
          <AppText variant="muted">{strings.jobs.noVisit}</AppText>
        )}
        {canScheduleJob(job.status) ? (
          choice ? (
            <>
              <AppText variant="heading">{strings.jobs.scheduleTitle}</AppText>
              <SlotChoiceFields days={days} value={choice} onChange={setChoice} />
              <AppText variant="muted">
                {formatSlotIL(toSlot(choice).startsAt, toSlot(choice).endsAt)}
              </AppText>
              <Button
                testID="job-schedule-save"
                label={strings.jobs.scheduleSave}
                loading={busy === 'schedule'}
                disabled={disabled}
                onPress={() => void schedule()}
              />
              <Button
                variant="ghost"
                label={strings.jobs.scheduleCancel}
                onPress={() => setChoice(null)}
              />
            </>
          ) : (
            <Button
              testID="job-schedule"
              label={strings.jobs.schedule}
              disabled={disabled}
              onPress={() => setChoice(defaultSlotChoice(days))}
            />
          )
        ) : null}
      </View>

      {job.status === 'completed' ? (
        job.invoice ? (
          <Button
            testID="job-open-invoice"
            size="large"
            label={strings.jobs.openInvoice}
            onPress={() =>
              router.push({ pathname: '/invoices/[id]', params: { id: job.invoice!.id } })
            }
          />
        ) : (
          <Button
            testID="job-create-invoice"
            size="large"
            label={strings.jobs.createInvoice}
            loading={busy === 'invoice'}
            disabled={disabled}
            onPress={() => void invoice()}
          />
        )
      ) : null}

      {(['start', 'complete'] as const)
        .filter((action) => canJob(action, job.status))
        .map((action) => (
          <Button
            key={action}
            testID={`job-${action}`}
            size="large"
            label={actionLabels[action]}
            loading={busy === action}
            disabled={disabled}
            onPress={() => void move(action)}
          />
        ))}

      {canJob('cancel', job.status) ? (
        confirmCancel ? (
          <View style={card}>
            <AppText>{strings.jobs.cancelConfirm}</AppText>
            <Button
              testID="job-cancel-confirm"
              variant="danger"
              label={strings.jobs.cancelYes}
              loading={busy === 'cancel'}
              disabled={disabled}
              onPress={() => void move('cancel')}
            />
            <Button
              variant="ghost"
              label={strings.jobs.keep}
              onPress={() => setConfirmCancel(false)}
            />
          </View>
        ) : (
          <Button
            testID="job-cancel"
            variant="ghost"
            label={actionLabels.cancel}
            disabled={disabled}
            onPress={() => setConfirmCancel(true)}
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
});
