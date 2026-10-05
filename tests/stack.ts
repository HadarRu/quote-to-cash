/**
 * The local Supabase stack the integration and E2E suites run against
 * (`pnpm supabase:start` + `supabase functions serve`, see tests/README.md).
 * Connection settings come from the environment, or from `supabase status`.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Database } from '@q2c/types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Client = SupabaseClient<Database>;

export const repoRoot = resolve(import.meta.dirname, '..');

interface StackEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

let cached: StackEnv | null = null;

export function stackEnv(): StackEnv {
  if (cached) return cached;
  let url = process.env.SUPABASE_URL;
  let anonKey = process.env.SUPABASE_ANON_KEY;
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const vars = Object.fromEntries(
      [...status.matchAll(/^([A-Z_]+)="(.*)"$/gm)].map((m) => [m[1]!, m[2]!]),
    );
    url ??= vars.API_URL;
    anonKey ??= vars.ANON_KEY;
    serviceRoleKey ??= vars.SERVICE_ROLE_KEY;
  }
  if (!url || !anonKey || !serviceRoleKey)
    throw new Error('Local Supabase is not running: start it with `pnpm supabase:start`.');
  cached = { url, anonKey, serviceRoleKey };
  return cached;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export function anonClient(): Client {
  const { url, anonKey } = stackEnv();
  return createClient<Database>(url, anonKey, noSession);
}

/** service_role: bypasses RLS. Only for arranging fixtures and checking results. */
export function adminClient(): Client {
  const { url, serviceRoleKey } = stackEnv();
  return createClient<Database>(url, serviceRoleKey, noSession);
}

/** Seeded users (supabase/seed.sql); they sign in with the test OTP in config.toml. */
export const users = {
  ownerA: { phone: '972500000001', id: '00000000-0000-4000-a000-000000000001' },
  employeeA: { phone: '972500000002', id: '00000000-0000-4000-a000-000000000002' },
  ownerB: { phone: '972500000003', id: '00000000-0000-4000-b000-000000000001' },
  employeeB: { phone: '972500000004', id: '00000000-0000-4000-b000-000000000002' },
} as const;

export const businesses = {
  a: '10000000-0000-4000-a000-000000000001',
  b: '10000000-0000-4000-b000-000000000001',
} as const;

export const TEST_OTP = '123456';

export interface SignedIn {
  client: Client;
  accessToken: string;
  userId: string;
}

/** Signs in with the phone's test OTP; the client then acts as that user (RLS applies). */
export async function signIn(phone: string): Promise<SignedIn> {
  const client = anonClient();
  const { data, error } = await client.auth.verifyOtp({ phone, token: TEST_OTP, type: 'sms' });
  if (error || !data.session) throw new Error(`sign-in failed for ${phone}: ${error?.message}`);
  return { client, accessToken: data.session.access_token, userId: data.session.user.id };
}

export function functionsUrl(path: string): string {
  return `${stackEnv().url}/functions/v1/${path}`;
}

