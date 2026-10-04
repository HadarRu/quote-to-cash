-- Invoicing: only COMPLETED jobs, idempotent creation from the quote snapshot,
-- status transitions, payments, and no deletion (void only). Relies on
-- supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

create temp table ids as select
  '10000000-0000-4000-a000-000000000001'::uuid as business_a,
  '00000000-0000-4000-a000-000000000001'::uuid as owner_a,
  '00000000-0000-4000-b000-000000000001'::uuid as owner_b,
  (select id from public.customer where business_id = '10000000-0000-4000-a000-000000000001') as customer_a,
  '80000000-0000-4000-a000-000000000001'::uuid as quote1,
  '81000000-0000-4000-a000-000000000001'::uuid as job1,
  '81000000-0000-4000-a000-000000000002'::uuid as job_no_quote,
  '82000000-0000-4000-a000-000000000001'::uuid as key1,
  '82000000-0000-4000-a000-000000000002'::uuid as key2,
  '82000000-0000-4000-a000-000000000003'::uuid as key3;
grant select on ids to authenticated, service_role;

-- A sent and approved quote with its snapshot (as the quotes Edge Function
-- writes it), and a job for it that is still scheduled.
insert into public.quote (id, business_id, customer_id, title, subtotal_minor, discount_minor,
                          vat_rate_bp, vat_minor, total_minor)
select quote1, business_a, customer_a, 'תאורה בחצר', 60000, 5000, 1800, 9900, 64900 from ids;
update public.quote set
  status = 'approved', quote_number = app.take_quote_number((select business_a from ids)),
  sent_at = now(), approved_at = now(),
  sent_snapshot = jsonb_build_object(
    'quote_number', 7, 'revision', 1, 'title', 'תאורה בחצר', 'notes', null, 'valid_until', current_date,
    'business', jsonb_build_object('name', 'כהן חשמל', 'tax_status', 'osek_murshe', 'tax_id', '123456789',
                                   'phone', '+972500000001', 'email', null, 'logo_path', null),
    'customer', jsonb_build_object('full_name', 'משה ישראלי', 'phone', '+972541112222', 'address', 'הרצל 5, חיפה'),
    'items', jsonb_build_array(
      jsonb_build_object('description', 'גוף תאורה', 'quantity', '2', 'unit', 'unit',
                         'unit_price_minor', 20000, 'vat_included', false, 'line_total_minor', 40000),
      jsonb_build_object('description', 'חיווט', 'quantity', '12.5', 'unit', 'meter',
                         'unit_price_minor', 1600, 'vat_included', false, 'line_total_minor', 20000)),
    'discount_type', 'amount', 'discount_value', 5000,
    'totals', jsonb_build_object('subtotal_minor', 60000, 'discount_minor', 5000, 'vat_rate_bp', 1800,
                                 'vat_minor', 9900, 'total_minor', 64900),
    'photos', '[]'::jsonb)
where id = (select quote1 from ids);
insert into public.job (id, business_id, customer_id, quote_id, title)
select job1, business_a, customer_a, quote1, 'תאורה בחצר' from ids;
insert into public.job (id, business_id, customer_id, title, status)
select job_no_quote, business_a, customer_a, 'עבודה בלי הצעה', 'completed' from ids;

create function pg_temp.create(p_user uuid, p_job uuid, p_key uuid)
returns table (invoice_id uuid, already_created boolean) language sql as $$
  select * from public.create_invoice(p_user, p_job, p_key)
$$;
create function pg_temp.move(p_status public.invoice_status, p_details jsonb default '{}')
returns table (status public.invoice_status, changed boolean) language sql as $$
  select * from public.transition_invoice((select owner_a from ids),
    (select id from public.invoice where idempotency_key = (select key1 from ids)), p_status, p_details)
$$;

-- ---------------------------------------------------------------- clients cannot write
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

select throws_ok($$ select * from pg_temp.create((select owner_a from ids), (select job1 from ids), (select key1 from ids)) $$,
  '42501', null, 'create_invoice is not callable by clients (only by the Edge Function)');
select throws_ok($$ insert into public.invoice (business_id, customer_id) select business_a, customer_a from ids $$,
  '42501', null, 'clients cannot insert invoices');
