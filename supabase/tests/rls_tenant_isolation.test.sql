-- Tenant isolation: a member of business A cannot select, insert or update
-- business B rows in any business table. Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;

create schema tests;

-- Every table scoped to a business, the column that holds the business id, and
-- whether members may UPDATE their own rows (positive control).
-- update_col: the column the UPDATE checks write (defaults to key_col); quote
-- grants clients UPDATE only on its content columns.
create table tests.tenant_table (name text primary key, key_col text not null, updatable boolean not null, update_col text);
insert into tests.tenant_table (name, key_col, updatable, update_col) values
  ('business', 'id', true, null),
  ('business_member', 'business_id', true, null),
  ('business_settings', 'business_id', true, null),
  ('customer', 'business_id', true, null),
  ('customer_address', 'business_id', true, null),
  ('service_category', 'business_id', true, null),
  ('service', 'business_id', true, null),
  ('quote', 'business_id', true, 'notes'),
  ('quote_item', 'business_id', true, null),
  ('quote_slot_option', 'business_id', true, null),
  ('quote_comment', 'business_id', true, null),
  ('appointment', 'business_id', true, null),
  ('job', 'business_id', true, null),
  ('invoice', 'business_id', true, null),
  ('invoice_item', 'business_id', true, null),
  ('payment', 'business_id', true, null),
  ('notification', 'business_id', true, null),
  ('device', 'business_id', false, null),
  ('notification_preference', 'business_id', true, null),
  ('subscription', 'business_id', false, null),
  ('audit_log', 'business_id', false, null),
  ('file', 'business_id', true, null);

create table tests.ids (name text primary key, id uuid not null);
insert into tests.ids values
  ('business_a', '10000000-0000-4000-a000-000000000001'),
  ('business_b', '10000000-0000-4000-b000-000000000001'),
  ('owner_a', '00000000-0000-4000-a000-000000000001'),
  ('employee_a', '00000000-0000-4000-a000-000000000002'),
  ('owner_b', '00000000-0000-4000-b000-000000000001'),
  ('employee_b', '00000000-0000-4000-b000-000000000002');
create function tests.id(p_name text) returns uuid language sql stable
  as $$ select id from tests.ids where name = p_name $$;

-- Runs p_sql (which must return one bigint) as the given authenticated user,
-- then switches back to the test owner. NULL user = anon.
create function tests.count_as(p_user uuid, p_sql text) returns bigint
language plpgsql as $$
declare
  v_result bigint;
begin
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  perform set_config('request.jwt.claims',
    coalesce(json_build_object('sub', p_user, 'role', 'authenticated')::text, '{"role":"anon"}'), true);
  execute p_sql into v_result;
  reset role;
  return v_result;
end;
$$;

-- Runs p_sql (returning one bigint) as the given user; returns the result as
-- text, or 'ERROR <sqlstate>' when the statement is refused.
create function tests.result_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
begin
  return tests.count_as(p_user, p_sql)::text;
exception when others then
  reset role;
  return 'ERROR ' || sqlstate;
end;
$$;

-- Runs p_sql as the given user and returns the SQLSTATE it fails with (NULL on success).
create function tests.error_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
begin
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute p_sql;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return null;
end;
$$;

-- One existing business B row per table, captured as the test owner, used as
-- the payload of the cross-tenant INSERT attempts.
create table tests.b_row (name text primary key, data jsonb);

do $$
declare
  t record;
  v_row jsonb;
begin
  for t in select * from tests.tenant_table loop
    execute format('select to_jsonb(x) from public.%I x where %I = $1 limit 1', t.name, t.key_col)
      into v_row using tests.id('business_b');
    -- New primary key so the attempt is a genuine new row.
    if v_row ? 'id' then
      v_row := v_row || jsonb_build_object('id', gen_random_uuid());
    end if;
    -- The membership attack: A tries to add themselves to B.
    if t.name = 'business_member' then
      v_row := v_row || jsonb_build_object('user_id', tests.id('owner_a'), 'role', 'OWNER');
    end if;
    insert into tests.b_row values (t.name, v_row);
  end loop;
end;
$$;

grant usage on schema tests to anon, authenticated;
grant select on all tables in schema tests to anon, authenticated;

select plan(
  (select count(*)::int * 5 from tests.tenant_table)
  + (select count(*)::int from tests.tenant_table where updatable)
  + 6
);

