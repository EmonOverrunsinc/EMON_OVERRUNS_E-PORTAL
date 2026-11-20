-- 3.99.147: the box goes to the right order line: the BATCH NO comes before the product name (many lines can have the
-- same product), and a line typed without a box count still gets its box. The invoice and the line correction (116)
-- use the same order. Needs 064 + 116 first. Safe to run again.

create or replace function public.co_delivered(p_order uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare o public.customer_orders; res jsonb;
begin
  select * into o from public.customer_orders where id = p_order;
  if not found then return null; end if;
  with ln as (
    select (x.ord - 1)::int as i, x.v, upper(trim(coalesce(x.v ->> 'code', ''))) as code, upper(trim(coalesce(x.v ->> 'lot', ''))) as lot,
      upper(trim(coalesce(x.v ->> 'product', ''))) as prod, coalesce(nullif(x.v ->> 'price', '')::numeric, 0) as price,
      coalesce(nullif(x.v ->> 'qty', '')::numeric, 0) as qty, coalesce(nullif(x.v ->> 'boxes', '')::numeric, 0) as nbox,
      coalesce(nullif(x.v ->> 'amount', '')::numeric, coalesce(nullif(x.v ->> 'qty', '')::numeric, 0) * coalesce(nullif(x.v ->> 'price', '')::numeric, 0)) as amt
    from jsonb_array_elements(coalesce(o.lines, '[]'::jsonb)) with ordinality x(v, ord)
  ), bx as (
    select b.id, b.serial_no, upper(trim(coalesce(b.code, ''))) as code, upper(trim(coalesce(b.batch_no, ''))) as lot,
      upper(trim(coalesce(b.items, ''))) as item, coalesce(b.pcs, 0) as pcs
    from public.customer_order_boxes b where b.order_id = p_order
  ), pick as (
    select bx.*, m.i, m.rk from bx left join lateral (
      select ln.i, case when ln.code = bx.code and ln.lot = bx.lot then 0
          when bx.lot <> '' and ln.lot = bx.lot and (ln.code = '' or bx.code = '') then 1
          when bx.code <> '' and ln.code = bx.code and (ln.lot = '' or bx.lot = '') then 2
          -- 3.99.147: the batch no before the product (many lines can have the same product)
          when bx.lot <> '' and ln.lot = bx.lot and bx.pcs > 0 and ln.qty / greatest(ln.nbox, 1) = bx.pcs then 3
          when bx.lot <> '' and ln.lot = bx.lot then 4
          when bx.item <> '' and ln.prod <> '' and (ln.prod = bx.item or position(ln.prod in bx.item) > 0 or position(bx.item in ln.prod) > 0)
            and bx.pcs > 0 and ln.qty / greatest(ln.nbox, 1) = bx.pcs then 5
          when bx.item <> '' and ln.prod <> '' and (ln.prod = bx.item or position(ln.prod in bx.item) > 0 or position(bx.item in ln.prod) > 0) then 6
          when bx.pcs > 0 and ln.qty / greatest(ln.nbox, 1) = bx.pcs then 7
          when bx.code <> '' and ln.code = bx.code then 8
          else 9 end as rk
      from ln where ln.nbox > 0 or ln.qty > 0
      -- among lines that fit the same way, the line of the same product first (e.g. MIX and TOMMY, both without a code)
      order by 2, (bx.item <> '' and ln.prod = bx.item) desc,
        (bx.item <> '' and ln.prod <> '' and (position(ln.prod in bx.item) > 0 or position(bx.item in ln.prod) > 0)) desc, ln.i limit 1) m on true
  ), per as (
    select ln.i, ln.v, ln.price, ln.qty, ln.nbox, ln.amt,
      count(p.id) filter (where p.rk < 9) as boxes_in, coalesce(sum(p.pcs) filter (where p.rk < 9), 0) as pcs_in,
      count(p.id) filter (where p.rk < 9 and p.pcs = 0) as zero_in
    from ln left join pick p on p.i = ln.i group by ln.i, ln.v, ln.price, ln.qty, ln.nbox, ln.amt
  ), tot as (select coalesce(sum(pcs), 0) as pcs, count(*) filter (where serial_no is not null) as boxes from bx),
  lines as (
    select per.*, case when (per.nbox = 0 and per.boxes_in = 0) or per.zero_in > 0 or (select pcs from tot) = 0 then per.qty else per.pcs_in end as dqty
    from per
  ), lines2 as (
    select lines.*, case when (lines.nbox = 0 and lines.boxes_in = 0) or lines.zero_in > 0 or (select pcs from tot) = 0 then lines.amt else round(lines.dqty * lines.price, 2) end as damt from lines
  ), odd as (
    select coalesce(sum(p.pcs), 0) as pcs from pick p where p.rk is null or p.rk = 9
  ), oddl as (
    select p.code, p.lot, p.item, count(*) filter (where p.serial_no is not null) as boxes, count(*) as lines, coalesce(sum(p.pcs), 0) as pcs,
      string_agg(coalesce(p.serial_no, '-'), ', ' order by p.serial_no) as serials
    from pick p where p.rk is null or p.rk = 9 group by p.code, p.lot, p.item
  )
  select jsonb_build_object(
    'has_pcs', (select pcs from tot) > 0,
    'boxes', (select boxes from tot),
    'pcs', (select coalesce(sum(dqty), 0) from lines2),
    'odd_pcs', (select pcs from odd),
    'odd', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'lot', lot, 'items', item, 'boxes', boxes, 'lines', lines, 'pcs', pcs, 'serials', serials) order by lot, code, item) from oddl), '[]'::jsonb),
    'ordered_amount', o.total_amount, 'ordered_pcs', o.total_pcs,
    'amount', (select coalesce(sum(damt), 0) from lines2),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('i', i, 'product', v ->> 'product', 'code', v ->> 'code', 'lot', v ->> 'lot', 'price', price,
       'ordered', qty, 'delivered', dqty, 'boxes', boxes_in, 'amount', damt, 'ordered_amount', amt) order by i) from lines2), '[]'::jsonb))
  into res;
  return res;
