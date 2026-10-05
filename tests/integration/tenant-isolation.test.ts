// Cross-tenant access through the public APIs a client can actually reach
// (Data API, RPCs, Storage), with real sign-in sessions. The pgTAP suite
// (supabase/tests/rls_tenant_isolation.test.sql) checks the same rules inside
// Postgres and that this table list covers every business table.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import starterList from '../../packages/types/src/starter-price-lists/electrician.json' with { type: 'json' };
import {
  adminClient,
  anonClient,
  businesses,
  createDraft,
  runFullFlow,
  signIn,
  storageStatus,
  users,
  type Client,
  type SignedIn,
} from '../stack.ts';

/** Business tables and the column holding the business id. */
const TABLES = [
  ['business', 'id'],
  ['business_member', 'business_id'],
  ['business_settings', 'business_id'],
  ['customer', 'business_id'],
  ['customer_address', 'business_id'],
  ['service_category', 'business_id'],
  ['service', 'business_id'],
  ['quote', 'business_id'],
  ['quote_item', 'business_id'],
  ['quote_slot_option', 'business_id'],
  ['quote_comment', 'business_id'],
  ['appointment', 'business_id'],
  ['job', 'business_id'],
  ['invoice', 'business_id'],
  ['invoice_item', 'business_id'],
  ['payment', 'business_id'],
  ['notification', 'business_id'],
  ['device', 'business_id'],
  ['notification_preference', 'business_id'],
  ['subscription', 'business_id'],
  ['audit_log', 'business_id'],
  ['file', 'business_id'],
] as const;

type Table = (typeof TABLES)[number][0];

// The typed client only knows each table's own columns; these tests loop over all of them.
const from = (client: Client, table: Table) => client.from(table as 'customer');

let ownerA: SignedIn;
let employeeA: SignedIn;

beforeAll(async () => {
  [ownerA, employeeA] = await Promise.all([
    signIn(users.ownerA.phone),
    signIn(users.employeeA.phone),
  ]);
  // The seed has users, businesses and customers only: both businesses get
  // the rest by running the real flow.
  const ownerB = await signIn(users.ownerB.phone);
  await Promise.all([runFullFlow(ownerA, businesses.a), runFullFlow(ownerB, businesses.b)]);
}, 60_000);

async function rowsOfB(table: Table, key: string) {
  const { data, error } = await from(adminClient(), table).select('*').eq(key, businesses.b);
  if (error) throw error;
  return data as unknown as Record<string, unknown>[];
}

