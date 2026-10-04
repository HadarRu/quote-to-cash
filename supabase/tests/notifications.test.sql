-- Notifications: device registration, preferences, push events from quotes,
-- appointments, jobs, invoices and payments, reminders, delivery bookkeeping,
-- analytics events and the action queue as items progress. Relies on supabase/seed.sql
-- (business A: OWNER with a device and quote_viewed pushes turned off, and an EMPLOYEE).
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

create temp table ids as select
  '10000000-0000-4000-a000-000000000001'::uuid as biz,
  '00000000-0000-4000-a000-000000000001'::uuid as owner_a,
  '00000000-0000-4000-a000-000000000002'::uuid as employee_a,
  '00000000-0000-4000-b000-000000000001'::uuid as owner_b,
  (select id from public.business_member
   where business_id = '10000000-0000-4000-a000-000000000001' and role = 'EMPLOYEE') as employee_member,
  (select id from public.customer where business_id = '10000000-0000-4000-a000-000000000001') as customer_a,
  '80000000-0000-4000-a000-000000000001'::uuid as q1,
  '80000000-0000-4000-a000-000000000002'::uuid as appt,
  '80000000-0000-4000-a000-000000000003'::uuid as job,
  '80000000-0000-4000-a000-000000000004'::uuid as invoice;
grant select on ids to authenticated, service_role;

-- Run as an authenticated member (restored by `reset role`).
create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

-- Lists `p_id` appears in, in the owner of A's action queue.
create function pg_temp.queue_kinds(p_id uuid) returns text[] language plpgsql as $$
declare
  v_kinds text[];
begin
  perform pg_temp.as_user((select owner_a from ids));
  select coalesce(array_agg(q.kind order by q.kind), '{}') into v_kinds
  from public.action_queue((select biz from ids)) q where q.id = p_id;
  reset role;
  return v_kinds;
end;
$$;

-- Recipients of queued pushes for an event about an entity (payload key = id).
create function pg_temp.recipients(p_event text, p_key text, p_id uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(n.recipient_user_id order by n.recipient_user_id), '{}')
  from public.notification n
  where n.event::text = p_event and n.payload ->> p_key = p_id::text and n.channel = 'push'
$$;

create function pg_temp.tracked(p_event text, p_key text, p_id uuid) returns bigint language sql as $$
  select count(*) from app.analytics_event e where e.event = p_event and e.properties ->> p_key = p_id::text
$$;

-- ---------------------------------------------------------------- devices
select pg_temp.as_user((select owner_a from ids));
select lives_ok($$ select public.register_device((select biz from ids), 'ExponentPushToken[owner-a-2]', 'android') $$,
  'a member registers a push token');
select lives_ok($$ select public.register_device((select biz from ids), 'ExponentPushToken[owner-a-2]', 'android') $$,
  'registering the same token again is harmless');
select throws_ok($$ select public.register_device((select biz from ids), 'not-a-token', 'ios') $$,
  '23514', null, 'malformed tokens are rejected');
select throws_ok($$ insert into public.device (business_id, user_id, expo_push_token, platform)
                    select biz, owner_a, 'ExponentPushToken[direct]', 'ios' from ids $$,
  '42501', null, 'devices are written only through register_device');
reset role;

select pg_temp.as_user((select owner_b from ids));
select throws_ok($$ select public.register_device((select biz from ids), 'ExponentPushToken[intruder]', 'ios') $$,
  '42501', null, 'a non-member cannot register a device for the business');
reset role;

-- The phone signs in as the employee: the token moves with it.
select pg_temp.as_user((select employee_a from ids));
select public.register_device((select biz from ids), 'ExponentPushToken[owner-a-2]', 'android');
reset role;
select is((select user_id from public.device where expo_push_token = 'ExponentPushToken[owner-a-2]'),
  (select employee_a from ids), 'a token registered by another user moves to that user');

select pg_temp.as_user((select owner_a from ids));
select public.unregister_device('ExponentPushToken[owner-a-2]');
reset role;
select is((select deleted_at from public.device where expo_push_token = 'ExponentPushToken[owner-a-2]'),
  null, 'only the token''s owner can unregister it');

-- ---------------------------------------------------------------- preferences
select pg_temp.as_user((select owner_a from ids));
select lives_ok($$ insert into public.notification_preference (business_id, user_id, event, push_enabled)
                   select biz, owner_a, 'appointment_changed', true from ids $$,
  'a member saves their own preference');
select throws_ok($$ insert into public.notification_preference (business_id, user_id, event, push_enabled)
                    select biz, employee_a, 'quote_approved', false from ids $$,
  '42501', null, 'a member cannot change a teammate''s preferences');
reset role;

-- ---------------------------------------------------------------- quote events and queue
insert into public.quote (id, business_id, customer_id, title)
select q1, biz, customer_a, 'תאורה בגינה' from ids;
select is(pg_temp.tracked('quote_created', 'quote_id', (select q1 from ids)), 1::bigint, 'quote_created is tracked');
select is(pg_temp.queue_kinds((select q1 from ids)), '{}'::text[], 'a draft is not in the queue');

