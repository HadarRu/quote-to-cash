import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { cache } from '../lib/cache';
import { getSupabase } from '../lib/supabase';
import {
  pushTarget,
  registerForPush,
  type DevicesApi,
  type PermissionState,
  type PushDevice,
} from './push';

const TOKEN_CACHE_KEY = 'push-token';

const permissionState = (p: Notifications.NotificationPermissionsStatus): PermissionState =>
  p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';

/** This phone, through expo-notifications. */
export const expoPushDevice: PushDevice = {
  platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
  canReceivePush: Platform.OS === 'ios' || Platform.OS === 'android',
  getPermission: async () => permissionState(await Notifications.getPermissionsAsync()),
  requestPermission: async () => permissionState(await Notifications.requestPermissionsAsync()),
  async getToken() {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(
      typeof projectId === 'string' && projectId ? { projectId } : undefined,
    );
    return data;
  },
};

const devicesApi: DevicesApi = {
  async register(input) {
    const { error } = await getSupabase().functions.invoke('devices', { body: input });
    return { error };
  },
};

/** Registers this phone for the business's pushes. Remembers the token for sign-out. */
export async function registerThisDevice(businessId: string) {
  const result = await registerForPush(businessId, expoPushDevice, devicesApi);
  if (result.token) await cache.set(TOKEN_CACHE_KEY, result.token);
  return result.status;
}

/** Stops pushes to this phone (before signing out). Best-effort. */
export async function unregisterThisDevice(): Promise<void> {
  const token = await cache.get<string>(TOKEN_CACHE_KEY);
  if (!token) return;
  await getSupabase()
    .functions.invoke('devices', { method: 'DELETE', body: { token } })
    .catch(() => undefined);
}

// Show pushes that arrive while the app is open, too.
if (expoPushDevice.canReceivePush) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Signed-in app wiring: registers the phone and opens the screen a tapped push
 * points at (also when the tap launched the app).
 */
export function usePushNotifications(businessId: string) {
  useEffect(() => {
    if (!expoPushDevice.canReceivePush) return;
    void registerThisDevice(businessId);
    const open = (response: Notifications.NotificationResponse | null) => {
      const target = pushTarget(response?.notification.request.content.data);
      if (!target) return;
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      router.push(target as never);
    };
    void Notifications.getLastNotificationResponseAsync().then(open, () => undefined);
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    return () => tapped.remove();
  }, [businessId]);
}

/** Calls `onReceived` when a push arrives while the app is open. */
export function usePushReceived(onReceived: () => void) {
  useEffect(() => {
    if (!expoPushDevice.canReceivePush) return;
    const received = Notifications.addNotificationReceivedListener(() => onReceived());
    return () => received.remove();
  }, [onReceived]);
}
