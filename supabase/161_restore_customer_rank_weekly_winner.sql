-- Restore the original customer ranking and keep the current week as a separate #1 profile watermark.
-- Main ranking: every active customer with positive lifetime net purchases, closed at this week's Monday.
-- Weekly winner: only the active #1 customer from the latest completed Monday-to-Sunday week.
-- Safe to run again.

create or replace function public.customer_ranks()
returns table (customer_id uuid, rank int, net numeric, as_of date, tier text)
language plpgsql stable security definer set search_path = '' as $$
declare
  monday date := date_trunc('week', now() at time zone 'Asia/Manila')::date;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('customers'))) then return; end if;
  return query
    with totals as (
      select c.id, c.account_no,
        coalesce((select sum(i.total_amount)
                  from public.customer_invoices i
                  where i.customer_id = c.id and i.invoice_date < monday), 0)
        - coalesce((select sum(m.request_amount)
                    from public.credit_memos m
                    where m.customer_id = c.id
                      and m.status in ('approved', 'paid') and m.off_balance
                      and m.memo_date < monday), 0) as value
      from public.customers c
      where c.status = 'active'),
    ranked as (
      select t.id, t.value::numeric(14,2) as value,
        (row_number() over (order by t.value desc, t.account_no))::int as place
      from totals t
      where t.value > 0)
    select r.id, r.place, case when public.sees_money() then r.value end, monday,
      case when r.value >= 100000 then 'gold'
           when r.value >= 60000 then 'silver'
           when r.value >= 25000 then 'bronze' end
    from ranked r
    order by r.place;
end $$;

revoke execute on function public.customer_ranks() from public, anon;
grant execute on function public.customer_ranks() to authenticated;

create or replace function public.customer_weekly_winner()
returns table (customer_id uuid, net numeric, week_start date)
language plpgsql stable security definer set search_path = '' as $$
declare
  period_end date := date_trunc('week', now() at time zone 'Asia/Manila')::date;
  period_start date := (period_end - interval '7 days')::date;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('customers'))) then return; end if;
  return query
    with totals as (
      select c.id, c.account_no,
        coalesce((select sum(i.total_amount)
                  from public.customer_invoices i
                  where i.customer_id = c.id
                    and i.invoice_date >= period_start and i.invoice_date < period_end), 0)
        - coalesce((select sum(m.request_amount)
                    from public.credit_memos m
                    where m.customer_id = c.id
                      and m.status in ('approved', 'paid') and m.off_balance
                      and m.memo_date >= period_start and m.memo_date < period_end), 0) as value
      from public.customers c
      where c.status = 'active'
        and exists (
          select 1 from public.customer_invoices i
          where i.customer_id = c.id
            and i.invoice_date >= period_start and i.invoice_date < period_end))
    select t.id, case when public.sees_money() then t.value::numeric(14,2) end, period_start
    from totals t
    where t.value > 0
    order by t.value desc, t.account_no
    limit 1;
end $$;

revoke execute on function public.customer_weekly_winner() from public, anon;
grant execute on function public.customer_weekly_winner() to authenticated;

notify pgrst, 'reload schema';

select '161 OK - full customer rank restored; weekly #1 profile watermark ready' as result;
