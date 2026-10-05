-- Jobs: every approved quote has exactly one job, created by the database
-- whichever way the quote was approved.
--
--   customer approves on the quote page   public_quote_respond (portal)
--   owner records an approval             mark_quote_approved (phone / WhatsApp / in person)
--   approved quote without a job          create_job_for_quote
--
-- A job starts PENDING_SCHEDULE. Booking a visit (the customer picks a
-- proposed time, or the owner sets one with schedule_job) makes it SCHEDULED;
-- then start, complete or cancel (transition_job). Only COMPLETED jobs can be
-- invoiced (20261005000000_invoicing.sql).
--
-- Rules enforced here (the app mirrors JOB_TRANSITIONS in
-- packages/types/src/job.ts, the database decides):
-- * One live job per quote (job_quote_key, from 20261002200400). Creating a job
--   locks the quote row, so concurrent approvals create exactly one.
-- * Status moves only along app.job_transition_allowed.
-- * Clients never write jobs or create appointments directly; every new
--   appointment belongs to a job.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.quote
  -- How the approval arrived: on the quote page, or recorded by the owner.
  add column approval_method text check (approval_method in ('portal', 'phone', 'whatsapp', 'in_person')),
  add column approval_note text check (char_length(approval_note) <= 500);
update public.quote set approval_method = 'portal' where approved_at is not null and approval_method is null;

alter table public.job alter column status set default 'pending_schedule';

-- ---------------------------------------------------------------------------
-- Transitions (mirror of JOB_TRANSITIONS in packages/types/src/job.ts)
-- ---------------------------------------------------------------------------
create function app.job_transition_allowed(p_from public.job_status, p_to public.job_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'pending_schedule' then p_to in ('scheduled', 'in_progress', 'cancelled')
    when 'scheduled' then p_to in ('in_progress', 'cancelled')
    when 'in_progress' then p_to in ('on_hold', 'completed', 'cancelled')
    when 'on_hold' then p_to in ('in_progress', 'cancelled')
    else false
  end;
$$;

-- A job keeps its business, customer and quote; its status follows the transitions.
create function app.guard_job_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.business_id, new.customer_id, new.quote_id) is distinct from
     (old.id, old.business_id, old.customer_id, old.quote_id) then
    raise exception 'job id, business, customer and quote cannot change' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not app.job_transition_allowed(old.status, new.status) then
    raise exception 'job cannot move from % to %', old.status, new.status using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_job_update before update on public.job
  for each row execute function app.guard_job_update();

