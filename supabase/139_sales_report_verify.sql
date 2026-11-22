-- 3.99.232: CHECK A DAILY SALES REPORT ON THE VERIFY PAGE.
-- The sales report's number (DSR-SHOP1-20261119) and its TRX ID (the PDF417 under the Director's name) now show the
-- saved record on the Verify page: the shop, the date and who recorded it (staff also see the total sales).
-- Needs 109 and 137 first. Safe to run again.

create or replace function public.dsr_no(p_sale uuid) returns text
language sql stable security definer set search_path = '' as $$
  select 'DSR-' || regexp_replace(upper(coalesce(o.code, '')), '[^A-Z0-9]', '', 'g') || '-' || to_char(s.sale_date, 'YYYYMMDD')
  from public.outlet_sales s join public.outlets o on o.id = s.outlet_id where s.id = p_sale;
$$;
revoke execute on function public.dsr_no(uuid) from public, anon, authenticated;

-- the TRX ID of a sales record gives its report number too
create or replace function public.verify_trx(p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_id is null then return null; end if;
  select x.n into v from (
    select invoice_no as n from public.customer_invoices where id = p_id
    union all select receipt_no from public.payments_received where id = p_id
    union all select order_no from public.customer_orders where id = p_id
    union all select memo_no from public.credit_memos where id = p_id
    union all select ins_no from public.order_insurance where id = p_id
    union all select cv_no from public.collection_vouchers where id = p_id
    union all select voucher_no from public.pay_vouchers where id = p_id
    union all select po_no from public.purchase_orders where id = p_id
    union all select bill_no from public.stock_bills where id = p_id
    union all select payslip_no from public.payslips where id = p_id
    union all select project_no from public.projects where id = p_id
    union all select qc_no from public.qc_tests where id = p_id
    union all select statement_no from public.statements where id = p_id
    union all select public.dsr_no(id) from public.outlet_sales where id = p_id) x
  where x.n is not null limit 1;
  return v;
end $$;
revoke execute on function public.verify_trx(uuid) from public;
grant execute on function public.verify_trx(uuid) to anon, authenticated;

-- a sales report by its number: found or not, and a few details
create or replace function public.verify_dsr(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m text[]; s record; staff boolean := coalesce(public.is_active() and (public.is_staff() or public.is_admin()), false);
begin
  m := regexp_match(upper(trim(coalesce(p_code, ''))), '^DSR-([A-Z0-9]+)-(\d{8})$');
  if m is null then return jsonb_build_object('found', false); end if;
  select x.*, o.code as o_code, o.name as o_name into s
  from public.outlet_sales x join public.outlets o on o.id = x.outlet_id
  where regexp_replace(upper(coalesce(o.code, '')), '[^A-Z0-9]', '', 'g') = m[1]
    and x.sale_date = to_date(m[2], 'YYYYMMDD') limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'type', 'Daily Sales Report', 'number', upper(trim(p_code)), 'status', 'recorded', 'limited', not staff,
    'fields', jsonb_build_array(
      jsonb_build_array('Sales Record No', upper(trim(p_code))),
      jsonb_build_array('Outlet', s.o_code || case when s.o_name is not null and s.o_name <> s.o_code then ' · ' || s.o_name else '' end),
      jsonb_build_array('Sales Date', to_char(s.sale_date, 'FMMonth DD YYYY')),
      jsonb_build_array('Recorded By', coalesce(s.created_by_name, '')),
      jsonb_build_array('Recorded On', to_char(s.created_at at time zone 'Asia/Manila', 'FMMonth DD YYYY'))
    ) || case when staff then jsonb_build_array(jsonb_build_array('Total Sales', 'PHP ' || to_char(coalesce(s.total, 0), 'FM999,999,999,990.00'))) else '[]'::jsonb end);
end $$;
revoke execute on function public.verify_dsr(text) from public;
grant execute on function public.verify_dsr(text) to anon, authenticated;

notify pgrst, 'reload schema';

select '139 OK - sales reports can be checked on the Verify page' as result;