end;
$$;
revoke execute on function public.co_delivered(uuid) from public, anon;
grant execute on function public.co_delivered(uuid) to authenticated;

create or replace function public.co_fix_lines(p_order uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare o public.customer_orders; r record; ls jsonb; n int := 0; v jsonb; prod text;
begin
  select * into o from public.customer_orders where id = p_order;
  if not found or o.status = 'cancelled' or jsonb_array_length(coalesce(o.lines, '[]'::jsonb)) = 0 then return 0; end if;
  ls := o.lines;
  for r in
    with ln as (
      select (x.ord - 1)::int as i, upper(trim(coalesce(x.v ->> 'code', ''))) as code, upper(trim(coalesce(x.v ->> 'lot', ''))) as lot,
        upper(trim(coalesce(x.v ->> 'product', ''))) as prod, coalesce(nullif(x.v ->> 'qty', '')::numeric, 0) as qty,
        coalesce(nullif(x.v ->> 'boxes', '')::numeric, 0) as nbox
      from jsonb_array_elements(o.lines) with ordinality x(v, ord)
    ), bx as (
      select b.id, upper(trim(coalesce(b.code, ''))) as code, upper(trim(coalesce(b.batch_no, ''))) as lot,
        upper(trim(coalesce(b.items, ''))) as item, upper(trim(coalesce(b.brand, ''))) as brand, coalesce(b.pcs, 0) as pcs
      from public.customer_order_boxes b where b.order_id = p_order and b.serial_no is not null
    ), pick as (
      select bx.*, m.i, m.rk from bx left join lateral (
        select ln.i, case when ln.code = bx.code and ln.lot = bx.lot then 0
            when bx.lot <> '' and ln.lot = bx.lot and (ln.code = '' or bx.code = '') then 1
            when bx.code <> '' and ln.code = bx.code and (ln.lot = '' or bx.lot = '') then 2
            -- 3.99.147: the batch no before the product (many lines can have the same product)
            when bx.lot <> '' and ln.lot = bx.lot and bx.pcs > 0 and ln.qty / greatest(ln.nbox, 1) = bx.pcs then 3
            when bx.lot <> '' and ln.lot = bx.lot then 4
            when bx.item <> '' and ln.prod <> '' and (ln.prod = bx.item or position(ln.prod in bx.item) > 0 or position(bx.item in ln.prod) > 0)
              and bx.pcs > 0 and ln.qty / greatest(ln.nbox, 1) = bx.pcs then 5
            when bx.item <> '' and ln.prod <> '' and (ln.prod = bx.item or position(ln.prod in bx.item) > 0 or position(bx.item in ln.prod) > 0) then 6
            when bx.pcs > 0 and ln.qty / greatest(ln.nbox, 1) = bx.pcs then 7
            when bx.code <> '' and ln.code = bx.code then 8
            else 9 end as rk
        from ln where ln.nbox > 0 or ln.qty > 0
        order by 2, (bx.item <> '' and ln.prod = bx.item) desc,
          (bx.item <> '' and ln.prod <> '' and (position(ln.prod in bx.item) > 0 or position(bx.item in ln.prod) > 0)) desc, ln.i limit 1) m on true
    )
    select p.i, min(p.code) as code, min(p.lot) as lot, min(p.item) as item, min(p.brand) as brand
    from pick p where p.rk between 1 and 8 and p.i is not null
      and not exists (select 1 from pick q where q.i = p.i and q.rk = 0) -- a line with an exact box is right already
    group by p.i
    having count(distinct (p.code, p.lot, p.item)) = 1
  loop
    v := ls -> r.i;
    prod := case when r.item = '' then v ->> 'product'
      when r.brand <> '' and position(r.brand in r.item) = 0 then r.item || ' · ' || r.brand else r.item end;
    if upper(trim(coalesce(v ->> 'code', ''))) is distinct from r.code or upper(trim(coalesce(v ->> 'lot', ''))) is distinct from r.lot
       or upper(trim(coalesce(v ->> 'product', ''))) is distinct from upper(prod) then
      ls := jsonb_set(ls, array[r.i::text], v || jsonb_build_object('code', r.code, 'lot', r.lot, 'product', prod,
        'fixed', coalesce(v -> 'fixed', jsonb_build_object('code', v ->> 'code', 'lot', v ->> 'lot', 'product', v ->> 'product',
          'at', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI')))));
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    perform set_config('eo.allow_change', 'on', true);
    update public.customer_orders set lines = ls, updated_at = now() where id = p_order;
    perform set_config('eo.allow_change', '', true);
  end if;
  return n;
end $$;
revoke execute on function public.co_fix_lines(uuid) from public, anon, authenticated;

-- the open orders now: corrected again with the new order
do $$
declare r record;
begin
  for r in select id from public.customer_orders where status in ('pending', 'approved') loop
    begin perform public.co_fix_lines(r.id); exception when others then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';

select '117 OK - a box goes to the order line of its batch no first' as result;
