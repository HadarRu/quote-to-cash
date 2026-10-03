-- Price list: units as codes, VAT flag, favorites, recently used, and an
-- idempotent import of the starter price lists shipped in packages/types.

-- Units are stored as codes; the app shows them in Hebrew (packages/ui i18n).
update public.service
set unit = 'unit'
where unit not in ('unit', 'point', 'meter', 'sqm', 'hour', 'job');

alter table public.service
  add constraint service_unit_code_check check (unit in ('unit', 'point', 'meter', 'sqm', 'hour', 'job')),
  -- Whether default_price_minor already includes VAT.
  add column vat_included boolean not null default false,
  add column is_favorite boolean not null default false,
  -- Set when the service is added to a quote; drives "recently used" ordering.
  add column last_used_at timestamptz,
  -- Key of the starter price list entry this row was imported from (never reused).
  add column starter_key text check (starter_key ~ '^[a-z0-9_.-]{1,100}$');

alter table public.service_category
  add column starter_key text check (starter_key ~ '^[a-z0-9_.-]{1,100}$');

-- Not partial: a starter row the user deleted is not brought back by a re-import.
create unique index service_business_starter_key on public.service (business_id, starter_key);
create unique index service_category_business_starter_key on public.service_category (business_id, starter_key);

create index service_business_order_idx
  on public.service (business_id, is_favorite desc, last_used_at desc nulls last, name)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- import_starter_price_list: adds the categories and services of a starter
-- list to a business. Runs as the caller (SECURITY INVOKER), so RLS decides
-- who may import; rows that were already imported are left untouched, which
-- makes the import idempotent and keeps the user's later edits.
--
-- p_list: { "categories": [ { "key", "name", "services": [
--   { "key", "name", "unit", "price_minor", "vat_included" } ] } ] }
-- Returns the number of services added by this call.
-- ---------------------------------------------------------------------------
create function public.import_starter_price_list(p_business_id uuid, p_list jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_category jsonb;
  v_service jsonb;
  v_category_id uuid;
  v_sort integer := 0;
  v_added integer := 0;
  v_rows integer;
begin
  if jsonb_typeof(p_list -> 'categories') <> 'array' then
    raise exception 'invalid starter price list' using errcode = '22023';
  end if;

  for v_category in select * from jsonb_array_elements(p_list -> 'categories') loop
    v_sort := v_sort + 1;
    insert into public.service_category (business_id, name, sort_order, starter_key)
    values (p_business_id, v_category ->> 'name', v_sort, v_category ->> 'key')
    on conflict (business_id, starter_key) do nothing;

    select id into v_category_id
    from public.service_category
    where business_id = p_business_id and starter_key = v_category ->> 'key';

    for v_service in select * from jsonb_array_elements(v_category -> 'services') loop
      insert into public.service (business_id, category_id, name, unit, default_price_minor,
                                  vat_included, starter_key)
      values (p_business_id, v_category_id, v_service ->> 'name', v_service ->> 'unit',
              (v_service ->> 'price_minor')::bigint, (v_service ->> 'vat_included')::boolean,
              v_service ->> 'key')
      on conflict (business_id, starter_key) do nothing;
      get diagnostics v_rows = row_count;
      v_added := v_added + v_rows;
    end loop;
  end loop;

  return v_added;
end;
$$;

revoke execute on function public.import_starter_price_list(uuid, jsonb) from public, anon;
grant execute on function public.import_starter_price_list(uuid, jsonb) to authenticated, service_role;
