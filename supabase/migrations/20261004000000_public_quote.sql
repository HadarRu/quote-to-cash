-- Public quote page: what the customer sees through their link, and their
-- answer (approve with a typed name, reject with an optional reason, comment).
--
-- The customer is not a Supabase user. The `public-quote` Edge Function hashes
-- the link token with TOKEN_PEPPER and calls the functions below as
-- service_role; nothing here is reachable by anon or authenticated clients.

-- ---------------------------------------------------------------------------
-- Columns and tables
-- ---------------------------------------------------------------------------
alter table public.quote
  -- The name the customer typed to approve, and where the approval came from.
  add column approved_name text check (char_length(approved_name) between 2 and 200),
  add column approved_ip inet,
  add column rejected_reason text check (char_length(rejected_reason) <= 1000),
  add column rejected_ip inet;

-- Messages on a quote. Customers write through the Edge Function; members read
-- them in the app (RLS through setup_tenant_table).
create table public.quote_comment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  quote_id uuid not null,
  author text not null check (author in ('customer', 'business')),
  body text not null check (char_length(body) between 1 and 2000),
  ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (business_id, quote_id) references public.quote (business_id, id) on delete cascade
);
create index quote_comment_quote_idx on public.quote_comment (business_id, quote_id, created_at);
select app.setup_tenant_table('public.quote_comment');

-- Fixed-window request counters (per IP, per token). Not exposed to clients.
create table app.rate_limit (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
revoke all on app.rate_limit from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
-- Counts one request in `p_bucket` for the current window; true while within
-- `p_limit` requests per `p_window_seconds`. Old windows are pruned as it goes.
create function public.hit_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into app.rate_limit (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = app.rate_limit.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from app.rate_limit where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;

revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- What a link shows
-- ---------------------------------------------------------------------------
-- State of a quote as the customer's page presents it.
create function app.public_quote_state(q public.quote)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when q.status = 'cancelled' then 'cancelled'
    when q.status = 'superseded' then 'superseded'
    when q.status = 'approved' then 'approved'
    when q.status = 'rejected' then 'rejected'
    when q.status = 'expired' or q.token_expires_at <= now() then 'expired'
    else 'open'
  end
$$;

-- The quote behind a token hash, or null for unknown and revoked links (the
-- caller answers both the same way). A link revoked by cancelling or revising
-- still resolves, so the customer learns why it stopped working.
create function app.quote_by_token(p_token_hash text, p_lock boolean)
returns public.quote
language plpgsql
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
begin
  if p_lock then
    select * into v_quote from public.quote q
    where q.token_hash = p_token_hash and q.deleted_at is null for update;
  else
    select * into v_quote from public.quote q
    where q.token_hash = p_token_hash and q.deleted_at is null;
  end if;
  if not found or v_quote.status = 'draft'
     or (v_quote.token_revoked_at is not null and v_quote.status not in ('cancelled', 'superseded')) then
    return null;
  end if;
  return v_quote;
end;
$$;

revoke execute on function app.public_quote_state(public.quote) from public, anon, authenticated;
revoke execute on function app.quote_by_token(text, boolean) from public, anon, authenticated;

/** The page's data: state, and for live states the snapshot and the answer. */
create function app.public_quote_view(q public.quote)
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
        jsonb_build_object('reason', q.rejected_reason, 'at', q.rejected_at) end)
  end
$$;

revoke execute on function app.public_quote_view(public.quote) from public, anon, authenticated;

-- Opening the link: the first open of a sent quote marks it VIEWED; an open
-- past the expiry marks it EXPIRED. Returns null for unknown/revoked links.
create function public.public_quote_open(p_token_hash text, p_ip inet)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
begin
  v_quote := app.quote_by_token(p_token_hash, true);
  if v_quote.id is null then
    return null;
  end if;

  if v_quote.status in ('sent', 'viewed') and v_quote.token_expires_at <= now() then
    update public.quote q set status = 'expired' where q.id = v_quote.id returning * into v_quote;
  elsif v_quote.status = 'sent' then
    update public.quote q set status = 'viewed', viewed_at = now() where q.id = v_quote.id
    returning * into v_quote;
    insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
    values (v_quote.business_id, null, 'update', 'quote', v_quote.id,
            jsonb_build_object('status', 'viewed', 'ip', p_ip, 'at', v_quote.viewed_at));
  end if;

  return app.public_quote_view(v_quote);
end;
$$;

-- ---------------------------------------------------------------------------
-- The customer's answer
-- ---------------------------------------------------------------------------
-- Approve (with the typed name) or reject (with an optional reason). Repeating
-- the same answer returns it again; changing an answer is refused (55000), as
-- is answering a quote that is no longer open. Returns null for unknown or
-- revoked links.
create function public.public_quote_respond(
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
        viewed_at = coalesce(q.viewed_at, now())
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

  return app.public_quote_view(v_quote) || jsonb_build_object('already', false);
end;
$$;

-- A comment from the customer, while the link is live (not cancelled/superseded).
create function public.public_quote_comment(p_token_hash text, p_body text, p_ip inet)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote%rowtype;
  v_body text := btrim(p_body);
begin
  v_quote := app.quote_by_token(p_token_hash, false);
  if v_quote.id is null then
    return null;
  end if;
  if app.public_quote_state(v_quote) in ('cancelled', 'superseded') then
    raise exception 'quote is closed' using errcode = '55000';
  end if;
  if v_body is null or char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'comment length' using errcode = '22023';
  end if;
  insert into public.quote_comment (business_id, quote_id, author, body, ip)
  values (v_quote.business_id, v_quote.id, 'customer', v_body, p_ip);
  return true;
end;
$$;

revoke execute on function public.public_quote_open(text, inet) from public, anon, authenticated;
revoke execute on function public.public_quote_respond(text, text, text, text, inet) from public, anon, authenticated;
revoke execute on function public.public_quote_comment(text, text, inet) from public, anon, authenticated;
grant execute on function public.public_quote_open(text, inet) to service_role;
grant execute on function public.public_quote_respond(text, text, text, text, inet) to service_role;
grant execute on function public.public_quote_comment(text, text, inet) to service_role;
