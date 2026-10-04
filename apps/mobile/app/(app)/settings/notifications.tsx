import { NOTIFICATION_GROUPS, type NotificationEvent } from '@q2c/types';
import { errorMessage, radius, space, strings } from '@q2c/ui';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../../../src/auth/AuthProvider';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { LoadingView } from '../../../src/components/LoadingView';
import { Screen } from '../../../src/components/Screen';
import { Toggle } from '../../../src/components/Toggle';
import { useCachedQuery } from '../../../src/lib/useCachedQuery';
import { getSupabase } from '../../../src/lib/supabase';
import { expoPushDevice } from '../../../src/notifications/expo';
import { fetchPreferences, savePreference } from '../../../src/notifications/preferences';
import { useThemeColors } from '../../../src/theme';

const groups = Object.entries(NOTIFICATION_GROUPS) as [
  keyof typeof NOTIFICATION_GROUPS,
  readonly NotificationEvent[],
][];

/** Which pushes this member gets for the business. */
export default function NotificationSettings() {
  const colors = useThemeColors();
  const { business, session } = useCurrentBusiness();
  const fetcher = useCallback(() => fetchPreferences(getSupabase(), business.id), [business.id]);
  const { state, reload } = useCachedQuery(`notification-prefs:${business.id}`, fetcher);
  // Toggles saved (or being saved) since the last load, shown over the loaded values.
  const [overrides, setOverrides] = useState<Partial<Record<NotificationEvent, boolean>>>({});
  const [saveError, setSaveError] = useState(false);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined' | null>(null);

  useEffect(() => {
    if (!expoPushDevice.canReceivePush) return;
    void expoPushDevice.getPermission().then(setPermission, () => setPermission(null));
  }, []);

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

  const prefs = { ...state.data, ...overrides };
  const toggle = async (event: NotificationEvent, pushEnabled: boolean) => {
    setOverrides((current) => ({ ...current, [event]: pushEnabled }));
    setSaveError(false);
    try {
      const { error } = await savePreference(getSupabase(), {
        businessId: business.id,
        userId: session.user.id,
        event,
        pushEnabled,
      });
      if (error) throw error;
    } catch {
      setOverrides((current) => ({ ...current, [event]: !pushEnabled }));
      setSaveError(true);
    }
  };

  return (
    <Screen title={strings.notifications.title} subtitle={strings.notifications.subtitle}>
      {!expoPushDevice.canReceivePush ? (
        <Banner
          tone="info"
          testID="notifications-unsupported"
          message={strings.notifications.unsupported}
        />
      ) : permission === 'denied' ? (
        <Banner
          tone="info"
          testID="notifications-denied"
          message={strings.notifications.permissionDenied}
        />
      ) : null}
      {state.offline ? <Banner tone="info" message={strings.actionQueue.offline} /> : null}
      {saveError ? (
        <Banner
          tone="error"
          testID="notifications-save-error"
          message={strings.notifications.saveFailed}
        />
      ) : null}
      {groups.map(([group, events]) => (
        <View
          key={group}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <AppText variant="heading">{strings.notifications.groups[group]}</AppText>
          {events.map((event) => (
            <Toggle
              key={event}
              testID={`notifications-${event}`}
              label={strings.notifications.events[event]}
              value={prefs[event]}
              onChange={(value) => void toggle(event, value)}
            />
          ))}
        </View>
      ))}
      <Button variant="ghost" label={strings.settings.back} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(0.5),
  },
});
