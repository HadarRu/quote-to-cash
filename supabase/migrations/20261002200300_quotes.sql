-- Quotes, their line items and the time slots offered to the customer.

-- Per-business document numbers (quotes, invoices) are always assigned by the
-- server from business_settings on INSERT and can never change on UPDATE, so
-- numbering cannot be skipped or forged by a client. SECURITY DEFINER so any
-- member (not only OWNER/ADMIN, who may write settings) can draw a number; the
-- row lock on the settings row serialises concurrent inserts.
create function app.assign_document_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column text := tg_argv[0];      -- 'quote_number' | 'invoice_number'
  v_counter text := tg_argv[1];     -- 'next_quote_number' | 'next_invoice_number'
  v_number integer;
begin
  if tg_op = 'UPDATE' then
    return jsonb_populate_record(new, jsonb_build_object(v_column, to_jsonb(old) -> v_column));
  end if;

  execute format(
    'update public.business_settings set %1$I = %1$I + 1 where business_id = $1 returning %1$I - 1',
    v_counter)
  into v_number
  using new.business_id;

  if v_number is null then
    raise exception 'business_settings missing for business %', new.business_id
      using errcode = 'P0002';
  end if;

  return jsonb_populate_record(new, jsonb_build_object(v_column, v_number));
end;
$$;

revoke execute on function app.assign_document_number() from public, anon, authenticated;

create table public.quote (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  customer_id uuid not null,
  address_id uuid,
  -- Placeholder default: assign_document_number() always replaces it on insert.
  quote_number integer not null default 0 check (quote_number > 0),
  status public.quote_status not null default 'draft',
  title text check (char_length(title) between 1 and 200),
  notes text check (char_length(notes) <= 4000),
  valid_until date,
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  vat_rate_bp integer not null default 1800 check (vat_rate_bp between 0 and 10000),
  vat_minor bigint not null default 0 check (vat_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  -- SHA-256 of the customer link token (peppered with TOKEN_PEPPER); never the raw token.
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz,
  viewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (business_id, quote_number),
  unique (business_id, id),
  check (discount_minor <= subtotal_minor),
  check (total_minor = subtotal_minor - discount_minor + vat_minor),
  foreign key (business_id, customer_id) references public.customer (business_id, id),
  foreign key (business_id, address_id) references public.customer_address (business_id, id)
);
create index quote_business_status_updated_idx on public.quote (business_id, status, updated_at);
create index quote_business_customer_idx on public.quote (business_id, customer_id);

create trigger assign_quote_number before insert or update on public.quote
  for each row execute function app.assign_document_number('quote_number', 'next_quote_number');

create table public.quote_item (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  quote_id uuid not null,
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
  foreign key (business_id, quote_id) references public.quote (business_id, id) on delete cascade,
  foreign key (business_id, service_id) references public.service (business_id, id)
);
create index quote_item_quote_idx on public.quote_item (business_id, quote_id, sort_order);

create table public.quote_slot_option (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  quote_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.quote_slot_option_status not null default 'offered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at),
  foreign key (business_id, quote_id) references public.quote (business_id, id) on delete cascade
);
create index quote_slot_option_quote_idx on public.quote_slot_option (business_id, quote_id, starts_at);
create unique index quote_slot_option_one_selected_key on public.quote_slot_option (quote_id)
  where status = 'selected' and deleted_at is null;

select app.setup_tenant_table('public.quote');
select app.setup_tenant_table('public.quote_item');
select app.setup_tenant_table('public.quote_slot_option');
