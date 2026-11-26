-- Customer ranking uses the current calendar month in Asia/Manila and resets at the next month.
-- The best 15 eligible customers receive a monthly rank; the portal animates only ranks 1 to 10.
-- Safe to run again.

create or replace function public.customer_ranks()
returns table (customer_id uuid, rank int, net numeric, as_of date, tier text)
language plpgsql stable security definer set search_path = '' as $$
declare
  month_start date := date_trunc('month', now() at time zone 'Asia/Manila')::date;
  month_end date := (month_start + interval '1 month')::date;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('customers'))) then return; end if;
  return query
    with totals as (
      select c.id, c.account_no,
        coalesce((select sum(i.total_amount)
                  from public.customer_invoices i
                  where i.customer_id = c.id
                    and i.invoice_date >= month_start and i.invoice_date < month_end), 0)
        - coalesce((select sum(m.request_amount)
                    from public.credit_memos m
                    where m.customer_id = c.id
                      and m.status in ('approved', 'paid') and m.off_balance
                      and m.memo_date >= month_start and m.memo_date < month_end), 0) as value
      from public.customers c
      where c.status = 'active'
        and exists (
          select 1 from public.customer_invoices q
          where q.customer_id = c.id
            and q.invoice_date >= month_start and q.invoice_date < month_end)
        -- A restored account returns to ranking on the next calendar-month cycle, not immediately.
        and not exists (
          select 1 from public.customer_events e
          where e.customer_id = c.id and e.created_at >= month_start
            and (e.action ~* '^active by ' or e.action ~* '^reopened'))),
    ranked as (
      select t.id, t.value::numeric(14,2) as value,
        (row_number() over (order by t.value desc, t.account_no))::int as place
      from totals t)
    select r.id, r.place, case when public.sees_money() then r.value end, month_start,
      case when r.value >= 100000 then 'gold'
           when r.value >= 60000 then 'silver'
           when r.value >= 25000 then 'bronze' end
    from ranked r where r.place <= 15
    order by r.place;
end $$;

revoke execute on function public.customer_ranks() from public, anon;
grant execute on function public.customer_ranks() to authenticated;

notify pgrst, 'reload schema';

select '160 OK - customer ranks use current-month invoiced net sales' as result;
