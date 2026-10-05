-- Jobs: one per approved quote however it was approved (customer link, owner
-- records it, "create job"), visits booked by the owner or the customer, the
-- job state machine, and the action queue. Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers/flow.psql
select plan(55);

create temp table t as select
  '2031-03-03 09:00 Asia/Jerusalem'::timestamptz as d1_9,
  '2031-03-03 11:00 Asia/Jerusalem'::timestamptz as d1_11,
  '2031-03-03 10:00 Asia/Jerusalem'::timestamptz as d1_10,
  '2031-03-03 12:00 Asia/Jerusalem'::timestamptz as d1_12,
  '2031-03-04 09:00 Asia/Jerusalem'::timestamptz as d2_9,
  '2031-03-04 11:00 Asia/Jerusalem'::timestamptz as d2_11;
grant select on t to authenticated;

create temp table q (name text primary key, id uuid, token text);
grant select on q to authenticated;
create function pg_temp.q(p_name text) returns uuid language sql as $$ select id from q where name = p_name $$;
create function pg_temp.token(p_name text) returns text language sql as $$ select token from q where name = p_name $$;

-- Kinds the row about p_quote has in the owner of A's action queue, with its job.
create function pg_temp.queue(p_id uuid) returns text[] language plpgsql as $$
declare
  v text[];
begin
  perform flow.as_user(flow.owner_a());
  select coalesce(array_agg(x.kind || ':' || coalesce(x.job_id::text, '-') order by x.kind), '{}') into v
  from public.action_queue(flow.business_a()) x where x.id = p_id;
  reset role;
  return v;
end;
$$;

-- ---------------------------------------------------------------- the customer approves on the link
insert into q select 'portal', d, flow.send(flow.owner_a(), d) from flow.draft(flow.owner_a(), flow.business_a(), 'החלפת לוח') d;
select is(flow.job_of(pg_temp.q('portal')), null, 'a sent quote has no job');

select flow.as_user(flow.owner_a());
select throws_ok($$ select public.create_job_for_quote(pg_temp.q('portal')) $$,
  '55000', 'only approved quotes become jobs', 'a quote that is not approved cannot become a job');
reset role;

select flow.approve(pg_temp.token('portal'));
select results_eq(
  $$ select j.status::text, j.title, j.customer_id = q.customer_id, j.business_id
     from public.job j join public.quote q on q.id = j.quote_id where j.quote_id = pg_temp.q('portal') $$,
  $$ values ('pending_schedule', 'החלפת לוח', true, flow.business_a()) $$,
  'approving on the link creates the job (PENDING_SCHEDULE), with the quote''s customer and title');
select is((select approval_method from public.quote where id = pg_temp.q('portal')), 'portal',
  'the approval is recorded as given on the link');
select is((select (flow.approve(pg_temp.token('portal')) ->> 'already')::boolean), true,
  'approving again is a repeat');
select is((select count(*) from public.job where quote_id = pg_temp.q('portal')), 1::bigint,
  'a repeated approval creates no second job');

select flow.as_user(flow.owner_a());
select is(public.create_job_for_quote(pg_temp.q('portal')), flow.job_of(pg_temp.q('portal')),
  'create_job_for_quote returns the existing job');
reset role;
select flow.as_user(flow.owner_b());
select throws_ok($$ select public.create_job_for_quote(pg_temp.q('portal')) $$,
  '42501', null, 'a member of another business cannot create the job');
reset role;

select is(pg_temp.queue(pg_temp.q('portal')),
  array['approved_unscheduled:' || flow.job_of(pg_temp.q('portal'))],
  'the approved quote waits to be scheduled, pointing at its job');

-- ---------------------------------------------------------------- the owner records an approval
insert into q select 'phone', d, flow.send(flow.owner_a(), d) from flow.draft(flow.owner_a(), flow.business_a(), 'תאורה') d;

select flow.as_user(flow.employee_a());
select throws_ok($$ select public.mark_quote_approved(pg_temp.q('phone'), 'fax') $$,
  '22023', null, 'the approval method must be phone, WhatsApp or in person');
select throws_ok($$ select public.mark_quote_approved(pg_temp.q('phone'), 'phone', repeat('א', 501)) $$,
  '22023', null, 'the note is at most 500 characters');
select lives_ok($$ select public.mark_quote_approved(pg_temp.q('phone'), 'phone', '  אישר בטלפון  ') $$,
  'a member marks a sent quote approved');
reset role;

select results_eq(
  $$ select status::text, approval_method, approval_note, approved_at is not null, approved_name
     from public.quote where id = pg_temp.q('phone') $$,
  $$ values ('approved', 'phone', 'אישר בטלפון', true, null::text) $$,
  'APPROVED, with the method and the trimmed note');
select results_eq(
  $$ select actor_user_id, new_data ->> 'status', new_data ->> 'method', old_data ->> 'status'
     from public.audit_log where table_name = 'quote' and record_id = pg_temp.q('phone')
       and new_data ->> 'status' = 'approved' $$,
  $$ values (flow.employee_a(), 'approved', 'phone', 'sent') $$,
  'the audit log records who approved it, how, and from what');
