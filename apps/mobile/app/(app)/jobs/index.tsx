import { JOB_FILTERS, type JobFilter } from '@q2c/types';
import { errorMessage, format, MIN_TOUCH_TARGET, radius, space, strings } from '@q2c/ui';
import { formatMoney, formatSlotIL } from '@q2c/utils';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { ChoiceChips } from '../../../src/components/ChoiceChips';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../src/components/LoadingView';
import { Screen } from '../../../src/components/Screen';
import { useJobs } from '../../../src/jobs/hooks';
import { filterJobs, type JobListItem } from '../../../src/jobs/model';
import { useThemeColors } from '../../../src/theme';

const filterOptions = (Object.keys(JOB_FILTERS) as JobFilter[]).map((value) => ({
  value,
  label: strings.jobs.filters[value],
}));

/** Jobs by stage: to schedule, scheduled, in progress, done. */
export default function JobsList() {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const { state, reload } = useJobs(business.id);
  const [filter, setFilter] = useState<JobFilter>('to_schedule');

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

  const visible = filterJobs(state.data, filter);
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <Screen title={strings.jobs.title}>
      {state.offline ? (
        <Banner tone="info" testID="jobs-offline" message={strings.jobs.offline} />
      ) : null}
      {state.data.length === 0 ? (
        <View style={card} testID="jobs-empty">
          <AppText variant="heading">{strings.jobs.emptyTitle}</AppText>
          <AppText variant="muted">{strings.jobs.emptyBody}</AppText>
        </View>
      ) : (
        <>
          <ChoiceChips
            testID="jobs-filter"
            label={strings.jobs.filterLabel}
            options={filterOptions}
            value={filter}
            onChange={setFilter}
          />
          {visible.length === 0 ? (
            <AppText variant="muted" testID="jobs-no-results">
              {strings.jobs.noResults}
            </AppText>
          ) : (
            visible.map((job) => <JobRow key={job.id} job={job} />)
          )}
        </>
      )}
    </Screen>
  );
}

function JobRow({ job }: { job: JobListItem }) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID="job-row"
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/jobs/[id]', params: { id: job.id } })}
      style={[
        styles.card,
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.grow}>
        <AppText>{job.customerName ? `${job.title} · ${job.customerName}` : job.title}</AppText>
        <AppText variant="muted">
          {job.visit
            ? format(strings.jobs.visitAt, {
                when: formatSlotIL(job.visit.startsAt, job.visit.endsAt),
              })
            : strings.jobs.noVisit}
        </AppText>
      </View>
      <View style={styles.meta}>
        {job.totalMinor !== null ? <AppText>{formatMoney(job.totalMinor)}</AppText> : null}
        <AppText variant="muted" testID="job-row-status">
          {strings.jobStatus[job.status]}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
