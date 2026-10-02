-- Notifications, file metadata (objects live in Supabase Storage) and the audit log.

create table public.notification (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  -- Exactly one recipient: a team member (in-app/push) or a customer (sms/whatsapp/email).
  recipient_user_id uuid references auth.users (id) on delete cascade,
  customer_id uuid,
  channel public.notification_channel not null,
  status public.notification_status not null default 'queued',
  template text not null check (char_length(template) between 1 and 100),
  payload jsonb not null default '{}'::jsonb,
  to_address text check (char_length(to_address) <= 320),
  sent_at timestamptz,
  read_at timestamptz,
  error text check (char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (num_nonnulls(recipient_user_id, customer_id) = 1),
  foreign key (business_id, customer_id) references public.customer (business_id, id)
);
create index notification_business_status_idx on public.notification (business_id, status, created_at);
create index notification_recipient_idx on public.notification (recipient_user_id, created_at desc)
  where recipient_user_id is not null;

create table public.file (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  kind public.file_kind not null default 'other',
  bucket text not null check (char_length(bucket) between 1 and 100),
  storage_path text not null check (char_length(storage_path) between 1 and 1024),
  mime_type text check (char_length(mime_type) <= 255),
  size_bytes bigint check (size_bytes >= 0),
  customer_id uuid,
  quote_id uuid,
  job_id uuid,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bucket, storage_path),
  foreign key (business_id, customer_id) references public.customer (business_id, id),
  foreign key (business_id, quote_id) references public.quote (business_id, id),
  foreign key (business_id, job_id) references public.job (business_id, id),
  foreign key (business_id, invoice_id) references public.invoice (business_id, id)
);
create index file_business_kind_idx on public.file (business_id, kind);

select app.setup_tenant_table('public.notification');
select app.setup_tenant_table('public.file');

-- ---------------------------------------------------------------------------
-- audit_log: insert-only. No UPDATE/DELETE privileges, no UPDATE/DELETE
-- policies, and a trigger that rejects UPDATE/DELETE for every role.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- No cascade: deleting a business that has audit history is refused.
  business_id uuid not null references public.business (id),
  -- Plain uuid, not a FK: the record must outlive the user account.
  actor_user_id uuid default auth.uid(),
  action public.audit_action not null,
  table_name text not null check (char_length(table_name) between 1 and 63),
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_business_created_idx on public.audit_log (business_id, created_at desc);

create function app.reject_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is insert-only' using errcode = '42501';
end;
$$;

create trigger audit_log_insert_only before update or delete on public.audit_log
  for each row execute function app.reject_audit_log_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.reject_audit_log_change();

revoke update, delete, truncate on public.audit_log from anon, authenticated, service_role;

alter table public.audit_log enable row level security;
-- Members write entries for their own business, as themselves.
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (app.is_member(business_id) and actor_user_id = (select auth.uid()));
-- Only OWNER/ADMIN read the log.
create policy audit_log_select on public.audit_log for select to authenticated
  using (app.has_role(business_id, '{OWNER,ADMIN}'));
