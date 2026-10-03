-- Quote lifecycle: drafts edited by the app (offline-capable), sending through
-- the `quotes` Edge Function, revisions and cancellation.
--
-- Rules enforced here (the app mirrors them, the database decides):
-- * Only DRAFT quotes and their items can be edited.
-- * Status, number, token and the sent snapshot change only through the
--   functions below; clients have no column privileges for them.
-- * A quote number is assigned when the quote is sent, from the business
--   counter, under a row lock: no duplicates, no gaps from abandoned drafts.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
drop trigger assign_quote_number on public.quote;

alter table public.quote
  alter column quote_number drop not null,
  alter column quote_number drop default,
  -- Discount as entered: a percent (basis points, 1000 = 10%) or an amount in agorot.
  add column discount_type text not null default 'none' check (discount_type in ('none', 'percent', 'amount')),
  add column discount_value bigint not null default 0 check (discount_value >= 0),
  add column revision integer not null default 1 check (revision >= 1),
  -- First quote of a revision chain, and the quote this revision replaces.
  add column root_quote_id uuid,
  add column supersedes_quote_id uuid,
  -- Idempotency key of the send request that sent this quote.
  add column send_key uuid,
  add column token_expires_at timestamptz,
  add column token_revoked_at timestamptz,
  add column cancelled_at timestamptz,
  add column superseded_at timestamptz,
  -- What the customer sees: business, customer, lines and totals as sent.
  add column sent_snapshot jsonb,
  add constraint quote_discount_percent_check check (discount_type <> 'percent' or discount_value <= 10000),
  add constraint quote_number_when_sent check (quote_number is not null or status in ('draft', 'cancelled')),
  add constraint quote_root_fk foreign key (business_id, root_quote_id) references public.quote (business_id, id),
  add constraint quote_supersedes_fk foreign key (business_id, supersedes_quote_id)
    references public.quote (business_id, id);

create unique index quote_send_key on public.quote (send_key) where send_key is not null;
create index quote_root_idx on public.quote (business_id, root_quote_id) where root_quote_id is not null;

alter table public.quote_item
  -- Whether unit_price_minor already includes VAT (copied from the service).
  add column vat_included boolean not null default false;

-- ---------------------------------------------------------------------------
-- Column privileges: clients write content only.
-- ---------------------------------------------------------------------------
revoke insert, update on public.quote from authenticated;
grant insert (id, business_id, customer_id, address_id, title, notes, valid_until, discount_type,
              discount_value, vat_rate_bp, subtotal_minor, discount_minor, vat_minor, total_minor)
  on public.quote to authenticated;
grant update (customer_id, address_id, title, notes, valid_until, discount_type, discount_value,
              vat_rate_bp, subtotal_minor, discount_minor, vat_minor, total_minor, deleted_at)
  on public.quote to authenticated;

-- ---------------------------------------------------------------------------
-- Draft-only editing
-- ---------------------------------------------------------------------------
create function app.guard_quote_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.business_id <> old.business_id then
    raise exception 'quote id and business cannot change' using errcode = '42501';
  end if;
  if old.quote_number is not null and new.quote_number is distinct from old.quote_number then
    raise exception 'quote number cannot change' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (
       (old.customer_id, old.address_id, old.title, old.notes, old.valid_until, old.discount_type,
        old.discount_value, old.vat_rate_bp, old.subtotal_minor, old.discount_minor, old.vat_minor,
        old.total_minor, old.deleted_at)
       is distinct from
       (new.customer_id, new.address_id, new.title, new.notes, new.valid_until, new.discount_type,
        new.discount_value, new.vat_rate_bp, new.subtotal_minor, new.discount_minor, new.vat_minor,
        new.total_minor, new.deleted_at)) then
    raise exception 'only draft quotes can be edited' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_quote_update before update on public.quote
  for each row execute function app.guard_quote_update();

create function app.guard_quote_item_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new is not distinct from old then
    return new;
  end if;
  -- Rows of other businesses are rejected by RLS; don't reveal their state here.
  if not app.is_member(new.business_id) then
    return new;
  end if;
  if (select q.status from public.quote q where q.id = new.quote_id) <> 'draft' then
    raise exception 'only draft quotes can be edited' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke execute on function app.guard_quote_item_write() from public, anon, authenticated;

create trigger guard_quote_item_write before insert or update on public.quote_item
  for each row execute function app.guard_quote_item_write();

