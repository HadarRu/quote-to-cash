-- Scheduling from a quote: send_quote stores 2-3 proposed times, the page
-- lists them, and after approval the customer books one as a CONFIRMED
-- appointment; a time that overlaps another confirmed visit is refused
-- (23P01, the exclusion constraint). Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create temp table ids as select
  '10000000-0000-4000-a000-000000000001'::uuid as business_a,
  '00000000-0000-4000-a000-000000000001'::uuid as owner_a,
  (select id from public.customer where business_id = '10000000-0000-4000-a000-000000000001') as customer_a,
  '74000000-0000-4000-a000-000000000001'::uuid as q1,
  '74000000-0000-4000-a000-000000000002'::uuid as q2,
  '74000000-0000-4000-a000-000000000003'::uuid as q3,
  -- Far from the seed's appointments (Asia/Jerusalem wall-clock times).
  '2031-03-03 08:00 Asia/Jerusalem'::timestamptz as t08,
  '2031-03-03 10:00 Asia/Jerusalem'::timestamptz as t10,
  '2031-03-03 12:00 Asia/Jerusalem'::timestamptz as t12,
  '2031-03-04 08:00 Asia/Jerusalem'::timestamptz as d2;
grant select on ids to authenticated, service_role;

create function pg_temp.hash(p_token text) returns text language sql as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;

create function pg_temp.slot(p_starts timestamptz, p_hours integer) returns jsonb language sql as $$
  select jsonb_build_object('starts_at', p_starts, 'ends_at', p_starts + make_interval(hours => p_hours))
$$;

-- A draft with one line, saved by the owner.
create function pg_temp.draft(p_id uuid) returns void language plpgsql as $$
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
end;
$$;

-- Sends the draft with link token `p_token` and the proposed times `p_slots`.
create function pg_temp.send(p_id uuid, p_token text, p_slots jsonb) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.send_quote((select owner_a from ids), p_id, gen_random_uuid(), pg_temp.hash(p_token),
    now() + interval '14 days',
    '{"subtotal_minor": 10000, "discount_minor": 0, "vat_rate_bp": 1800, "vat_minor": 1800, "total_minor": 11800}',
    '{"business": {"name": "כהן חשמל"}, "items": []}', p_slots);
  reset role;
end;
$$;

select pg_temp.draft((select q1 from ids));
select pg_temp.draft((select q2 from ids));
select pg_temp.draft((select q3 from ids));

-- ---------------------------------------------------------------- proposing times
select throws_ok(
  $$ select pg_temp.send((select q1 from ids), 'sched-one', jsonb_build_array(pg_temp.slot((select t08 from ids), 2))) $$,
  '22007', null, 'one proposed time is not enough');
select throws_ok(
  $$ select pg_temp.send((select q1 from ids), 'sched-one', jsonb_build_array(
       pg_temp.slot((select t08 from ids), 2), pg_temp.slot((select t10 from ids), 2),
       pg_temp.slot((select t12 from ids), 2), pg_temp.slot((select d2 from ids), 2))) $$,
  '22007', null, 'four proposed times are too many');
select throws_ok(
  $$ select pg_temp.send((select q1 from ids), 'sched-one', jsonb_build_array(
       pg_temp.slot(now() - interval '1 hour', 2), pg_temp.slot((select t10 from ids), 2))) $$,
  '22007', null, 'a proposed time in the past is refused');
select throws_ok(
  $$ select pg_temp.send((select q1 from ids), 'sched-one', jsonb_build_array(
       pg_temp.slot((select t08 from ids), 13), pg_temp.slot((select t10 from ids), 2))) $$,
  '22007', null, 'a proposed visit longer than 12 hours is refused');
select is((select status::text from public.quote where id = (select q1 from ids)), 'draft',
  'a refused send leaves the quote a draft');

select lives_ok(
  $$ select pg_temp.send((select q1 from ids), 'sched-one', jsonb_build_array(
       pg_temp.slot((select t08 from ids), 2), pg_temp.slot((select t12 from ids), 2),
       pg_temp.slot((select d2 from ids), 3))) $$,
  'the owner sends the quote with three proposed times');
select results_eq(
  $$ select status::text, sort_order::int from public.quote_slot_option
     where quote_id = (select q1 from ids) and deleted_at is null order by sort_order $$,
  $$ values ('offered', 0), ('offered', 1), ('offered', 2) $$,
  'they are stored as offered, in order');