select throws_ok($$ update public.invoice set status = 'paid' where business_id = (select business_a from ids) $$,
  '42501', null, 'clients cannot update invoices');
select throws_ok($$ delete from public.invoice where business_id = (select business_a from ids) $$,
  '42501', null, 'clients cannot delete invoices');
select throws_ok($$ insert into public.payment (business_id, invoice_id, amount_minor, method)
                    select business_id, id, 100, 'cash' from public.invoice limit 1 $$,
  '42501', null, 'clients cannot record payments directly');

-- ---------------------------------------------------------------- only COMPLETED jobs
reset role;
set local role service_role;

select throws_ok($$ select * from pg_temp.create((select owner_a from ids), (select job1 from ids), (select key1 from ids)) $$,
  '55000', 'only completed jobs can be invoiced', 'a scheduled job cannot be invoiced');
update public.job set status = 'in_progress' where id = (select job1 from ids);
select throws_ok($$ select * from pg_temp.create((select owner_a from ids), (select job1 from ids), (select key1 from ids)) $$,
  '55000', 'only completed jobs can be invoiced', 'a job in progress cannot be invoiced');
select throws_ok($$ select * from pg_temp.create((select owner_a from ids), (select job_no_quote from ids), (select key3 from ids)) $$,
  '22023', null, 'a completed job without a sent quote cannot be invoiced');
update public.job set status = 'completed', completed_at = now() where id = (select job1 from ids);
select throws_ok($$ select * from pg_temp.create((select owner_b from ids), (select job1 from ids), (select key1 from ids)) $$,
  '42501', null, 'a member of another business cannot invoice the job');

-- ---------------------------------------------------------------- creation and idempotency
select results_eq(
  $$ select already_created from pg_temp.create((select owner_a from ids), (select job1 from ids), (select key1 from ids)) $$,
  $$ values (false) $$, 'a completed job is invoiced');
select results_eq(
  $$ select status::text, provider, invoice_number, subtotal_minor, discount_minor, vat_minor, total_minor,
            snapshot #>> '{customer,full_name}', snapshot #>> '{job,title}'
     from public.invoice where idempotency_key = (select key1 from ids) $$,
  $$ values ('not_issued', 'manual', 2, 60000::bigint, 5000::bigint, 9900::bigint, 64900::bigint,
             'משה ישראלי', 'תאורה בחצר') $$,
  'NOT_ISSUED, manual provider, next internal number, totals and data from the quote snapshot');
select results_eq(
  $$ select description, quantity, unit_price_minor, line_total_minor, sort_order from public.invoice_item
     where invoice_id = (select id from public.invoice where idempotency_key = (select key1 from ids))
     order by sort_order $$,
  $$ values ('גוף תאורה', 2.000::numeric, 20000::bigint, 40000::bigint, 1),
            ('חיווט', 12.500::numeric, 1600::bigint, 20000::bigint, 2) $$,
  'invoice lines copied from the snapshot, in order');
select results_eq(
  $$ select already_created from pg_temp.create((select owner_a from ids), (select job1 from ids), (select key1 from ids)) $$,
  $$ values (true) $$, 'a retry with the same key returns the same invoice');
select is((select count(*) from public.invoice where job_id = (select job1 from ids)), 1::bigint,
  'the retry created no second invoice');
select is((select next_invoice_number from public.business_settings where business_id = (select business_a from ids)), 3,
  'the retry drew no new number');
select throws_ok($$ select * from pg_temp.create((select owner_a from ids), (select job1 from ids), (select key2 from ids)) $$,
  '23505', null, 'a second invoice for the same job is refused');
select throws_ok($$ select * from pg_temp.create((select owner_a from ids), (select job_no_quote from ids), (select key1 from ids)) $$,
  '42501', null, 'a key cannot be reused for another job');

-- ---------------------------------------------------------------- transitions
select throws_ok($$ select * from pg_temp.move('paid', '{"method": "cash"}') $$,
  '55000', null, 'NOT_ISSUED cannot be marked paid');
select throws_ok($$ select * from pg_temp.move('sent') $$,
  '55000', null, 'NOT_ISSUED cannot be marked sent');
