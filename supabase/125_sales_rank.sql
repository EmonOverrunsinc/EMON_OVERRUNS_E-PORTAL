-- 3.99.178: SALES RANK · TOP 10.
-- SHOPS: by the month's net sales (all of the day sales of that month); a new rank for every month.
-- CUSTOMERS: by the total net sales (all invoices − the approved credits taken off the balance), counted up to this
-- week's Monday, so the rank changes once a week, every Monday (Manila time).
-- Only the rank number is shown to employees; the amount only to EMON HASAN and staff with "See Balances & History".
-- Needs 109 first. Safe to run again.

create or replace function public.outlet_ranks(p_month text)
returns table (outlet_id uuid, rank int, net numeric, shops int)
language plpgsql stable security definer set search_path = '' as $$
declare d1 date; d2 date;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('outlets'))) then return; end if;
  if coalesce(p_month, '') !~ '^\d{4}-\d{2}$' then raise exception 'Give the month as YYYY-MM.'; end if;
  d1 := to_date(p_month || '-01', 'YYYY-MM-DD');
  d2 := (d1 + interval '1 month')::date;
  return query
    with t as (
      select o.id, o.code, coalesce(sum(s.total), 0)::numeric(14,2) as v
      from public.outlets o
      left join public.outlet_sales s on s.outlet_id = o.id and s.sale_date >= d1 and s.sale_date < d2
      where o.status = 'active'
      group by o.id, o.code),
    r as (
      select t.id, t.v, (row_number() over (order by t.v desc, t.code))::int as k, (count(*) over ())::int as n
      from t where t.v > 0)
    select r.id, r.k, case when public.sees_money() then r.v end, r.n from r where r.k <= 10 order by r.k;
end $$;
revoke execute on function public.outlet_ranks(text) from public, anon;
grant execute on function public.outlet_ranks(text) to authenticated;

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
    select r.id, r.k, case when public.sees_money() then r.v end, mon from r where r.k <= 10 order by r.k;
end $$;
revoke execute on function public.customer_ranks() from public, anon;
grant execute on function public.customer_ranks() to authenticated;

notify pgrst, 'reload schema';

select '125 OK - sales rank ready (' || (select count(*) from public.outlet_ranks(to_char(now() at time zone 'Asia/Manila', 'YYYY-MM'))) || ' shop(s) · '
  || (select count(*) from public.customer_ranks()) || ' customer(s) in the top 10)' as result;
