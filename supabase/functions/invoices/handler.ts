import {
  canTransitionInvoice,
  CreateInvoiceRequestSchema,
  IssueInvoiceRequestSchema,
  MarkInvoicePaidRequestSchema,
  VoidInvoiceRequestSchema,
  type InvoiceActionResponse,
  type InvoiceDocument,
  type InvoiceProviderId,
  type InvoiceProviderRegistry,
  type InvoiceProviderResult,
  type InvoiceSnapshot,
  type InvoiceStatus,
} from '@q2c/types';
import { corsHeaders, json } from '../_shared/http.ts';
import { ManualInvoiceProvider } from './providers/manual.ts';

type DbError = { code?: string; message: string };
type DbResult<T> = Promise<{ data: T | null; error: DbError | null }>;

export interface TransitionArgs {
  p_user_id: string;
  p_invoice_id: string;
  p_status: InvoiceStatus;
  p_details: Record<string, string | null>;
}

export interface Deps {
  /** The user behind the bearer token, or null when it is invalid or expired. */
  getUserId(authorization: string): Promise<string | null>;
  /** Reads the invoice as that user (RLS), so other businesses' invoices are not found. */
  loadInvoice(authorization: string, invoiceId: string): DbResult<InvoiceDocument>;
  /** The create_invoice RPC, as service_role. */
  createInvoice(args: {
    p_user_id: string;
    p_job_id: string;
    p_idempotency_key: string;
  }): DbResult<{ invoice_id: string; already_created: boolean }>;
  /** The transition_invoice RPC, as service_role. */
  transitionInvoice(args: TransitionArgs): DbResult<{ status: InvoiceStatus; changed: boolean }>;
  providers: InvoiceProviderRegistry;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CREATE_PATH = /\/invoices\/?$/;
const INVOICE_PATH = new RegExp(`/invoices/(${UUID})(?:/(issue|sent|paid|void))?/?$`, 'i');

/** A refusal from the database, as the app's error key and HTTP status. */
function dbErrorResponse(scope: string, error: DbError | null): Response {
  switch (error?.code) {
    case '42501':
      return json(404, { error: scope === 'create' ? 'job_not_found' : 'invoice_not_found' });
    case '55000':
      return json(409, {
        error: scope === 'create' ? 'job_not_completed' : 'invoice_status_conflict',
      });
    case '23505':
      return json(409, {
        error: scope === 'create' ? 'job_already_invoiced' : 'document_number_taken',
      });
    case '22023':
      return json(422, { error: scope === 'create' ? 'job_has_no_quote' : 'validation_failed' });
    default:
      console.error(`invoices: ${scope} failed`, error);
      return json(500, { error: 'internal_error' });
  }
}

/** Database details for a provider's result. */
function details(result: InvoiceProviderResult): Record<string, string | null> {
  switch (result.status) {
    case 'issued':
      return {
        document_number: result.documentNumber ?? null,
        provider_document_id: result.providerDocumentId ?? null,
      };
    case 'failed':
      return { reason: result.failureReason ?? null };
    default:
      return {};
  }
}

/**
 * POST /invoices { jobId, idempotencyKey }        create from a COMPLETED job's quote snapshot
 * GET  /invoices/:id                              refresh the status from the provider
 * POST /invoices/:id/issue { documentNumber }     manual provider: the owner issued the document
 * POST /invoices/:id/sent                         the owner sent the document to the customer
 * POST /invoices/:id/paid { method, paidAt? }     the customer paid
 * POST /invoices/:id/void { reason? }             cancel (invoices are never deleted)
 *
 * Every endpoint answers InvoiceActionResponse and is safe to retry. The
 * provider is the one the invoice's business selected.
 */
export async function handleInvoices(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const path = new URL(req.url).pathname;
  const isCreate = CREATE_PATH.test(path);
  const match = INVOICE_PATH.exec(path);
  if (!isCreate && !match) return json(404, { error: 'not_found' });
  const action = isCreate ? 'create' : (match![2]?.toLowerCase() ?? 'status');
  if (req.method !== (action === 'status' ? 'GET' : 'POST')) {
    return json(405, { error: 'method_not_allowed' });
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'not_authenticated' });
  const userId = await deps.getUserId(authorization);
  if (!userId) return json(401, { error: 'not_authenticated' });