-- The list above must cover every public table that has a business_id column.
select set_eq(
  $$ select name from tests.tenant_table where name <> 'business' $$,
  $$ select c.table_name::text from information_schema.columns c
     join information_schema.tables t using (table_schema, table_name)
     where c.table_schema = 'public' and c.column_name = 'business_id' and t.table_type = 'BASE TABLE' $$,
  'tenant table list covers every public table with business_id'
);

-- Precondition: the seed has business B rows in every table, so "0 rows" below is meaningful.
select ok(
  (select r.data is not null from tests.b_row r where r.name = t.name),
  format('%s: seed has a business B row', t.name)
) from tests.tenant_table t order by t.name;

-- Positive control: A's owner sees A's own rows.
select cmp_ok(
  tests.count_as(tests.id('owner_a'),
    format('select count(*) from public.%I where %I = %L', t.name, t.key_col, tests.id('business_a'))),
  '>', 0::bigint,
  format('%s: owner of A can select A rows', t.name)
) from tests.tenant_table t order by t.name;

-- A cannot SELECT B rows.
select is(
  tests.count_as(tests.id('owner_a'),
    format('select count(*) from public.%I where %I = %L', t.name, t.key_col, tests.id('business_b'))),
  0::bigint,
  format('%s: owner of A cannot select B rows', t.name)
) from tests.tenant_table t order by t.name;

-- A cannot INSERT rows into B (RLS rejects with 42501 before any constraint check).
select is(
  tests.error_as(tests.id('owner_a'),
    format('insert into public.%I select * from jsonb_populate_record(null::public.%I, %L::jsonb)',
           t.name, t.name, (select data from tests.b_row r where r.name = t.name))),
  '42501',
  format('%s: owner of A cannot insert into B', t.name)
) from tests.tenant_table t order by t.name;

-- A cannot UPDATE B rows: RLS hides them, so nothing is touched. audit_log
-- has no UPDATE privilege at all, so the statement itself is refused.
select is(
  tests.result_as(tests.id('owner_a'),
    format('with u as (update public.%1$I set %4$I = %4$I where %2$I = %3$L returning 1) select count(*) from u',
           t.name, t.key_col, tests.id('business_b'), coalesce(t.update_col, t.key_col))),
  case when t.name = 'audit_log' then 'ERROR 42501' else '0' end,
  format('%s: owner of A cannot update B rows', t.name)
) from tests.tenant_table t order by t.name;

-- Positive control: the same UPDATE works on A's own rows.
select cmp_ok(
  tests.count_as(tests.id('owner_a'),
    format('with u as (update public.%1$I set %4$I = %4$I where %2$I = %3$L returning 1) select count(*) from u',
           t.name, t.key_col, tests.id('business_a'), coalesce(t.update_col, t.key_col))),
  '>', 0::bigint,
  format('%s: owner of A can update A rows', t.name)
) from tests.tenant_table t where t.updatable order by t.name;

-- user_profile is not a business table: teammates are visible, other tenants are not.
select is(
  tests.count_as(tests.id('owner_a'),
    format('select count(*) from public.user_profile where id = %L', tests.id('employee_a'))),
  1::bigint, 'user_profile: owner of A sees a teammate''s profile');
select is(
  tests.count_as(tests.id('owner_a'),
    format('select count(*) from public.user_profile where id in (%L, %L)', tests.id('owner_b'), tests.id('employee_b'))),
  0::bigint, 'user_profile: owner of A cannot select B members'' profiles');
select is(
  tests.count_as(tests.id('owner_a'),
    format('with u as (update public.user_profile set full_name = %L where id = %L returning 1) select count(*) from u',
           'hacked', tests.id('owner_b'))),
  0::bigint, 'user_profile: owner of A cannot update a B member''s profile');
select is(
  tests.error_as(tests.id('owner_a'),
    format('insert into public.user_profile (id, full_name) values (%L, %L)', gen_random_uuid(), 'someone else')),
  '42501', 'user_profile: a user cannot create a profile for someone else');

-- anon sees nothing in any table.
select is(
  (select sum(tests.count_as(null, format('select count(*) from public.%I', t.name)))
   from tests.tenant_table t),
  0::numeric, 'anon cannot select rows from any business table');

select * from finish();
rollback;
