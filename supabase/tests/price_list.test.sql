-- Price list: price and unit rules, idempotent starter import, and soft delete
-- leaving quote snapshots untouched. Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers/flow.psql
select plan(12);

-- A sent quote of business A with a line from the seeded service.
select flow.send(flow.owner_a(), flow.draft(flow.owner_a(), flow.business_a(), p_service =>
  (select id from public.service where business_id = flow.business_a() and name = 'התקנת שקע')));

-- A small list in the same shape as packages/types/src/starter-price-lists/*.json.
create temp table starter as select '{
  "version": 1, "trade": "electrician",
  "categories": [
    { "key": "t.points", "name": "נקודות", "services": [
      { "key": "t.points.new", "name": "נקודת חשמל", "unit": "point", "price_minor": 25000, "vat_included": false },
      { "key": "t.points.usb", "name": "שקע USB", "unit": "unit", "price_minor": 15000, "vat_included": true } ] },
    { "key": "t.repairs", "name": "תיקונים", "services": [
      { "key": "t.repairs.hour", "name": "שעת עבודה", "unit": "hour", "price_minor": 20000, "vat_included": false } ] }
  ]}'::jsonb as list;
grant select on starter to authenticated, anon;

-- Owner of business A.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.service (business_id, name, unit, default_price_minor)
     values ('10000000-0000-4000-a000-000000000001', 'מחיר שלילי', 'unit', -1) $$,
  '23514', null,
  'a negative price is rejected'
);

select throws_ok(
  $$ insert into public.service (business_id, name, unit, default_price_minor)
     values ('10000000-0000-4000-a000-000000000001', 'יחידה לא מוכרת', 'box', 100) $$,
  '23514', null,
  'units must be one of the known codes'
);

select is(
  public.import_starter_price_list('10000000-0000-4000-a000-000000000001', (select list from starter)),
  3,
  'the first import adds every starter service'
);

select is(
  public.import_starter_price_list('10000000-0000-4000-a000-000000000001', (select list from starter)),
  0,
  'importing again adds nothing'
);

select results_eq(
  $$ select (select count(*) from public.service_category where starter_key like 't.%'),
            (select count(*) from public.service where starter_key like 't.%') $$,
  $$ values (2::bigint, 3::bigint) $$,
  'the import is idempotent: still 2 categories and 3 services'
);

-- The user edits a price and deletes another starter service; a re-import keeps both changes.
update public.service set default_price_minor = 27500 where starter_key = 't.points.new';
update public.service set deleted_at = now() where starter_key = 't.points.usb';
select public.import_starter_price_list('10000000-0000-4000-a000-000000000001', (select list from starter));

select results_eq(
  $$ select default_price_minor, (select deleted_at is not null from public.service where starter_key = 't.points.usb')
     from public.service where starter_key = 't.points.new' $$,
  $$ values (27500::bigint, true) $$,
  'a re-import neither overwrites edited prices nor restores deleted services'
);

select results_eq(
  $$ select c.name, s.unit, s.vat_included from public.service s
     join public.service_category c on c.id = s.category_id
     where s.starter_key = 't.repairs.hour' $$,
  $$ values ('תיקונים', 'hour', false) $$,
  'imported services keep their category, unit and VAT flag'
);

-- Soft-deleting a service that a quote uses leaves the quote line exactly as it was.
create temp table before_delete as
select qi.id, qi.description, qi.unit, qi.quantity, qi.unit_price_minor, qi.line_total_minor, q.total_minor
from public.quote_item qi join public.quote q on q.id = qi.quote_id
where qi.business_id = '10000000-0000-4000-a000-000000000001' and qi.service_id is not null;

select is((select count(*) from before_delete), 1::bigint, 'precondition: the quote has one line from a service');

update public.service set deleted_at = now()
where business_id = '10000000-0000-4000-a000-000000000001' and name = 'התקנת שקע';

select results_eq(
  $$ select qi.id, qi.description, qi.unit, qi.quantity, qi.unit_price_minor, qi.line_total_minor, q.total_minor
     from public.quote_item qi join public.quote q on q.id = qi.quote_id
     where qi.business_id = '10000000-0000-4000-a000-000000000001' and qi.service_id is not null $$,
  $$ select * from before_delete $$,
  'deleting a service does not alter the quote_item snapshot or the quote total'
);

select throws_ok(
  $$ delete from public.service where business_id = '10000000-0000-4000-a000-000000000001' $$,
  '42501', null,
  'services cannot be hard-deleted through the API'
);

-- Owner of business B cannot import into business A.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-b000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.import_starter_price_list('10000000-0000-4000-a000-000000000001', (select list from starter)) $$,
  '42501', null,
  'a non-member cannot import into another business'
);

reset role;
set local role anon;
select throws_ok(
  $$ select public.import_starter_price_list('10000000-0000-4000-a000-000000000001', (select list from starter)) $$,
  '42501', null,
  'anon cannot import'
);

reset role;
select * from finish();
rollback;
