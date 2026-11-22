-- 3.99.227: SHOP LOCATION and TRX ID ON THE VERIFY PAGE.
-- SHOP LOCATION: a shop keeps its Google Maps link (pasted when the shop is added or edited); the shop page shows the map.
-- VERIFY BY TRX ID: the Verify page also takes a record's TRX ID (its server ID, printed at the bottom of every paper) and
-- shows the same record as its number does, so a copy can be checked against what is saved. Only the record's number is
-- looked up here; what the Verify page shows stays the same as before. Needs 109 first. Safe to run again.

alter table public.outlets add column if not exists map_url text check (map_url is null or char_length(map_url) <= 1000);

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
    union all select statement_no from public.statements where id = p_id) x
  where x.n is not null limit 1;
  return v;
end $$;
revoke execute on function public.verify_trx(uuid) from public;
grant execute on function public.verify_trx(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

select '137 OK - shop map link and TRX ID on the Verify page' as result;