select is((select status::text from public.job where quote_id = pg_temp.q('phone')), 'pending_schedule',
  'marking approved creates the job');

select flow.as_user(flow.owner_a());
select is(public.mark_quote_approved(pg_temp.q('phone'), 'whatsapp'), flow.job_of(pg_temp.q('phone')),
  'marking it approved again returns the same job');
select throws_ok($$ select public.mark_quote_approved(flow.draft(flow.owner_a(), flow.business_a()), 'phone') $$,
  '55000', null, 'a draft cannot be marked approved');
reset role;
select is((select approval_method from public.quote where id = pg_temp.q('phone')), 'phone',
  'the repeat changes nothing');

insert into q select 'viewed', d, flow.send(flow.owner_a(), d) from flow.draft(flow.owner_a(), flow.business_a(), 'שקעים') d;
select public.public_quote_open(pg_temp.token('viewed'), null);
select flow.as_user(flow.owner_b());
select throws_ok($$ select public.mark_quote_approved(pg_temp.q('viewed'), 'in_person') $$,
  '42501', null, 'a member of another business cannot mark it approved');
reset role;
select flow.as_user(flow.owner_a());
select lives_ok($$ select public.mark_quote_approved(pg_temp.q('viewed'), 'in_person') $$,
  'a viewed quote can be marked approved in person');
reset role;

-- ---------------------------------------------------------------- the owner sets the visit
select throws_ok($$ select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('portal')), d1_11, d1_9) from t $$,
  '22007', null, 'a visit must end after it starts');
select throws_ok($$ select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('portal')), d1_9, d1_9 + interval '13 hours') from t $$,
  '22007', null, 'a visit is at most 12 hours');
select throws_ok($$ select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('portal')), now() - interval '1 hour', now() + interval '1 hour') $$,
  '22007', null, 'a visit cannot start in the past');
select throws_ok($$ select flow.schedule(flow.owner_b(), flow.job_of(pg_temp.q('portal')), d1_9, d1_11) from t $$,
  '42501', null, 'a member of another business cannot schedule the job');

select lives_ok($$ select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('portal')), d1_9, d1_11) from t $$,
  'the owner sets a visit');
select results_eq(
  $$ select a.status::text, a.quote_id, a.customer_id = j.customer_id, j.status::text
     from public.appointment a join public.job j on j.id = a.job_id where j.quote_id = pg_temp.q('portal') $$,
  $$ values ('confirmed', pg_temp.q('portal'), true, 'scheduled') $$,
  'a CONFIRMED visit of the job; the job is SCHEDULED');
select throws_ok($$ select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('portal')), d2_9, d2_11) from t $$,
  '23505', null, 'a scheduled job refuses a second visit');
select throws_ok($$ select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('phone')), d1_10, d1_12) from t $$,
  '23P01', null, 'a visit overlapping another confirmed visit is a conflict');
select is((select status::text from public.job where quote_id = pg_temp.q('phone')), 'pending_schedule',
  'after a conflict the job still waits for a visit');
select is(pg_temp.queue(pg_temp.q('portal')), '{}'::text[], 'a scheduled job leaves the queue');

-- ---------------------------------------------------------------- the customer books a proposed time
insert into q
select 'slots', d, flow.send(flow.owner_a(), d, jsonb_build_array(
  jsonb_build_object('starts_at', d2_9, 'ends_at', d2_11),
  jsonb_build_object('starts_at', d2_9 + interval '1 day', 'ends_at', d2_11 + interval '1 day')))
from flow.draft(flow.owner_a(), flow.business_a(), 'מזגן') d, t;
select flow.approve(pg_temp.token('slots'));
select lives_ok(
  $$ select public.public_quote_schedule(pg_temp.token('slots'),
       (select id from public.quote_slot_option where quote_id = pg_temp.q('slots') and sort_order = 0), null) $$,
  'the customer books a proposed time');
select results_eq(
  $$ select a.job_id, j.status::text from public.appointment a join public.job j on j.id = a.job_id
     where a.quote_id = pg_temp.q('slots') $$,
  $$ values (flow.job_of(pg_temp.q('slots')), 'scheduled') $$,
  'the booked visit belongs to the quote''s job, which is SCHEDULED');
select throws_ok($$ select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('slots')), d1_9 + interval '3 days', d1_11 + interval '3 days') from t $$,
  '23505', null, 'the owner cannot add a second visit to a job the customer booked');

-- The owner schedules a job whose quote offered times: the customer can no longer pick one.
insert into q
select 'offered', d, flow.send(flow.owner_a(), d, jsonb_build_array(
  jsonb_build_object('starts_at', d1_9 + interval '7 days', 'ends_at', d1_11 + interval '7 days'),
  jsonb_build_object('starts_at', d1_9 + interval '8 days', 'ends_at', d1_11 + interval '8 days')))