-- ---------------------------------------------------------------------------
-- Numbers
-- ---------------------------------------------------------------------------
-- Next quote number of a business. The UPDATE locks the settings row, so
-- concurrent sends of one business are serialised and never share a number.
create function app.take_quote_number(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
begin
  update public.business_settings
  set next_quote_number = next_quote_number + 1
  where business_id = p_business_id
  returning next_quote_number - 1 into v_number;
  if v_number is null then
    raise exception 'business_settings missing for business %', p_business_id using errcode = 'P0002';
  end if;
  return v_number;
end;
$$;

revoke execute on function app.take_quote_number(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_quote_draft: idempotent upsert of a draft and its lines (the app's
-- outbox replays it until the server confirms). Runs as the caller, so RLS,
-- column privileges and the draft-only triggers apply.
-- ---------------------------------------------------------------------------
create function public.save_quote_draft(p_quote jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := (p_quote ->> 'id')::uuid;
  v_item jsonb;
  v_item_ids uuid[] := '{}';
begin
  insert into public.quote (id, business_id, customer_id, address_id, title, notes, valid_until,
                            discount_type, discount_value, vat_rate_bp, subtotal_minor, discount_minor,
                            vat_minor, total_minor)
  values (v_id, (p_quote ->> 'business_id')::uuid, (p_quote ->> 'customer_id')::uuid,
          (p_quote ->> 'address_id')::uuid, nullif(p_quote ->> 'title', ''), nullif(p_quote ->> 'notes', ''),
          (p_quote ->> 'valid_until')::date, p_quote ->> 'discount_type', (p_quote ->> 'discount_value')::bigint,
          (p_quote ->> 'vat_rate_bp')::integer, (p_quote ->> 'subtotal_minor')::bigint,
          (p_quote ->> 'discount_minor')::bigint, (p_quote ->> 'vat_minor')::bigint,
          (p_quote ->> 'total_minor')::bigint)
  on conflict (id) do update set
    customer_id = excluded.customer_id,
    address_id = excluded.address_id,
    title = excluded.title,
    notes = excluded.notes,
    valid_until = excluded.valid_until,
    discount_type = excluded.discount_type,
    discount_value = excluded.discount_value,
    vat_rate_bp = excluded.vat_rate_bp,
    subtotal_minor = excluded.subtotal_minor,
    discount_minor = excluded.discount_minor,
    vat_minor = excluded.vat_minor,
    total_minor = excluded.total_minor;

  for v_item in select * from jsonb_array_elements(coalesce(p_quote -> 'items', '[]'::jsonb)) loop
    v_item_ids := v_item_ids || (v_item ->> 'id')::uuid;
    insert into public.quote_item (id, business_id, quote_id, service_id, description, quantity, unit,
                                   unit_price_minor, line_total_minor, vat_included, sort_order)
    values ((v_item ->> 'id')::uuid, (p_quote ->> 'business_id')::uuid, v_id,
            (v_item ->> 'service_id')::uuid, v_item ->> 'description', (v_item ->> 'quantity')::numeric,
            v_item ->> 'unit', (v_item ->> 'unit_price_minor')::bigint, (v_item ->> 'line_total_minor')::bigint,
            (v_item ->> 'vat_included')::boolean, (v_item ->> 'sort_order')::integer)
    on conflict (id) do update set
      service_id = excluded.service_id,
      description = excluded.description,
      quantity = excluded.quantity,
      unit = excluded.unit,
      unit_price_minor = excluded.unit_price_minor,
      line_total_minor = excluded.line_total_minor,
      vat_included = excluded.vat_included,
      sort_order = excluded.sort_order,
      deleted_at = null;
  end loop;

  -- Lines removed in the app.
  update public.quote_item
  set deleted_at = now()
  where quote_id = v_id and deleted_at is null and id <> all (v_item_ids);
end;
$$;

revoke execute on function public.save_quote_draft(jsonb) from public, anon;
grant execute on function public.save_quote_draft(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- send_quote: called only by the `quotes` Edge Function (service_role), which
-- authenticates the user, recomputes the totals from the stored lines and
-- generates the customer token. Idempotent per send key: a retry (the app never
-- got the first response, so the link never went out) returns the same number
-- and stores the retry's new token instead, as only its hash is ever kept.
-- Once the customer has opened the quote, a retry leaves the token alone
-- (token_stored = false).
-- ---------------------------------------------------------------------------
create function public.send_quote(
  p_user_id uuid,
  p_quote_id uuid,
  p_send_key uuid,
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_totals jsonb,
  p_snapshot jsonb
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

revoke execute on function public.send_quote(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.send_quote(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- revise_quote: copies a sent quote into a new draft revision; the old quote
-- becomes SUPERSEDED and its customer link is revoked. Idempotent per new id.
-- ---------------------------------------------------------------------------
create function public.revise_quote(p_quote_id uuid, p_new_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.quote%rowtype;
begin
  select * into v_old from public.quote q where q.id = p_quote_id for update;
  if not found or not app.is_member(v_old.business_id) then
    raise exception 'quote not found' using errcode = '42501';
  end if;

  if exists (select 1 from public.quote q where q.id = p_new_quote_id) then
    if exists (select 1 from public.quote q where q.id = p_new_quote_id and q.supersedes_quote_id = p_quote_id) then
      return p_new_quote_id;
    end if;
    raise exception 'quote id already in use' using errcode = '42501';
  end if;

  if v_old.status not in ('sent', 'viewed', 'rejected', 'expired') then
    raise exception 'only sent quotes can be revised' using errcode = '55000';
  end if;

  insert into public.quote (id, business_id, customer_id, address_id, title, notes, valid_until,
                            discount_type, discount_value, vat_rate_bp, subtotal_minor, discount_minor,
                            vat_minor, total_minor, revision, root_quote_id, supersedes_quote_id)
  values (p_new_quote_id, v_old.business_id, v_old.customer_id, v_old.address_id, v_old.title, v_old.notes,
          null, v_old.discount_type, v_old.discount_value, v_old.vat_rate_bp, v_old.subtotal_minor,
          v_old.discount_minor, v_old.vat_minor, v_old.total_minor, v_old.revision + 1,
          coalesce(v_old.root_quote_id, v_old.id), v_old.id);

  insert into public.quote_item (business_id, quote_id, service_id, description, quantity, unit,
                                 unit_price_minor, line_total_minor, vat_included, sort_order)
  select i.business_id, p_new_quote_id, i.service_id, i.description, i.quantity, i.unit,
         i.unit_price_minor, i.line_total_minor, i.vat_included, i.sort_order
  from public.quote_item i
  where i.quote_id = p_quote_id and i.deleted_at is null;

  update public.quote q
  set status = 'superseded', superseded_at = now(), token_revoked_at = now()
  where q.id = p_quote_id;

  insert into public.audit_log (business_id, action, table_name, record_id, new_data)
  values (v_old.business_id, 'update', 'quote', p_quote_id,
          jsonb_build_object('status', 'superseded', 'revision', p_new_quote_id));

  return p_new_quote_id;
end;
$$;

revoke execute on function public.revise_quote(uuid, uuid) from public, anon;
grant execute on function public.revise_quote(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- cancel_quote: a draft or an open sent quote becomes CANCELLED and its
-- customer link is revoked. Idempotent.
-- ---------------------------------------------------------------------------
create function public.cancel_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
begin
  select * into v_quote from public.quote q where q.id = p_quote_id for update;
  if not found or not app.is_member(v_quote.business_id) then
    raise exception 'quote not found' using errcode = '42501';
  end if;
  if v_quote.status = 'cancelled' then
    return;
  end if;
  if v_quote.status not in ('draft', 'sent', 'viewed', 'rejected', 'expired') then
    raise exception 'this quote cannot be cancelled' using errcode = '55000';
  end if;

  update public.quote q
  set status = 'cancelled', cancelled_at = now(),
      token_revoked_at = case when v_quote.token_hash is not null then now() end
  where q.id = p_quote_id;

  insert into public.audit_log (business_id, action, table_name, record_id, new_data)
  values (v_quote.business_id, 'update', 'quote', p_quote_id, jsonb_build_object('status', 'cancelled'));
end;
$$;

revoke execute on function public.cancel_quote(uuid) from public, anon;
grant execute on function public.cancel_quote(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Quote photos: private bucket, objects under '<business_id>/quotes/<quote_id>/...';
-- any member reads and uploads (a file row in public.file points at each object).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quote-photos', 'quote-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy quote_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'quote-photos' and app.is_member(app.try_uuid((storage.foldername(name))[1])));
create policy quote_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'quote-photos' and app.is_member(app.try_uuid((storage.foldername(name))[1])));
create policy quote_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'quote-photos' and app.is_member(app.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'quote-photos' and app.is_member(app.try_uuid((storage.foldername(name))[1])));
