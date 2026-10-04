-- Scheduling from a quote: when sending, the owner proposes 2-3 visit times
-- (quote_slot_option, OFFERED). After approving, the customer picks one on
-- their page: it becomes SELECTED, the others DECLINED, and a CONFIRMED
-- appointment is booked. The appointment_no_overlapping_confirmed
-- exclusion constraint decides whether the time is still free (23P01).

-- ---------------------------------------------------------------------------
-- Proposed times (quote_slot_option, from 20261002200300_quotes.sql)
-- ---------------------------------------------------------------------------
alter table public.quote_slot_option
  add column sort_order smallint not null default 0,
  add constraint quote_slot_option_max_length check (ends_at - starts_at <= interval '12 hours'),
  add constraint quote_slot_option_business_id_id_key unique (business_id, id);

-- The appointment booked from a proposed time.
alter table public.appointment
  add column slot_option_id uuid,
  add constraint appointment_slot_option_fk foreign key (business_id, slot_option_id)
    references public.quote_slot_option (business_id, id);

-- ---------------------------------------------------------------------------
-- send_quote: as before, plus the proposed times (p_slots: [] or 2-3 of
-- {starts_at, ends_at}, each in the future and at most 12 hours long; 22007
-- otherwise).
-- ---------------------------------------------------------------------------
drop function public.send_quote(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb);

