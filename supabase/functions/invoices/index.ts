// Supabase Edge Function (Deno). Request handling lives in handler.ts (unit-tested).
import { createClient } from '@supabase/supabase-js';
import { handleInvoices, INVOICE_SELECT, toInvoiceDocument, type InvoiceRow } from './handler.ts';
import { invoiceProviders } from './providers/registry.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const options = { auth: { persistSession: false } };
const admin = createClient(supabaseUrl, serviceRoleKey, options);
const providers = invoiceProviders();

Deno.serve((req) =>
  handleInvoices(req, {
    providers,
    async getUserId(authorization) {
      const { data } = await admin.auth.getUser(authorization.slice('Bearer '.length));
      return data.user?.id ?? null;
    },
    async loadInvoice(authorization, invoiceId) {
      // As the user: RLS hides other businesses' invoices.
      const client = createClient(supabaseUrl, supabaseAnonKey, {
        ...options,
        global: { headers: { Authorization: authorization } },
      });
      const { data, error } = await client
        .from('invoice')
        .select(INVOICE_SELECT)
        .eq('id', invoiceId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return { data: null, error };
      return { data: data ? toInvoiceDocument(data as unknown as InvoiceRow) : null, error: null };
    },
    async createInvoice(args) {
      const { data, error } = await admin.rpc('create_invoice', args).single();
      return { data: data as never, error };
    },
    async transitionInvoice(args) {
      const { data, error } = await admin.rpc('transition_invoice', args).single();
      return { data: data as never, error };
    },
  }),
);
