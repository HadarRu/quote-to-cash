-- Schema-wide rules: RLS everywhere, soft delete only, insert-only audit log,
-- server-assigned document numbers, and tenant creation. Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select is_empty(
  $$ select c.relname::text from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity $$,
  'every public table has row level security enabled'
);

select is_empty(
  $$ select tablename::text from pg_policies where schemaname = 'public' and cmd in ('DELETE', 'ALL') $$,
  'no DELETE (or ALL) policies: rows are soft-deleted via deleted_at'
);

select is_empty(
  $$ select format('%s: %s %s', table_name, grantee, privilege_type) from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')
       and privilege_type in ('TRUNCATE', 'DELETE') $$,
  'anon and authenticated have no TRUNCATE (bypasses RLS) or DELETE (soft delete only) on any table'
);

select is_empty(
  $$ select table_name::text from information_schema.columns
     where table_schema = 'public' and column_name like '%\_minor' and data_type <> 'bigint' $$,
  'every *_minor money column is an integer (bigint)'
);

-- Act as the owner of business A.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.audit_log (business_id, action, table_name)
     values ('10000000-0000-4000-a000-000000000001', 'update', 'customer') $$,
  'audit_log: a member can append an entry for their business'
);

select throws_ok(
  $$ insert into public.audit_log (business_id, actor_user_id, action, table_name)
     values ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'update', 'customer') $$,
  '42501', null,
  'audit_log: a member cannot write an entry in someone else''s name'
);

select throws_ok(
  $$ update public.audit_log set table_name = 'tampered' $$,
  '42501', null,
  'audit_log: UPDATE is refused for members'
);

select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null,
  'audit_log: DELETE is refused for members'
);

-- Quote numbers are assigned by the server when a quote is sent, never by a client.
select throws_ok(
  $$ insert into public.quote (business_id, customer_id, quote_number)
     select business_id, id, 999 from public.customer where business_id = '10000000-0000-4000-a000-000000000001' $$,
  '42501', null,
  'a client cannot choose a quote number'
);

insert into public.quote (id, business_id, customer_id)
select '30000000-0000-4000-a000-000000000001', business_id, id from public.customer
where business_id = '10000000-0000-4000-a000-000000000001';

select results_eq(
  $$ select status::text, quote_number from public.quote where id = '30000000-0000-4000-a000-000000000001' $$,
  $$ values ('draft', null::integer) $$,
  'a new quote is a draft without a number'
);

-- create_business makes the caller the OWNER of a new tenant.
select isnt(
  public.create_business('עסק חדש'),
  null,
  'create_business returns the new business id'
);

select results_eq(
  $$ select m.role::text from public.business_member m join public.business b on b.id = m.business_id
     where b.name = 'עסק חדש' and m.user_id = '00000000-0000-4000-a000-000000000001' $$,
  $$ values ('OWNER') $$,
  'create_business adds the caller as OWNER (and the new business is visible to them)'
);

reset role;

-- Even the table owner cannot rewrite history.
select throws_ok(
  $$ update public.audit_log set table_name = 'tampered' $$,
  '42501', 'audit_log is insert-only',
  'audit_log: UPDATE is refused even for the table owner'
);

select * from finish();
rollback;
