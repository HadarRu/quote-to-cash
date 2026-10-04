-- Invoicing behind a provider interface (InvoiceProvider in packages/types).
-- The first provider is MANUAL: the app builds the invoice from the quote
-- snapshot of a COMPLETED job, the owner issues the document in their own
-- invoicing software and records its number here.
--
-- Rules enforced here (the app and the `invoices` Edge Function mirror them,
-- the database decides):
-- * Only COMPLETED jobs can be invoiced, and a job has at most one invoice
--   that is not VOIDED.
-- * Creating an invoice is idempotent per idempotency key.
-- * Status changes follow INVOICE_TRANSITIONS (packages/types/src/invoice.ts).
-- * Invoices, their lines and payments are never deleted or edited by
--   clients; an invoice is VOIDED instead. All writes go through the
--   service_role functions below, called only by the `invoices` Edge Function.
--
-- TODO(tax-authority): no Israeli Tax Authority logic is implemented. A real
-- provider must handle allocation numbers (מספר הקצאה) for invoices above the
-- threshold and the legal document types (חשבונית מס, חשבונית מס/קבלה, קבלה).
-- Under the manual provider this happens in the owner's invoicing software.

-- ---------------------------------------------------------------------------
-- Statuses: NOT_ISSUED, ISSUED, SENT, PAID, FAILED, VOIDED
-- (replaces draft / issued / partially_paid / paid / void, unused until now)
-- ---------------------------------------------------------------------------
alter table public.invoice drop constraint invoice_check2;
alter table public.invoice alter column status drop default;
alter type public.invoice_status rename to invoice_status_old;
create type public.invoice_status as enum ('not_issued', 'issued', 'sent', 'paid', 'failed', 'voided');
alter table public.invoice alter column status type public.invoice_status using (
  case status::text
    when 'draft' then 'not_issued'
    when 'partially_paid' then 'issued'
    when 'void' then 'voided'
    else status::text
  end
)::public.invoice_status;
alter table public.invoice alter column status set default 'not_issued';
drop type public.invoice_status_old;

-- ---------------------------------------------------------------------------
-- Provider per business
-- ---------------------------------------------------------------------------
alter table public.business_settings
  add column invoice_provider text not null default 'manual' check (invoice_provider in ('manual'));

-- ---------------------------------------------------------------------------
-- Invoice columns
-- ---------------------------------------------------------------------------
alter table public.invoice
  -- The provider that handles this invoice (copied from the business when created).
  add column provider text not null default 'manual' check (provider in ('manual')),
  -- Client-generated key of the create request: a retry returns the same invoice.
  add column idempotency_key uuid unique,
  -- Number of the legal document (entered by the owner, or returned by a provider).
  add column document_number text check (char_length(document_number) between 1 and 50),
  -- The provider's own id for the document; null for the manual provider.
  add column provider_document_id text check (char_length(provider_document_id) between 1 and 200),
  -- What the invoice is for: business, customer, lines and totals from the
  -- quote snapshot, plus the job. Source of the data sheet.
  add column snapshot jsonb,
  add column sent_at timestamptz,
  add column paid_at timestamptz,
  add column failed_at timestamptz,
  add column failure_reason text check (char_length(failure_reason) <= 500),
  add column voided_at timestamptz,
  add column void_reason text check (char_length(void_reason) <= 500),
  add constraint invoice_issued_has_number check (
    status not in ('issued', 'sent', 'paid') or (issued_at is not null and document_number is not null)),
  add constraint invoice_sent_has_time check (status <> 'sent' or sent_at is not null),
  add constraint invoice_paid_has_time check (status <> 'paid' or paid_at is not null),
  add constraint invoice_failed_has_time check (status <> 'failed' or failed_at is not null),
  add constraint invoice_voided_has_time check (status <> 'voided' or voided_at is not null);

-- One live invoice per job; a voided one can be replaced.
create unique index invoice_job_active_key on public.invoice (job_id)
  where job_id is not null and status <> 'voided' and deleted_at is null;
-- A legal document number is used once per business.
create unique index invoice_document_number_key on public.invoice (business_id, document_number)
  where document_number is not null;

alter table public.invoice_item
  add column vat_included boolean not null default false;

