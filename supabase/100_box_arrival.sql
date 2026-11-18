-- =====================================================================
-- EMON OVERRUNS E-PORTAL - Update 3.99.38: the box database keeps the DATE OF ARRIVAL and every other column of the sheet
-- 1. Read Sheet finds each column by its title in the top row of the sheet (any order).
-- 2. box_stock.arrival_date: the date the box arrived (empty = the box is still SHIPPED, on the way).
-- 3. box_stock.ship_date / release_date / sold_date / sheet_invoice: the SHIPPING DATE, RELEASED DATE, DATE SOLD and INVOICE NO
--    columns of the sheet (when the sheet has them).
-- 4. box_stock.extra: the other columns of the sheet (title -> value), shown with the box.
-- Needs 099 (RUN_050_BOXES_AND_099.sql). Safe to run again.
-- =====================================================================
do $$ begin
  if to_regclass('public.box_stock') is null then raise exception 'Update 3.99.38: the box database is missing (run RUN_050_BOXES_AND_099.sql first).'; end if;
end $$;

alter table public.box_stock add column if not exists price numeric(12,2) check (price is null or price >= 0);
alter table public.box_stock add column if not exists arrival_date date;
alter table public.box_stock add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.box_stock add column if not exists ship_date date;
alter table public.box_stock add column if not exists release_date date;
alter table public.box_stock add column if not exists sold_date date;
alter table public.box_stock add column if not exists sheet_invoice text check (char_length(sheet_invoice) <= 40);

-- a date written yyyy-mm-dd, or null (a wrong date never stops the reading)
create or replace function public.box_date(p text) returns date
language plpgsql immutable set search_path = '' as $$
declare d date;
begin
  if coalesce(trim(p), '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  d := trim(p)::date;
  return case when d between date '2000-01-01' and date '2100-12-31' then d end;
exception when others then return null;
end;
$$;
revoke execute on function public.box_date(text) from public, anon;

create or replace function public.replace_box_stock(p_rows jsonb, p_source text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; me text := (select full_name from public.profiles where id = auth.uid());
begin
  if not public.is_admin() then raise exception 'Only the Director can read the box database'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The sheet has no boxes (the serial no column is empty).'; end if;
  if jsonb_array_length(p_rows) > 100000 then raise exception 'Up to 100,000 boxes can be read.'; end if;
  delete from public.box_stock where true;
  insert into public.box_stock (serial_no, product, brand, ctn, style, qty, batch, price, arrival_date, ship_date, release_date, sold_date, sheet_invoice, extra)
  select distinct on (x.s) x.s,
    nullif(left(trim(coalesce(x.r ->> 'product', '')), 120), ''), nullif(left(trim(coalesce(x.r ->> 'brand', '')), 80), ''),
    nullif(left(trim(coalesce(x.r ->> 'ctn', '')), 30), ''), nullif(left(upper(trim(coalesce(x.r ->> 'style', ''))), 30), ''),
    case when trim(coalesce(x.r ->> 'qty', '')) ~ '^\d{1,9}(\.\d+)?$' then round(trim(x.r ->> 'qty')::numeric)::integer else 0 end,
    nullif(left(upper(trim(coalesce(x.r ->> 'batch', ''))), 40), ''),
    case when replace(trim(coalesce(x.r ->> 'price', '')), ',', '') ~ '^\d{1,9}(\.\d{1,4})?$' then round(replace(trim(x.r ->> 'price'), ',', '')::numeric, 2) end,
    public.box_date(x.r ->> 'arrival'), public.box_date(x.r ->> 'ship'), public.box_date(x.r ->> 'released'), public.box_date(x.r ->> 'sold_on'),
    nullif(left(upper(trim(coalesce(x.r ->> 'invoice', ''))), 40), ''),
    case when jsonb_typeof(x.r -> 'extra') = 'object' and length((x.r -> 'extra')::text) <= 4000 then x.r -> 'extra' else '{}'::jsonb end
  from (select left(upper(regexp_replace(trim(coalesce(e.r ->> 'serial_no', '')), '\s+', ' ', 'g')), 60) s, e.r, e.ord
        from jsonb_array_elements(p_rows) with ordinality as e(r, ord)) x
  where x.s <> ''
  order by x.s, x.ord desc;
  get diagnostics n = row_count;
  insert into public.ai_settings (key, value, updated_by_name, updated_at)
  values ('box_sheet_read', jsonb_build_object('boxes', n, 'source', left(coalesce(p_source, ''), 300), 'read_at', now(),
    'has_arrival', exists (select 1 from public.box_stock where arrival_date is not null)), me, now())
  on conflict (key) do update set value = excluded.value, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at;
  return n;
end;
$$;
revoke execute on function public.replace_box_stock(jsonb, text) from public, anon;
grant execute on function public.replace_box_stock(jsonb, text) to authenticated;

select 'UPDATE 3.99.38 READY' as result;