create function public.send_quote(
  p_user_id uuid,
  p_quote_id uuid,
  p_send_key uuid,
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_totals jsonb,
  p_snapshot jsonb,
  p_slots jsonb default '[]'
)
returns table (quote_number integer, sent_at timestamptz, already_sent boolean, token_stored boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
  v_number integer;
  v_now timestamptz := now();
  v_slots jsonb := coalesce(p_slots, '[]');
begin
  select * into v_quote from public.quote q where q.id = p_quote_id for update;
  if not found or not exists (
    select 1 from public.business_member m
    where m.business_id = v_quote.business_id and m.user_id = p_user_id
      and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'quote not found' using errcode = '42501';
  end if;

  if v_quote.status <> 'draft' then
    if v_quote.send_key = p_send_key then
      if v_quote.status = 'sent' and v_quote.token_revoked_at is null then
        update public.quote q set token_hash = p_token_hash where q.id = p_quote_id;
        return query select v_quote.quote_number, v_quote.sent_at, true, true;
      else
        return query select v_quote.quote_number, v_quote.sent_at, true, false;
      end if;
      return;
    end if;
    raise exception 'only draft quotes can be sent' using errcode = '55000';
  end if;
  if v_quote.deleted_at is not null then
    raise exception 'quote was deleted' using errcode = '55000';
  end if;
  if not exists (select 1 from public.quote_item i where i.quote_id = p_quote_id and i.deleted_at is null) then
    raise exception 'quote has no lines' using errcode = '22023';
  end if;

  if jsonb_typeof(v_slots) <> 'array' or jsonb_array_length(v_slots) not in (0, 2, 3) then
    raise exception 'propose 2-3 times or none' using errcode = '22007';
  end if;
  if jsonb_array_length(v_slots) > 0 then
    -- The times sent are the offer; anything stored on the draft before is replaced.
    update public.quote_slot_option s set deleted_at = v_now
    where s.quote_id = p_quote_id and s.deleted_at is null;
    begin
      insert into public.quote_slot_option (business_id, quote_id, starts_at, ends_at, sort_order)
      select v_quote.business_id, p_quote_id, (s.value ->> 'starts_at')::timestamptz,
             (s.value ->> 'ends_at')::timestamptz, (s.ordinality - 1)::smallint
      from jsonb_array_elements(v_slots) with ordinality s;
    exception when check_violation or not_null_violation or invalid_datetime_format
                   or datetime_field_overflow or invalid_text_representation then
      raise exception 'invalid proposed time' using errcode = '22007';
    end;
    if exists (select 1 from public.quote_slot_option s
               where s.quote_id = p_quote_id and s.deleted_at is null and s.starts_at <= v_now) then
      raise exception 'proposed time in the past' using errcode = '22007';
    end if;
  end if;

  v_number := app.take_quote_number(v_quote.business_id);

  update public.quote q set
    status = 'sent',
    quote_number = v_number,
    sent_at = v_now,
    send_key = p_send_key,
    token_hash = p_token_hash,
    token_expires_at = p_token_expires_at,
    valid_until = coalesce(q.valid_until, (p_token_expires_at at time zone 'Asia/Jerusalem')::date),
    subtotal_minor = (p_totals ->> 'subtotal_minor')::bigint,
    discount_minor = (p_totals ->> 'discount_minor')::bigint,
    vat_rate_bp = (p_totals ->> 'vat_rate_bp')::integer,
    vat_minor = (p_totals ->> 'vat_minor')::bigint,
    total_minor = (p_totals ->> 'total_minor')::bigint,
    sent_snapshot = p_snapshot || jsonb_build_object('quote_number', v_number, 'sent_at', v_now)
  where q.id = p_quote_id;

  update public.service s set last_used_at = v_now
  where s.id in (select i.service_id from public.quote_item i
                 where i.quote_id = p_quote_id and i.deleted_at is null and i.service_id is not null);

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
  values (v_quote.business_id, p_user_id, 'update', 'quote', p_quote_id,
          jsonb_build_object('status', 'sent', 'quote_number', v_number));

  return query select v_number, v_now, false, true;
end;
$$;

revoke execute on function public.send_quote(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.send_quote(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- What a link shows: as before, plus the proposed times (each marked
-- available while it is in the future and no other confirmed appointment of
-- the business overlaps it) and the booked visit (the SELECTED time).
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
      'appointment', (
        select jsonb_build_object('slot_id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
        from public.quote_slot_option s
        where s.quote_id = q.id and s.status = 'selected' and s.deleted_at is null))
  end
$$;

-- ---------------------------------------------------------------------------
-- The customer picks a time
-- ---------------------------------------------------------------------------
-- Books one of the quote's proposed times as a CONFIRMED appointment. Only an
-- approved quote can be scheduled (55000 otherwise). Picking the booked time
-- again returns it again; a different time once booked is refused (23505). A
-- time that is taken, or already past, fails with 23P01, so the customer picks
-- another. Returns null for unknown or revoked links.
create function public.public_quote_schedule(p_token_hash text, p_slot_id uuid, p_ip inet)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
  v_slot public.quote_slot_option%rowtype;
  v_booked_slot_id uuid;
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

  if v_slot.starts_at <= now() then
    raise exception 'time has passed' using errcode = '23P01';
  end if;

  -- The exclusion constraint rejects an overlap with another confirmed visit (23P01).
  insert into public.appointment (business_id, customer_id, quote_id, address_id, slot_option_id,
                                  status, starts_at, ends_at)
  values (v_quote.business_id, v_quote.customer_id, v_quote.id, v_quote.address_id, v_slot.id,
          'confirmed', v_slot.starts_at, v_slot.ends_at)
  returning id into v_appointment_id;

  update public.quote_slot_option s set status = 'declined'
  where s.quote_id = v_quote.id and s.id <> v_slot.id and s.deleted_at is null;
  update public.quote_slot_option s set status = 'selected' where s.id = v_slot.id;

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
  values (v_quote.business_id, null, 'insert', 'appointment', v_appointment_id,
          jsonb_build_object('status', 'confirmed', 'quote_id', v_quote.id, 'slot_id', v_slot.id,
                             'starts_at', v_slot.starts_at, 'ip', p_ip));

  return app.public_quote_view(v_quote) || jsonb_build_object('already', false);
end;
$$;

revoke execute on function public.public_quote_schedule(text, uuid, inet) from public, anon, authenticated;
grant execute on function public.public_quote_schedule(text, uuid, inet) to service_role;