from flow.draft(flow.owner_a(), flow.business_a(), 'גנרטור') d, t;
select flow.approve(pg_temp.token('offered'));
select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('offered')), d1_9 + interval '9 days', d1_11 + interval '9 days') from t;
select is((select array_agg(distinct status::text) from public.quote_slot_option where quote_id = pg_temp.q('offered')),
  '{declined}'::text[], 'times the customer did not pick are declined');
select throws_ok(
  $$ select public.public_quote_schedule(pg_temp.token('offered'),
       (select id from public.quote_slot_option where quote_id = pg_temp.q('offered') and sort_order = 0), null) $$,
  '23505', null, 'the customer cannot book a job the owner already scheduled');
select is((select public.public_quote_open(pg_temp.token('offered'), null) #>> '{appointment,starts_at}')::timestamptz,
  (select d1_9 + interval '9 days' from t), 'the customer''s page shows the visit the owner set');

-- ---------------------------------------------------------------- start, complete, cancel
select throws_ok($$ select flow.move_job(flow.owner_a(), flow.job_of(pg_temp.q('portal')), 'complete') $$,
  '55000', null, 'a job that was not started cannot be completed');
select throws_ok($$ select flow.move_job(flow.owner_a(), flow.job_of(pg_temp.q('portal')), 'finish') $$,
  '22023', null, 'unknown actions are rejected');
select is(flow.move_job(flow.employee_a(), flow.job_of(pg_temp.q('portal')), 'start'), 'in_progress'::public.job_status,
  'start: IN_PROGRESS');
select is((select started_at is not null from public.job where quote_id = pg_temp.q('portal')), true, 'start time recorded');
select is(flow.move_job(flow.owner_a(), flow.job_of(pg_temp.q('portal')), 'start'), 'in_progress'::public.job_status,
  'starting again is harmless');
select is(flow.move_job(flow.owner_a(), flow.job_of(pg_temp.q('portal')), 'complete'), 'completed'::public.job_status,
  'complete: COMPLETED');
select results_eq(
  $$ select j.completed_at is not null, a.status::text from public.job j join public.appointment a on a.job_id = j.id
     where j.quote_id = pg_temp.q('portal') $$,
  $$ values (true, 'completed') $$, 'completion time recorded and the visit marked completed');
select throws_ok($$ select flow.move_job(flow.owner_a(), flow.job_of(pg_temp.q('portal')), 'cancel') $$,
  '55000', null, 'a completed job cannot be cancelled');
select is(pg_temp.queue(flow.job_of(pg_temp.q('portal'))),
  array['completed_uninvoiced:' || flow.job_of(pg_temp.q('portal'))], 'a completed job waits for an invoice');

select is(flow.move_job(flow.owner_a(), flow.job_of(pg_temp.q('slots')), 'cancel'), 'cancelled'::public.job_status,
  'cancel: CANCELLED');
select is((select status::text from public.appointment where job_id = flow.job_of(pg_temp.q('slots'))), 'cancelled',
  'cancelling a job cancels its visit');
select lives_ok($$ select flow.schedule(flow.owner_a(), flow.job_of(pg_temp.q('viewed')), d2_9, d2_11) from t $$,
  'the cancelled visit''s time is free again');
select throws_ok($$ select flow.move_job(flow.owner_a(), flow.job_of(pg_temp.q('slots')), 'start') $$,
  '55000', null, 'a cancelled job cannot be started');

-- ---------------------------------------------------------------- no direct writes
select flow.as_user(flow.owner_a());
select throws_ok($$ update public.job set status = 'completed' where business_id = flow.business_a() $$,
  '42501', null, 'clients cannot update jobs directly');
select throws_ok($$ insert into public.job (business_id, customer_id, title)
                    values (flow.business_a(), flow.customer_of(flow.business_a()), 'x') $$,
  '42501', null, 'clients cannot insert jobs directly');
select throws_ok($$ insert into public.appointment (business_id, customer_id, job_id, status, starts_at, ends_at)
                    select flow.business_a(), flow.customer_of(flow.business_a()), flow.job_of(pg_temp.q('phone')),
                           'confirmed', d2_9 + interval '20 days', d2_11 + interval '20 days' from t $$,
  '42501', null, 'clients cannot create visits directly');
reset role;
select throws_ok($$ insert into public.appointment (business_id, customer_id, status, starts_at, ends_at)
                    select flow.business_a(), flow.customer_of(flow.business_a()), 'confirmed',
                           d2_9 + interval '30 days', d2_11 + interval '30 days' from t $$,
  '23514', null, 'every new visit belongs to a job');

-- ---------------------------------------------------------------- backfill
-- An approved quote left without a job (as before this stage) gets one, and
-- the visit already booked for it moves to the job.
insert into q select 'legacy', flow.approved_quote(flow.owner_b(), flow.business_b(), 'ישן'), null;
update public.job set deleted_at = now() where quote_id = pg_temp.q('legacy');
select is(app.ensure_job_for_quote(pg_temp.q('legacy'), null) is not null, true,
  'the backfill creates a job for an approved quote without one');
select is((select count(*) from public.job where quote_id = pg_temp.q('legacy') and deleted_at is null), 1::bigint,
  'exactly one live job');

select * from finish();
rollback;
