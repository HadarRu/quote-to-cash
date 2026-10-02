-- Confirmed appointments of the same business cannot overlap
-- (exclusion constraint appointment_no_overlapping_confirmed). Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- Fixed window far from the seed's appointments: 2030-01-01 10:00-12:00 Asia/Jerusalem.
create temp table ctx as
select
  '10000000-0000-4000-a000-000000000001'::uuid as business_a,
  '10000000-0000-4000-b000-000000000001'::uuid as business_b,
  (select id from public.customer where business_id = '10000000-0000-4000-a000-000000000001') as customer_a,
  (select id from public.customer where business_id = '10000000-0000-4000-b000-000000000001') as customer_b,
  '2030-01-01 10:00 Asia/Jerusalem'::timestamptz as t10,
  '2030-01-01 11:00 Asia/Jerusalem'::timestamptz as t11,
  '2030-01-01 12:00 Asia/Jerusalem'::timestamptz as t12,
  '2030-01-01 13:00 Asia/Jerusalem'::timestamptz as t13;

insert into public.appointment (id, business_id, customer_id, status, starts_at, ends_at)
select '20000000-0000-4000-a000-000000000001', business_a, customer_a, 'confirmed', t10, t12 from ctx;

select throws_ok(
  $$ insert into public.appointment (business_id, customer_id, status, starts_at, ends_at)
     select business_a, customer_a, 'confirmed', t11, t13 from ctx $$,
  '23P01', null,
  'overlapping confirmed appointments in the same business are rejected'
);

select throws_ok(
  $$ insert into public.appointment (business_id, customer_id, status, starts_at, ends_at)
     select business_a, customer_a, 'confirmed', t10, t12 from ctx $$,
  '23P01', null,
  'an identical confirmed time range in the same business is rejected'
);

select lives_ok(
  $$ insert into public.appointment (business_id, customer_id, status, starts_at, ends_at)
     select business_a, customer_a, 'confirmed', t12, t13 from ctx $$,
  'back-to-back confirmed appointments are allowed (ranges are half-open)'
);

select lives_ok(
  $$ insert into public.appointment (id, business_id, customer_id, status, starts_at, ends_at)
     select '20000000-0000-4000-a000-000000000002', business_a, customer_a, 'proposed', t11, t13 from ctx $$,
  'a proposed appointment may overlap a confirmed one'
);

select throws_ok(
  $$ update public.appointment set status = 'confirmed'
     where id = '20000000-0000-4000-a000-000000000002' $$,
  '23P01', null,
  'confirming an overlapping proposed appointment is rejected'
);

select lives_ok(
  $$ insert into public.appointment (business_id, customer_id, status, starts_at, ends_at)
     select business_b, customer_b, 'confirmed', t10, t12 from ctx $$,
  'another business may have a confirmed appointment at the same time'
);

select lives_ok(
  $$ update public.appointment set status = 'cancelled'
     where id = '20000000-0000-4000-a000-000000000001';
     insert into public.appointment (business_id, customer_id, status, starts_at, ends_at)
     select business_a, customer_a, 'confirmed', t10, t11 from ctx $$,
  'cancelling a confirmed appointment frees its time'
);

select lives_ok(
  $$ update public.appointment set deleted_at = now()
     where business_id = (select business_a from ctx) and status = 'confirmed' and starts_at = (select t10 from ctx);
     insert into public.appointment (business_id, customer_id, status, starts_at, ends_at)
     select business_a, customer_a, 'confirmed', t10, t11 from ctx $$,
  'a soft-deleted confirmed appointment no longer blocks its time'
);

select * from finish();
rollback;
