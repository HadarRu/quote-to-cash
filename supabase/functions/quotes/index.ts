// Supabase Edge Function (Deno). Request handling lives in handler.ts (unit-tested).
import { createClient } from '@supabase/supabase-js';
import { handleQuotes, QUOTE_SELECT, toQuoteForSend, type QuoteRow } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const options = { auth: { persistSession: false } };
const admin = createClient(supabaseUrl, serviceRoleKey, options);

Deno.serve((req) =>
  handleQuotes(req, {
    tokenPepper: Deno.env.get('TOKEN_PEPPER') ?? '',
    publicAppUrl: Deno.env.get('PUBLIC_APP_URL') ?? '',
    async getUserId(authorization) {
      const { data } = await admin.auth.getUser(authorization.slice('Bearer '.length));
      return data.user?.id ?? null;
    },
    async loadQuote(authorization, quoteId) {
      // As the user: RLS hides other businesses' quotes.
      const client = createClient(supabaseUrl, supabaseAnonKey, {
        ...options,
        global: { headers: { Authorization: authorization } },
      });
      const { data, error } = await client
        .from('quote')
        .select(QUOTE_SELECT)
        .eq('id', quoteId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return { data: null, error };
      return { data: data ? toQuoteForSend(data as unknown as QuoteRow) : null, error: null };
    },
    async sendQuote(args) {
      const { data, error } = await admin.rpc('send_quote', args).single();
      return { data: data as never, error };
    },
  }),
);
