-- Quote lifecycle: drafts, draft-only editing, sending (idempotent, numbered
-- without duplicates), revisions and cancellation. Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create temp table ids as select
  '10000000-0000-4000-a000-000000000001'::uuid as business_a,
  '00000000-0000-4000-a000-000000000001'::uuid as owner_a,
  '00000000-0000-4000-b000-000000000001'::uuid as owner_b,
  (select id from public.customer where business_id = '10000000-0000-4000-a000-000000000001') as customer_a,
  '70000000-0000-4000-a000-000000000001'::uuid as q1,
  '70000000-0000-4000-a000-000000000002'::uuid as q2,
  '70000000-0000-4000-a000-000000000003'::uuid as q3,
  '70000000-0000-4000-a000-000000000009'::uuid as revision,
  '71000000-0000-4000-a000-000000000001'::uuid as key1,
  '71000000-0000-4000-a000-000000000002'::uuid as key2,
  '71000000-0000-4000-a000-000000000003'::uuid as key3;
grant select on ids to authenticated, service_role;

-- Payload in the shape the app's outbox sends.
create function pg_temp.draft(p_id uuid, p_lines integer) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'business_id', business_a, 'customer_id', customer_a, 'title', 'הצעה לבדיקה',
    'discount_type', 'none', 'discount_value', 0, 'vat_rate_bp', 1800,
    'subtotal_minor', 25000 * p_lines, 'discount_minor', 0, 'vat_minor', 4500 * p_lines,
    'total_minor', 29500 * p_lines,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', ('72000000-0000-4000-a000-' || lpad((n + 100 * right(p_id::text, 1)::int)::text, 12, '0'))::uuid,
      'description', 'שקע ' || n, 'quantity', 1, 'unit', 'point', 'unit_price_minor', 25000,
      'line_total_minor', 25000, 'vat_included', false, 'sort_order', n))
      from generate_series(1, p_lines) n), '[]'::jsonb))
  from ids
$$;

create function pg_temp.send(p_user uuid, p_quote uuid, p_key uuid)
returns table (quote_number integer, sent_at timestamptz, already_sent boolean, token_stored boolean)
language sql as $$
  select * from public.send_quote(p_user, p_quote, p_key, encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    now() + interval '14 days',
    '{"subtotal_minor": 50000, "discount_minor": 0, "vat_rate_bp": 1800, "vat_minor": 9000, "total_minor": 59000}',
    '{"business": {"name": "כהן חשמל"}}')
$$;

-- ---------------------------------------------------------------- drafts (as the owner of A)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

select lives_ok($$ select public.save_quote_draft(pg_temp.draft((select q1 from ids), 2)) $$,
  'a member saves a draft with its lines');
select lives_ok($$ select public.save_quote_draft(pg_temp.draft((select q1 from ids), 2)) $$,
  'saving the same draft again is harmless (outbox retries)');
select results_eq(
  $$ select status::text, quote_number, (select count(*) from public.quote_item i where i.quote_id = q.id and i.deleted_at is null)
     from public.quote q where id = (select q1 from ids) $$,
  $$ values ('draft', null::integer, 2::bigint) $$,
  'one draft, no number yet, two lines');

select public.save_quote_draft(pg_temp.draft((select q1 from ids), 1));
select is(
  (select count(*) from public.quote_item where quote_id = (select q1 from ids) and deleted_at is null),
  1::bigint, 'a line removed in the app is soft-deleted on the next save');
select public.save_quote_draft(pg_temp.draft((select q1 from ids), 2));

select throws_ok($$ update public.quote set status = 'sent' where id = (select q1 from ids) $$,
  '42501', null, 'clients cannot change a quote''s status');
select throws_ok($$ insert into public.quote (business_id, customer_id, status) select business_a, customer_a, 'approved' from ids $$,
  '42501', null, 'clients cannot create a quote in another status');
select throws_ok($$ select * from pg_temp.send((select owner_a from ids), (select q1 from ids), (select key1 from ids)) $$,
  '42501', null, 'send_quote is not callable by clients (only by the Edge Function)');

-- ---------------------------------------------------------------- sending (as the Edge Function)
reset role;
set local role service_role;

select results_eq(
  $$ select quote_number, already_sent from pg_temp.send((select owner_a from ids), (select q1 from ids), (select key1 from ids)) $$,
  $$ values (2, false) $$,
  'sending assigns the next number (the seed used 1)');
select results_eq(
  $$ select status::text, token_hash is not null, token_expires_at > now(), (sent_snapshot ->> 'quote_number')::int, total_minor
     from public.quote where id = (select q1 from ids) $$,
  $$ values ('sent', true, true, 2, 59000::bigint) $$,
  'the sent quote has its token hash, expiry, snapshot and server totals');
create temp table first_hash as select token_hash from public.quote where id = (select q1 from ids);
select results_eq(
  $$ select quote_number, already_sent, token_stored from pg_temp.send((select owner_a from ids), (select q1 from ids), (select key1 from ids)) $$,
  $$ values (2, true, true) $$,
  'retrying with the same send key returns the same number and stores the new link');
