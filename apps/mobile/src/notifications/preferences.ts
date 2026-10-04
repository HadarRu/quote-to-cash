import { NotificationPreferenceSchema, type NotificationEvent } from '@q2c/types';
import type { AppSupabaseClient } from '../lib/supabase';
import { withDefaults } from './push';

/** The member's push preferences for the business (RLS: only their own rows). */
export async function fetchPreferences(
  supabase: AppSupabaseClient,
  businessId: string,
): Promise<
  | { data: Record<NotificationEvent, boolean>; error: null }
  | { data: null; error: { message: string } }
> {
  const { data, error } = await supabase
    .from('notification_preference')
    .select('event, push_enabled')
    .eq('business_id', businessId);
  if (error) return { data: null, error };
  return { data: withDefaults(data), error: null };
}

export async function savePreference(
  supabase: AppSupabaseClient,
  input: { businessId: string; userId: string; event: NotificationEvent; pushEnabled: boolean },
) {
  const parsed = NotificationPreferenceSchema.parse(input);
  const { error } = await supabase.from('notification_preference').upsert(
    {
      business_id: parsed.businessId,
      user_id: input.userId,
      event: parsed.event,
      push_enabled: parsed.pushEnabled,
    },
    { onConflict: 'business_id,user_id,event' },
  );
  return { error };
}
