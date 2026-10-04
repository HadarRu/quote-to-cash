// Supabase Edge Function (Deno). Request handling lives in handler.ts (unit-tested).
import { createClient } from '@supabase/supabase-js';
import { handleDevices } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

/** A client acting as the caller, so RLS and auth.uid() apply. */
const asUser = (authorization: string) =>
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });

Deno.serve((req) =>
  handleDevices(req, {
    async register(authorization, input) {
      const { data, error } = await asUser(authorization).rpc('register_device', {
        p_business_id: input.businessId,
        p_token: input.token,
        p_platform: input.platform,
      });
      return { data: data as string | null, error };
    },
    async unregister(authorization, token) {
      const { error } = await asUser(authorization).rpc('unregister_device', { p_token: token });
      return { error };
    },
  }),
);