select isnt((select token_hash from public.quote where id = (select q1 from ids)), (select token_hash from first_hash),
  'the retry''s token replaces the one whose response was lost');
select is(
  (select next_quote_number from public.business_settings where business_id = (select business_a from ids)),
  3, 'a retried send does not consume a number');
select is((select valid_until from public.quote where id = (select q1 from ids)),
  ((now() + interval '14 days') at time zone 'Asia/Jerusalem')::date, 'sending sets the validity date from the link expiry');
update public.quote set status = 'viewed', viewed_at = now() where id = (select q1 from ids);
create temp table viewed_hash as select token_hash from public.quote where id = (select q1 from ids);
select results_eq(
  $$ select already_sent, token_stored, (select token_hash from public.quote where id = (select q1 from ids)) = (select token_hash from viewed_hash)
     from pg_temp.send((select owner_a from ids), (select q1 from ids), (select key1 from ids)) $$,
  $$ values (true, false, true) $$,
  'once the customer opened the quote, a retry keeps the link the customer has');
update public.quote set status = 'sent', viewed_at = null where id = (select q1 from ids);
select throws_ok($$ select * from pg_temp.send((select owner_a from ids), (select q1 from ids), (select key2 from ids)) $$,
  '55000', null, 'a sent quote cannot be sent again with another key');
select throws_ok($$ select * from pg_temp.send((select owner_b from ids), (select q1 from ids), (select key1 from ids)) $$,
  '42501', null, 'a user of another business cannot send it');

-- Two more drafts: numbers keep counting up, without duplicates.
reset role;
set local role authenticated;
select public.save_quote_draft(pg_temp.draft((select q2 from ids), 1));
select public.save_quote_draft(pg_temp.draft((select q3 from ids), 0));
reset role;
set local role service_role;
select throws_ok($$ select * from pg_temp.send((select owner_a from ids), (select q3 from ids), (select key3 from ids)) $$,
  '22023', null, 'a quote without lines cannot be sent');
select results_eq(
  $$ select quote_number from pg_temp.send((select owner_a from ids), (select q2 from ids), (select key2 from ids)) $$,
  $$ values (3) $$, 'the next quote gets the next number');
select is_empty(
  $$ select quote_number from public.quote where business_id = (select business_a from ids) and quote_number is not null
     group by quote_number having count(*) > 1 $$,
  'no two quotes of a business share a number');
reset role;
select throws_ok($$ update public.quote set quote_number = 2 where id = (select q2 from ids) $$,
  '42501', null, 'a number never changes once assigned');

-- ---------------------------------------------------------------- draft-only editing
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
select throws_ok($$ update public.quote set notes = 'שינוי' where id = (select q1 from ids) $$,
  '55000', null, 'a sent quote cannot be edited');
select throws_ok($$ select public.save_quote_draft(pg_temp.draft((select q1 from ids), 3)) $$,
  '55000', null, 'an outbox save of a quote sent from another device is refused');
select throws_ok(
  $$ insert into public.quote_item (business_id, quote_id, description, quantity, unit, unit_price_minor, line_total_minor)
     select business_a, q1, 'תוספת', 1, 'unit', 100, 100 from ids $$,
  '55000', null, 'lines cannot be added to a sent quote');

-- ---------------------------------------------------------------- revise and cancel
select is(public.revise_quote((select q1 from ids), (select revision from ids)), (select revision from ids),
  'revising creates the new draft revision');
select results_eq(
  $$ select r.status::text, r.revision, r.root_quote_id = q.id, r.supersedes_quote_id = q.id, r.quote_number,
            (select count(*) from public.quote_item i where i.quote_id = r.id),
            q.status::text, q.token_revoked_at is not null
     from public.quote r join public.quote q on q.id = (select q1 from ids)
     where r.id = (select revision from ids) $$,
  $$ values ('draft', 2, true, true, null::integer, 2::bigint, 'superseded', true) $$,
  'the revision copies the lines; the old quote is superseded and its link revoked');
select is(public.revise_quote((select q1 from ids), (select revision from ids)), (select revision from ids),
  'revising again with the same id is harmless');
select throws_ok($$ select public.revise_quote((select revision from ids), gen_random_uuid()) $$,
  '55000', null, 'a draft cannot be revised');

select lives_ok($$ select public.cancel_quote((select q2 from ids)) $$, 'a sent quote can be cancelled');
select results_eq(
  $$ select status::text, cancelled_at is not null, token_revoked_at is not null from public.quote where id = (select q2 from ids) $$,
  $$ values ('cancelled', true, true) $$, 'cancelling revokes the customer link');
select lives_ok($$ select public.cancel_quote((select q2 from ids)) $$, 'cancelling twice is harmless');
select throws_ok(
  $$ select public.cancel_quote((select id from public.quote where business_id = (select business_a from ids) and status = 'approved')) $$,
  '55000', null, 'an approved quote cannot be cancelled');

reset role;
select * from finish();
rollback;