update public.quote set status = 'sent', quote_number = app.take_quote_number(business_id), sent_at = now(),
  token_expires_at = now() + interval '14 days'
where id = (select q1 from ids);
select is(pg_temp.tracked('quote_sent', 'quote_id', (select q1 from ids)), 1::bigint, 'quote_sent is tracked');
select is(pg_temp.queue_kinds((select q1 from ids)), '{quote_unanswered}'::text[],
  'a sent quote waits for an answer');

update public.quote set status = 'viewed', viewed_at = now() where id = (select q1 from ids);
select is(pg_temp.recipients('quote_viewed', 'quote_id', (select q1 from ids)), '{}'::uuid[],
  'quote_viewed: no push for an owner who turned it off');
select is(pg_temp.tracked('quote_viewed', 'quote_id', (select q1 from ids)), 1::bigint, 'quote_viewed is tracked');
select is(pg_temp.queue_kinds((select q1 from ids)), '{quote_unanswered}'::text[], 'a viewed quote still waits');

update public.quote set status = 'approved', approved_at = now(), approved_name = 'משה ישראלי'
where id = (select q1 from ids);
select is(pg_temp.recipients('quote_approved', 'quote_id', (select q1 from ids)),
  array[(select owner_a from ids)], 'quote_approved: pushed to the owner, not the employee');
select is((select payload ->> 'customer_name' from public.notification
           where event = 'quote_approved' and payload ->> 'quote_id' = (select q1 from ids)::text),
  'משה ישראלי', 'the push payload names the customer');
select is(pg_temp.queue_kinds((select q1 from ids)), '{approved_unscheduled}'::text[],
  'an approved quote waits to be scheduled');

update public.quote set status = 'viewed' where id = (select q1 from ids);
update public.quote set status = 'approved' where id = (select q1 from ids);
select is(cardinality(pg_temp.recipients('quote_approved', 'quote_id', (select q1 from ids))), 1,
  'an approval is pushed once');

-- ---------------------------------------------------------------- appointments
insert into public.appointment (id, business_id, customer_id, quote_id, assigned_member_id, status, starts_at, ends_at)
select appt, biz, customer_a, q1, employee_member, 'proposed',
  (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '1 day 13 hours') at time zone 'Asia/Jerusalem',
  (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '1 day 15 hours') at time zone 'Asia/Jerusalem'
from ids;
select is(pg_temp.recipients('appointment_created', 'appointment_id', (select appt from ids)),
  array[(select owner_a from ids), (select employee_a from ids)],
  'appointment_created: pushed to the owner and the assigned member');
select is(pg_temp.tracked('appointment_created', 'appointment_id', (select appt from ids)), 1::bigint,
  'appointment_created is tracked');
select is(pg_temp.queue_kinds((select q1 from ids)), '{}'::text[], 'a scheduled quote leaves the queue');

update public.appointment set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
where id = (select appt from ids);
select is(cardinality(pg_temp.recipients('appointment_changed', 'appointment_id', (select appt from ids))), 2,
  'appointment_changed: moving it is pushed');
update public.appointment set notes = 'להביא סולם' where id = (select appt from ids);
select is(cardinality(pg_temp.recipients('appointment_changed', 'appointment_id', (select appt from ids))), 2,
  'editing notes is not pushed');

-- ---------------------------------------------------------------- reminders (the evening before)
reset role;
set local role service_role;
select is(
  (select public.enqueue_appointment_reminders(
     (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '10 hours') at time zone 'Asia/Jerusalem')),
  0, 'no reminders before the evening');
select public.enqueue_appointment_reminders(
  (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '19 hours') at time zone 'Asia/Jerusalem');
select is(cardinality(pg_temp.recipients('appointment_reminder', 'appointment_id', (select appt from ids))), 2,
  'appointment_reminder: queued the evening before');
select is(
  (select public.enqueue_appointment_reminders(
     (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '20 hours') at time zone 'Asia/Jerusalem')),
  0, 'each appointment is reminded once');
reset role;

-- ---------------------------------------------------------------- jobs and invoices
insert into public.job (id, business_id, customer_id, quote_id, title, status, started_at, completed_at)
select job, biz, customer_a, q1, 'תאורה בגינה', 'completed', now() - interval '2 hours', now() from ids;
select is(pg_temp.tracked('job_completed', 'job_id', (select job from ids)), 1::bigint, 'job_completed is tracked');
select is(pg_temp.queue_kinds((select job from ids)), '{completed_uninvoiced}'::text[],
  'a completed job waits for an invoice');

insert into public.invoice (id, business_id, customer_id, quote_id, job_id, subtotal_minor, vat_rate_bp, vat_minor, total_minor)
select invoice, biz, customer_a, q1, job, 100000, 1800, 18000, 118000 from ids;
select is(pg_temp.tracked('invoice_created', 'invoice_id', (select invoice from ids)), 1::bigint,
  'invoice_created is tracked');
