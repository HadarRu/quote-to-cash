import {
  canTransitionInvoice,
  InvoiceProviderRegistry,
  type InvoiceDocument,
  type InvoiceProvider,
  type InvoiceSnapshot,
  type InvoiceStatus,
} from '@q2c/types';
import { describe, expect, it, vi } from 'vitest';
import { handleInvoices, toInvoiceDocument, type Deps, type TransitionArgs } from './handler.ts';
import { ManualInvoiceProvider } from './providers/manual.ts';
import { invoiceProviders } from './providers/registry.ts';

const USER_ID = '00000000-0000-4000-a000-000000000001';
const JOB_ID = '81000000-0000-4000-a000-000000000001';
const SCHEDULED_JOB_ID = '81000000-0000-4000-a000-000000000002';
const KEY = '82000000-0000-4000-a000-000000000001';
const OTHER_KEY = '82000000-0000-4000-a000-000000000002';

const snapshot: InvoiceSnapshot = {
  quote_number: 7,
  business: {
    name: 'כהן חשמל',
    tax_status: 'osek_murshe',
    tax_id: '123456789',
    phone: '+972500000001',
    email: null,
    logo_path: null,
  },
  customer: { full_name: 'משה ישראלי', phone: '+972541112222', address: 'הרצל 5, חיפה' },
  items: [
    {
      description: 'גוף תאורה',
      quantity: '2',
      unit: 'unit',
      unit_price_minor: 20000,
      vat_included: false,
      line_total_minor: 40000,
    },
  ],
  discount_type: 'none',
  discount_value: 0,
  totals: {
    subtotal_minor: 40000,
    discount_minor: 0,
    vat_rate_bp: 1800,
    vat_minor: 7200,
    total_minor: 47200,
  },
  job: { title: 'תאורה בחצר', completed_at: '2026-10-04T10:00:00Z' },
};

/** A fake database with the rules of create_invoice and transition_invoice. */
function fakeDatabase() {
  const invoices = new Map<string, InvoiceDocument>();
  const jobs: Record<string, string> = { [JOB_ID]: 'completed', [SCHEDULED_JOB_ID]: 'scheduled' };
  const jobOf = new Map<string, string>();
  const payments: { invoiceId: string; method: string }[] = [];
  let number = 1;

  const createInvoice = vi.fn<Deps['createInvoice']>(async (args) => {
    const existing = [...invoices.values()].find(
      (i) => i.idempotencyKey === args.p_idempotency_key,
    );
    if (existing) {
      if (jobOf.get(existing.id) !== args.p_job_id)
        return { data: null, error: { code: '42501', message: 'key reused' } };
      return { data: { invoice_id: existing.id, already_created: true }, error: null };
    }
    const status = jobs[args.p_job_id];
    if (!status) return { data: null, error: { code: '42501', message: 'job not found' } };
    if (status !== 'completed')
      return { data: null, error: { code: '55000', message: 'only completed jobs' } };
    if (
      [...invoices.values()].some((i) => jobOf.get(i.id) === args.p_job_id && i.status !== 'voided')
    )
      return { data: null, error: { code: '23505', message: 'already invoiced' } };
    const id = `90000000-0000-4000-a000-00000000000${number}`;
    invoices.set(id, {
      id,
      businessId: 'b',
      invoiceNumber: number++,
      idempotencyKey: args.p_idempotency_key,
      provider: 'manual',
      status: 'not_issued',
      documentNumber: null,
      providerDocumentId: null,
      snapshot,
    });
    jobOf.set(id, args.p_job_id);
    return { data: { invoice_id: id, already_created: false }, error: null };
  });

  const transitionInvoice = vi.fn<Deps['transitionInvoice']>(async (args: TransitionArgs) => {
    const invoice = invoices.get(args.p_invoice_id);
    if (!invoice) return { data: null, error: { code: '42501', message: 'not found' } };
    if (invoice.status === args.p_status)
      return { data: { status: invoice.status, changed: false }, error: null };
    if (!canTransitionInvoice(invoice.status, args.p_status))
      return { data: null, error: { code: '55000', message: 'bad transition' } };
    if (args.p_status === 'issued') {
      if (!args.p_details.document_number)
        return { data: null, error: { code: '22023', message: 'number required' } };
      if ([...invoices.values()].some((i) => i.documentNumber === args.p_details.document_number))
        return { data: null, error: { code: '23505', message: 'number taken' } };
      invoice.documentNumber = args.p_details.document_number;
    }
    if (args.p_status === 'paid')
      payments.push({ invoiceId: invoice.id, method: args.p_details.method! });
    invoice.status = args.p_status;
    return { data: { status: invoice.status, changed: true }, error: null };
  });

  return { invoices, payments, createInvoice, transitionInvoice };
}

