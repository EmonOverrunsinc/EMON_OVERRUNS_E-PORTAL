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