/** Raw call to an Edge Function, so tests see exact statuses and bodies. */
export async function callFunction(
  path: string,
  init: {
    method?: string;
    accessToken?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> | null; headers: Headers }> {
  const headers: Record<string, string> = {
    apikey: stackEnv().anonKey,
    ...(init.accessToken ? { Authorization: `Bearer ${init.accessToken}` } : {}),
    ...(init.body !== undefined || init.rawBody !== undefined
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...init.headers,
  };
  const res = await fetch(functionsUrl(path), {
    method: init.method ?? (init.body !== undefined || init.rawBody !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

/**
 * A unique client address for one test, so the public page's per-IP rate
 * limits (keyed on X-Forwarded-For) don't leak between tests.
 */
export function freshIp(): string {
  const n = Math.floor(Math.random() * 2 ** 24);
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export interface QuoteFixture {
  quoteId: string;
  customerId: string;
  businessId: string;
}

/** A new customer of the signed-in user's business, created as that user (RLS). */
export async function createCustomer(
  as: SignedIn,
  businessId: string,
  fields: { fullName?: string; phone?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const { error } = await as.client.from('customer').insert({
    id,
    business_id: businessId,
    full_name: fields.fullName ?? 'לקוח בדיקה',
    phone_e164: fields.phone ?? `+97252${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
  });
  if (error) throw new Error(`create customer: ${error.message}`);
  return id;
}

/** A draft quote with one line (2 × ₪250 + 18% VAT = ₪590), saved as the user. */
export async function createDraft(
  as: SignedIn,
  businessId: string,
  fields: { customerId?: string; title?: string; notes?: string; description?: string } = {},
): Promise<QuoteFixture> {
  const customerId = fields.customerId ?? (await createCustomer(as, businessId));
  const quoteId = randomUUID();
  const { error } = await as.client.rpc('save_quote_draft', {
    p_quote: {
      id: quoteId,
      business_id: businessId,
      customer_id: customerId,
      title: fields.title ?? 'התקנת שקעים',
      notes: fields.notes ?? null,
      valid_until: null,
      discount_type: 'none',
      discount_value: 0,
      vat_rate_bp: 1800,
      subtotal_minor: 50000,
      discount_minor: 0,
      vat_minor: 9000,
      total_minor: 59000,
      items: [
        {
          id: randomUUID(),
          service_id: null,
          description: fields.description ?? 'התקנת שקע',
          quantity: '2',
          unit: 'point',
          unit_price_minor: 25000,
          line_total_minor: 50000,
          vat_included: false,
          sort_order: 0,
        },
      ],
    },
  });
  if (error) throw new Error(`save draft: ${error.message}`);
  return { quoteId, customerId, businessId };
}

export interface SentQuote extends QuoteFixture {
  token: string;
  url: string;
  quoteNumber: number;
}

/** Sends a draft through the `quotes` Edge Function and returns the customer link. */
export async function sendQuote(
  as: SignedIn,
  quote: QuoteFixture,
  extraBody: Record<string, unknown> = {},
): Promise<SentQuote> {
  const res = await callFunction(`quotes/${quote.quoteId}/send`, {
    accessToken: as.accessToken,
    body: { sendKey: randomUUID(), ...extraBody },
  });
  if (res.status !== 200 || !res.body)
    throw new Error(`send failed: ${res.status} ${JSON.stringify(res.body)}`);
  const url = res.body.url as string;
  return {
    ...quote,
    url,
    token: url.split('/quote/')[1]!,
    quoteNumber: res.body.quoteNumber as number,
  };
}

/** Creates and sends a quote of business A as its owner. */
export async function sentQuoteOfA(fields?: Parameters<typeof createDraft>[2]) {
  const owner = await signIn(users.ownerA.phone);
  return sendQuote(owner, await createDraft(owner, businesses.a, fields));
}

/** HTTP status a Storage call was refused with ('403', '413', '415', ...), or null. */
export function storageStatus(error: unknown): string | null {
  if (!error) return null;
  return String((error as { statusCode?: string | number }).statusCode ?? 'unknown');
}

/**
 * Proposes 2-hour visits at 07:00 UTC, `daysAhead` days after every visit
 * already booked for the business, so reruns on one database never offer a
 * time an earlier run has taken.
 */
export async function visitPlanner(businessId: string) {
  const { data, error } = await adminClient()
    .from('appointment')
    .select('ends_at')
    .eq('business_id', businessId)
    .order('ends_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const base = new Date(Math.max(Date.now(), Date.parse(data[0]?.ends_at ?? '1970-01-01')));
  base.setUTCHours(0, 0, 0, 0);
  return (daysAhead: number) => {
    const start = new Date(base);
    start.setUTCDate(start.getUTCDate() + daysAhead);
    start.setUTCHours(7);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return { startsAt: start.toISOString(), endsAt: end.toISOString() };
  };
}

/** The customer approves through their link (POST /public-quote/:token/approve). */
export async function approveOnLink(token: string, ip = freshIp()) {
  return callFunction(`public-quote/${token}/approve`, {
    body: { name: 'לקוח בדיקה' },
    headers: { 'X-Forwarded-For': ip },
  });
}

/** The live job of a quote, read as the member (RLS). */
export async function jobOfQuote(as: SignedIn, quoteId: string) {
  const { data, error } = await as.client
    .from('job')
    .select('id, status, started_at, completed_at')
    .eq('quote_id', quoteId)
    .is('deleted_at', null);
  if (error) throw error;
  return data;
}

/** POST to the `invoices` Edge Function as the member; throws unless it answers 200. */
async function invoiceCall(as: SignedIn, path: string, body: Record<string, unknown>) {
  const res = await callFunction(path, { accessToken: as.accessToken, body });
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body!;
}

/**
 * The whole flow for one business, through the same APIs the app and the
 * customer's page use: a quote with a photo, sent with proposed times; the
 * customer comments, approves and books a time; the job is started and
 * completed; its invoice is created, issued and paid. Leaves a row in every
 * business table (notifications and the audit log come from the database).
 */
export async function runFullFlow(as: SignedIn, businessId: string) {
  const draft = await createDraft(as, businessId);
  const photoPath = `${businessId}/quotes/${draft.quoteId}/${randomUUID()}.jpg`;
  const upload = await as.client.storage
    .from('quote-photos')
    .upload(photoPath, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg' });
  if (upload.error) throw new Error(`photo upload: ${upload.error.message}`);
  const file = await as.client.from('file').insert({
    business_id: businessId,
    kind: 'quote_attachment',
    bucket: 'quote-photos',
    storage_path: photoPath,
    mime_type: 'image/jpeg',
    size_bytes: 4,
    quote_id: draft.quoteId,
  });
  if (file.error) throw new Error(`photo row: ${file.error.message}`);

  const visit = await visitPlanner(businessId);
  const sent = await sendQuote(as, draft, { slots: [visit(30), visit(31)] });
  const ip = freshIp();
  const comment = await callFunction(`public-quote/${sent.token}/comment`, {
    body: { body: 'אפשר להגיע בבוקר?' },
    headers: { 'X-Forwarded-For': ip },
  });
  if (comment.status !== 200) throw new Error(`comment: ${comment.status}`);
  const approved = await approveOnLink(sent.token, ip);
  if (approved.status !== 200) throw new Error(`approve: ${approved.status}`);
  const slots = approved.body!.slots as { id: string }[];
  const booked = await callFunction(`public-quote/${sent.token}/schedule`, {
    body: { slotId: slots[0]!.id },
    headers: { 'X-Forwarded-For': ip },
  });
  if (booked.status !== 200)
    throw new Error(`schedule: ${booked.status} ${JSON.stringify(booked.body)}`);

  const [job] = await jobOfQuote(as, sent.quoteId);
  for (const action of ['start', 'complete'] as const) {
    const { error } = await as.client.rpc('transition_job', {
      p_job_id: job!.id,
      p_action: action,
    });
    if (error) throw new Error(`${action}: ${error.message}`);
  }
  const created = await invoiceCall(as, 'invoices', {
    jobId: job!.id,
    idempotencyKey: randomUUID(),
  });
  const invoiceId = created.invoiceId as string;
  await invoiceCall(as, `invoices/${invoiceId}/issue`, {
    documentNumber: String(Date.now()).slice(-9),
  });
  await invoiceCall(as, `invoices/${invoiceId}/paid`, { method: 'bit' });
  return { ...sent, jobId: job!.id, invoiceId };
}
