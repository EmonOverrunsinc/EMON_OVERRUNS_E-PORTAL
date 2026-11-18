-- =====================================================================
-- EMON OVERRUNS E-PORTAL - ALL UPDATES IN ONE (3.99.32 to 3.99.76)
-- The box database, box price and SOLD boxes (050 + 099), the date of arrival and every sheet column (100), staff read
-- the cost per box (101), the middle name on coverage records (102), the Director pays a salary without the ID card (103).
-- Every part is safe to run again (already run = nothing changes). Paste all of it in Supabase > SQL Editor and press Run.
-- The last line must say: ALL UPDATES READY - 099 OK · 100 OK · 101 OK · 102 OK · 103 OK
-- =====================================================================

-- ===================== RUN_050_BOXES_AND_099.sql =====================
-- =====================================================================
-- EMON OVERRUNS E-PORTAL - the box database (from update 050) and update 3.99.32 (099), in one file
-- The server never had the box database (050): this adds ONLY its tables and the box trigger. The rest of 050
-- (EVA access, the order paper functions) is NOT run again, because later updates changed those.
-- Safe to run again.
-- =====================================================================
do $$ begin
  if to_regclass('public.customer_order_boxes') is null then raise exception 'Customer orders are missing (045).'; end if;
end $$;

-- ===== the box database (050, parts 1-3) =====
create table if not exists public.ai_settings (
  key text primary key check (char_length(key) between 1 and 60),
  value jsonb not null default '{}'::jsonb,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table public.ai_settings enable row level security;
revoke all on public.ai_settings from anon;
grant select, insert, update, delete on public.ai_settings to authenticated;
drop policy if exists "ai settings: director" on public.ai_settings;
create policy "ai settings: director" on public.ai_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- 2. the box database (read from the sheet; only READ SHEET changes it)
create table if not exists public.box_stock (
  serial_no text primary key check (char_length(serial_no) between 1 and 60),
  product text check (char_length(product) <= 120),
  brand text check (char_length(brand) <= 80),
  ctn text check (char_length(ctn) <= 30),
  style text check (char_length(style) <= 30),
  qty integer not null default 0 check (qty >= 0),
  batch text check (char_length(batch) <= 40),
  read_at timestamptz not null default now()
);
create index if not exists box_stock_batch_idx on public.box_stock(batch);
alter table public.box_stock enable row level security;
revoke all on public.box_stock from anon, authenticated;
grant select on public.box_stock to authenticated;
-- read: the Director and the staff who make customer orders (a typed box fills from it)
drop policy if exists "box stock: read" on public.box_stock;
create policy "box stock: read" on public.box_stock for select to authenticated
  using ((select public.is_admin()) or (select public.co_can_read()));

-- READ SHEET: p_rows = [{serial_no, product, brand, ctn, style, qty, batch}, ...] (columns A to G of the sheet). The old
-- rows are removed and the new ones put in; a serial no written twice keeps its last row. Gives the number of boxes.
create or replace function public.replace_box_stock(p_rows jsonb, p_source text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; me text := (select full_name from public.profiles where id = auth.uid());
begin
  if not public.is_admin() then raise exception 'Only the Director can read the box database'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The sheet has no boxes (column A: the serial no).'; end if;
  if jsonb_array_length(p_rows) > 100000 then raise exception 'Up to 100,000 boxes can be read.'; end if;
  delete from public.box_stock where true;
  insert into public.box_stock (serial_no, product, brand, ctn, style, qty, batch)
  select distinct on (x.s) x.s,
    nullif(left(trim(coalesce(x.r ->> 'product', '')), 120), ''), nullif(left(trim(coalesce(x.r ->> 'brand', '')), 80), ''),
    nullif(left(trim(coalesce(x.r ->> 'ctn', '')), 30), ''), nullif(left(upper(trim(coalesce(x.r ->> 'style', ''))), 30), ''),
    case when trim(coalesce(x.r ->> 'qty', '')) ~ '^\d{1,9}(\.\d+)?$' then round(trim(x.r ->> 'qty')::numeric)::integer else 0 end,
    nullif(left(upper(trim(coalesce(x.r ->> 'batch', ''))), 40), '')
  from (select left(upper(regexp_replace(trim(coalesce(e.r ->> 'serial_no', '')), '\s+', ' ', 'g')), 60) s, e.r, e.ord
        from jsonb_array_elements(p_rows) with ordinality as e(r, ord)) x
  where x.s <> ''
  order by x.s, x.ord desc;
  get diagnostics n = row_count;
  insert into public.ai_settings (key, value, updated_by_name, updated_at)
  values ('box_sheet_read', jsonb_build_object('boxes', n, 'source', left(coalesce(p_source, ''), 300), 'read_at', now()), me, now())
  on conflict (key) do update set value = excluded.value, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at;
  return n;
end;
$$;
revoke execute on function public.replace_box_stock(jsonb, text) from public, anon;
grant execute on function public.replace_box_stock(jsonb, text) to authenticated;

-- 3. a box put on a customer order takes its details from the box database (when its serial no is there)
alter table public.customer_order_boxes add column if not exists brand text;
alter table public.customer_order_boxes add column if not exists ctn text;
create or replace function public.co_box_from_stock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.box_stock;
begin
  select * into s from public.box_stock where serial_no = new.serial_no;
  if found then
    new.items := coalesce(nullif(trim(s.product), ''), new.items);
    new.brand := coalesce(nullif(nullif(trim(s.brand), ''), '-'), new.brand);
    new.ctn := coalesce(nullif(trim(s.ctn), ''), new.ctn);
    new.code := coalesce(nullif(upper(trim(s.style)), ''), new.code);
    new.pcs := case when s.qty > 0 then s.qty else new.pcs end;
    new.batch_no := coalesce(nullif(upper(trim(s.batch)), ''), new.batch_no);
  end if;
  return new;
end;
$$;
revoke execute on function public.co_box_from_stock() from public, anon, authenticated;
drop trigger if exists cob_stock_bi on public.customer_order_boxes;
create trigger cob_stock_bi before insert on public.customer_order_boxes for each row execute function public.co_box_from_stock();

-- ===== update 3.99.32 (099) =====
-- =====================================================================
-- EMON OVERRUNS E-PORTAL - Update 3.99.32: the price of a box, and a box SOLD when its order is invoiced
-- 1. The box database (the Google Sheet) has a PRICE column (H, price per pc); Read Sheet keeps it.
-- 2. Each scanned box is its own order line: the line keeps the box's serial no (up to 200 lines).
-- 3. When an order is COMPLETED and its invoice made, every box of the order is SOLD: box_sales keeps the box's
--    price per pc, pcs, total, the invoice no, the order no and the customer. Editing the completed order counts it
--    again; cancelling or deleting the order (or its invoice) takes the boxes out of SOLD.
-- Safe to run again.
-- =====================================================================
do $$ begin
  if to_regclass('public.box_stock') is null then raise exception 'Update 3.99.32: the box database is missing (run RUN_048_TO_051.sql first).'; end if;
  if to_regprocedure('public.co_clean_lines(jsonb,text[])') is null then raise exception 'Update 3.99.32: customer orders are missing (045).'; end if;
end $$;

-- 1. the price per pc of a box (column H of the sheet)
alter table public.box_stock add column if not exists price numeric(12,2) check (price is null or price >= 0);

create or replace function public.replace_box_stock(p_rows jsonb, p_source text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; me text := (select full_name from public.profiles where id = auth.uid());
begin
  if not public.is_admin() then raise exception 'Only the Director can read the box database'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The sheet has no boxes (column A: the serial no).'; end if;
  if jsonb_array_length(p_rows) > 100000 then raise exception 'Up to 100,000 boxes can be read.'; end if;
  delete from public.box_stock where true;
  insert into public.box_stock (serial_no, product, brand, ctn, style, qty, batch, price)
  select distinct on (x.s) x.s,
    nullif(left(trim(coalesce(x.r ->> 'product', '')), 120), ''), nullif(left(trim(coalesce(x.r ->> 'brand', '')), 80), ''),
    nullif(left(trim(coalesce(x.r ->> 'ctn', '')), 30), ''), nullif(left(upper(trim(coalesce(x.r ->> 'style', ''))), 30), ''),
    case when trim(coalesce(x.r ->> 'qty', '')) ~ '^\d{1,9}(\.\d+)?$' then round(trim(x.r ->> 'qty')::numeric)::integer else 0 end,
    nullif(left(upper(trim(coalesce(x.r ->> 'batch', ''))), 40), ''),
    case when replace(trim(coalesce(x.r ->> 'price', '')), ',', '') ~ '^\d{1,9}(\.\d{1,4})?$' then round(replace(trim(x.r ->> 'price'), ',', '')::numeric, 2) end
  from (select left(upper(regexp_replace(trim(coalesce(e.r ->> 'serial_no', '')), '\s+', ' ', 'g')), 60) s, e.r, e.ord
        from jsonb_array_elements(p_rows) with ordinality as e(r, ord)) x
  where x.s <> ''
  order by x.s, x.ord desc;
  get diagnostics n = row_count;
  insert into public.ai_settings (key, value, updated_by_name, updated_at)
  values ('box_sheet_read', jsonb_build_object('boxes', n, 'source', left(coalesce(p_source, ''), 300), 'read_at', now()), me, now())
  on conflict (key) do update set value = excluded.value, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at;
  return n;
end;
$$;

-- 2. an order line keeps the serial no of its box; up to 200 lines (one per box)
create or replace function public.co_clean_lines(p_lines jsonb, p_cols text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare x jsonb; r jsonb := '[]'::jsonb; n int := 0; bx int; pc int; qty numeric; price numeric; ex jsonb; c text;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Add at least one line'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    if coalesce(trim(x ->> 'product'), '') = '' and coalesce(trim(x ->> 'code'), '') = '' and coalesce(nullif(x ->> 'qty', '')::numeric, 0) = 0
       and coalesce(nullif(x ->> 'boxes', '')::numeric, 0) = 0 and coalesce(nullif(x ->> 'pcs', '')::numeric, 0) = 0 then continue; end if;
    n := n + 1;
    if n > 200 then raise exception 'An order has up to 200 lines'; end if;
    if coalesce(trim(x ->> 'product'), '') = '' then raise exception 'Write the product on line %', n; end if;
    bx := round(greatest(coalesce(nullif(x ->> 'boxes', '')::numeric, 0), 0));
    pc := round(greatest(coalesce(nullif(x ->> 'pcs', '')::numeric, 0), 0));
    qty := case when bx > 0 and pc > 0 then bx * pc else round(greatest(coalesce(nullif(x ->> 'qty', '')::numeric, 0), 0)) end;
    if qty <= 0 then raise exception 'Write the boxes and pcs (or the quantity) on line %', n; end if;
    price := round(greatest(coalesce(nullif(x ->> 'price', '')::numeric, 0), 0), 2);
    ex := '{}'::jsonb;
    foreach c in array coalesce(p_cols, '{}') loop
      ex := ex || jsonb_build_object(c, left(trim(coalesce(x -> 'extra' ->> c, '')), 60));
    end loop;
    r := r || jsonb_build_array(jsonb_build_object('qty', qty, 'boxes', bx, 'code', left(upper(trim(coalesce(x ->> 'code', ''))), 30), 'pcs', pc,
      'lot', left(upper(trim(coalesce(x ->> 'lot', ''))), 40), 'product', left(trim(x ->> 'product'), 120), 'price', price, 'amount', round(qty * price, 2), 'extra', ex)
      || case when coalesce(trim(x ->> 'serial'), '') <> '' then jsonb_build_object('serial', left(upper(trim(x ->> 'serial')), 60)) else '{}'::jsonb end);
  end loop;
  if n = 0 then raise exception 'Add at least one line'; end if;
  return r;
end;
$$;
revoke execute on function public.co_clean_lines(jsonb, text[]) from public, anon;

-- 3. SOLD boxes
create table if not exists public.box_sales (
  serial_no text not null,
  order_id uuid not null references public.customer_orders(id) on delete cascade,
  order_no text,
  invoice_id uuid references public.customer_invoices(id) on delete cascade,
  invoice_no text,
  customer_id uuid,
  customer_name text,
  pcs integer not null default 0,
  price numeric(12,2) not null default 0,
  total numeric(14,2) not null default 0,
  sold_at timestamptz not null default now(),
  primary key (serial_no, order_id)
);
create index if not exists box_sales_invoice_idx on public.box_sales(invoice_id);
alter table public.box_sales enable row level security;
revoke all on public.box_sales from anon, authenticated;
grant select on public.box_sales to authenticated;
drop policy if exists "box sales: read" on public.box_sales;
create policy "box sales: read" on public.box_sales for select to authenticated
  using ((select public.is_admin()) or (select public.co_can_read()));

-- the boxes of a completed order are counted as sold (again after an edit); an order no longer completed is not sold
create or replace function public.co_mark_sold(p_order uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.customer_orders; inv public.customer_invoices; n integer := 0; avg_price numeric;
begin
  select * into o from public.customer_orders where id = p_order;
  delete from public.box_sales where order_id = p_order;
  if o.id is null or o.status <> 'completed' or o.invoice_id is null then return 0; end if;
  select * into inv from public.customer_invoices where id = o.invoice_id;
  avg_price := case when coalesce(o.total_pcs, 0) > 0 then round(coalesce(o.total_amount, 0) / o.total_pcs, 2) else 0 end;
  insert into public.box_sales (serial_no, order_id, order_no, invoice_id, invoice_no, customer_id, customer_name, pcs, price, total, sold_at)
  select b.serial_no, o.id, o.order_no, inv.id, inv.invoice_no, o.customer_id,
    (select upper(trim(concat_ws(' ', c.first_name, c.middle_name, c.last_name))) from public.customers c where c.id = o.customer_id),
    b.pcs, p.price, round(b.pcs * p.price, 2), coalesce(o.completed_at, now())
  from public.customer_order_boxes b
  cross join lateral (
    select coalesce(
      (select (l ->> 'price')::numeric from jsonb_array_elements(coalesce(o.lines, '[]'::jsonb)) l where upper(l ->> 'serial') = upper(b.serial_no) limit 1),
      (select (l ->> 'price')::numeric from jsonb_array_elements(coalesce(o.lines, '[]'::jsonb)) l
        where coalesce(l ->> 'serial', '') = '' and coalesce(l ->> 'code', '') <> '' and upper(l ->> 'code') = upper(coalesce(b.code, ''))
          and (coalesce(l ->> 'lot', '') = '' or upper(l ->> 'lot') = upper(coalesce(b.batch_no, ''))) and (l ->> 'price')::numeric > 0 limit 1),
      avg_price) as price) p
  where b.order_id = o.id
  on conflict (serial_no, order_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.co_mark_sold(uuid) from public, anon, authenticated;

create or replace function public.customer_orders_sold() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and new.invoice_id is not null then perform public.co_mark_sold(new.id);
  elsif old.status = 'completed' then delete from public.box_sales where order_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.customer_orders_sold() from public, anon, authenticated;
drop trigger if exists customer_orders_sold on public.customer_orders;
create trigger customer_orders_sold after update of status, invoice_id, lines, total_amount, total_pcs on public.customer_orders
  for each row execute function public.customer_orders_sold();

-- a box added to or taken off a completed order (an edit of the delivery) counts again
create or replace function public.customer_order_boxes_sold() returns trigger
language plpgsql security definer set search_path = '' as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  if exists (select 1 from public.customer_orders o where o.id = oid and o.status = 'completed') then perform public.co_mark_sold(oid); end if;
  return null;
end;
$$;
revoke execute on function public.customer_order_boxes_sold() from public, anon, authenticated;
drop trigger if exists customer_order_boxes_sold on public.customer_order_boxes;
create trigger customer_order_boxes_sold after insert or update or delete on public.customer_order_boxes
  for each row execute function public.customer_order_boxes_sold();

-- the boxes of the orders completed before this update
do $$ declare r record; begin
  for r in select id from public.customer_orders where status = 'completed' and invoice_id is not null loop perform public.co_mark_sold(r.id); end loop;
end $$;

select 'UPDATE 3.99.32 READY' as result;

-- ===================== 100_box_arrival.sql =====================
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

-- ===================== 101_box_settings_read.sql =====================
-- =====================================================================
-- EMON OVERRUNS E-PORTAL - Update 3.99.52: the staff who see customer orders also read two box settings
-- (the COST PER BOX and whether the sheet has a DATE OF ARRIVAL), so their box search shows the same total cost and
-- SHIPPED boxes as the Director's. Only the Director changes them. Safe to run again.
-- =====================================================================
do $$ begin
  if to_regclass('public.ai_settings') is null then raise exception 'Update 3.99.52: the box database is missing (run RUN_050_BOXES_AND_099.sql first).'; end if;
  if to_regprocedure('public.co_can_read()') is null then raise exception 'Update 3.99.52: customer orders are missing (045).'; end if;
end $$;

drop policy if exists "ai settings: staff read box settings" on public.ai_settings;
create policy "ai settings: staff read box settings" on public.ai_settings for select to authenticated
  using (key in ('box_cost', 'box_sheet_read') and (select public.co_can_read()));

select 'UPDATE 3.99.52 READY' as result;

-- ===================== 102_coverage_middle_name.sql =====================
-- =====================================================================
-- EMON OVERRUNS E-PORTAL - Update 3.99.71: the customer's MIDDLE NAME on the coverage (insurance) records
-- The customer name a coverage keeps is written FIRST MIDDLE LAST (a new coverage, and the coverages saved before).
-- Safe to run again.
-- =====================================================================
do $$ begin
  if to_regclass('public.order_insurance') is null then raise exception 'Update 3.99.71: the coverage table is missing (077).'; end if;
end $$;

create or replace function public.order_insurance_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is not null then
    new.customer_name := coalesce((select nullif(trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.middle_name), ''), nullif(trim(c.last_name), ''))), '')
                                   from public.customers c where c.id = new.customer_id), new.customer_name);
  end if;
  return new;
end;
$$;
revoke execute on function public.order_insurance_name() from public, anon, authenticated;
drop trigger if exists order_insurance_name on public.order_insurance;
create trigger order_insurance_name before insert or update of customer_id on public.order_insurance
  for each row execute function public.order_insurance_name();

-- the coverages saved before: the middle name added
update public.order_insurance i
   set customer_name = trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.middle_name), ''), nullif(trim(c.last_name), '')))
  from public.customers c
 where c.id = i.customer_id and nullif(trim(c.middle_name), '') is not null
   and i.customer_name is distinct from trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.middle_name), ''), nullif(trim(c.last_name), '')));

