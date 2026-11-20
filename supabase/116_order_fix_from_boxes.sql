-- 3.99.146: THE BOX IS THE TRUE RECORD. When a scanned box goes to an order line (by pcs, batch no, code or product) but
-- the line was typed with another batch no / code / product, the line is corrected from the box (the server box data):
-- batch no, code and product (items · brand). The price and the pcs stay. The old values are kept in the line ("fixed").
-- A line whose boxes are of different kinds is not changed. Needs 064 + 115 first. Safe to run again.

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
            when bx.item <> '' and ln.prod = bx.item then 3
            when bx.item <> '' and ln.prod <> '' and (position(ln.prod in bx.item) > 0 or position(bx.item in ln.prod) > 0) then 4
            when bx.pcs > 0 and ln.nbox > 0 and ln.qty / ln.nbox = bx.pcs then 5
            when bx.lot <> '' and ln.lot = bx.lot then 6
            when bx.code <> '' and ln.code = bx.code then 7
            else 9 end as rk
        from ln where ln.nbox > 0
        order by 2, (bx.item <> '' and ln.prod = bx.item) desc,
          (bx.item <> '' and ln.prod <> '' and (position(ln.prod in bx.item) > 0 or position(bx.item in ln.prod) > 0)) desc, ln.i limit 1) m on true
    )
    select p.i, min(p.code) as code, min(p.lot) as lot, min(p.item) as item, min(p.brand) as brand
    from pick p where p.rk between 1 and 8
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

-- the boxes of an order change: first the lines are corrected from the boxes, then the invoice follows
create or replace function public.co_boxes_charge() returns trigger
language plpgsql security definer set search_path = '' as $$
declare oid uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
begin
  perform public.co_fix_lines(oid);
  perform public.co_charge_as_delivered(oid);
  return null;
end;
$$;
revoke execute on function public.co_boxes_charge() from public, anon, authenticated;

-- the open orders now: corrected from their boxes
do $$
declare r record;
begin
  for r in select id from public.customer_orders where status in ('pending', 'approved') loop
    begin perform public.co_fix_lines(r.id); exception when others then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';

select '116 OK - order lines are corrected from the scanned boxes' as result;
