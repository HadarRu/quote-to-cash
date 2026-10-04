// Supabase Edge Function (Deno). Request handling lives in handler.ts (unit-tested).
// Called by the database, not by users (verify_jwt = false in config.toml); the
// x-notify-secret header authenticates the caller.
import { createClient } from '@supabase/supabase-js';
import { captureBatch } from '@q2c/utils';
import { sendExpoPush } from '../_shared/expo-push.ts';
import { handleNotify, type AnalyticsRow, type PushJob } from './handler.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);
const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || undefined;
const posthogKey = Deno.env.get('POSTHOG_KEY') ?? '';
const posthogHost = Deno.env.get('POSTHOG_HOST') ?? '';

Deno.serve((req) =>
  handleNotify(req, {
    notifySecret: Deno.env.get('NOTIFY_SECRET') ?? '',
    async enqueueReminders(now) {
      const { data, error } = await admin.rpc('enqueue_appointment_reminders', {
        p_now: now.toISOString(),
      });
      return { data: data as number | null, error };
    },
    async claimPushes(limit) {
      const { data, error } = await admin.rpc('claim_push_notifications', { p_limit: limit });
      return { data: data as unknown as PushJob[] | null, error };
    },
    async completePushes(results) {
      const { error } = await admin.rpc('complete_push_notifications', {
        p_results: results as never,
      });
      return { error };
    },
    sendPush: (messages) => sendExpoPush(messages, { accessToken: expoAccessToken }),
    async claimAnalytics(limit) {
      const { data, error } = await admin.rpc('claim_analytics_events', { p_limit: limit });
      return { data: data as unknown as AnalyticsRow[] | null, error };
    },
    async markAnalyticsSent(ids) {
      const { error } = await admin.rpc('mark_analytics_sent', { p_ids: ids });
      return { error };
    },
    capture: posthogKey
      ? (events) => captureBatch(events, { apiKey: posthogKey, host: posthogHost })
      : null,
  }),
);
