-- Invoices, invoice lines, payments, and the business's SaaS subscription.

create table public.invoice (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  customer_id uuid not null,
  quote_id uuid,
  job_id uuid,
  -- Placeholder default: assign_document_number() always replaces it on insert.
  invoice_number integer not null default 0 check (invoice_number > 0),
  status public.invoice_status not null default 'draft',
  issued_at timestamptz,
  due_date date,
  notes text check (char_length(notes) <= 4000),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  vat_rate_bp integer not null default 1800 check (vat_rate_bp between 0 and 10000),
  vat_minor bigint not null default 0 check (vat_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, invoice_number),
  unique (business_id, id),
  check (discount_minor <= subtotal_minor),
  check (total_minor = subtotal_minor - discount_minor + vat_minor),
  check (status = 'draft' or issued_at is not null),
  foreign key (business_id, customer_id) references public.customer (business_id, id),
  foreign key (business_id, quote_id) references public.quote (business_id, id),
  foreign key (business_id, job_id) references public.job (business_id, id)
);
create index invoice_business_status_updated_idx on public.invoice (business_id, status, updated_at);
create index invoice_business_customer_idx on public.invoice (business_id, customer_id);

create trigger assign_invoice_number before insert or update on public.invoice
  for each row execute function app.assign_document_number('invoice_number', 'next_invoice_number');

create table public.invoice_item (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  invoice_id uuid not null,
  service_id uuid,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text not null default 'unit' check (char_length(unit) between 1 and 30),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (line_total_minor = round(quantity * unit_price_minor)),
  foreign key (business_id, invoice_id) references public.invoice (business_id, id) on delete cascade,
  foreign key (business_id, service_id) references public.service (business_id, id)
);
create index invoice_item_invoice_idx on public.invoice_item (business_id, invoice_id, sort_order);

create table public.payment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  invoice_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  method public.payment_method not null,
  status public.payment_status not null default 'pending',
  paid_at timestamptz,
  reference text check (char_length(reference) <= 200),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (status <> 'succeeded' or paid_at is not null),
  foreign key (business_id, invoice_id) references public.invoice (business_id, id)
);
create index payment_invoice_idx on public.payment (business_id, invoice_id);

-- One SaaS subscription per business. Written only by the billing backend
-- (service_role); members can read it.
create table public.subscription (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.business (id) on delete cascade,
  plan_code text not null check (char_length(plan_code) between 1 and 50),
  status public.subscription_status not null default 'trialing',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  provider text check (char_length(provider) between 1 and 50),
  provider_subscription_id text unique check (char_length(provider_subscription_id) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (current_period_end is null or current_period_start is null
         or current_period_end > current_period_start)
);

select app.setup_tenant_table('public.invoice');
select app.setup_tenant_table('public.invoice_item');
select app.setup_tenant_table('public.payment');

create trigger set_updated_at before update on public.subscription
  for each row execute function app.set_updated_at();
alter table public.subscription enable row level security;
create policy subscription_select on public.subscription for select to authenticated
  using (app.is_member(business_id));