describe.each(TABLES)('%s', (table, key) => {
  it('business B has rows (so the checks below mean something)', async () => {
    expect((await rowsOfB(table, key)).length).toBeGreaterThan(0);
  });

  it('owner A reads A’s own rows (positive control)', async () => {
    const { data, error } = await from(ownerA.client, table).select('*').eq(key, businesses.a);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it.each([
    ['owner A', () => ownerA.client],
    ['employee A', () => employeeA.client],
    ['anon', () => anonClient()],
  ])('%s cannot read B rows', async (who, client) => {
    const { data, error } = await from(client(), table).select('*').eq(key, businesses.b);
    // Members get an empty result; anon is refused outright or gets nothing.
    if (who !== 'anon' && error) throw error;
    expect(data ?? []).toEqual([]);
  });

  it('owner A cannot insert a row into B', async () => {
    const before = await rowsOfB(table, key);
    const row = before[0];
    const copy = { ...row, ...('id' in row! && key !== 'id' ? { id: randomUUID() } : {}) };
    const { error } = await from(ownerA.client, table).insert(copy as never);
    expect(error).not.toBeNull();
    expect(error!.code).toMatch(/^(42501|23505)$/);
    // 23505 can only be a collision with B's own row, never a write.
    expect(await rowsOfB(table, key)).toHaveLength(before.length);
  });

  it('owner A cannot update or delete B rows', async () => {
    const before = await rowsOfB(table, key);
    const update = await from(ownerA.client, table)
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq(key, businesses.b)
      .select();
    expect(update.data ?? []).toEqual([]);
    const del = await from(ownerA.client, table).delete().eq(key, businesses.b).select();
    expect(del.data ?? []).toEqual([]);
    expect(await rowsOfB(table, key)).toEqual(before);
  });
});

describe('RPCs refuse other tenants', () => {
  it('save_quote_draft cannot create a quote in B', async () => {
    const customerB = (await rowsOfB('customer', 'business_id'))[0]!.id as string;
    const id = randomUUID();
    const { error } = await ownerA.client.rpc('save_quote_draft', {
      p_quote: {
        id,
        business_id: businesses.b,
        customer_id: customerB,
        discount_type: 'none',
        discount_value: 0,
        vat_rate_bp: 1800,
        subtotal_minor: 0,
        discount_minor: 0,
        vat_minor: 0,
        total_minor: 0,
        items: [],
      },
    });
    expect(error?.code).toBe('42501');
    const { data } = await adminClient().from('quote').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it('save_quote_draft cannot overwrite B’s draft by its id', async () => {
    const ownerB = await signIn(users.ownerB.phone);
    const draftB = await createDraft(ownerB, businesses.b, { title: 'של B' });
    const { error } = await ownerA.client.rpc('save_quote_draft', {
      p_quote: {
        id: draftB.quoteId,
        business_id: businesses.a,
        customer_id: (await createDraft(ownerA, businesses.a)).customerId,
        title: 'נחטף',
        discount_type: 'none',
        discount_value: 0,
        vat_rate_bp: 1800,
        subtotal_minor: 0,
        discount_minor: 0,
        vat_minor: 0,
        total_minor: 0,
        items: [],
      },
    });
    expect(error?.code).toBe('42501');
    const { data } = await adminClient()
      .from('quote')
      .select('title, business_id')
      .eq('id', draftB.quoteId)
      .single();
    expect(data).toEqual({ title: 'של B', business_id: businesses.b });
  });

  it('cancel_quote and revise_quote do nothing to B’s quotes', async () => {
    const ownerB = await signIn(users.ownerB.phone);
    const draftB = await createDraft(ownerB, businesses.b);
    const cancel = await ownerA.client.rpc('cancel_quote', { p_quote_id: draftB.quoteId });
    expect(cancel.error?.code).toBe('42501');
    const revise = await ownerA.client.rpc('revise_quote', {
      p_quote_id: draftB.quoteId,
      p_new_quote_id: randomUUID(),
    });
    expect(revise.error?.code).toBe('42501');
    const { data } = await adminClient()
      .from('quote')
      .select('status')
      .eq('id', draftB.quoteId)
      .single();
    expect(data!.status).toBe('draft');
  });

  it('import_starter_price_list cannot write into B', async () => {
    const before = (await rowsOfB('service', 'business_id')).length;
    const { error } = await ownerA.client.rpc('import_starter_price_list', {
      p_business_id: businesses.b,
      p_list: starterList as never,
    });
    expect(error?.code).toBe('42501');
    expect((await rowsOfB('service', 'business_id')).length).toBe(before);
  });

  it('the public-quote SQL functions are not callable by clients at all', async () => {
    for (const client of [anonClient(), ownerA.client]) {
      for (const [fn, args] of [
        ['public_quote_open', { p_token_hash: 'x', p_ip: null }],
        ['public_quote_comment', { p_token_hash: 'x', p_body: 'x', p_ip: null }],
        [
          'public_quote_respond',
          { p_token_hash: 'x', p_action: 'approve', p_name: 'x', p_reason: null, p_ip: null },
        ],
        ['hit_rate_limit', { p_bucket: 'x', p_limit: 1, p_window_seconds: 60 }],
        [
          'send_quote',
          {
            p_user_id: users.ownerA.id,
            p_quote_id: randomUUID(),
            p_send_key: randomUUID(),
            p_token_hash: 'x',
            p_token_expires_at: new Date().toISOString(),
            p_totals: {},
            p_snapshot: {},
          },
        ],
      ] as const) {
        const { error } = await client.rpc(fn as never, args as never);
        expect(error, fn).not.toBeNull();
        expect(error!.code, fn).toBe('42501');
      }
    }
  });
});

describe('Storage refuses other tenants', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
  const pathB = `${businesses.b}/quotes/${randomUUID()}/${randomUUID()}.jpg`;

  beforeAll(async () => {
    const { error } = await adminClient()
      .storage.from('quote-photos')
      .upload(pathB, jpeg, { contentType: 'image/jpeg' });
    if (error) throw error;
  });

  it('cannot upload into B’s folder, directly or through ../', async () => {
    const photos = ownerA.client.storage.from('quote-photos');
    for (const path of [
      `${businesses.b}/quotes/${randomUUID()}/x.jpg`,
      `${businesses.a}/../${businesses.b}/quotes/${randomUUID()}/x.jpg`,
      `not-a-business/${randomUUID()}.jpg`,
    ]) {
      const { error } = await photos.upload(path, jpeg, { contentType: 'image/jpeg' });
      expect(storageStatus(error), path).toBe('403');
    }
  });

  it('cannot download, sign, list, overwrite or delete B’s photo', async () => {
    const photos = ownerA.client.storage.from('quote-photos');
    expect((await photos.download(pathB)).error).not.toBeNull();
    expect((await photos.createSignedUrl(pathB, 60)).error).not.toBeNull();
    const folder = pathB.split('/').slice(0, 3).join('/');
    expect((await photos.list(folder)).data ?? []).toEqual([]);
    expect(
      (await photos.upload(pathB, jpeg, { contentType: 'image/jpeg', upsert: true })).error,
    ).not.toBeNull();
    await photos.remove([pathB]);
    expect((await adminClient().storage.from('quote-photos').download(pathB)).error).toBeNull();
  });

  it('anon cannot read either bucket', async () => {
    const photos = anonClient().storage.from('quote-photos');
    expect((await photos.download(pathB)).error).not.toBeNull();
    expect(
      (await anonClient().storage.from('business-assets').list(businesses.a)).data ?? [],
    ).toEqual([]);
  });

  it('within a business, only OWNER/ADMIN may change the logo', async () => {
    const assets = (c: Client) => c.storage.from('business-assets');
    const path = `${businesses.a}/logo-${randomUUID()}.png`;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(
      (await assets(employeeA.client).upload(path, png, { contentType: 'image/png' })).error,
    ).not.toBeNull();
    expect(
      (await assets(ownerA.client).upload(path, png, { contentType: 'image/png' })).error,
    ).toBeNull();
  });
});
