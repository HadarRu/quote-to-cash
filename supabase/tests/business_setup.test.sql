-- Sign-up and business setup: user_profile sync, setup_business() permissions
-- and idempotency, and business-assets Storage access. Relies on supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- A brand-new user, as GoTrue creates them after phone OTP (digits, no '+').
insert into auth.users (instance_id, id, aud, role, phone, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-a000-000000000001',
        'authenticated', 'authenticated', '972509990001', now(), now());

select is(
  (select phone_e164::text from public.user_profile where id = '40000000-0000-4000-a000-000000000001'),
  '+972509990001',
  'a user_profile with the E.164 phone is created for every new auth user'
);

update auth.users set phone = '972509990002' where id = '40000000-0000-4000-a000-000000000001';
select is(
  (select phone_e164::text from public.user_profile where id = '40000000-0000-4000-a000-000000000001'),
  '+972509990002',
  'user_profile.phone_e164 follows a phone change in auth.users'
);

-- anon cannot create businesses.
set local role anon;
select throws_ok(
  $$ select public.setup_business('50000000-0000-4000-a000-000000000001', 'עסק', 'electrician', 'osek_patur') $$,
  '42501', null,
  'anon cannot call setup_business'
);
select throws_ok(
  $$ select public.create_business('עסק') $$,
  '42501', null,
  'anon cannot call create_business'
);
reset role;

-- The new user sets up their business.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

select is(
  public.setup_business('50000000-0000-4000-a000-000000000001', 'חשמל בע"מ', 'electrician', 'company'),
  '50000000-0000-4000-a000-000000000001'::uuid,
  'setup_business returns the client-generated business id'
);

select results_eq(
  $$ select name, trade::text, tax_status::text from public.business
     where id = '50000000-0000-4000-a000-000000000001' $$,
  $$ values ('חשמל בע"מ', 'electrician', 'company') $$,
  'the business is created with name, trade and tax status, and is visible to its owner'
);

select results_eq(
  $$ select role::text, status::text from public.business_member
     where business_id = '50000000-0000-4000-a000-000000000001' $$,
  $$ values ('OWNER', 'active') $$,
  'the caller is the only member, as an active OWNER'
);

select is(
  (select count(*) from public.business_settings where business_id = '50000000-0000-4000-a000-000000000001'),
  1::bigint,
  'business_settings are created with the business'
);

select is(
  public.setup_business('50000000-0000-4000-a000-000000000001', 'חשמל בע"מ', 'electrician', 'company'),
  '50000000-0000-4000-a000-000000000001'::uuid,
  'retrying setup_business with the same id returns the same business'
);

select is(
  (select count(*) from public.business_member where business_id = '50000000-0000-4000-a000-000000000001'),
  1::bigint,
  'a retry does not add a second membership'
);

select throws_ok(
  $$ select public.setup_business('a', 'bad', 'electrician', 'company') $$,
  '22P02', null,
  'setup_business rejects an invalid business id'
);

select throws_ok(
  $$ select public.setup_business('50000000-0000-4000-a000-000000000002', '', 'electrician', 'company') $$,
  '23514', null,
  'setup_business rejects an empty name (same rule as BusinessSetupSchema)'
);

-- The owner can upload into their business folder.
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('business-assets', '50000000-0000-4000-a000-000000000001/logo-1.png',
             '40000000-0000-4000-a000-000000000001') $$,
  'the owner can upload a logo into their business folder'
);

-- Owner of business A (seed) tries to take over the new business.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.setup_business('50000000-0000-4000-a000-000000000001', 'השתלטות', 'other', 'osek_patur') $$,
  '42501', null,
  'another user cannot claim an existing business id'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'business-assets'
     and name like '50000000-0000-4000-a000-000000000001/%'),
  0::bigint,
  'a non-member cannot see another business''s assets'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('business-assets', '50000000-0000-4000-a000-000000000001/logo-2.png',
             '00000000-0000-4000-a000-000000000001') $$,
  '42501', null,
  'a non-member cannot upload into another business''s folder'
);

-- An EMPLOYEE of business A cannot change the business logo.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('business-assets', '10000000-0000-4000-a000-000000000001/logo-3.png',
             '00000000-0000-4000-a000-000000000002') $$,
  '42501', null,
  'an EMPLOYEE cannot upload business assets'
);

reset role;
select * from finish();
rollback;
