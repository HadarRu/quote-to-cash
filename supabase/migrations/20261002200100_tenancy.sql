-- Tenancy: user profiles, businesses, memberships, per-business settings and the
-- membership helpers every RLS policy relies on.

-- ---------------------------------------------------------------------------
-- user_profile (one per auth user; not a business table)
-- ---------------------------------------------------------------------------
create table public.user_profile (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) between 1 and 200),
  phone_e164 public.phone_e164,
  locale text not null default 'he' check (locale in ('he', 'en', 'ar', 'ru')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- business (the tenant)
-- ---------------------------------------------------------------------------
create table public.business (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  legal_name text check (char_length(legal_name) between 1 and 200),
  -- Israeli business / VAT registration number (ע.מ / ח.פ).
  tax_id text check (tax_id ~ '^[0-9]{9}$'),
  phone_e164 public.phone_e164,
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- business_member
-- ---------------------------------------------------------------------------
create table public.business_member (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'EMPLOYEE',
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, user_id),
  unique (business_id, id)
);
create index business_member_user_id_idx on public.business_member (user_id);

-- ---------------------------------------------------------------------------
-- business_settings (1:1 with business)
-- ---------------------------------------------------------------------------
create table public.business_settings (
  business_id uuid primary key references public.business (id) on delete cascade,
  timezone text not null default 'Asia/Jerusalem',
  currency text not null default 'ILS' check (currency = 'ILS'),
  -- VAT in basis points: 1800 = 18%.
  vat_rate_bp integer not null default 1800 check (vat_rate_bp between 0 and 10000),
  quote_valid_days integer not null default 14 check (quote_valid_days between 1 and 365),
  next_quote_number integer not null default 1 check (next_quote_number > 0),
  next_invoice_number integer not null default 1 check (next_invoice_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER: they read business_member without
-- re-entering its RLS policies).
-- ---------------------------------------------------------------------------

-- True when the current user is an active member of the business.
create function app.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_member m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.deleted_at is null
  );
$$;

-- True when the current user is an active member holding one of the given roles.
create function app.has_role(p_business_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_member m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.deleted_at is null
      and m.role = any (p_roles)
  );
$$;

-- True when the current user shares an active business with p_user_id.
create function app.shares_business(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_member mine
    join public.business_member theirs on theirs.business_id = mine.business_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and mine.deleted_at is null
      and theirs.user_id = p_user_id
      and theirs.deleted_at is null
  );
$$;

revoke execute on function app.is_member(uuid), app.has_role(uuid, public.member_role[]),
  app.shares_business(uuid) from public, anon;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.member_role[]),
  app.shares_business(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_business: the only way for a user to create a tenant. Creates the
-- business, its settings and an OWNER membership for the caller atomically.
-- ---------------------------------------------------------------------------
create function public.create_business(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_business_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.business (name) values (p_name) returning id into v_business_id;
  insert into public.business_settings (business_id) values (v_business_id);
  insert into public.business_member (business_id, user_id, role, status)
  values (v_business_id, v_user_id, 'OWNER', 'active');

  return v_business_id;
end;
$$;

revoke execute on function public.create_business(text) from public, anon;
grant execute on function public.create_business(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.user_profile
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.business
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.business_member
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.business_settings
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.user_profile enable row level security;
alter table public.business enable row level security;
alter table public.business_member enable row level security;
alter table public.business_settings enable row level security;

-- user_profile: read own profile and teammates'; write only your own.
create policy user_profile_select on public.user_profile for select to authenticated
  using (id = (select auth.uid()) or app.shares_business(id));
create policy user_profile_insert on public.user_profile for insert to authenticated
  with check (id = (select auth.uid()));
create policy user_profile_update on public.user_profile for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- business: members read; OWNER/ADMIN update; creation only through create_business().
create policy business_select on public.business for select to authenticated
  using (app.is_member(id));
create policy business_update on public.business for update to authenticated
  using (app.has_role(id, '{OWNER,ADMIN}'))
  with check (app.has_role(id, '{OWNER,ADMIN}'));

-- business_member: members read the team; OWNER/ADMIN manage it, and only an
-- OWNER may grant or modify the OWNER role.
create policy business_member_select on public.business_member for select to authenticated
  using (app.is_member(business_id));
create policy business_member_insert on public.business_member for insert to authenticated
  with check (
    app.has_role(business_id, '{OWNER,ADMIN}')
    and (role <> 'OWNER' or app.has_role(business_id, '{OWNER}'))
  );
create policy business_member_update on public.business_member for update to authenticated
  using (
    app.has_role(business_id, '{OWNER,ADMIN}')
    and (role <> 'OWNER' or app.has_role(business_id, '{OWNER}'))
  )
  with check (
    app.has_role(business_id, '{OWNER,ADMIN}')
    and (role <> 'OWNER' or app.has_role(business_id, '{OWNER}'))
  );

-- business_settings: members read; OWNER/ADMIN write.
create policy business_settings_select on public.business_settings for select to authenticated
  using (app.is_member(business_id));
create policy business_settings_insert on public.business_settings for insert to authenticated
  with check (app.has_role(business_id, '{OWNER,ADMIN}'));
create policy business_settings_update on public.business_settings for update to authenticated
  using (app.has_role(business_id, '{OWNER,ADMIN}'))
  with check (app.has_role(business_id, '{OWNER,ADMIN}'));

-- ---------------------------------------------------------------------------
-- Standard setup for operational business tables: updated_at trigger, RLS on,
-- and select/insert/update for active members of the row's business.
-- There are no DELETE policies anywhere: rows are soft-deleted via deleted_at.
-- ---------------------------------------------------------------------------
create function app.setup_tenant_table(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text := (select c.relname from pg_catalog.pg_class c where c.oid = p_table);
begin
  execute format(
    'create trigger set_updated_at before update on %s for each row execute function app.set_updated_at()',
    p_table);
  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy %I on %s for select to authenticated using (app.is_member(business_id))',
    v_name || '_select', p_table);
  execute format(
    'create policy %I on %s for insert to authenticated with check (app.is_member(business_id))',
    v_name || '_insert', p_table);
  execute format(
    'create policy %I on %s for update to authenticated using (app.is_member(business_id)) with check (app.is_member(business_id))',
    v_name || '_update', p_table);
end;
$$;

revoke execute on function app.setup_tenant_table(regclass) from public, anon, authenticated;