select 'UPDATE 3.99.71 READY' as result;

-- ===================== 103_director_salary_no_card.sql =====================
-- =====================================================================
-- EMON OVERRUNS E-PORTAL - Update 3.99.76: the DIRECTOR pays a salary without scanning the employee's ID card
-- Everyone else still scans the employee's ID card. A payment made by the Director without the card says so in its notes.
-- Safe to run again.
-- =====================================================================
do $$ begin
  if to_regprocedure('public.pay_salary(uuid,numeric,date,text,text,text,text)') is null then raise exception 'Update 3.99.76: payroll is missing (063).'; end if;
end $$;

create or replace function public.pay_salary(p_payslip uuid, p_amount numeric, p_date date, p_method text, p_ref text, p_notes text, p_card text)
returns public.salary_payments
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare s public.payslips; e public.employees; c public.employee_cards; sec text; mm text[]; paid numeric; left_amt numeric;
  amt numeric := round(coalesce(p_amount, 0), 2); d date := coalesce(p_date, current_date); r public.salary_payments;
  me text := (select full_name from public.profiles where id = auth.uid());
begin
  if not public.can_write('employees') then raise exception 'Not allowed'; end if;
  select * into s from public.payslips where id = p_payslip for update;
  if not found then raise exception 'Payslip not found'; end if;
  select * into e from public.employees where id = s.employee_id;
  if s.issued_at is null then raise exception 'Payslip % was paid when it was made', s.payslip_no; end if;
  select coalesce(sum(amount), 0) into paid from public.salary_payments where payslip_id = s.id;
  left_amt := s.net_pay - paid;
  if left_amt <= 0 then raise exception 'Payslip % is paid already', s.payslip_no; end if;
  if amt <= 0 then raise exception 'Enter the amount to pay'; end if;
  if amt > left_amt then raise exception 'Only PHP % is left to pay on payslip %', to_char(left_amt, 'FM999,999,990.00'), s.payslip_no; end if;
  if d > current_date then raise exception 'The pay date cannot be after today'; end if;
  -- the employee's ID card: the card of this employee, valid today (3.99.76: the Director may pay without the card)
  if not (public.is_admin() and coalesce(trim(p_card), '') = '') then
    mm := regexp_match(upper(trim(coalesce(p_card, ''))), '^EMONID\|(EOID-[0-9]{4}-[0-9]{4,})\|([0-9A-F]{40})$');
    if mm is null then raise exception 'Scan the QR code on the employee''s ID card first'; end if;
    select * into c from public.employee_cards where card_no = mm[1];
    select k.secret into sec from private.employee_card_keys k where k.card_id = c.id;
    if c.id is null or sec is distinct from mm[2] then raise exception 'This ID card is not valid'; end if;
    if c.employee_id <> s.employee_id then raise exception 'This ID card is not the card of % - scan the card of the employee who is paid', upper(e.first_name || ' ' || e.last_name); end if;
    if c.status <> 'active' then raise exception 'This ID card is no longer valid (%) - use the new card', upper(c.status); end if;
    if c.valid_until < current_date then raise exception 'This ID card expired on %', to_char(c.valid_until, 'FMMONTH DD YYYY'); end if;
  end if;
  insert into public.salary_payments (payment_no, employee_id, payslip_id, amount, pay_date, method, reference_no, notes, card_no, created_by_name)
  values ('SP-' || to_char(d, 'YYYYMM') || '-' || lpad(public.next_counter('SP' || to_char(d, 'YYYYMM'))::text, 3, '0'), s.employee_id, s.id, amt, d,
    nullif(left(trim(coalesce(p_method, '')), 40), ''), nullif(left(trim(coalesce(p_ref, '')), 60), ''), nullif(left(trim(coalesce(p_notes, '') || case when c.card_no is null then case when coalesce(trim(p_notes), '') = '' then '' else ' · ' end || 'Paid by the Director without the ID card' else '' end), 300), ''), c.card_no, me)
  returning * into r;
  if e.profile_id is not null then
    perform public.notify_user(e.profile_id, 'Salary paid - ' || r.payment_no,
      'PHP ' || to_char(amt, 'FM999,999,990.00') || ' paid on payslip ' || s.payslip_no
      || case when amt < left_amt then ' (PHP ' || to_char(left_amt - amt, 'FM999,999,990.00') || ' still unpaid)' else ' (paid in full)' end, 'payslip/' || s.id);
  end if;
  return r;
end;
$$;
revoke execute on function public.pay_salary(uuid, numeric, date, text, text, text, text) from public, anon;
grant execute on function public.pay_salary(uuid, numeric, date, text, text, text, text) to authenticated;

select 'UPDATE 3.99.76 READY' as result;

select 'ALL UPDATES READY - 099 ' || case when to_regclass('public.box_sales') is not null and to_regprocedure('public.co_mark_sold(uuid)') is not null then 'OK' else 'MISSING' end
  || ' · 100 ' || case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'box_stock' and column_name = 'sheet_invoice') then 'OK' else 'MISSING' end
  || ' · 101 ' || case when exists (select 1 from pg_policies where tablename = 'ai_settings' and policyname = 'ai settings: staff read box settings') then 'OK' else 'MISSING' end
  || ' · 102 ' || case when to_regprocedure('public.order_insurance_name()') is not null then 'OK' else 'MISSING' end
  || ' · 103 ' || case when position('without the ID card' in pg_get_functiondef('public.pay_salary(uuid,numeric,date,text,text,text,text)'::regprocedure)) > 0 then 'OK' else 'MISSING' end as result;
