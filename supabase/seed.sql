-- =============================================================================
-- LOCAL DEVELOPMENT AND TESTS ONLY. NEVER RUN IN PRODUCTION.
-- Loaded by `supabase db reset`. The pgTAP tests in supabase/tests rely on it.
-- Two businesses (A and B), each with an OWNER and an EMPLOYEE, a customer, a
-- service, and account settings (a push device, a notification preference, a
-- trial). Nothing the app's flows create (quotes, jobs, visits, invoices) is
-- seeded: tests create it through those flows, so a missing flow shows up.
-- =============================================================================

do $$
begin
  if exists (select 1 from public.business) then
    raise exception 'seed.sql must only run on an empty local database';
  end if;
end;
$$;

-- Users: A owner/employee, B owner/employee. They sign in with the test OTP
-- codes in config.toml. GoTrue reads its token columns as strings, so they
-- must be '' rather than NULL or sign-in fails with "Database error finding user".
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new,
                        email_change_token_current, phone_change, phone_change_token,
                        reauthentication_token)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.phone, now(),
       '{"provider":"phone","providers":["phone"]}', '{}', now(), now(),
       '', '', '', '', '', '', '', ''
from (values
  ('00000000-0000-4000-a000-000000000001'::uuid, '972500000001'),
  ('00000000-0000-4000-a000-000000000002'::uuid, '972500000002'),
  ('00000000-0000-4000-b000-000000000001'::uuid, '972500000003'),
  ('00000000-0000-4000-b000-000000000002'::uuid, '972500000004')
) as v (id, phone);

-- Profiles are created by the sync_user_profile trigger; add display names.
update public.user_profile p set full_name = v.full_name
from (values
  ('00000000-0000-4000-a000-000000000001'::uuid, 'אבי כהן'),
  ('00000000-0000-4000-a000-000000000002'::uuid, 'דנה לוי'),
  ('00000000-0000-4000-b000-000000000001'::uuid, 'יוסי מזרחי'),
  ('00000000-0000-4000-b000-000000000002'::uuid, 'רונית פרץ')
) as v (id, full_name)
where p.id = v.id;

do $$
declare
  b record;
  v_customer uuid;
  v_category uuid;
begin
  for b in
    select * from (values
      ('10000000-0000-4000-a000-000000000001'::uuid, 'כהן חשמל', '00000000-0000-4000-a000-000000000001'::uuid,
       '00000000-0000-4000-a000-000000000002'::uuid, '+972521111111'),
      ('10000000-0000-4000-b000-000000000001'::uuid, 'מזרחי חשמל', '00000000-0000-4000-b000-000000000001'::uuid,
       '00000000-0000-4000-b000-000000000002'::uuid, '+972522222222')
    ) as t (id, name, owner_id, employee_id, customer_phone)
  loop
    insert into public.business (id, name, trade, tax_status) values (b.id, b.name, 'electrician', 'osek_murshe');
    insert into public.business_settings (business_id) values (b.id);
    insert into public.business_member (business_id, user_id, role) values
      (b.id, b.owner_id, 'OWNER'),
      (b.id, b.employee_id, 'EMPLOYEE');

    insert into public.customer (business_id, full_name, phone_e164)
    values (b.id, 'משה ישראלי', b.customer_phone) returning id into v_customer;
    insert into public.customer_address (business_id, customer_id, street, house_number, city, is_primary)
    values (b.id, v_customer, 'הרצל', '10', 'תל אביב-יפו', true);

    insert into public.service_category (business_id, name) values (b.id, 'התקנות')
      returning id into v_category;
    insert into public.service (business_id, category_id, name, unit, default_price_minor)
    values (b.id, v_category, 'התקנת שקע', 'point', 25000);

    insert into public.device (business_id, user_id, expo_push_token, platform)
    values (b.id, b.owner_id, 'ExponentPushToken[seed-' || b.id || ']', 'ios');
    insert into public.notification_preference (business_id, user_id, event, push_enabled)
    values (b.id, b.owner_id, 'quote_viewed', false);
    insert into public.subscription (business_id, plan_code, status, trial_ends_at)
    values (b.id, 'trial', 'trialing', now() + interval '14 days');
  end loop;
end;
$$;
