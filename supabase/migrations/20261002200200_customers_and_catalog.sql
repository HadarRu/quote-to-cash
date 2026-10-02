-- Customers, their addresses, and the business's service catalog.
-- Child rows reference parents through (business_id, id) so a row can never
-- point at another tenant's data.

create table public.customer (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 200),
  phone_e164 public.phone_e164 not null,
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id)
);
create unique index customer_business_phone_key on public.customer (business_id, phone_e164)
  where deleted_at is null;
create index customer_business_updated_idx on public.customer (business_id, updated_at desc);

create table public.customer_address (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  customer_id uuid not null,
  label text check (char_length(label) between 1 and 100),
  street text not null check (char_length(street) between 1 and 200),
  house_number text check (char_length(house_number) between 1 and 20),
  apartment text check (char_length(apartment) between 1 and 20),
  city text not null check (char_length(city) between 1 and 100),
  postal_code text check (postal_code ~ '^[0-9]{7}$'),
  access_notes text check (char_length(access_notes) <= 1000),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customer (business_id, id) on delete cascade
);
create index customer_address_customer_idx on public.customer_address (business_id, customer_id);
create unique index customer_address_one_primary_key on public.customer_address (customer_id)
  where is_primary and deleted_at is null;

create table public.service_category (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id)
);
create unique index service_category_business_name_key on public.service_category (business_id, name)
  where deleted_at is null;

create table public.service (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  category_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 4000),
  unit text not null default 'unit' check (char_length(unit) between 1 and 30),
  default_price_minor bigint not null default 0 check (default_price_minor >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, category_id) references public.service_category (business_id, id)
);
create index service_business_category_idx on public.service (business_id, category_id);

select app.setup_tenant_table('public.customer');
select app.setup_tenant_table('public.customer_address');
select app.setup_tenant_table('public.service_category');
select app.setup_tenant_table('public.service');
