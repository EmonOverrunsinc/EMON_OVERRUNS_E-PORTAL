-- 3.99.184: CUSTOMER RANK FOR EVERY CUSTOMER (not only the Top 10): the customers list is numbered by rank (1 = the highest
-- total net sales). Counted up to this week's Monday, so the rank changes once a week. Only the Top 10 get a badge.
-- Needs 125 first. Safe to run again.

create or replace function public.customer_ranks()
returns table (customer_id uuid, rank int, net numeric, as_of date)
language plpgsql stable security definer set search_path = '' as $$
declare mon date;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('customers'))) then return; end if;
  mon := date_trunc('week', now() at time zone 'Asia/Manila')::date; -- this week's Monday
  return query
    with t as (
      select c.id, c.account_no,
        coalesce((select sum(i.total_amount) from public.customer_invoices i where i.customer_id = c.id and i.invoice_date < mon), 0)
        - coalesce((select sum(m.request_amount) from public.credit_memos m
                    where m.customer_id = c.id and m.status in ('approved', 'paid') and m.off_balance and m.memo_date < mon), 0) as v
      from public.customers c
      where c.status = 'active'),
    r as (
      select t.id, t.v::numeric(14,2) as v, (row_number() over (order by t.v desc, t.account_no))::int as k
      from t where t.v > 0)
    select r.id, r.k, case when public.sees_money() then r.v end, mon from r order by r.k;
end $$;
revoke execute on function public.customer_ranks() from public, anon;
grant execute on function public.customer_ranks() to authenticated;

notify pgrst, 'reload schema';

select '127 OK - ' || (select count(*) from public.customer_ranks()) || ' customer(s) ranked' as result;
