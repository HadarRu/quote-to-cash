// The Jobs stage through the APIs the app and the customer's page call, from a
// brand-new account with nothing seeded: customer -> quote -> send -> approval
// (on the link, or recorded by the owner) -> job -> visit -> start -> complete
// -> invoice -> paid, with the home action queue at each step. Plus concurrent
// approvals creating exactly one job.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  adminClient,
  anonClient,
  approveOnLink,
  businesses,
  callFunction,
  createCustomer,
  createDraft,
  freshIp,
  jobOfQuote,
  sendQuote,
  signIn,
  users,
  visitPlanner,
  type SignedIn,
} from '../stack.ts';

/** A new user with no business, set up through the `business-setup` Edge Function. */
async function newBusinessOwner(): Promise<{ owner: SignedIn; businessId: string }> {
  const phone = `9725${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const password = randomUUID();
  const created = await adminClient().auth.admin.createUser({
    phone,
    password,
    phone_confirm: true,
  });
  if (created.error) throw created.error;
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ phone, password });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  const owner = { client, accessToken: data.session.access_token, userId: data.session.user.id };
  const businessId = randomUUID();
  const setup = await callFunction('business-setup', {
    accessToken: owner.accessToken,
    body: { businessId, name: 'חשמל חדש', trade: 'electrician', taxStatus: 'osek_murshe' },
  });
  expect(setup.status).toBe(200);
  return { owner, businessId };
}

async function queue(owner: SignedIn, businessId: string) {
  const { data, error } = await owner.client.rpc('action_queue', { p_business_id: businessId });
  if (error) throw error;
  return data.map((row) => ({ kind: row.kind, id: row.id, jobId: row.job_id }));
}

async function rpc<T>(call: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await call;
  if (error) throw new Error(error.message);
  return data;
}

/** Schedule, start, complete, invoice, issue and mark paid, checking each step. */
async function jobToPaidInvoice(owner: SignedIn, businessId: string, jobId: string) {
  expect(await queue(owner, businessId)).toEqual([
    expect.objectContaining({ kind: 'approved_unscheduled', jobId }),
  ]);

  const visit = (await visitPlanner(businessId))(2);
  await rpc(
    owner.client.rpc('schedule_job', {
      p_job_id: jobId,
      p_starts_at: visit.startsAt,
      p_ends_at: visit.endsAt,
    }),
  );
  const { data: scheduled } = await owner.client
    .from('job')
    .select('status, appointment (status, starts_at)')
    .eq('id', jobId)
    .single();
  expect(scheduled!.status).toBe('scheduled');
  expect(scheduled!.appointment).toEqual([{ status: 'confirmed', starts_at: expect.any(String) }]);
  expect(Date.parse(scheduled!.appointment[0]!.starts_at)).toBe(Date.parse(visit.startsAt));
  expect(await queue(owner, businessId)).toEqual([]);

  expect(
    await rpc(owner.client.rpc('transition_job', { p_job_id: jobId, p_action: 'start' })),
  ).toBe('in_progress');
  expect(
    await rpc(owner.client.rpc('transition_job', { p_job_id: jobId, p_action: 'complete' })),
  ).toBe('completed');
  expect(await queue(owner, businessId)).toEqual([
    { kind: 'completed_uninvoiced', id: jobId, jobId },
  ]);

  // "הפק חשבונית"
  const created = await callFunction('invoices', {
    accessToken: owner.accessToken,
    body: { jobId, idempotencyKey: randomUUID() },
  });
  expect(created.status).toBe(200);
  const invoiceId = created.body!.invoiceId as string;
  const { data: invoice } = await owner.client
    .from('invoice')
    .select('status, job_id, total_minor')
    .eq('id', invoiceId)
    .single();
  expect(invoice).toEqual({ status: 'not_issued', job_id: jobId, total_minor: 59000 });

  const issued = await callFunction(`invoices/${invoiceId}/issue`, {
    accessToken: owner.accessToken,
    body: { documentNumber: '5001' },
  });
  expect(issued.status).toBe(200);
  expect(await queue(owner, businessId)).toEqual([
    expect.objectContaining({ kind: 'invoice_unpaid', id: invoiceId, jobId }),
  ]);

  const paid = await callFunction(`invoices/${invoiceId}/paid`, {
    accessToken: owner.accessToken,
    body: { method: 'bit' },
  });
  expect(paid.status).toBe(200);
  expect(paid.body!.status).toBe('paid');
  expect(await queue(owner, businessId)).toEqual([]);
}

describe('jobs from an empty account', () => {
  it('customer approves on the link: a job appears, and it reaches a paid invoice', async () => {
    const { owner, businessId } = await newBusinessOwner();
    expect(await queue(owner, businessId)).toEqual([]);

    const customerId = await createCustomer(owner, businessId, { fullName: 'לקוחה חדשה' });
    const sent = await sendQuote(owner, await createDraft(owner, businessId, { customerId }));
    expect(await queue(owner, businessId)).toEqual([
      expect.objectContaining({ kind: 'quote_unanswered', id: sent.quoteId }),
    ]);
    expect(await jobOfQuote(owner, sent.quoteId)).toEqual([]);

    expect((await approveOnLink(sent.token)).status).toBe(200);
    const jobs = await jobOfQuote(owner, sent.quoteId);
    expect(jobs).toEqual([expect.objectContaining({ status: 'pending_schedule' })]);

    await jobToPaidInvoice(owner, businessId, jobs[0]!.id);
  });

  it('the owner marks the quote approved: same job, same path to a paid invoice', async () => {
    const { owner, businessId } = await newBusinessOwner();
    const sent = await sendQuote(owner, await createDraft(owner, businessId));

    const jobId = await rpc(
      owner.client.rpc('mark_quote_approved', {
        p_quote_id: sent.quoteId,
        p_method: 'phone',
        p_note: 'אישר בשיחה',
      }),
    );
    if (!jobId) throw new Error('mark_quote_approved returned no job');
    const { data: quote } = await owner.client
      .from('quote')
      .select('status, approval_method, approval_note')
      .eq('id', sent.quoteId)
      .single();
    expect(quote).toEqual({
      status: 'approved',
      approval_method: 'phone',
      approval_note: 'אישר בשיחה',
    });
    const { data: audit } = await owner.client
      .from('audit_log')
      .select('actor_user_id, new_data')
      .eq('record_id', sent.quoteId)
      .eq('new_data->>status', 'approved');
    expect(audit).toEqual([
      { actor_user_id: owner.userId, new_data: expect.objectContaining({ method: 'phone' }) },
    ]);
    expect(await jobOfQuote(owner, sent.quoteId)).toEqual([
      expect.objectContaining({ id: jobId, status: 'pending_schedule' }),
    ]);

    await jobToPaidInvoice(owner, businessId, jobId);
  });
});

describe('concurrent approvals', () => {
  it('create exactly one job', async () => {
    const owner = await signIn(users.ownerA.phone);
    const sent = await sendQuote(owner, await createDraft(owner, businesses.a));
    const [links, owners] = await Promise.all([
      Promise.all(Array.from({ length: 6 }, () => approveOnLink(sent.token, freshIp()))),
      Promise.all(
        Array.from({ length: 3 }, () =>
          owner.client.rpc('mark_quote_approved', { p_quote_id: sent.quoteId, p_method: 'phone' }),
        ),
      ),
    ]);
    expect(links.map((res) => res.status)).toEqual(Array(6).fill(200));
    expect(owners.map((res) => res.error)).toEqual(Array(3).fill(null));
    const { data } = await adminClient().from('job').select('id').eq('quote_id', sent.quoteId);
    expect(data).toHaveLength(1);
    expect(owners.map((res) => res.data)).toEqual(Array(3).fill(data![0]!.id));
  });

  it('a visit overlapping another confirmed visit is refused (CONFLICT)', async () => {
    const owner = await signIn(users.ownerA.phone);
    const jobs = [];
    for (let i = 0; i < 2; i++) {
      const sent = await sendQuote(owner, await createDraft(owner, businesses.a));
      expect((await approveOnLink(sent.token)).status).toBe(200);
      jobs.push((await jobOfQuote(owner, sent.quoteId))[0]!.id);
    }
    const visit = (await visitPlanner(businesses.a))(3);
    const schedule = (jobId: string) =>
      owner.client.rpc('schedule_job', {
        p_job_id: jobId,
        p_starts_at: visit.startsAt,
        p_ends_at: visit.endsAt,
      });
    expect((await schedule(jobs[0]!)).error).toBeNull();
    expect((await schedule(jobs[1]!)).error?.code).toBe('23P01');
  });
});