function setup(overrides: Partial<Deps> = {}) {
  const db = fakeDatabase();
  const d: Deps = {
    getUserId: vi.fn(async () => USER_ID),
    loadInvoice: vi.fn(async (_auth, id) => {
      const invoice = db.invoices.get(id);
      return { data: invoice ? { ...invoice } : null, error: null };
    }),
    createInvoice: db.createInvoice,
    transitionInvoice: db.transitionInvoice,
    providers: invoiceProviders(),
    ...overrides,
  };
  return { d, db };
}

async function call(d: Deps, path: string, body?: unknown, method = 'POST') {
  const headers = new Headers({ 'Content-Type': 'application/json', Authorization: 'Bearer jwt' });
  const res = await handleInvoices(
    new Request(`http://localhost/invoices${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    d,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const create = (d: Deps, jobId = JOB_ID, idempotencyKey = KEY) =>
  call(d, '', { jobId, idempotencyKey });

describe('invoices handler: create', () => {
  it('creates a NOT_ISSUED invoice for a completed job (manual provider)', async () => {
    const { d, db } = setup();
    const { status, body } = await create(d);
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'not_issued', alreadyDone: false });
    expect(db.createInvoice).toHaveBeenCalledWith({
      p_user_id: USER_ID,
      p_job_id: JOB_ID,
      p_idempotency_key: KEY,
    });
    expect(db.transitionInvoice).not.toHaveBeenCalled();
  });

  it('only allows COMPLETED jobs', async () => {
    const { d } = setup();
    expect(await create(d, SCHEDULED_JOB_ID)).toEqual({
      status: 409,
      body: { error: 'job_not_completed' },
    });
  });

  it('is idempotent per key, and refuses a second invoice for the job', async () => {
    const { d, db } = setup();
    const first = await create(d);
    const retry = await create(d);
    expect(retry.body).toEqual({ ...first.body, alreadyDone: true });
    expect(db.invoices.size).toBe(1);
    expect(await create(d, JOB_ID, OTHER_KEY)).toEqual({
      status: 409,
      body: { error: 'job_already_invoiced' },
    });
  });

  it('records what a real provider returns, and marks the invoice FAILED when it throws', async () => {
    const issuing: InvoiceProvider = {
      id: 'manual',
      createInvoice: vi.fn(async (invoice: InvoiceDocument) => ({
        status: 'issued' as InvoiceStatus,
        documentNumber: `R-${invoice.invoiceNumber}`,
        providerDocumentId: 'ext-1',
      })),
      getStatus: vi.fn(),
      voidInvoice: vi.fn(),
    };
    const { d, db } = setup({ providers: new InvoiceProviderRegistry([issuing]) });
    expect((await create(d)).body).toMatchObject({ status: 'issued' });
    expect(db.transitionInvoice.mock.calls[0]![0]).toMatchObject({
      p_status: 'issued',
      p_details: { document_number: 'R-1', provider_document_id: 'ext-1' },
    });
    expect(issuing.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: KEY }),
    );

    const failing: InvoiceProvider = {
      ...issuing,
      createInvoice: vi.fn(async () => {
        throw new Error('provider down');
      }),
    };
    const other = setup({ providers: new InvoiceProviderRegistry([failing]) });
    expect((await create(other.d)).body).toMatchObject({ status: 'failed' });
    expect(other.db.transitionInvoice.mock.calls[0]![0]).toMatchObject({
      p_status: 'failed',
      p_details: { reason: 'provider down' },
    });
  });

  it('validates the request and the caller', async () => {
    const { d } = setup();
    expect((await call(d, '', { jobId: 'x', idempotencyKey: KEY })).status).toBe(422);
    const anonymous = setup({ getUserId: vi.fn(async () => null) });
    expect((await create(anonymous.d)).status).toBe(401);
    expect((await call(d, '', undefined, 'GET')).status).toBe(405);
  });
});

describe('invoices handler: issue, send, pay, void', () => {
  async function created() {
    const s = setup();
    const { body } = await create(s.d);
    return { ...s, id: body.invoiceId as string };
  }

  it('walks the manual flow: record the document number, sent, paid', async () => {
    const { d, db, id } = await created();
    expect((await call(d, `/${id}/issue`, { documentNumber: ' 30045 ' })).body).toEqual({
      invoiceId: id,
      status: 'issued',
      alreadyDone: false,
    });
    expect(db.invoices.get(id)!.documentNumber).toBe('30045');
    expect((await call(d, `/${id}/issue`, { documentNumber: '30045' })).body).toMatchObject({
      status: 'issued',
      alreadyDone: true,
    });
    expect((await call(d, `/${id}/issue`, { documentNumber: '999' })).status).toBe(409);
    expect((await call(d, `/${id}/sent`)).body).toMatchObject({ status: 'sent' });
    expect((await call(d, `/${id}/paid`, { method: 'bit' })).body).toMatchObject({
      status: 'paid',
    });
    expect((await call(d, `/${id}/paid`, { method: 'bit' })).body).toMatchObject({
      status: 'paid',
      alreadyDone: true,
    });
    expect(db.payments).toEqual([{ invoiceId: id, method: 'bit' }]);
  });

  it('refuses moves the status does not allow', async () => {
    const { d, id } = await created();
    expect(await call(d, `/${id}/paid`, { method: 'cash' })).toEqual({
      status: 409,
      body: { error: 'invoice_status_conflict' },
    });
    expect((await call(d, `/${id}/issue`, { documentNumber: '' })).body).toEqual({
      error: 'document_number_required',
    });
    expect((await call(d, `/${id}/paid`, { method: 'gold' })).body).toEqual({
      error: 'payment_method_required',
    });
  });

  it('voids instead of deleting; a paid invoice cannot be voided', async () => {
    const { d, id } = await created();
    expect((await call(d, `/${id}/void`, { reason: 'בטעות' })).body).toMatchObject({
      status: 'voided',
      alreadyDone: false,
    });
    expect((await call(d, `/${id}/void`, {})).body).toMatchObject({ alreadyDone: true });
    expect((await call(d, `/${id}/issue`, { documentNumber: '1' })).status).toBe(409);
    // The job can be invoiced again.
    expect((await create(d, JOB_ID, OTHER_KEY)).status).toBe(200);

    const paid = await created();
    await call(paid.d, `/${paid.id}/issue`, { documentNumber: '1' });
    await call(paid.d, `/${paid.id}/paid`, { method: 'cash' });
    expect(await call(paid.d, `/${paid.id}/void`, {})).toEqual({
      status: 409,
      body: { error: 'invoice_status_conflict' },
    });
    expect((await call(paid.d, `/${paid.id}`, undefined, 'DELETE')).status).toBe(405);
  });

  it('reports a document number that is already used', async () => {
    const { d, id } = await created();
    await call(d, `/${id}/issue`, { documentNumber: '1' });
    await call(d, `/${id}/void`, {});
    const second = (await create(d, JOB_ID, OTHER_KEY)).body.invoiceId as string;
    expect((await call(d, `/${second}/issue`, { documentNumber: '1' })).body).toEqual({
      error: 'document_number_taken',
    });
  });

  it('refreshes the status from the provider', async () => {
    const { d, id } = await created();
    expect((await call(d, `/${id}`, undefined, 'GET')).body).toEqual({
      invoiceId: id,
      status: 'not_issued',
      alreadyDone: false,
    });
  });

  it('answers 404 for an invoice the user cannot see', async () => {
    const { d } = setup();
    expect((await call(d, '/90000000-0000-4000-a000-000000000009/sent')).status).toBe(404);
  });
});

describe('ManualInvoiceProvider', () => {
  const provider = new ManualInvoiceProvider();
  const invoice = toInvoiceDocument({
    id: 'i',
    business_id: 'b',
    invoice_number: 3,
    idempotency_key: null,
    provider: 'manual',
    status: 'not_issued',
    document_number: null,
    provider_document_id: null,
    snapshot,
  });

  it('creates nothing remotely and leaves the owner to issue the document', async () => {
    expect(await provider.createInvoice(invoice)).toEqual({ status: 'not_issued' });
    expect(provider.recordIssued('30045')).toEqual({ status: 'issued', documentNumber: '30045' });
    expect(await provider.voidInvoice()).toEqual({ status: 'voided' });
    expect(invoice.idempotencyKey).toBe('i');
  });
});
