import { errorMessage, format, radius, space, strings } from '@q2c/ui';
import { formatDateIL, formatMoney } from '@q2c/utils';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { dismissNotification, fetchActionQueue } from '../../src/action-queue/api';
import {
  groupQueue,
  queueAction,
  rowTitle,
  type ActionQueueRow,
} from '../../src/action-queue/model';
import { useCurrentBusiness } from '../../src/auth/AuthProvider';
import { useLogoUrl } from '../../src/business/useLogoUrl';
import { AppText } from '../../src/components/AppText';
import { Banner } from '../../src/components/Banner';
import { Button } from '../../src/components/Button';
import { getSupabase } from '../../src/lib/supabase';
import { useCachedQuery } from '../../src/lib/useCachedQuery';
import { usePushReceived } from '../../src/notifications/expo';
import { useThemeColors } from '../../src/theme';

/** Home = the action queue: what waits on the business, plus a big "new quote". */
export default function Home() {
  const colors = useThemeColors();
  const { business } = useCurrentBusiness();
  const logoUrl = useLogoUrl(business.logoPath);
  const fetcher = useCallback(() => fetchActionQueue(getSupabase(), business.id), [business.id]);
  const { state, reload } = useCachedQuery(`action-queue:${business.id}`, fetcher);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // A push means something moved: refresh the lists.
  const onPush = useCallback(() => void reload(), [reload]);
  usePushReceived(onPush);

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const act = async (row: ActionQueueRow) => {
    const action = queueAction(row, business.name);
    if (!action) return;
    setActionError(null);
    if (action.type === 'whatsapp') {
      await Linking.openURL(action.url).catch(() =>
        setActionError(strings.actionQueue.whatsappFailed),
      );
    } else if (action.type === 'quote') {
      router.push({ pathname: '/quotes/[id]', params: { id: action.quoteId } });
    } else {
      setBusyId(row.id);
      const { error } = await dismissNotification(getSupabase(), action.notificationId);
      setBusyId(null);
      if (error) setActionError(strings.errors.generic);
      else await reload();
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.header}>
          {logoUrl ? (
            <Image testID="home-logo" source={{ uri: logoUrl }} style={styles.logo} />
          ) : null}
          <View style={styles.headerText}>
            <AppText variant="title" accessibilityRole="header" testID="home-business-name">
              {business.name}
            </AppText>
            <AppText variant="muted">
              {format(strings.appHome.greeting, { name: business.name })}
            </AppText>
          </View>
        </View>

        <Button
          testID="home-new-quote"
          size="large"
          label={strings.appHome.newQuote}
          onPress={() => router.push('/quotes/new')}
        />

        {actionError ? <Banner tone="error" message={actionError} /> : null}

        {state.status === 'loading' ? (
          <ActivityIndicator
            testID="home-queue-loading"
            accessibilityLabel={strings.states.loading}
            color={colors.primary}
          />
        ) : state.status === 'error' ? (
          <View style={styles.section} testID="home-queue-error">
            <Banner tone="error" message={errorMessage(state.error)} />
            <Button
              variant="secondary"
              label={strings.states.retry}
              onPress={() => void reload()}
            />
          </View>
        ) : (
          <QueueLists
            rows={state.data}
            offline={state.offline}
            busyId={busyId}
            businessName={business.name}
            onAction={(row) => void act(row)}
          />
        )}

        <View style={styles.nav}>
          <Button
            testID="home-quotes"
            variant="secondary"
            label={strings.appHome.quotes}
            onPress={() => router.push('/quotes')}
          />
          <Button
            testID="home-customers"
            variant="secondary"
            label={strings.appHome.customers}
            onPress={() => router.push('/customers')}
          />
          <Button
            testID="home-price-list"
            variant="secondary"
            label={strings.appHome.priceList}
            onPress={() => router.push('/price-list')}
          />
          <Button
            testID="home-settings"
            variant="secondary"
            label={strings.appHome.settings}
            onPress={() => router.push('/settings')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QueueLists({
  rows,
  offline,
  busyId,
  businessName,
  onAction,
}: {
  rows: ActionQueueRow[];
  offline: boolean;
  busyId: string | null;
  businessName: string;
  onAction: (row: ActionQueueRow) => void;
}) {
  const colors = useThemeColors();
  const sections = groupQueue(rows);
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <View style={styles.section}>
      {offline ? (
        <Banner tone="info" testID="home-queue-offline" message={strings.actionQueue.offline} />
      ) : null}
      {sections.length === 0 ? (
        <View style={card} testID="home-queue-empty">
          <AppText variant="heading">{strings.actionQueue.emptyTitle}</AppText>
          <AppText variant="muted">{strings.actionQueue.emptyBody}</AppText>
        </View>
      ) : (
        <>
          <AppText variant="heading" accessibilityRole="header">
            {strings.actionQueue.title}
          </AppText>
          {sections.map((section) => (
            <View key={section.kind} style={card} testID={`home-queue-${section.kind}`}>
              <AppText variant="heading">
                {`${strings.actionQueue.sections[section.kind]} (${section.rows.length})`}
              </AppText>
              {section.rows.map((row) => (
                <View
                  key={row.id}
                  style={[styles.row, { borderTopColor: colors.border }]}
                  testID={`home-queue-row-${row.id}`}
                >
                  <AppText>{rowTitle(row)}</AppText>
                  <RowDetails row={row} />
                  {queueAction(row, businessName) ? (
                    <Button
                      testID={`home-queue-action-${row.id}`}
                      variant={section.kind === 'push_failed' ? 'ghost' : 'secondary'}
                      label={strings.actionQueue.actions[section.kind]}
                      loading={busyId === row.id}
                      onPress={() => onAction(row)}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function RowDetails({ row }: { row: ActionQueueRow }) {
  const parts = [
    row.amount_minor !== null
      ? row.kind === 'invoice_unpaid'
        ? format(strings.actionQueue.amountDue, { amount: formatMoney(row.amount_minor) })
        : formatMoney(row.amount_minor)
      : null,
    row.since ? format(strings.actionQueue.since, { date: formatDateIL(row.since) }) : null,
  ].filter(Boolean);
  return parts.length ? <AppText variant="muted">{parts.join(' · ')}</AppText> : null;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: space(2), gap: space(3), width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  headerText: { flex: 1, gap: space(0.5) },
  logo: { width: 56, height: 56, borderRadius: radius.md },
  section: { gap: space(2) },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space(1), gap: space(1) },
  nav: { gap: space(1) },
});
