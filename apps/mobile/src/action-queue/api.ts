import type { AppSupabaseClient } from '../lib/supabase';
import type { ActionQueueRow } from './model';

type Result<T> = { data: T; error: null } | { data: null; error: { message: string } };

/** The business's action queue (RLS: only the caller's businesses). */
export async function fetchActionQueue(
  supabase: AppSupabaseClient,
  businessId: string,
): Promise<Result<ActionQueueRow[]>> {
  const { data, error } = await supabase.rpc('action_queue', { p_business_id: businessId });
  if (error) return { data: null, error };
  return { data: data as ActionQueueRow[], error: null };
}

/** Hides a failed push from the caller's queue. */
export async function dismissNotification(supabase: AppSupabaseClient, notificationId: string) {
  const { error } = await supabase.rpc('dismiss_notification', {
    p_notification_id: notificationId,
  });
  return { error };
}