select is(pg_temp.queue_kinds((select job from ids)), '{}'::text[], 'an invoiced job leaves the queue');

-- With the invoicing stage, an issued invoice also carries the external document number.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'invoice' and column_name = 'document_number') then
    execute 'update public.invoice set status = ''issued'', issued_at = now(), document_number = ''INV-1''
             where id = (select invoice from ids)';
  else
    update public.invoice set status = 'issued', issued_at = now() where id = (select invoice from ids);
  end if;
end;
$$;
select is(pg_temp.recipients('invoice_issued', 'invoice_id', (select invoice from ids)),
  array[(select owner_a from ids)], 'invoice_issued: pushed to the owner');
select is(pg_temp.queue_kinds((select invoice from ids)), '{invoice_unpaid}'::text[], 'an issued invoice waits for payment');

insert into public.payment (business_id, invoice_id, amount_minor, method, status, paid_at)
select biz, invoice, 18000, 'bit', 'succeeded', now() from ids;
select is(
  (select array[count(*), max(amount_minor)] from public.notification n
   cross join lateral (select (n.payload ->> 'amount_minor')::bigint as amount_minor) a
   where n.event = 'payment_received' and n.payload ->> 'invoice_id' = (select invoice from ids)::text),
  array[1::bigint, 18000::bigint], 'payment_received: pushed with the amount');
select is(
  (select amount_minor from public.action_queue((select biz from ids)) where id = (select invoice from ids)),
  100000::bigint, 'a partly paid invoice shows the amount still due');
insert into public.payment (business_id, invoice_id, amount_minor, method, status, paid_at)
select biz, invoice, 100000, 'cash', 'succeeded', now() from ids;
select is(pg_temp.queue_kinds((select invoice from ids)), '{}'::text[], 'a paid invoice leaves the queue');

-- ---------------------------------------------------------------- delivery
select pg_temp.as_user((select owner_a from ids));
select throws_ok($$ select * from public.claim_push_notifications(10) $$, '42501', null,
  'clients cannot claim pushes');
reset role;

set local role service_role;
create temp table claimed as select * from public.claim_push_notifications(1000);
select ok((select bool_and(tokens = array['ExponentPushToken[seed-10000000-0000-4000-a000-000000000001]'])
           from claimed where recipient_user_id = (select owner_a from ids)),
  'a claimed push carries the recipient''s tokens');
select is((select count(*) from public.claim_push_notifications(1000)), 0::bigint,
  'claimed pushes are not claimed again by an overlapping run');

create temp table picked as select
  (select c.id from claimed c, ids where c.event = 'quote_approved' and c.payload ->> 'quote_id' = ids.q1::text) as delivered,
  (select c.id from claimed c, ids where c.event = 'appointment_created' and c.payload ->> 'appointment_id' = ids.appt::text
     and c.recipient_user_id = ids.owner_a) as retried,
  (select c.id from claimed c, ids where c.event = 'invoice_issued' and c.payload ->> 'invoice_id' = ids.invoice::text) as failed;
grant select on picked to authenticated, service_role;

select public.complete_push_notifications(jsonb_build_array(
  jsonb_build_object('id', (select delivered from picked), 'ok', true),
  jsonb_build_object('id', (select retried from picked),
                     'ok', false, 'retry', true, 'error', 'MessageRateExceeded'),
  jsonb_build_object('id', (select failed from picked),
                     'ok', false, 'retry', false, 'error', 'DeviceNotRegistered',
                     'invalid_tokens', jsonb_build_array('ExponentPushToken[seed-10000000-0000-4000-a000-000000000001]'))));
reset role;

select is((select status::text from public.notification where id = (select delivered from picked)),
  'sent', 'a delivered push is SENT');
select is(
  (select status::text || '/' || attempts from public.notification
   where id = (select retried from picked)),
  'queued/1', 'a retryable failure goes back to the queue');
select is((select status::text || '/' || error from public.notification
           where id = (select failed from picked)),
  'failed/DeviceNotRegistered', 'a final failure is FAILED with the reason');
select isnt((select deleted_at from public.device where expo_push_token = 'ExponentPushToken[seed-10000000-0000-4000-a000-000000000001]'),
  null, 'a token Expo no longer knows is removed');
select is(pg_temp.queue_kinds((select failed from picked)), '{push_failed}'::text[],
  'a failed push stays visible in the recipient''s queue');

select pg_temp.as_user((select owner_a from ids));
select public.dismiss_notification((select failed from picked));
reset role;
select is(pg_temp.queue_kinds((select failed from picked)), '{}'::text[],
  'a dismissed failure leaves the queue');

-- ---------------------------------------------------------------- analytics outbox
set local role service_role;
select ok((select count(*) > 0 from public.claim_analytics_events(1000) where event = 'payment_received'),
  'analytics events are handed to `notify`');
select public.mark_analytics_sent(array(select id from public.claim_analytics_events(1000)));
select is((select count(*) from public.claim_analytics_events(1000)), 0::bigint, 'sent events are not sent again');
reset role;

select * from finish();
rollback;