-- ---------------------------------------------------------------------------
-- Privileges: clients read jobs; every write goes through the functions below.
-- New appointments come only from schedule_job and the customer's booking.
-- ---------------------------------------------------------------------------
revoke insert, update on public.job from anon, authenticated;
revoke insert on public.appointment from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The job of an approved quote
-- ---------------------------------------------------------------------------
-- Returns the quote's live job, creating it (PENDING_SCHEDULE) when there is
-- none. Only approved quotes get a job (55000). The quote row lock serialises
-- concurrent calls, so a quote never gets two jobs. A visit already booked for
-- the quote (before jobs existed) is attached to the job, which is then
-- SCHEDULED. Callers check membership.
create function app.ensure_job_for_quote(p_quote_id uuid, p_actor_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
  v_job_id uuid;
begin
  select * into v_quote from public.quote q where q.id = p_quote_id for update;
  if not found or v_quote.deleted_at is not null then
    raise exception 'quote not found' using errcode = '42501';
  end if;

  select j.id into v_job_id from public.job j where j.quote_id = p_quote_id and j.deleted_at is null;
  if v_job_id is not null then
    return v_job_id;
  end if;
  if v_quote.status <> 'approved' then
    raise exception 'only approved quotes become jobs' using errcode = '55000';
  end if;

  insert into public.job (business_id, customer_id, quote_id, address_id, title, status)
  values (v_quote.business_id, v_quote.customer_id, v_quote.id, v_quote.address_id,
          left(coalesce(nullif(btrim(v_quote.title), ''), 'הצעת מחיר ' || v_quote.quote_number), 200),
          'pending_schedule')
  returning id into v_job_id;

  update public.appointment a set job_id = v_job_id
  where a.quote_id = p_quote_id and a.job_id is null and a.deleted_at is null;
  if exists (select 1 from public.appointment a
             where a.job_id = v_job_id and a.status = 'confirmed' and a.deleted_at is null) then
    update public.job j set status = 'scheduled' where j.id = v_job_id;
  end if;

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
  values (v_quote.business_id, p_actor_user_id, 'insert', 'job', v_job_id,
          jsonb_build_object('status', 'pending_schedule', 'quote_id', p_quote_id));

  return v_job_id;
end;
$$;

revoke execute on function app.ensure_job_for_quote(uuid, uuid) from public, anon, authenticated;

-- The owner's "create job" on an approved quote. Idempotent: returns the
-- existing job when there is one.
create function public.create_job_for_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_member((select q.business_id from public.quote q where q.id = p_quote_id)) then
    raise exception 'quote not found' using errcode = '42501';
  end if;
  return app.ensure_job_for_quote(p_quote_id, auth.uid());
end;
$$;

revoke execute on function public.create_job_for_quote(uuid) from public, anon;
grant execute on function public.create_job_for_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The owner records an approval the customer gave outside the link
-- ---------------------------------------------------------------------------
-- A SENT or VIEWED quote becomes APPROVED, with how it was approved and an
-- optional note, written to the audit log as the acting member; its job is
-- created in the same transaction. Returns the job. Approving an approved
-- quote again returns its job.
create function public.mark_quote_approved(p_quote_id uuid, p_method text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v_quote from public.quote q where q.id = p_quote_id for update;
  if not found or v_quote.deleted_at is not null or not app.is_member(v_quote.business_id) then
    raise exception 'quote not found' using errcode = '42501';
  end if;
  if v_quote.status = 'approved' then
    return app.ensure_job_for_quote(p_quote_id, auth.uid());
  end if;
  if v_quote.status not in ('sent', 'viewed') then
    raise exception 'only sent quotes can be approved' using errcode = '55000';
  end if;
  if p_method is null or p_method not in ('phone', 'whatsapp', 'in_person') then
    raise exception 'approval method required' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'note too long' using errcode = '22023';
  end if;

  update public.quote q
  set status = 'approved', approved_at = now(), approval_method = p_method, approval_note = v_note
  where q.id = p_quote_id;

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, old_data, new_data)
  values (v_quote.business_id, auth.uid(), 'update', 'quote', p_quote_id,
          jsonb_build_object('status', v_quote.status),
          jsonb_build_object('status', 'approved', 'method', p_method, 'note', v_note));

  return app.ensure_job_for_quote(p_quote_id, auth.uid());
end;
$$;

revoke execute on function public.mark_quote_approved(uuid, text, text) from public, anon;
grant execute on function public.mark_quote_approved(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The customer's answer: as before (20261004000000_public_quote.sql), plus the
-- job, created in the same transaction as the approval. A repeated approval
-- returns the same job.
-- ---------------------------------------------------------------------------
create or replace function public.public_quote_respond(
  p_token_hash text,
  p_action text,
  p_name text,
  p_reason text,
  p_ip inet
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
  v_state text;
  v_name text := btrim(p_name);
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  v_quote := app.quote_by_token(p_token_hash, true);
  if v_quote.id is null then
    return null;
  end if;
  v_state := app.public_quote_state(v_quote);

  -- Same answer again (a double tap, a retry): nothing changes.
  if (p_action = 'approve' and v_state = 'approved') or (p_action = 'reject' and v_state = 'rejected') then
    if v_state = 'approved' then
      perform app.ensure_job_for_quote(v_quote.id, null);
    end if;
    return app.public_quote_view(v_quote) || jsonb_build_object('already', true);
  end if;
  if v_state <> 'open' then
    raise exception 'quote is %', v_state using errcode = '55000';
  end if;

  if p_action = 'approve' then
    if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 200 then
      raise exception 'name required' using errcode = '22023';
    end if;
    update public.quote q
    set status = 'approved', approved_at = now(), approved_name = v_name, approved_ip = p_ip,
        approval_method = 'portal', viewed_at = coalesce(q.viewed_at, now())
    where q.id = v_quote.id
    returning * into v_quote;
  else
    if char_length(v_reason) > 1000 then
      raise exception 'reason too long' using errcode = '22023';
    end if;
    update public.quote q
    set status = 'rejected', rejected_at = now(), rejected_reason = v_reason, rejected_ip = p_ip,
        viewed_at = coalesce(q.viewed_at, now())
    where q.id = v_quote.id
    returning * into v_quote;
  end if;

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
  values (v_quote.business_id, null, 'update', 'quote', v_quote.id,
          jsonb_build_object('status', v_quote.status, 'ip', p_ip,
                             'at', coalesce(v_quote.approved_at, v_quote.rejected_at),
                             'name', v_quote.approved_name, 'reason', v_quote.rejected_reason));

  if p_action = 'approve' then
    perform app.ensure_job_for_quote(v_quote.id, null);
  end if;

  return app.public_quote_view(v_quote) || jsonb_build_object('already', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a link shows: as before (20261004100000_quote_scheduling.sql), but the
-- booked visit is also one the owner set (no slot_id then).
-- ---------------------------------------------------------------------------
create or replace function app.public_quote_view(q public.quote)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when app.public_quote_state(q) in ('cancelled', 'superseded') then
      jsonb_build_object('state', app.public_quote_state(q),
                         'business', jsonb_build_object('name', q.sent_snapshot -> 'business' ->> 'name'))
    else jsonb_build_object(
      'state', app.public_quote_state(q),
      'quote', q.sent_snapshot,
      'viewed_at', q.viewed_at,
      'expires_at', q.token_expires_at,
      'approval', case when q.approved_at is not null then
        jsonb_build_object('name', q.approved_name, 'at', q.approved_at) end,
      'rejection', case when q.rejected_at is not null then
        jsonb_build_object('reason', q.rejected_reason, 'at', q.rejected_at) end,
      'slots', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                 'available', s.starts_at > now() and not exists (
                   select 1 from public.appointment a
                   where a.business_id = s.business_id and a.status = 'confirmed' and a.deleted_at is null
                     and tstzrange(a.starts_at, a.ends_at) && tstzrange(s.starts_at, s.ends_at)))
               order by s.sort_order)
        from public.quote_slot_option s
        where s.quote_id = q.id and s.deleted_at is null), '[]'::jsonb),
      'appointment', coalesce(
        (select jsonb_build_object('slot_id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
         from public.quote_slot_option s
         where s.quote_id = q.id and s.status = 'selected' and s.deleted_at is null),
        (select jsonb_build_object('slot_id', null, 'starts_at', a.starts_at, 'ends_at', a.ends_at)
         from public.appointment a
         join public.job j on j.id = a.job_id
         where j.quote_id = q.id and j.deleted_at is null and a.status = 'confirmed' and a.deleted_at is null
         order by a.starts_at
         limit 1)))
  end
$$;

-- ---------------------------------------------------------------------------
-- The customer picks a time: as before, and the visit belongs to the quote's
-- job, which becomes SCHEDULED. A job the owner already scheduled refuses a
-- second visit (23505); a cancelled or finished job refuses booking (55000).
-- ---------------------------------------------------------------------------
create or replace function public.public_quote_schedule(p_token_hash text, p_slot_id uuid, p_ip inet)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
  v_slot public.quote_slot_option%rowtype;
  v_booked_slot_id uuid;
  v_job public.job%rowtype;
  v_appointment_id uuid;
begin
  v_quote := app.quote_by_token(p_token_hash, true);
  if v_quote.id is null then
    return null;
  end if;
  if app.public_quote_state(v_quote) <> 'approved' then
    raise exception 'quote is %', app.public_quote_state(v_quote) using errcode = '55000';
  end if;

  select * into v_slot from public.quote_slot_option s
  where s.id = p_slot_id and s.quote_id = v_quote.id and s.deleted_at is null;
  if not found then
    raise exception 'unknown time' using errcode = '22023';
  end if;

  select s.id into v_booked_slot_id from public.quote_slot_option s
  where s.quote_id = v_quote.id and s.status = 'selected' and s.deleted_at is null;
  if v_booked_slot_id is not null then
    if v_booked_slot_id = p_slot_id then
      return app.public_quote_view(v_quote) || jsonb_build_object('already', true);
    end if;
    raise exception 'already scheduled' using errcode = '23505';
  end if;

  select * into v_job from public.job j where j.id = app.ensure_job_for_quote(v_quote.id, null) for update;
  if v_job.status <> 'pending_schedule' then
    if v_job.status = 'scheduled' then
      raise exception 'already scheduled' using errcode = '23505';
    end if;
    raise exception 'job is %', v_job.status using errcode = '55000';
  end if;

  if v_slot.starts_at <= now() then
    raise exception 'time has passed' using errcode = '23P01';
  end if;

  -- The exclusion constraint rejects an overlap with another confirmed visit (23P01).
  insert into public.appointment (business_id, customer_id, quote_id, job_id, address_id, slot_option_id,
                                  assigned_member_id, status, starts_at, ends_at)
  values (v_quote.business_id, v_quote.customer_id, v_quote.id, v_job.id, v_quote.address_id, v_slot.id,
          v_job.assigned_member_id, 'confirmed', v_slot.starts_at, v_slot.ends_at)
  returning id into v_appointment_id;

  update public.quote_slot_option s set status = 'declined'
  where s.quote_id = v_quote.id and s.id <> v_slot.id and s.deleted_at is null;
  update public.quote_slot_option s set status = 'selected' where s.id = v_slot.id;
  update public.job j set status = 'scheduled' where j.id = v_job.id;

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
  values (v_quote.business_id, null, 'insert', 'appointment', v_appointment_id,
          jsonb_build_object('status', 'confirmed', 'quote_id', v_quote.id, 'job_id', v_job.id,
                             'slot_id', v_slot.id, 'starts_at', v_slot.starts_at, 'ip', p_ip));

  return app.public_quote_view(v_quote) || jsonb_build_object('already', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner sets the visit of a job
-- ---------------------------------------------------------------------------
-- Books a CONFIRMED appointment for a PENDING_SCHEDULE job, which becomes
-- SCHEDULED. The time must be ahead and at most 12 hours long (22007); a time
-- that overlaps another confirmed visit of the business fails with 23P01.
-- Times the customer was offered and did not pick are declined. A job that
-- already has a visit refuses another (23505). Returns the appointment.
create function public.schedule_job(p_job_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.job%rowtype;
  v_appointment_id uuid;
begin
  select * into v_job from public.job j where j.id = p_job_id for update;
  if not found or v_job.deleted_at is not null or not app.is_member(v_job.business_id) then
    raise exception 'job not found' using errcode = '42501';
  end if;
  if v_job.status <> 'pending_schedule' then
    if v_job.status = 'scheduled' then
      raise exception 'already scheduled' using errcode = '23505';
    end if;
    raise exception 'job is %', v_job.status using errcode = '55000';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_ends_at - p_starts_at > interval '12 hours' then
    raise exception 'invalid visit time' using errcode = '22007';
  end if;
  if p_starts_at <= now() then
    raise exception 'visit time in the past' using errcode = '22007';
  end if;

  insert into public.appointment (business_id, customer_id, quote_id, job_id, address_id, assigned_member_id,
                                  status, starts_at, ends_at)
  values (v_job.business_id, v_job.customer_id, v_job.quote_id, v_job.id, v_job.address_id,
          v_job.assigned_member_id, 'confirmed', p_starts_at, p_ends_at)
  returning id into v_appointment_id;

  if v_job.quote_id is not null then
    update public.quote_slot_option s set status = 'declined'
    where s.quote_id = v_job.quote_id and s.status = 'offered' and s.deleted_at is null;
  end if;
  update public.job j set status = 'scheduled' where j.id = p_job_id;

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
  values (v_job.business_id, auth.uid(), 'insert', 'appointment', v_appointment_id,
          jsonb_build_object('status', 'confirmed', 'job_id', p_job_id, 'starts_at', p_starts_at,
                             'ends_at', p_ends_at));

  return v_appointment_id;
end;
$$;

revoke execute on function public.schedule_job(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.schedule_job(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Start, complete, cancel
-- ---------------------------------------------------------------------------
-- p_action: 'start' (IN_PROGRESS), 'complete' (COMPLETED), 'cancel'
-- (CANCELLED). Idempotent: a job already there is left alone. Completing
-- marks its confirmed visit completed; cancelling cancels its open visits,
-- freeing their times. Returns the job's status.
create function public.transition_job(p_job_id uuid, p_action text)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.job%rowtype;
  v_to public.job_status;
  v_now timestamptz := now();
begin
  v_to := case p_action
    when 'start' then 'in_progress'
    when 'complete' then 'completed'
    when 'cancel' then 'cancelled'
  end;
  if v_to is null then
    raise exception 'unknown action' using errcode = '22023';
  end if;

  select * into v_job from public.job j where j.id = p_job_id for update;
  if not found or v_job.deleted_at is not null or not app.is_member(v_job.business_id) then
    raise exception 'job not found' using errcode = '42501';
  end if;
  if v_job.status = v_to then
    return v_to;
  end if;
  if not app.job_transition_allowed(v_job.status, v_to) then
    raise exception 'job cannot move from % to %', v_job.status, v_to using errcode = '55000';
  end if;

  update public.job j set
    status = v_to,
    started_at = case when v_to in ('in_progress', 'completed') then coalesce(j.started_at, v_now) else j.started_at end,
    completed_at = case when v_to = 'completed' then v_now else j.completed_at end
  where j.id = p_job_id;

  if v_to = 'completed' then
    update public.appointment a set status = 'completed'
    where a.job_id = p_job_id and a.status = 'confirmed' and a.deleted_at is null;
  elsif v_to = 'cancelled' then
    update public.appointment a set status = 'cancelled'
    where a.job_id = p_job_id and a.status in ('proposed', 'confirmed') and a.deleted_at is null;
  end if;

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, old_data, new_data)
  values (v_job.business_id, auth.uid(), 'update', 'job', p_job_id,
          jsonb_build_object('status', v_job.status), jsonb_build_object('status', v_to));

  return v_to;
end;
$$;

revoke execute on function public.transition_job(uuid, text) from public, anon;
grant execute on function public.transition_job(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: a job for every approved quote that has none.
-- ---------------------------------------------------------------------------
select app.ensure_job_for_quote(q.id, null)
from public.quote q
where q.status = 'approved' and q.deleted_at is null
  and not exists (select 1 from public.job j where j.quote_id = q.id and j.deleted_at is null);

-- From here on every appointment belongs to a job (older rows are left as they are).
alter table public.appointment
  add constraint appointment_has_job check (job_id is not null) not valid;

-- ---------------------------------------------------------------------------
-- Action queue: as before (20261005100000_notifications.sql), plus job_id so
-- scheduling and invoicing rows open the job. approved_unscheduled is now
-- an approved quote whose job waits for a visit (or, before the backfill ran,
-- has no job).
-- ---------------------------------------------------------------------------
drop function public.action_queue(uuid);

create function public.action_queue(p_business_id uuid)
returns table (
  kind text,
  id uuid,
  quote_id uuid,
  job_id uuid,
  customer_name text,
  customer_phone text,
  number integer,
  title text,
  amount_minor bigint,
  since timestamptz,
  event public.notification_event,
  error text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select kind, id, quote_id, job_id, customer_name, customer_phone, number, title, amount_minor, since, event, error
  from (
    select 'quote_unanswered' as kind, q.id, q.id as quote_id, null::uuid as job_id,
           c.full_name::text as customer_name, c.phone_e164::text as customer_phone, q.quote_number as number,
           q.title, q.total_minor as amount_minor, q.sent_at as since,
           null::public.notification_event as event, null::text as error, 1 as sort_group
    from public.quote q
    join public.customer c on c.id = q.customer_id
    where q.business_id = p_business_id and q.deleted_at is null
      and q.status in ('sent', 'viewed')
      and (q.token_expires_at is null or q.token_expires_at > now())

    union all
    select 'approved_unscheduled', q.id, q.id, j.id, c.full_name::text, c.phone_e164::text, q.quote_number,
           q.title, q.total_minor, q.approved_at, null, null, 2
    from public.quote q
    join public.customer c on c.id = q.customer_id
    left join public.job j on j.quote_id = q.id and j.deleted_at is null
    where q.business_id = p_business_id and q.deleted_at is null and q.status = 'approved'
      and (j.id is null or j.status = 'pending_schedule')
      and not exists (
        select 1 from public.appointment a
        where a.business_id = q.business_id and a.deleted_at is null and a.status <> 'cancelled'
          and (a.quote_id = q.id or a.job_id = j.id))

    union all
    select 'completed_uninvoiced', j.id, j.quote_id, j.id, c.full_name::text, c.phone_e164::text,
           q.quote_number, j.title, q.total_minor, coalesce(j.completed_at, j.updated_at), null, null, 3
    from public.job j
    join public.customer c on c.id = j.customer_id
    left join public.quote q on q.id = j.quote_id
    where j.business_id = p_business_id and j.deleted_at is null and j.status = 'completed'
      and not exists (
        select 1 from public.invoice i
        where i.business_id = j.business_id and i.deleted_at is null and i.status <> 'voided'
          and (i.job_id = j.id or (j.quote_id is not null and i.quote_id = j.quote_id)))

    union all
    select 'invoice_unpaid', i.id, i.quote_id, i.job_id, c.full_name::text, c.phone_e164::text,
           i.invoice_number, null, i.total_minor - paid.amount_minor, i.issued_at, null, null, 4
    from public.invoice i
    join public.customer c on c.id = i.customer_id
    cross join lateral (
      select coalesce(sum(p.amount_minor), 0)::bigint as amount_minor from public.payment p
      where p.invoice_id = i.id and p.status = 'succeeded' and p.deleted_at is null) paid
    where i.business_id = p_business_id and i.deleted_at is null
      and i.status in ('issued', 'sent')
      and i.total_minor > paid.amount_minor

    union all
    select 'push_failed', n.id, (n.payload ->> 'quote_id')::uuid, (n.payload ->> 'job_id')::uuid,
           n.payload ->> 'customer_name', null,
           coalesce((n.payload ->> 'quote_number')::integer, (n.payload ->> 'invoice_number')::integer),
           null, coalesce((n.payload ->> 'amount_minor')::bigint, (n.payload ->> 'total_minor')::bigint),
           n.created_at, n.event, n.error, 5
    from public.notification n
    where n.business_id = p_business_id and n.recipient_user_id = (select auth.uid())
      and n.channel = 'push' and n.status = 'failed' and n.read_at is null and n.deleted_at is null
  ) queue
  order by sort_group, since nulls last
$$;

revoke execute on function public.action_queue(uuid) from public, anon;
grant execute on function public.action_queue(uuid) to authenticated;