  let body: unknown = {};
  if (req.method === 'POST') {
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return json(400, { error: 'invalid_json' });
    }
  }

  const load = async (invoiceId: string) => {
    const loaded = await deps.loadInvoice(authorization, invoiceId);
    if (loaded.error) {
      console.error('invoices: load failed', loaded.error);
      return { response: json(500, { error: 'internal_error' }) };
    }
    if (!loaded.data) return { response: json(404, { error: 'invoice_not_found' }) };
    return { invoice: loaded.data };
  };

  const respond = (invoiceId: string, status: InvoiceStatus, alreadyDone: boolean) =>
    json(200, { invoiceId, status, alreadyDone } satisfies InvoiceActionResponse);

  /** Records a status (idempotent in the database) and answers with it. */
  const record = async (
    invoice: InvoiceDocument,
    status: InvoiceStatus,
    recordDetails: Record<string, string | null>,
    alreadyDone = false,
  ) => {
    const { data, error } = await deps.transitionInvoice({
      p_user_id: userId,
      p_invoice_id: invoice.id,
      p_status: status,
      p_details: recordDetails,
    });
    if (error || !data) return dbErrorResponse(action, error);
    return respond(invoice.id, data.status, alreadyDone || !data.changed);
  };

  /** Records what a provider reported, when it is a move the invoice can make. */
  const sync = async (
    invoice: InvoiceDocument,
    result: InvoiceProviderResult,
    alreadyDone: boolean,
  ) => {
    if (result.status === invoice.status || !canTransitionInvoice(invoice.status, result.status)) {
      return respond(invoice.id, invoice.status, alreadyDone);
    }
    return record(invoice, result.status, details(result), alreadyDone);
  };

  if (action === 'create') {
    const parsed = CreateInvoiceRequestSchema.safeParse(body);
    if (!parsed.success) return json(422, { error: 'validation_failed' });
    const created = await deps.createInvoice({
      p_user_id: userId,
      p_job_id: parsed.data.jobId,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (created.error || !created.data) return dbErrorResponse('create', created.error);
    const { invoice, response } = await load(created.data.invoice_id);
    if (!invoice) return response;
    // A retry hands the invoice to the provider again only while it has no
    // document (providers are idempotent per idempotency key).
    if (invoice.status !== 'not_issued' && invoice.status !== 'failed') {
      return respond(invoice.id, invoice.status, created.data.already_created);
    }
    let result: InvoiceProviderResult;
    try {
      result = await deps.providers.get(invoice.provider).createInvoice(invoice);
    } catch (e) {
      result = { status: 'failed', failureReason: e instanceof Error ? e.message : String(e) };
    }
    return sync(invoice, result, created.data.already_created);
  }

  const { invoice, response } = await load(match![1]!.toLowerCase());
  if (!invoice) return response;
  const provider = deps.providers.get(invoice.provider);

  switch (action) {
    case 'status': {
      try {
        return await sync(invoice, await provider.getStatus(invoice), false);
      } catch (e) {
        console.error('invoices: provider status failed', e);
        return json(502, { error: 'invoice_provider_failed' });
      }
    }
    case 'issue': {
      if (!(provider instanceof ManualInvoiceProvider)) {
        return json(409, { error: 'invoice_not_manual' });
      }
      const parsed = IssueInvoiceRequestSchema.safeParse(body);
      if (!parsed.success) return json(422, { error: 'document_number_required' });
      // A retry with the same number finds the invoice already issued with it.
      if (invoice.status !== 'not_issued' && invoice.status !== 'failed') {
        return invoice.documentNumber === parsed.data.documentNumber
          ? respond(invoice.id, invoice.status, true)
          : json(409, { error: 'invoice_status_conflict' });
      }
      return record(invoice, 'issued', details(provider.recordIssued(parsed.data.documentNumber)));
    }
    case 'sent':
      if (invoice.status === 'paid') return respond(invoice.id, invoice.status, true);
      return record(invoice, 'sent', {});
    case 'paid': {
      const parsed = MarkInvoicePaidRequestSchema.safeParse(body);
      if (!parsed.success) return json(422, { error: 'payment_method_required' });
      return record(invoice, 'paid', {
        method: parsed.data.method,
        paid_at: parsed.data.paidAt ?? null,
      });
    }
    case 'void': {
      const parsed = VoidInvoiceRequestSchema.safeParse(body);
      if (!parsed.success) return json(422, { error: 'void_reason_too_long' });
      if (invoice.status === 'voided') return respond(invoice.id, invoice.status, true);
      if (!canTransitionInvoice(invoice.status, 'voided')) {
        return json(409, { error: 'invoice_status_conflict' });
      }
      let result: InvoiceProviderResult;
      try {
        result = await provider.voidInvoice(invoice, parsed.data.reason);
      } catch (e) {
        console.error('invoices: provider void failed', e);
        return json(502, { error: 'invoice_provider_failed' });
      }
      if (result.status !== 'voided') return json(502, { error: 'invoice_provider_failed' });
      return record(invoice, 'voided', { reason: parsed.data.reason });
    }
    default:
      return json(404, { error: 'not_found' });
  }
}

/** The row read by INVOICE_SELECT. */
export interface InvoiceRow {
  id: string;
  business_id: string;
  invoice_number: number;
  idempotency_key: string | null;
  provider: string;
  status: InvoiceStatus;
  document_number: string | null;
  provider_document_id: string | null;
  snapshot: unknown;
}

export const INVOICE_SELECT = `id, business_id, invoice_number, idempotency_key, provider, status,
  document_number, provider_document_id, snapshot`;

export function toInvoiceDocument(row: InvoiceRow): InvoiceDocument {
  return {
    id: row.id,
    businessId: row.business_id,
    invoiceNumber: row.invoice_number,
    idempotencyKey: row.idempotency_key ?? row.id,
    provider: row.provider as InvoiceProviderId,
    status: row.status,
    documentNumber: row.document_number,
    providerDocumentId: row.provider_document_id,
    snapshot: row.snapshot as InvoiceSnapshot,
  };
}
