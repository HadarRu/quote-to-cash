// Supabase Edge Function (Deno). Request handling lives in handler.ts (unit-tested).
import { createClient } from '@supabase/supabase-js';
import { handleBusinessSetup } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve((req) =>
  handleBusinessSetup(req, {
    async setupBusiness(authorization, args) {
      const client = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      });
      const { data, error } = await client.rpc('setup_business', args);
      return { data: data as string | null, error };
    },
  }),
);
