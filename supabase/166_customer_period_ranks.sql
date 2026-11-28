-- 3.99.375: CUSTOMER RANKING BY PERIOD: this week (Monday to today) and this month (1st to today), besides the
-- lifetime ranking (customer_ranks). Net = invoices − approved credit memos taken off the balance, in that period.
-- Needs 161. Safe to run again.

create or replace function public.customer_period_ranks(p_kind text)
returns table (customer_id uuid, rank int, net numeric, period_start date, period_end date)
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  d0 date := case lower(coalesce(p_kind, '')) when 'month' then date_trunc('month', today)::date else date_trunc('week', today)::date end;
  d1 date := today + 1;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('customers'))) then return; end if;
  return query
    with totals as (
      select c.id, c.account_no,
        coalesce((select sum(i.total_amount) from public.customer_invoices i
                  where i.customer_id = c.id and i.invoice_date >= d0 and i.invoice_date < d1), 0)
        - coalesce((select sum(m.request_amount) from public.credit_memos m
                    where m.customer_id = c.id and m.status in ('approved', 'paid') and m.off_balance
                      and m.memo_date >= d0 and m.memo_date < d1), 0) as value
      from public.customers c
      where c.status = 'active'),
    ranked as (
      select t.id, t.value::numeric(14,2) as value, (row_number() over (order by t.value desc, t.account_no))::int as place
      from totals t where t.value > 0)
    select r.id, r.place, case when public.sees_money() then r.value end, d0, today
    from ranked r order by r.place;
end $$;
revoke execute on function public.customer_period_ranks(text) from public, anon;
grant execute on function public.customer_period_ranks(text) to authenticated;

notify pgrst, 'reload schema';

select '166 OK - weekly and monthly customer ranking' as result;
