-- Jobs (the work itself) and appointments (scheduled visits).

create table public.job (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  customer_id uuid not null,
  quote_id uuid,
  address_id uuid,
  assigned_member_id uuid,
  status public.job_status not null default 'scheduled',
  title text not null check (char_length(title) between 1 and 200),
  notes text check (char_length(notes) <= 4000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  foreign key (business_id, customer_id) references public.customer (business_id, id),
  foreign key (business_id, quote_id) references public.quote (business_id, id),
  foreign key (business_id, address_id) references public.customer_address (business_id, id),
  foreign key (business_id, assigned_member_id) references public.business_member (business_id, id)
);
create index job_business_status_updated_idx on public.job (business_id, status, updated_at);
create unique index job_quote_key on public.job (quote_id) where quote_id is not null and deleted_at is null;

create table public.appointment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  customer_id uuid not null,
  quote_id uuid,
  job_id uuid,
  address_id uuid,
  assigned_member_id uuid,
  status public.appointment_status not null default 'proposed',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at),
  foreign key (business_id, customer_id) references public.customer (business_id, id),
  foreign key (business_id, quote_id) references public.quote (business_id, id),
  foreign key (business_id, job_id) references public.job (business_id, id),
  foreign key (business_id, address_id) references public.customer_address (business_id, id),
  foreign key (business_id, assigned_member_id) references public.business_member (business_id, id),
  -- A business cannot have two confirmed appointments that overlap in time.
  -- Ranges are half-open [starts_at, ends_at), so back-to-back visits are allowed.
  constraint appointment_no_overlapping_confirmed exclude using gist (
    business_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed' and deleted_at is null)
);
create index appointment_business_starts_idx on public.appointment (business_id, starts_at);

select app.setup_tenant_table('public.job');
select app.setup_tenant_table('public.appointment');