-- ---------------------------------------------------------------------------
-- Privileges: clients only read invoices, their lines and payments.
-- ---------------------------------------------------------------------------
revoke insert, update on public.invoice, public.invoice_item, public.payment from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Transitions (mirror of INVOICE_TRANSITIONS in packages/types/src/invoice.ts)
-- ---------------------------------------------------------------------------
create function app.invoice_transition_allowed(p_from public.invoice_status, p_to public.invoice_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'not_issued' then p_to in ('issued', 'failed', 'voided')
    when 'failed' then p_to in ('issued', 'voided')
    when 'issued' then p_to in ('sent', 'paid', 'voided')
    when 'sent' then p_to in ('paid', 'voided')
    else false
  end;
$$;

-- Invoices are never deleted and never change what they bill; only the
-- status (along an allowed transition) and its details move.
create function app.guard_invoice_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.id, old.business_id, old.customer_id, old.quote_id, old.job_id, old.invoice_number,
      old.provider, old.idempotency_key, old.subtotal_minor, old.discount_minor, old.vat_rate_bp,
      old.vat_minor, old.total_minor, old.snapshot, old.created_at)
     is distinct from
     (new.id, new.business_id, new.customer_id, new.quote_id, new.job_id, new.invoice_number,
      new.provider, new.idempotency_key, new.subtotal_minor, new.discount_minor, new.vat_rate_bp,
      new.vat_minor, new.total_minor, new.snapshot, new.created_at) then
    raise exception 'invoice content cannot change' using errcode = '55000';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'invoices cannot be deleted; void them instead' using errcode = '55000';
  end if;
  if old.document_number is not null and new.document_number is distinct from old.document_number then
    raise exception 'document number cannot change' using errcode = '55000';
  end if;
  if old.provider_document_id is not null
     and new.provider_document_id is distinct from old.provider_document_id then
    raise exception 'provider document id cannot change' using errcode = '55000';
  end if;
  if new.status <> old.status and not app.invoice_transition_allowed(old.status, new.status) then
    raise exception 'invoice cannot move from % to %', old.status, new.status using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_invoice_update before update on public.invoice
  for each row execute function app.guard_invoice_update();

create function app.reject_invoice_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'invoices, invoice lines and payments are never deleted; void the invoice instead'
    using errcode = '55000';
end;
$$;

create trigger no_delete before delete on public.invoice
  for each row execute function app.reject_invoice_delete();
create trigger no_delete before delete on public.invoice_item
  for each row execute function app.reject_invoice_delete();
create trigger no_delete before delete on public.payment
  for each row execute function app.reject_invoice_delete();

create function app.reject_invoice_item_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'invoice lines cannot change' using errcode = '55000';
end;
$$;

create trigger no_update before update on public.invoice_item
  for each row execute function app.reject_invoice_item_update();

