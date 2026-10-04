-- Notifications and the home screen's action queue.
--
-- * device: Expo push tokens, registered by the `devices` Edge Function.
-- * notification_preference: which push events each member wants.
-- * Triggers on quote, appointment, invoice and payment queue one push per
--   recipient in public.notification (the log); appointment reminders are
--   queued the evening before by enqueue_appointment_reminders().
-- * The `notify` Edge Function claims queued pushes, sends them through Expo
--   and records the outcome. A push that could not be delivered stays FAILED
--   and shows in the recipient's action queue until dismissed.
-- * The same triggers write product analytics events to app.analytics_event,
--   which `notify` forwards to PostHog.
-- * Delivery is kicked by pg_net right after a push is queued and every minute
--   by pg_cron, using the Vault secrets `notify_url` and `notify_secret`
--   (nothing happens until they are set; see README).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.device_platform as enum ('ios', 'android', 'web');
create type public.notification_event as enum (
  'quote_viewed',
  'quote_approved',
  'quote_rejected',
  'appointment_created',
  'appointment_changed',
  'appointment_reminder',
  'invoice_issued',
  'payment_received'
);

-- ---------------------------------------------------------------------------
-- device
-- ---------------------------------------------------------------------------
-- One row per push token. A phone that signs in to another account or business
-- moves its row there (register_device), so a push never reaches the wrong user.
create table public.device (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null unique
    check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  platform public.device_platform not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index device_recipient_idx on public.device (business_id, user_id) where deleted_at is null;

create trigger set_updated_at before update on public.device
  for each row execute function app.set_updated_at();
alter table public.device enable row level security;
-- Members see their own devices. No insert/update policies: writes go through
-- register_device/unregister_device.
create policy device_select on public.device for select to authenticated
  using (user_id = (select auth.uid()) and app.is_member(business_id));

create function public.register_device(p_business_id uuid, p_token text, p_platform public.device_platform)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not app.is_member(p_business_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  insert into public.device (business_id, user_id, expo_push_token, platform)
  values (p_business_id, auth.uid(), p_token, p_platform)
  on conflict (expo_push_token) do update set
    business_id = excluded.business_id,
    user_id = excluded.user_id,
    platform = excluded.platform,
    last_seen_at = now(),
    deleted_at = null
  returning id into v_id;
  return v_id;
end;
$$;

-- Stops pushes to this phone (sign-out). Only the token's owner can remove it.
create function public.unregister_device(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.device set deleted_at = now()
  where expo_push_token = p_token and user_id = auth.uid() and deleted_at is null;
$$;

revoke execute on function public.register_device(uuid, text, public.device_platform),
  public.unregister_device(text) from public, anon;
grant execute on function public.register_device(uuid, text, public.device_platform),
  public.unregister_device(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- notification_preference (no row = enabled)
-- ---------------------------------------------------------------------------
create table public.notification_preference (
  business_id uuid not null references public.business (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event public.notification_event not null,
  push_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id, event)
);

create trigger set_updated_at before update on public.notification_preference
  for each row execute function app.set_updated_at();
alter table public.notification_preference enable row level security;
create policy notification_preference_select on public.notification_preference for select to authenticated
  using (user_id = (select auth.uid()) and app.is_member(business_id));
create policy notification_preference_insert on public.notification_preference for insert to authenticated
  with check (user_id = (select auth.uid()) and app.is_member(business_id));
create policy notification_preference_update on public.notification_preference for update to authenticated
  using (user_id = (select auth.uid()) and app.is_member(business_id))
  with check (user_id = (select auth.uid()) and app.is_member(business_id));

-- ---------------------------------------------------------------------------
-- notification: push bookkeeping
-- ---------------------------------------------------------------------------
alter table public.notification
  add column event public.notification_event,
  -- One notification per recipient per key (e.g. a quote is "viewed" once).
  add column dedupe_key text check (char_length(dedupe_key) <= 200),
  add column attempts integer not null default 0 check (attempts >= 0),
  -- Set while a `notify` run is sending it.
  add column claimed_at timestamptz;

create unique index notification_dedupe_key on public.notification (recipient_user_id, dedupe_key)
  where dedupe_key is not null;
create index notification_push_queue_idx on public.notification (created_at)
  where channel = 'push' and status = 'queued' and deleted_at is null;

-- Push attempts before a push counts as FAILED.
create function app.max_push_attempts() returns integer language sql immutable as 'select 3';

-- Queues `p_event` for the business's OWNER/ADMIN members (and the assigned
-- member, for appointments) who have not turned it off. Returns rows queued.
create function app.enqueue_push(
  p_business_id uuid,
  p_event public.notification_event,
  p_payload jsonb,
  p_dedupe_key text,
  p_assigned_member_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.notification (business_id, recipient_user_id, channel, status, template, event,
                                   payload, dedupe_key)
  select p_business_id, m.user_id, 'push', 'queued', p_event::text, p_event, p_payload, p_dedupe_key
  from public.business_member m
  where m.business_id = p_business_id
    and m.status = 'active'
    and m.deleted_at is null
    and (m.role in ('OWNER', 'ADMIN') or m.id = p_assigned_member_id)
    and not exists (
      select 1 from public.notification_preference p
      where p.business_id = p_business_id and p.user_id = m.user_id and p.event = p_event
        and not p.push_enabled)
  on conflict (recipient_user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function app.enqueue_push(uuid, public.notification_event, jsonb, text, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Analytics outbox (forwarded to PostHog by `notify`)
-- ---------------------------------------------------------------------------
create table app.analytics_event (
  id bigint generated always as identity primary key,
  event text not null check (char_length(event) between 1 and 100),
  -- The member who caused it, or the business for customer and system actions.
  distinct_id text not null,
  business_id uuid not null,
  -- Ids and amounts only: no names or phone numbers leave the database.
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index analytics_event_unsent_idx on app.analytics_event (id) where sent_at is null;
revoke all on app.analytics_event from public, anon, authenticated;

create function app.track(p_event text, p_business_id uuid, p_properties jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app.analytics_event (event, distinct_id, business_id, properties)
  values (p_event, coalesce(auth.uid()::text, p_business_id::text), p_business_id, p_properties);
$$;

revoke execute on function app.track(text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Event triggers
-- ---------------------------------------------------------------------------
create function app.customer_name(p_customer_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.full_name from public.customer c where c.id = p_customer_id
$$;

revoke execute on function app.customer_name(uuid) from public, anon, authenticated;

create function app.on_quote_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := new.status::text;
begin
  if tg_op = 'INSERT' then
    perform app.track('quote_created', new.business_id, jsonb_build_object('quote_id', new.id));
    return null;
  end if;
  if new.status is not distinct from old.status then
    return null;
  end if;

  if v_status = 'sent' then
    perform app.track('quote_sent', new.business_id,
      jsonb_build_object('quote_id', new.id, 'total_minor', new.total_minor, 'revision', new.revision));
  elsif v_status in ('viewed', 'approved', 'rejected') then
    perform app.track('quote_' || v_status, new.business_id,
      jsonb_build_object('quote_id', new.id, 'total_minor', new.total_minor));
    perform app.enqueue_push(
      new.business_id,
      ('quote_' || v_status)::public.notification_event,
      jsonb_build_object('quote_id', new.id, 'quote_number', new.quote_number,
                         'customer_name', app.customer_name(new.customer_id),
                         'total_minor', new.total_minor, 'reason', new.rejected_reason),
      'quote_' || v_status || ':' || new.id);
  end if;
  return null;
end;
$$;

create trigger quote_events after insert or update of status on public.quote
  for each row execute function app.on_quote_event();

create function app.appointment_payload(a public.appointment)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('appointment_id', a.id, 'quote_id', a.quote_id, 'job_id', a.job_id,
                            'customer_name', app.customer_name(a.customer_id), 'status', a.status,
                            'starts_at', a.starts_at, 'ends_at', a.ends_at)
$$;

create function app.on_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'cancelled' or new.deleted_at is not null then
      return null;
    end if;
    perform app.track('appointment_created', new.business_id,
      jsonb_build_object('appointment_id', new.id, 'quote_id', new.quote_id, 'job_id', new.job_id));
    perform app.enqueue_push(new.business_id, 'appointment_created', app.appointment_payload(new),
                             'appointment_created:' || new.id, new.assigned_member_id);
    return null;
  end if;

  -- Moved, confirmed, cancelled or deleted. Completion and no-shows are the
  -- business's own doing and are not pushed.
  if (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at)
     or (new.status is distinct from old.status and new.status in ('confirmed', 'cancelled'))
     or (new.deleted_at is not null and old.deleted_at is null) then
    perform app.enqueue_push(
      new.business_id, 'appointment_changed',
      app.appointment_payload(new) || jsonb_build_object('deleted', new.deleted_at is not null),
      null, new.assigned_member_id);
  end if;
  return null;
end;
$$;

create trigger appointment_events after insert or update on public.appointment
  for each row execute function app.on_appointment_event();

create function app.on_job_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform app.track('job_completed', new.business_id,
      jsonb_build_object('job_id', new.id, 'quote_id', new.quote_id));
  end if;
  return null;
end;
$$;

create trigger job_events after insert or update of status on public.job
  for each row execute function app.on_job_event();

-- Invoice statuses are compared as text, so the triggers keep working when the
-- invoicing stage reshapes the status list.
create function app.on_invoice_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := lower(new.status::text);
  v_old text := case when tg_op = 'UPDATE' then lower(old.status::text) end;
  v_props jsonb := jsonb_build_object('invoice_id', new.id, 'job_id', new.job_id, 'quote_id', new.quote_id,
                                      'total_minor', new.total_minor);
begin
  if tg_op = 'INSERT' then
    perform app.track('invoice_created', new.business_id, v_props);
  end if;
  if v_status is not distinct from v_old then
    return null;
  end if;
  if v_status = 'issued' then
    perform app.enqueue_push(
      new.business_id, 'invoice_issued',
      jsonb_build_object('invoice_id', new.id, 'invoice_number', new.invoice_number,
                         'customer_name', app.customer_name(new.customer_id), 'total_minor', new.total_minor),
      'invoice_issued:' || new.id);
  elsif v_status = 'sent' then
    perform app.track('invoice_sent', new.business_id, v_props);
  end if;
  return null;
end;
$$;

-- Not `update of status`: a trigger listing the column would block the invoicing stage from
-- changing the column's type.
create trigger invoice_events after insert or update on public.invoice
  for each row execute function app.on_invoice_event();

create function app.on_payment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoice%rowtype;
begin
  if new.status <> 'succeeded' or (tg_op = 'UPDATE' and old.status = 'succeeded') then
    return null;
  end if;
  select * into v_invoice from public.invoice i where i.id = new.invoice_id;
  perform app.track('payment_received', new.business_id,
    jsonb_build_object('payment_id', new.id, 'invoice_id', new.invoice_id, 'amount_minor', new.amount_minor,
                       'method', new.method));
  perform app.enqueue_push(
    new.business_id, 'payment_received',
    jsonb_build_object('payment_id', new.id, 'invoice_id', new.invoice_id,
                       'invoice_number', v_invoice.invoice_number,
                       'customer_name', app.customer_name(v_invoice.customer_id),
                       'amount_minor', new.amount_minor),
    'payment_received:' || new.id);
  return null;
end;
$$;

create trigger payment_events after insert or update of status on public.payment
  for each row execute function app.on_payment_event();

revoke execute on function app.customer_name(uuid), app.appointment_payload(public.appointment),
  app.on_quote_event(), app.on_appointment_event(), app.on_job_event(), app.on_invoice_event(),
  app.on_payment_event() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reminders: the evening before (from p_hour, business time zone), one push per
-- appointment and start time, so a moved appointment is reminded again.
-- ---------------------------------------------------------------------------
create function public.enqueue_appointment_reminders(p_now timestamptz default now(), p_hour integer default 18)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointment%rowtype;
  v_count integer := 0;
begin
  for v_appointment in
    select a.* from public.appointment a
    join public.business_settings s on s.business_id = a.business_id
    where a.deleted_at is null
      and a.status in ('proposed', 'confirmed')
      and a.starts_at > p_now
      and (a.starts_at at time zone s.timezone)::date = (p_now at time zone s.timezone)::date + 1
      and extract(hour from p_now at time zone s.timezone) >= p_hour
  loop
    v_count := v_count + app.enqueue_push(
      v_appointment.business_id, 'appointment_reminder', app.appointment_payload(v_appointment),
      'appointment_reminder:' || v_appointment.id || ':' || extract(epoch from v_appointment.starts_at)::bigint,
      v_appointment.assigned_member_id);
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery (called by `notify` as service_role)
-- ---------------------------------------------------------------------------
-- Queued pushes, oldest first, with the recipient's push tokens. Locked rows
-- are skipped, so overlapping runs never send twice; a push claimed by a run
-- that died is claimed again after five minutes.
create function public.claim_push_notifications(p_limit integer)
returns table (
  id uuid,
  business_id uuid,
  recipient_user_id uuid,
  event public.notification_event,
  payload jsonb,
  attempts integer,
  tokens text[]
)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select n.id from public.notification n
    where n.channel = 'push' and n.status = 'queued' and n.deleted_at is null
      and (n.claimed_at is null or n.claimed_at < now() - interval '5 minutes')
    order by n.created_at
    limit p_limit
    for update skip locked
  )
  update public.notification n
  set claimed_at = now(), attempts = n.attempts + 1
  from picked
  where n.id = picked.id
  returning n.id, n.business_id, n.recipient_user_id, n.event, n.payload, n.attempts,
    array(select d.expo_push_token from public.device d
          where d.user_id = n.recipient_user_id and d.business_id = n.business_id and d.deleted_at is null
          order by d.last_seen_at desc);
$$;

-- Outcome of a run: [{ id, ok, retry, error, invalid_tokens }]. A retryable
-- failure goes back to the queue until max_push_attempts(); any other failure
-- is final (FAILED, shown in the action queue). Tokens Expo no longer knows
-- are removed.
create function public.complete_push_notifications(p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  for v_result in select * from jsonb_array_elements(p_results) loop
    update public.notification n set
      status = case
        when (v_result ->> 'ok')::boolean then 'sent'
        when coalesce((v_result ->> 'retry')::boolean, false) and n.attempts < app.max_push_attempts() then 'queued'
        else 'failed'
      end::public.notification_status,
      sent_at = case when (v_result ->> 'ok')::boolean then now() end,
      error = case when (v_result ->> 'ok')::boolean then null else left(v_result ->> 'error', 2000) end,
      claimed_at = null
    where n.id = (v_result ->> 'id')::uuid and n.status = 'queued';

    update public.device d set deleted_at = now()
    where d.deleted_at is null
      and d.expo_push_token in (select jsonb_array_elements_text(coalesce(v_result -> 'invalid_tokens', '[]')));
  end loop;
end;
$$;

create function public.claim_analytics_events(p_limit integer)
returns table (id bigint, event text, distinct_id text, business_id uuid, properties jsonb, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select e.id, e.event, e.distinct_id, e.business_id, e.properties, e.created_at
  from app.analytics_event e
  where e.sent_at is null
  order by e.id
  limit p_limit
  for update skip locked;
$$;

create function public.mark_analytics_sent(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update app.analytics_event set sent_at = now() where id = any (p_ids);
$$;

revoke execute on function public.enqueue_appointment_reminders(timestamptz, integer),
  public.claim_push_notifications(integer), public.complete_push_notifications(jsonb),
  public.claim_analytics_events(integer), public.mark_analytics_sent(bigint[])
  from public, anon, authenticated;
grant execute on function public.enqueue_appointment_reminders(timestamptz, integer),
  public.claim_push_notifications(integer), public.complete_push_notifications(jsonb),
  public.claim_analytics_events(integer), public.mark_analytics_sent(bigint[])
  to service_role;

-- ---------------------------------------------------------------------------
-- Kicking `notify`: right after pushes are queued, and every minute (retries,
-- reminders, analytics). Both are no-ops until the Vault secrets exist.
-- ---------------------------------------------------------------------------
create function app.request_notify()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'notify_url');
  v_secret text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'notify_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := '{}'::jsonb);
end;
$$;

create function app.on_push_queued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from inserted where channel = 'push' and status = 'queued') then
    perform app.request_notify();
  end if;
  return null;
end;
$$;

create trigger push_queued after insert on public.notification
  referencing new table as inserted
  for each statement execute function app.on_push_queued();

revoke execute on function app.request_notify(), app.on_push_queued() from public, anon, authenticated;

select cron.schedule('notify-dispatch', '* * * * *', 'select app.request_notify()');

-- ---------------------------------------------------------------------------
-- Action queue: what is waiting on the business, oldest first in each list.
-- Runs as the caller, so RLS limits it to the caller's businesses.
--   quote_unanswered      sent or viewed, link still valid       -> send reminder
--   approved_unscheduled  approved, no live appointment or job    -> schedule
--   completed_uninvoiced  job completed, no live invoice          -> create invoice
--   invoice_unpaid        issued or partly paid (amount = due)    -> payment reminder
--   push_failed           the caller's pushes that never arrived  -> dismiss
-- ---------------------------------------------------------------------------
create function public.action_queue(p_business_id uuid)
returns table (
  kind text,
  id uuid,
  quote_id uuid,
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
  select kind, id, quote_id, customer_name, customer_phone, number, title, amount_minor, since, event, error
  from (
    select 'quote_unanswered' as kind, q.id, q.id as quote_id, c.full_name::text as customer_name,
           c.phone_e164::text as customer_phone, q.quote_number as number, q.title, q.total_minor as amount_minor,
           q.sent_at as since,
           null::public.notification_event as event, null::text as error, 1 as sort_group
    from public.quote q
    join public.customer c on c.id = q.customer_id
    where q.business_id = p_business_id and q.deleted_at is null
      and q.status in ('sent', 'viewed')
      and (q.token_expires_at is null or q.token_expires_at > now())

    union all
    select 'approved_unscheduled', q.id, q.id, c.full_name::text, c.phone_e164::text, q.quote_number, q.title,
           q.total_minor, q.approved_at, null, null, 2
    from public.quote q
    join public.customer c on c.id = q.customer_id
    where q.business_id = p_business_id and q.deleted_at is null and q.status = 'approved'
      and not exists (
        select 1 from public.appointment a
        where a.business_id = q.business_id and a.deleted_at is null and a.status <> 'cancelled'
          and (a.quote_id = q.id
               or a.job_id in (select j.id from public.job j where j.quote_id = q.id and j.deleted_at is null)))
      and not exists (
        select 1 from public.job j
        where j.quote_id = q.id and j.deleted_at is null and j.status in ('completed', 'cancelled'))

    union all
    select 'completed_uninvoiced', j.id, j.quote_id, c.full_name::text, c.phone_e164::text, q.quote_number, j.title,
           q.total_minor, coalesce(j.completed_at, j.updated_at), null, null, 3
    from public.job j
    join public.customer c on c.id = j.customer_id
    left join public.quote q on q.id = j.quote_id
    where j.business_id = p_business_id and j.deleted_at is null and j.status = 'completed'
      and not exists (
        select 1 from public.invoice i
        where i.business_id = j.business_id and i.deleted_at is null and lower(i.status::text) not in ('void', 'voided')
          and (i.job_id = j.id or (j.quote_id is not null and i.quote_id = j.quote_id)))

    union all
    select 'invoice_unpaid', i.id, i.quote_id, c.full_name::text, c.phone_e164::text, i.invoice_number, null,
           i.total_minor - paid.amount_minor, i.issued_at, null, null, 4
    from public.invoice i
    join public.customer c on c.id = i.customer_id
    cross join lateral (
      select coalesce(sum(p.amount_minor), 0)::bigint as amount_minor from public.payment p
      where p.invoice_id = i.id and p.status = 'succeeded' and p.deleted_at is null) paid
    where i.business_id = p_business_id and i.deleted_at is null
      and lower(i.status::text) in ('issued', 'sent', 'partially_paid')
      and i.total_minor > paid.amount_minor

    union all
    select 'push_failed', n.id, (n.payload ->> 'quote_id')::uuid, n.payload ->> 'customer_name', null,
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

-- Hides a failed push from the caller's action queue.
create function public.dismiss_notification(p_notification_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.notification set read_at = now()
  where id = p_notification_id and recipient_user_id = (select auth.uid()) and read_at is null;
$$;

revoke execute on function public.dismiss_notification(uuid) from public, anon;
grant execute on function public.dismiss_notification(uuid) to authenticated;