select throws_ok($$ select * from pg_temp.move('issued', '{"document_number": "  "}') $$,
  '22023', null, 'issuing needs the document number');
select results_eq($$ select status::text, changed from pg_temp.move('issued', '{"document_number": "30045"}') $$,
  $$ values ('issued', true) $$, 'the owner records the document number: ISSUED');
select results_eq($$ select status::text, changed from pg_temp.move('issued', '{"document_number": "30045"}') $$,
  $$ values ('issued', false) $$, 'recording it again is harmless');
select throws_ok($$ update public.invoice set document_number = '999' where idempotency_key = (select key1 from ids) $$,
  '55000', null, 'the document number cannot change once recorded');
select throws_ok($$ update public.invoice set total_minor = 1, subtotal_minor = 1, vat_minor = 0, discount_minor = 0
                    where idempotency_key = (select key1 from ids) $$,
  '55000', null, 'the billed amounts cannot change');
select results_eq($$ select status::text from pg_temp.move('sent') $$, $$ values ('sent') $$, 'ISSUED -> SENT');
select throws_ok($$ select * from pg_temp.move('paid') $$,
  '22023', null, 'marking paid needs a payment method');
select results_eq($$ select status::text, changed from pg_temp.move('paid', '{"method": "bit"}') $$,
  $$ values ('paid', true) $$, 'SENT -> PAID');
select results_eq($$ select status::text, changed from pg_temp.move('paid', '{"method": "bit"}') $$,
  $$ values ('paid', false) $$, 'marking paid again is harmless');
select results_eq(
  $$ select count(*), sum(amount_minor), min(method::text), min(status::text) from public.payment
     where invoice_id = (select id from public.invoice where idempotency_key = (select key1 from ids)) $$,
  $$ values (1::bigint, 64900::numeric, 'bit', 'succeeded') $$,
  'one payment for the full total');
select throws_ok($$ select * from pg_temp.move('voided') $$,
  '55000', null, 'a PAID invoice cannot be voided');

-- ---------------------------------------------------------------- no deletion: void only
select throws_ok($$ delete from public.invoice where idempotency_key = (select key1 from ids) $$,
  '55000', null, 'an invoice cannot be deleted, even by the server');
select throws_ok($$ delete from public.payment where business_id = (select business_a from ids) $$,
  '55000', null, 'a payment cannot be deleted');
select throws_ok($$ update public.invoice set deleted_at = now() where idempotency_key = (select key1 from ids) $$,
  '55000', null, 'an invoice cannot be soft-deleted');
select throws_ok($$ update public.invoice_item set description = 'x'
                    where business_id = (select business_a from ids) $$,
  '55000', null, 'invoice lines cannot change');

-- Void and replace, on the seed's ISSUED invoice of business A.
set local role service_role;
select results_eq(
  $$ select status::text, changed from public.transition_invoice((select owner_a from ids),
       (select id from public.invoice where business_id = (select business_a from ids) and document_number = '1001'),
       'voided', '{"reason": "נרשם בטעות"}') $$,
  $$ values ('voided', true) $$, 'an ISSUED invoice is voided');
select throws_ok(
  $$ select * from public.transition_invoice((select owner_a from ids),
       (select id from public.invoice where business_id = (select business_a from ids) and document_number = '1001'),
       'issued', '{"document_number": "1002"}') $$,
  '55000', null, 'a VOIDED invoice stays voided');
reset role;
update public.job set status = 'completed', completed_at = now()
where id = (select job_id from public.invoice where business_id = (select business_a from ids) and document_number = '1001');
update public.quote set sent_snapshot = (select sent_snapshot from public.quote where id = (select quote1 from ids))
where id = (select quote_id from public.invoice where business_id = (select business_a from ids) and document_number = '1001');
set local role service_role;
select results_eq(
  $$ select already_created from pg_temp.create((select owner_a from ids),
       (select job_id from public.invoice where business_id = (select business_a from ids) and document_number = '1001'),
       (select key3 from ids)) $$,
  $$ values (false) $$, 'after voiding, the job can be invoiced again');

select * from finish();
rollback;
