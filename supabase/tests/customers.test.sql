-- Customers through the Data API's view of the database (authenticated + RLS):
-- duplicate phones, soft delete, and quotes staying readable. Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Act as the EMPLOYEE of business A: customers are everyday work for every member.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.customer (id, business_id, full_name, phone_e164)
     values ('60000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001',
             'דנה לוי', '+972547654321') $$,
  'a member can add a customer'
);

select throws_ok(
  $$ insert into public.customer (business_id, full_name, phone_e164)
     values ('10000000-0000-4000-a000-000000000001', 'דנה אחרת', '+972547654321') $$,
  '23505', null,
  'a second active customer with the same phone in the same business is rejected'
);

select throws_ok(
  $$ insert into public.customer (business_id, full_name, phone_e164)
     values ('10000000-0000-4000-a000-000000000001', 'מספר שגוי', '0547654321') $$,
  '23514', null,
  'phones must be E.164 (same rule as PhoneSchema)'
);

-- The seed customer of business A has an approved quote.
select is(
  (select count(*) from public.quote q
     join public.customer c on c.business_id = q.business_id and c.id = q.customer_id
   where c.business_id = '10000000-0000-4000-a000-000000000001' and c.phone_e164 = '+972521111111'),
  1::bigint,
  'precondition: the seed customer has a quote'
);

update public.customer set deleted_at = now()
where business_id = '10000000-0000-4000-a000-000000000001' and phone_e164 = '+972521111111';

select ok(
  (select deleted_at is not null from public.customer
   where business_id = '10000000-0000-4000-a000-000000000001' and phone_e164 = '+972521111111'),
  'a member can soft-delete a customer (an UPDATE of deleted_at)'
);

select results_eq(
  $$ select q.quote_number, q.total_minor, c.full_name, c.deleted_at is not null
     from public.quote q
     join public.customer c on c.business_id = q.business_id and c.id = q.customer_id
     where c.business_id = '10000000-0000-4000-a000-000000000001' and c.phone_e164 = '+972521111111' $$,
  $$ values (1, 59000::bigint, 'משה ישראלי', true) $$,
  'after a soft delete the customer''s quotes, with the customer''s name, are still readable'
);

select lives_ok(
  $$ insert into public.customer (business_id, full_name, phone_e164)
     values ('10000000-0000-4000-a000-000000000001', 'משה ישראלי (חדש)', '+972521111111') $$,
  'a soft-deleted customer''s phone can be used for a new customer'
);

select throws_ok(
  $$ delete from public.customer where id = '60000000-0000-4000-a000-000000000001' $$,
  '42501', null,
  'customers cannot be hard-deleted through the API'
);

-- Business B may have its own customer with the same phone.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-b000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.customer (business_id, full_name, phone_e164)
     values ('10000000-0000-4000-b000-000000000001', 'דנה לוי', '+972547654321') $$,
  'another business can have a customer with the same phone'
);

reset role;
select * from finish();
rollback;
