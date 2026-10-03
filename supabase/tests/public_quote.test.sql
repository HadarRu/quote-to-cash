-- Public quote page: token lookup (unknown = revoked), first open sets VIEWED,
-- expiry, idempotent approve / reject, comments, rate limiting, and that none of
-- it is reachable without the Edge Function. Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create temp table ids as select
  '10000000-0000-4000-a000-000000000001'::uuid as business_a,
  '00000000-0000-4000-a000-000000000001'::uuid as owner_a,
  (select id from public.customer where business_id = '10000000-0000-4000-a000-000000000001') as customer_a,
  '73000000-0000-4000-a000-000000000001'::uuid as q1,
  '73000000-0000-4000-a000-000000000002'::uuid as q2,
  '73000000-0000-4000-a000-000000000003'::uuid as q3,
  '73000000-0000-4000-a000-000000000009'::uuid as revision;
grant select on ids to authenticated, service_role;

create function pg_temp.hash(p_token text) returns text language sql as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;

-- A sent quote whose link token is `p_token`.
create function pg_temp.sent_quote(p_id uuid, p_token text, p_expires interval) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
  set local role authenticated;
  perform public.save_quote_draft(jsonb_build_object(
    'id', p_id, 'business_id', (select business_a from ids), 'customer_id', (select customer_a from ids),
    'discount_type', 'none', 'discount_value', 0, 'vat_rate_bp', 1800,
    'subtotal_minor', 10000, 'discount_minor', 0, 'vat_minor', 1800, 'total_minor', 11800,
    'items', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'description', 'שקע', 'quantity', 1, 'unit', 'point',
      'unit_price_minor', 10000, 'line_total_minor', 10000, 'vat_included', false, 'sort_order', 0))));
  reset role;
  set local role service_role;
  perform public.send_quote((select owner_a from ids), p_id, gen_random_uuid(), pg_temp.hash(p_token),
    now() + p_expires,
    '{"subtotal_minor": 10000, "discount_minor": 0, "vat_rate_bp": 1800, "vat_minor": 1800, "total_minor": 11800}',
    '{"business": {"name": "כהן חשמל"}, "items": []}');
  reset role;
end;
$$;

select pg_temp.sent_quote((select q1 from ids), 'token-one', interval '14 days');
select pg_temp.sent_quote((select q2 from ids), 'token-two', interval '14 days');
select pg_temp.sent_quote((select q3 from ids), 'token-old', interval '1 second');
update public.quote set token_expires_at = now() - interval '1 minute' where id = (select q3 from ids);

-- ---------------------------------------------------------------- not reachable by clients
set local role anon;
select throws_ok($$ select public.public_quote_open(pg_temp.hash('token-one'), null) $$,
  '42501', null, 'anon cannot open a quote by token directly');
reset role;
set local role authenticated;
select throws_ok($$ select public.public_quote_respond(pg_temp.hash('token-one'), 'approve', 'דנה', null, null) $$,
  '42501', null, 'signed-in users cannot answer a quote directly');
select throws_ok($$ select public.hit_rate_limit('x', 1, 60) $$, '42501', null, 'clients cannot touch rate limits');
reset role;

-- ---------------------------------------------------------------- opening
set local role service_role;
select is(public.public_quote_open(pg_temp.hash('no-such-token'), '203.0.113.7'), null,
  'an unknown token finds nothing');
select is(public.public_quote_open(pg_temp.hash('token-one'), '203.0.113.7') ->> 'state', 'open',
  'a sent quote opens');
select results_eq(
  $$ select status::text, viewed_at is not null from public.quote where id = (select q1 from ids) $$,
  $$ values ('viewed', true) $$, 'the first open marks it VIEWED');
select is((select count(*) from public.audit_log where record_id = (select q1 from ids) and new_data ->> 'status' = 'viewed'),
  1::bigint, 'the view is audited with the IP');
create temp table first_view as select viewed_at from public.quote where id = (select q1 from ids);
select public.public_quote_open(pg_temp.hash('token-one'), '203.0.113.7');
select is((select viewed_at from public.quote where id = (select q1 from ids)), (select viewed_at from first_view),
  'opening again keeps the first view time');
