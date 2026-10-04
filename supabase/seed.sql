-- =============================================================================
-- LOCAL DEVELOPMENT AND TESTS ONLY. NEVER RUN IN PRODUCTION.
-- Loaded by `supabase db reset`. The pgTAP tests in supabase/tests rely on it.
-- Two businesses (A and B), each with an OWNER and an EMPLOYEE, and one row in
-- every business table.
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
  v_address uuid;
  v_category uuid;
  v_service uuid;
  v_quote uuid;
  v_draft uuid;
  v_job uuid;
  v_invoice uuid;
  v_tomorrow_9 timestamptz :=
    (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '1 day 9 hours')
      at time zone 'Asia/Jerusalem';
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
    values (b.id, v_customer, 'הרצל', '10', 'תל אביב-יפו', true) returning id into v_address;

    insert into public.service_category (business_id, name) values (b.id, 'התקנות')
      returning id into v_category;
    insert into public.service (business_id, category_id, name, unit, default_price_minor)
    values (b.id, v_category, 'התקנת שקע', 'point', 25000) returning id into v_service;

    -- An approved quote: 2 × ₪250.00 = ₪500.00, VAT 18% = ₪90.00, total ₪590.00.
    -- Lines can only be added to drafts, so it is created as a draft first.
    insert into public.quote (business_id, customer_id, address_id, title, valid_until,
                              subtotal_minor, vat_rate_bp, vat_minor, total_minor)
    values (b.id, v_customer, v_address, 'התקנת שקעים בסלון', current_date + 14,
            50000, 1800, 9000, 59000)
    returning id into v_quote;
    insert into public.quote_item (business_id, quote_id, service_id, description, quantity, unit,
                                   unit_price_minor, line_total_minor)
    values (b.id, v_quote, v_service, 'התקנת שקע', 2, 'point', 25000, 50000);
    update public.quote
    set status = 'approved', quote_number = app.take_quote_number(b.id),
        sent_at = now() - interval '2 days', viewed_at = now() - interval '2 days',
        approved_at = now() - interval '1 day', approved_name = 'משה ישראלי',
        token_hash = encode(extensions.digest(b.id::text, 'sha256'), 'hex'),
        token_expires_at = now() + interval '12 days'
    where id = v_quote;

    insert into public.quote_comment (business_id, quote_id, author, body)
    values (b.id, v_quote, 'customer', 'אפשר להגיע ביום חמישי בבוקר?');

    -- A draft still being written: ₪3,500.00 + 18% VAT.
    insert into public.quote (business_id, customer_id, address_id, title, valid_until,
                              subtotal_minor, vat_rate_bp, vat_minor, total_minor)
    values (b.id, v_customer, v_address, 'החלפת לוח חשמל', current_date + 14, 350000, 1800, 63000, 413000)
    returning id into v_draft;
    insert into public.quote_item (business_id, quote_id, description, quantity, unit,
                                   unit_price_minor, line_total_minor)
    values (b.id, v_draft, 'החלפת לוח חשמל דירתי', 1, 'job', 350000, 350000);
    insert into public.quote_slot_option (business_id, quote_id, starts_at, ends_at, status)
    values (b.id, v_quote, v_tomorrow_9, v_tomorrow_9 + interval '2 hours', 'selected');

    insert into public.job (business_id, customer_id, quote_id, address_id, title)
    values (b.id, v_customer, v_quote, v_address, 'התקנת שקעים בסלון') returning id into v_job;
    insert into public.appointment (business_id, customer_id, quote_id, job_id, address_id, status,
                                    starts_at, ends_at)
    values (b.id, v_customer, v_quote, v_job, v_address, 'confirmed',
            v_tomorrow_9, v_tomorrow_9 + interval '2 hours');

    insert into public.invoice (business_id, customer_id, quote_id, job_id, status, issued_at,
                                due_date, subtotal_minor, vat_rate_bp, vat_minor, total_minor)
    values (b.id, v_customer, v_quote, v_job, 'issued', now(), current_date + 30,
            50000, 1800, 9000, 59000)
    returning id into v_invoice;
    insert into public.invoice_item (business_id, invoice_id, service_id, description, quantity, unit,
                                     unit_price_minor, line_total_minor)
    values (b.id, v_invoice, v_service, 'התקנת שקע', 2, 'point', 25000, 50000);
    insert into public.payment (business_id, invoice_id, amount_minor, method, status, paid_at)
    values (b.id, v_invoice, 59000, 'bit', 'succeeded', now());

    insert into public.notification (business_id, customer_id, channel, template, to_address)
    values (b.id, v_customer, 'sms', 'quote_sent', b.customer_phone);
    insert into public.device (business_id, user_id, expo_push_token, platform)
    values (b.id, b.owner_id, 'ExponentPushToken[seed-' || b.id || ']', 'ios');
    insert into public.notification_preference (business_id, user_id, event, push_enabled)
    values (b.id, b.owner_id, 'quote_viewed', false);
    insert into public.subscription (business_id, plan_code, status, trial_ends_at)
    values (b.id, 'trial', 'trialing', now() + interval '14 days');
    insert into public.file (business_id, kind, bucket, storage_path, mime_type, size_bytes, job_id)
    values (b.id, 'job_photo', 'business-files', b.id || '/jobs/' || v_job || '/before.jpg',
            'image/jpeg', 204800, v_job);
    insert into public.audit_log (business_id, actor_user_id, action, table_name, record_id, new_data)
    values (b.id, b.owner_id, 'insert', 'quote', v_quote, jsonb_build_object('status', 'approved'));
  end loop;
end;
$$;