select lives_ok(
  $$ select pg_temp.send((select q3 from ids), 'sched-three', '[]') $$,
  'a quote can still be sent without proposed times');

-- ---------------------------------------------------------------- the page
set local role service_role;
create temp table v1 as select public.public_quote_open(pg_temp.hash('sched-one'), null) as view;
select is(jsonb_array_length((select view -> 'slots' from v1)), 3, 'the page lists the proposed times');
select ok((select bool_and((s ->> 'available')::boolean) from v1, jsonb_array_elements(view -> 'slots') s),
  'all of them free');
select is((select view -> 'appointment' from v1), 'null'::jsonb, 'nothing is booked yet');
select is(jsonb_array_length(public.public_quote_open(pg_temp.hash('sched-three'), null) -> 'slots'), 0,
  'a quote without proposed times lists none');

-- ---------------------------------------------------------------- booking
create temp table slots as
select id, sort_order from public.quote_slot_option where quote_id = (select q1 from ids) and deleted_at is null;
grant select on slots to service_role;

select throws_ok(
  $$ select public.public_quote_schedule(pg_temp.hash('sched-one'), (select id from slots where sort_order = 0), null) $$,
  '55000', null, 'a time cannot be booked before the quote is approved');
reset role;
set local role anon;
select throws_ok($$ select public.public_quote_schedule(pg_temp.hash('sched-one'), gen_random_uuid(), null) $$,
  '42501', null, 'anon cannot book directly');
reset role;
set local role service_role;
select public.public_quote_respond(pg_temp.hash('sched-one'), 'approve', 'דנה לוי', null, null);

select is(public.public_quote_schedule(pg_temp.hash('no-such-token'), gen_random_uuid(), null), null,
  'an unknown token finds nothing');
select throws_ok(
  $$ select public.public_quote_schedule(pg_temp.hash('sched-one'), gen_random_uuid(), null) $$,
  '22023', null, 'a time that is not one of the quote''s is refused');
select is(
  public.public_quote_schedule(pg_temp.hash('sched-one'), (select id from slots where sort_order = 0), '203.0.113.7')
    -> 'appointment' ->> 'slot_id',
  (select id::text from slots where sort_order = 0), 'the customer books a proposed time');
reset role;
select results_eq(
  $$ select status::text, starts_at = (select t08 from ids), customer_id = (select customer_a from ids)
     from public.appointment where quote_id = (select q1 from ids) $$,
  $$ values ('confirmed', true, true) $$,
  'as a confirmed appointment for the quote''s customer');
select results_eq(
  $$ select status::text from public.quote_slot_option
     where quote_id = (select q1 from ids) and deleted_at is null order by sort_order $$,
  $$ values ('selected'), ('declined'), ('declined') $$,
  'the chosen time is selected, the others declined');
set local role service_role;
select is(
  public.public_quote_schedule(pg_temp.hash('sched-one'), (select id from slots where sort_order = 0), null) ->> 'already',
  'true', 'booking the same time again is harmless');
select throws_ok(
  $$ select public.public_quote_schedule(pg_temp.hash('sched-one'), (select id from slots where sort_order = 1), null) $$,
  '23505', null, 'once booked, another time is refused');

-- ---------------------------------------------------------------- conflicts
-- q2 proposes 09:00-11:00 (overlaps q1's booked 08:00-10:00) and 10:00-12:00 (free).
reset role;
select pg_temp.send((select q2 from ids), 'sched-two', jsonb_build_array(
  pg_temp.slot((select t08 from ids) + interval '1 hour', 2), pg_temp.slot((select t10 from ids), 2)));
set local role service_role;
select public.public_quote_respond(pg_temp.hash('sched-two'), 'approve', 'משה כהן', null, null);
select results_eq(
  $$ select (s ->> 'available')::boolean from jsonb_array_elements(
       public.public_quote_open(pg_temp.hash('sched-two'), null) -> 'slots') s $$,
  $$ values (false), (true) $$,
  'a proposed time that overlaps a booked visit shows as taken');
select throws_ok(
  $$ select public.public_quote_schedule(pg_temp.hash('sched-two'),
       (select id from public.quote_slot_option where quote_id = (select q2 from ids) and sort_order = 0), null) $$,
  '23P01', null, 'booking it conflicts');
select lives_ok(
  $$ select public.public_quote_schedule(pg_temp.hash('sched-two'),
       (select id from public.quote_slot_option where quote_id = (select q2 from ids) and sort_order = 1), null) $$,
  'the back-to-back time is booked');

reset role;
select * from finish();
rollback;
