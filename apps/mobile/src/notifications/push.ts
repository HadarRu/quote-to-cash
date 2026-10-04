import {
  NOTIFICATION_EVENTS,
  RegisterDeviceRequestSchema,
  type DevicePlatform,
  type NotificationEvent,
} from '@q2c/types';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/** Device side of push registration (expo-notifications in the app, fakes in tests). */
export interface PushDevice {
  platform: DevicePlatform;
  /** False on web and simulators: no push token can be issued. */
  canReceivePush: boolean;
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  getToken(): Promise<string>;
}

/** The `devices` Edge Function. */
export interface DevicesApi {
  register(input: {
    businessId: string;
    token: string;
    platform: DevicePlatform;
  }): Promise<{ error: { message: string } | null }>;
}

export type PushStatus = 'registered' | 'denied' | 'unsupported' | 'failed';

/**
 * Asks for permission (once), gets this phone's Expo push token and registers
 * it for the business. Never throws: push is optional, the app works without it.
 */
export async function registerForPush(
  businessId: string,
  device: PushDevice,
  api: DevicesApi,
): Promise<{ status: PushStatus; token: string | null }> {
  if (!device.canReceivePush) return { status: 'unsupported', token: null };
  try {
    let permission = await device.getPermission();
    if (permission === 'undetermined') permission = await device.requestPermission();
    if (permission !== 'granted') return { status: 'denied', token: null };

    const token = await device.getToken();
    const input = RegisterDeviceRequestSchema.safeParse({
      businessId,
      token,
      platform: device.platform,
    });
    if (!input.success) return { status: 'failed', token: null };
    const { error } = await api.register(input.data);
    return error ? { status: 'failed', token: null } : { status: 'registered', token };
  } catch {
    return { status: 'failed', token: null };
  }
}

/** Preferences as stored: one row per event the member changed (no row = on). */
export function withDefaults(
  rows: { event: NotificationEvent; push_enabled: boolean }[],
): Record<NotificationEvent, boolean> {
  const prefs = Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, true])) as Record<
    NotificationEvent,
    boolean
  >;
  for (const row of rows) prefs[row.event] = row.push_enabled;
  return prefs;
}

/** The screen a tapped push opens: only in-app paths, never external URLs. */
export function pushTarget(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(url) ? url : null;
}
