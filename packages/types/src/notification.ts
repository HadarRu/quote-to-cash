import { z } from 'zod';
import type { Database } from './database.types.ts';

export type NotificationEvent = Database['public']['Enums']['notification_event'];
export type DevicePlatform = Database['public']['Enums']['device_platform'];

/** Push events, in the order the preferences screen lists them. */
export const NOTIFICATION_EVENTS = [
  'quote_viewed',
  'quote_approved',
  'quote_rejected',
  'appointment_created',
  'appointment_changed',
  'appointment_reminder',
  'invoice_issued',
  'payment_received',
] as const satisfies readonly NotificationEvent[];

/** Preference groups on the settings screen. */
export const NOTIFICATION_GROUPS = {
  quotes: ['quote_viewed', 'quote_approved', 'quote_rejected'],
  appointments: ['appointment_created', 'appointment_changed', 'appointment_reminder'],
  billing: ['invoice_issued', 'payment_received'],
} as const satisfies Record<string, readonly NotificationEvent[]>;

/** Expo push token as returned by expo-notifications. */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;

export const RegisterDeviceRequestSchema = z.object({
  businessId: z.uuid('business_id_invalid'),
  token: z.string().regex(EXPO_PUSH_TOKEN_PATTERN, 'push_token_invalid'),
  platform: z.enum(['ios', 'android', 'web'], 'push_token_invalid'),
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;

export const UnregisterDeviceRequestSchema = z.object({
  token: z.string().regex(EXPO_PUSH_TOKEN_PATTERN, 'push_token_invalid'),
});

export const NotificationPreferenceSchema = z.object({
  businessId: z.uuid('business_id_invalid'),
  event: z.enum(NOTIFICATION_EVENTS),
  pushEnabled: z.boolean(),
});
export type NotificationPreferenceInput = z.infer<typeof NotificationPreferenceSchema>;

/** What a push carries, written by the database triggers (see 20261005100000_notifications.sql). */
export interface NotificationPayload {
  quote_id?: string | null;
  quote_number?: number | null;
  appointment_id?: string;
  job_id?: string | null;
  invoice_id?: string;
  invoice_number?: number | null;
  payment_id?: string;
  customer_name?: string | null;
  total_minor?: number;
  amount_minor?: number;
  starts_at?: string;
  ends_at?: string;
  status?: string;
  reason?: string | null;
  deleted?: boolean;
}

/** Lists of the home screen's action queue, in display order. */
export const ACTION_QUEUE_KINDS = [
  'quote_unanswered',
  'approved_unscheduled',
  'completed_uninvoiced',
  'invoice_unpaid',
  'push_failed',
] as const;
export type ActionQueueKind = (typeof ACTION_QUEUE_KINDS)[number];

/** Product analytics events sent to PostHog. */
export const ANALYTICS_EVENTS = [
  'app_opened',
  'quote_created',
  'quote_sent',
  'quote_viewed',
  'quote_approved',
  'quote_rejected',
  'appointment_created',
  'job_completed',
  'invoice_created',
  'invoice_sent',
  'payment_received',
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
