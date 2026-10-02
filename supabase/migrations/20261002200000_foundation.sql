-- Foundation: extensions, the private `app` schema, enums and shared trigger helpers.

create extension if not exists btree_gist with schema extensions;

-- Internal helpers live in `app` (not exposed through the Data API).
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums: roles and every status
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('OWNER', 'ADMIN', 'EMPLOYEE');
create type public.member_status as enum ('invited', 'active', 'disabled');
create type public.quote_status as enum ('draft', 'sent', 'viewed', 'approved', 'rejected', 'expired', 'cancelled');
create type public.quote_slot_option_status as enum ('offered', 'selected', 'declined');
create type public.appointment_status as enum ('proposed', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.job_status as enum ('scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled');
create type public.invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'void');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');
create type public.payment_method as enum ('cash', 'bank_transfer', 'credit_card', 'bit', 'paybox', 'check', 'other');
create type public.notification_channel as enum ('sms', 'whatsapp', 'email', 'push', 'in_app');
create type public.notification_status as enum ('queued', 'sent', 'delivered', 'failed', 'read');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'expired');
create type public.file_kind as enum ('logo', 'quote_attachment', 'job_photo', 'invoice_pdf', 'signature', 'other');
create type public.audit_action as enum ('insert', 'update', 'delete');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

-- Keeps updated_at current on every UPDATE.
create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Validates E.164 phone numbers (same rule as phoneE164Schema in packages/types).
create domain public.phone_e164 as text
  check (value ~ '^\+[1-9][0-9]{1,14}$');