-- The invoice row, locked, when p_user_id is an active member of its business.
create function app.lock_invoice(p_user_id uuid, p_invoice_id uuid)
returns public.invoice
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoice%rowtype;
begin
  select * into v_invoice from public.invoice i where i.id = p_invoice_id for update;
  if not found or v_invoice.deleted_at is not null or not exists (
    select 1 from public.business_member m
    where m.business_id = v_invoice.business_id and m.user_id = p_user_id
      and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'invoice not found' using errcode = '42501';
  end if;
  return v_invoice;
end;
$$;

revoke execute on function app.lock_invoice(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_invoice: builds a NOT_ISSUED invoice and its lines from the quote
-- snapshot of a COMPLETED job. Idempotent per key: a retry returns the same
-- invoice (already_created = true) and draws no new number.
-- ---------------------------------------------------------------------------
create function public.create_invoice(p_user_id uuid, p_job_id uuid, p_idempotency_key uuid)
returns table (invoice_id uuid, already_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.invoice%rowtype;
  v_job public.job%rowtype;
  v_snapshot jsonb;
  v_provider text;
  v_invoice_id uuid;
begin
  select * into v_job from public.job j where j.id = p_job_id for update;
  if not found or v_job.deleted_at is not null or not exists (
    select 1 from public.business_member m
    where m.business_id = v_job.business_id and m.user_id = p_user_id
      and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception 'job not found' using errcode = '42501';
  end if;

  select * into v_existing from public.invoice i where i.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.job_id is distinct from p_job_id then
      raise exception 'idempotency key already used' using errcode = '42501';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  if v_job.status <> 'completed' then
    raise exception 'only completed jobs can be invoiced' using errcode = '55000';
  end if;
  if exists (select 1 from public.invoice i
             where i.job_id = p_job_id and i.status <> 'voided' and i.deleted_at is null) then
    raise exception 'job already has an invoice' using errcode = '23505';
  end if;

  select q.sent_snapshot into v_snapshot from public.quote q where q.id = v_job.quote_id;
  if v_snapshot is null or jsonb_array_length(coalesce(v_snapshot -> 'items', '[]')) = 0 then
    raise exception 'job has no sent quote to invoice from' using errcode = '22023';
  end if;

  select s.invoice_provider into v_provider from public.business_settings s
  where s.business_id = v_job.business_id;

  insert into public.invoice (business_id, customer_id, quote_id, job_id, status, provider,
                              idempotency_key, subtotal_minor, discount_minor, vat_rate_bp,
                              vat_minor, total_minor, snapshot)
  values (v_job.business_id, v_job.customer_id, v_job.quote_id, v_job.id, 'not_issued',
          coalesce(v_provider, 'manual'), p_idempotency_key,
          (v_snapshot #>> '{totals,subtotal_minor}')::bigint,
          (v_snapshot #>> '{totals,discount_minor}')::bigint,
          (v_snapshot #>> '{totals,vat_rate_bp}')::integer,
          (v_snapshot #>> '{totals,vat_minor}')::bigint,
          (v_snapshot #>> '{totals,total_minor}')::bigint,
          jsonb_build_object(
            'quote_number', v_snapshot -> 'quote_number',
            'business', v_snapshot -> 'business',
            'customer', v_snapshot -> 'customer',
            'items', v_snapshot -> 'items',
            'discount_type', v_snapshot -> 'discount_type',
            'discount_value', v_snapshot -> 'discount_value',
            'totals', v_snapshot -> 'totals',
            'job', jsonb_build_object('title', v_job.title, 'completed_at', v_job.completed_at)))
  returning id into v_invoice_id;

  insert into public.invoice_item (business_id, invoice_id, description, quantity, unit,
                                   unit_price_minor, line_total_minor, vat_included, sort_order)
  select v_job.business_id, v_invoice_id, item ->> 'description', (item ->> 'quantity')::numeric,
         item ->> 'unit', (item ->> 'unit_price_minor')::bigint,
         round((item ->> 'quantity')::numeric * (item ->> 'unit_price_minor')::bigint),
         coalesce((item ->> 'vat_included')::boolean, false), n::integer
  from jsonb_array_elements(v_snapshot -> 'items') with ordinality as t(item, n);

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
  values (v_job.business_id, p_user_id, 'insert', 'invoice', v_invoice_id,
          jsonb_build_object('status', 'not_issued', 'job_id', p_job_id));

  return query select v_invoice_id, false;
end;
$$;

revoke execute on function public.create_invoice(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- transition_invoice: moves an invoice to p_status. Idempotent: an invoice
-- already in p_status is left alone (changed = false). p_details:
--   issued: document_number (required), provider_document_id, issued_at
--   sent:   sent_at
--   paid:   method (payment_method, required), paid_at; records the payment
--   failed: reason
--   voided: reason
-- ---------------------------------------------------------------------------
create function public.transition_invoice(
  p_user_id uuid,
  p_invoice_id uuid,
  p_status public.invoice_status,
  p_details jsonb default '{}'
)
returns table (status public.invoice_status, changed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoice%rowtype := app.lock_invoice(p_user_id, p_invoice_id);
  v_details jsonb := coalesce(p_details, '{}');
  v_now timestamptz := now();
  v_paid_at timestamptz;
begin
  if v_invoice.status = p_status then
    return query select v_invoice.status, false;
    return;
  end if;
  if not app.invoice_transition_allowed(v_invoice.status, p_status) then
    raise exception 'invoice cannot move from % to %', v_invoice.status, p_status using errcode = '55000';
  end if;

  case p_status
    when 'issued' then
      if nullif(btrim(v_details ->> 'document_number'), '') is null then
        raise exception 'document number is required' using errcode = '22023';
      end if;
      update public.invoice i set
        status = 'issued',
        document_number = btrim(v_details ->> 'document_number'),
        provider_document_id = coalesce(v_details ->> 'provider_document_id', i.provider_document_id),
        issued_at = coalesce((v_details ->> 'issued_at')::timestamptz, v_now),
        failure_reason = null
      where i.id = p_invoice_id;
    when 'sent' then
      update public.invoice i set
        status = 'sent', sent_at = coalesce((v_details ->> 'sent_at')::timestamptz, v_now)
      where i.id = p_invoice_id;
    when 'paid' then
      if v_details ->> 'method' is null then
        raise exception 'payment method is required' using errcode = '22023';
      end if;
      v_paid_at := coalesce((v_details ->> 'paid_at')::timestamptz, v_now);
      if v_paid_at > v_now + interval '1 day' then
        raise exception 'payment date is in the future' using errcode = '22023';
      end if;
      update public.invoice i set status = 'paid', paid_at = v_paid_at where i.id = p_invoice_id;
      insert into public.payment (business_id, invoice_id, amount_minor, method, status, paid_at)
      values (v_invoice.business_id, p_invoice_id, v_invoice.total_minor,
              (v_details ->> 'method')::public.payment_method, 'succeeded', v_paid_at);
    when 'failed' then
      update public.invoice i set
        status = 'failed', failed_at = v_now, failure_reason = left(v_details ->> 'reason', 500)
      where i.id = p_invoice_id;
    when 'voided' then
      update public.invoice i set
        status = 'voided', voided_at = v_now,
        void_reason = left(nullif(btrim(v_details ->> 'reason'), ''), 500)
      where i.id = p_invoice_id;
    else
      raise exception 'invoice cannot move to %', p_status using errcode = '55000';
  end case;

  insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, old_data, new_data)
  values (v_invoice.business_id, p_user_id, 'update', 'invoice', p_invoice_id,
          jsonb_build_object('status', v_invoice.status),
          jsonb_build_object('status', p_status) || v_details);

  return query select p_status, true;
end;
$$;

revoke execute on function public.transition_invoice(uuid, uuid, public.invoice_status, jsonb)
  from public, anon, authenticated;
grant execute on function public.transition_invoice(uuid, uuid, public.invoice_status, jsonb) to service_role;