select is(public.public_quote_open(pg_temp.hash('token-one'), null) -> 'quote' -> 'business' ->> 'name', 'כהן חשמל',
  'the page gets the snapshot');

select is(public.public_quote_open(pg_temp.hash('token-old'), null) ->> 'state', 'expired',
  'a link past its expiry shows the expired page');
select is((select status::text from public.quote where id = (select q3 from ids)), 'expired',
  'and the quote becomes EXPIRED');

-- ---------------------------------------------------------------- approving
select throws_ok($$ select public.public_quote_respond(pg_temp.hash('token-one'), 'approve', ' א ', null, '203.0.113.7') $$,
  '22023', null, 'approving requires a typed name');
select is(public.public_quote_respond(pg_temp.hash('token-one'), 'approve', ' דנה לוי ', null, '203.0.113.7') ->> 'state',
  'approved', 'the customer approves with their name');
select results_eq(
  $$ select status::text, approved_name, host(approved_ip), approved_at is not null from public.quote where id = (select q1 from ids) $$,
  $$ values ('approved', 'דנה לוי', '203.0.113.7', true) $$,
  'name, IP and time are stored on the quote');
select results_eq(
  $$ select new_data ->> 'name', new_data ->> 'ip', new_data ? 'at' from public.audit_log
     where record_id = (select q1 from ids) and new_data ->> 'status' = 'approved' $$,
  $$ values ('דנה לוי', '203.0.113.7', true) $$,
  'and in the audit log');
create temp table approval as select approved_at from public.quote where id = (select q1 from ids);
select is(public.public_quote_respond(pg_temp.hash('token-one'), 'approve', 'מישהו אחר', null, '198.51.100.1') ->> 'already',
  'true', 'approving twice is harmless');
select results_eq(
  $$ select approved_name, approved_at = (select approved_at from approval),
            (select count(*) from public.audit_log where record_id = (select q1 from ids) and new_data ->> 'status' = 'approved')
     from public.quote where id = (select q1 from ids) $$,
  $$ values ('דנה לוי', true, 1::bigint) $$,
  'the first approval stands, recorded once');
select throws_ok($$ select public.public_quote_respond(pg_temp.hash('token-one'), 'reject', null, 'יקר', null) $$,
  '55000', null, 'an approved quote cannot be rejected');
select is(public.public_quote_open(pg_temp.hash('token-one'), null) -> 'approval' ->> 'name', 'דנה לוי',
  'the page shows who approved');
select throws_ok($$ select public.public_quote_respond(pg_temp.hash('token-old'), 'approve', 'דנה', null, null) $$,
  '55000', null, 'an expired quote cannot be approved');

-- ---------------------------------------------------------------- rejecting and comments
select is(public.public_quote_respond(pg_temp.hash('token-two'), 'reject', null, '  ', null) ->> 'state', 'rejected',
  'the customer can reject without a reason');
select ok(public.public_quote_comment(pg_temp.hash('token-two'), ' אפשר לדבר על המחיר? ', '203.0.113.7'),
  'the customer can comment');
select is((select body from public.quote_comment where quote_id = (select q2 from ids)), 'אפשר לדבר על המחיר?',
  'the comment is stored for the business');

-- ---------------------------------------------------------------- revoked links
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
select public.revise_quote((select q2 from ids), (select revision from ids));
reset role;
-- A revoke that is neither a cancel nor a revision (the link alone was withdrawn).
update public.quote set token_revoked_at = now() where id = (select q3 from ids);
set local role service_role;
select is(public.public_quote_open(pg_temp.hash('token-two'), null) ->> 'state', 'superseded',
  'a link replaced by a new revision says so');
select is(public.public_quote_open(pg_temp.hash('token-old'), null), null,
  'a revoked link answers exactly like an unknown one');

select ok(public.hit_rate_limit('ip:203.0.113.7', 2, 60) and public.hit_rate_limit('ip:203.0.113.7', 2, 60),
  'requests within the limit pass');
select ok(not public.hit_rate_limit('ip:203.0.113.7', 2, 60), 'the next request in the window is refused');

reset role;
select * from finish();
rollback;
