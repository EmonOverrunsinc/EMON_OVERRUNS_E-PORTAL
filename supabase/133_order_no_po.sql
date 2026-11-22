-- 3.99.213: CUSTOMER ORDER numbers PO-YYYYMM-#### (were OR-YYYYMM-####, easy to mix up with the payment receipts OR-PR-…).
-- New orders get PO-202611-0005 and so on: the same count of the month goes on. The orders made already get the new
-- name too (OR-202611-0001 becomes PO-202611-0001), with the PO no of their invoice, their coverage, the sold boxes,
-- their notices and the customer's history. An order paper printed before (OR-… or CO-…) still opens its order.
-- Needs 047 first. Safe to run again.

-- new orders: only the letters change
do $$
declare def text;
begin
  if to_regprocedure('public.save_customer_order(uuid,jsonb)') is null then
    raise exception 'The customer orders are not set up yet.';
  end if;
  def := pg_get_functiondef('public.save_customer_order(uuid,jsonb)'::regprocedure);
  if position('''OR-'' || to_char(d' in def) > 0 then
    execute replace(def, '''OR-'' || to_char(d', '''PO-'' || to_char(d');
  end if;
end $$;

-- an order paper printed before (OR-… or CO-…) still finds its order
create or replace function public.co_by_paper(p_no text, p_code text) returns public.customer_orders
language plpgsql stable security definer set search_path = '' as $$
declare o public.customer_orders; n text := upper(trim(coalesce(p_no, '')));
begin
  if coalesce(trim(p_code), '') <> '' then
    select * into o from public.customer_orders
    where order_no in (n, regexp_replace(n, '^(CO|OR)-', 'PO-')) and delivery_code = lower(trim(p_code));
  end if;
  if o.id is null then raise exception 'This order paper is not known. Scan the barcode or the QR code of the printed order again.'; end if;
  return o;
end $$;

-- the orders made already
do $$
begin
  perform set_config('eo.allow_change', 'on', true);
  update public.customer_invoices i set po_number = 'PO' || substr(i.po_number, 3)
    where i.po_number ~ '^OR-[0-9]{6}-[0-9]+$';
  update public.credit_memos m set po_number = 'PO' || substr(m.po_number, 3)
    where m.po_number ~ '^OR-[0-9]{6}-[0-9]+$';
  update public.order_insurance set order_no = 'PO' || substr(order_no, 3) where order_no ~ '^OR-[0-9]{6}-[0-9]+$';
  if to_regclass('public.box_sales') is not null then
    update public.box_sales set order_no = 'PO' || substr(order_no, 3) where order_no ~ '^OR-[0-9]{6}-[0-9]+$';
  end if;
  update public.notifications set title = regexp_replace(title, '\mOR-([0-9]{6}-[0-9]+)', 'PO-\1', 'g'),
                                  body = regexp_replace(body, '\mOR-([0-9]{6}-[0-9]+)', 'PO-\1', 'g')
    where title ~ '\mOR-[0-9]{6}-[0-9]+' or body ~ '\mOR-[0-9]{6}-[0-9]+';
  update public.customer_events set note = regexp_replace(note, '\mOR-([0-9]{6}-[0-9]+)', 'PO-\1', 'g')
    where note ~ '\mOR-[0-9]{6}-[0-9]+';
  update public.customer_orders set order_no = 'PO' || substr(order_no, 3) where order_no ~ '^OR-[0-9]{6}-[0-9]+$';
  perform set_config('eo.allow_change', '', true);
end $$;

notify pgrst, 'reload schema';

select case when position('''PO-'' || to_char(d' in pg_get_functiondef('public.save_customer_order(uuid,jsonb)'::regprocedure)) > 0
    and not exists (select 1 from public.customer_orders where order_no ~ '^OR-')
  then '133 OK - Customer Order numbers are PO-YYYYMM-#### now (' || (select count(*) from public.customer_orders) || ' order(s))'
  else 'NOT READY - send this message to Claude' end as result;
