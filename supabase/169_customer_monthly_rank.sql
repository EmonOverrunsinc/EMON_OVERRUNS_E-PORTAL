-- 3.99.389: CUSTOMER MONTHLY RANK. The 3 customers with the highest net purchases of a month are ranked #1 GOLD,
-- #2 SILVER, #3 BRONZE, e.g. "#1 OF JANUARY 2026" (saved on FEBRUARY 01 2026). The rank shows beside the customer's name
-- for the whole next month. It is a rank, not a medal: the weekly MEDAL REWARD system and its prizes stay as they are.
-- The months before this update get their ranks now. Needs 126, 130, 131 and 136. Safe to run again.

alter table public.sales_medals drop constraint if exists sales_medals_kind_check;
alter table public.sales_medals add constraint sales_medals_kind_check check (kind in ('outlet', 'outlet_month', 'customer', 'customer_month'));

create or replace function public.award_medals() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  last_day date := ((now() at time zone 'Asia/Manila') - interval '36 hours')::date;
  this_mon date := date_trunc('week', now() at time zone 'Asia/Manila')::date;
  this_month date := date_trunc('month', now() at time zone 'Asia/Manila')::date;
  won jsonb; w jsonb; mw text;
begin
  -- shops, each closed day: only the shops with a record that day; medals = shops taking part − 1 (at most 3)
  insert into public.sales_medals (kind, owner_id, period, rank, amount)
  select 'outlet', t.outlet_id, t.sale_date, t.k, t.v from (
    select s.outlet_id, s.sale_date, s.total as v,
      (row_number() over (partition by s.sale_date order by s.total desc, o.code))::int as k,
      (count(*) over (partition by s.sale_date))::int as n
    from public.outlet_sales s join public.outlets o on o.id = s.outlet_id and o.status = 'active'
    where s.sale_date <= last_day and s.total > 0
      and not exists (select 1 from public.sales_medals m where m.kind = 'outlet' and m.period = s.sale_date)) t
  where t.n >= 2 and t.k <= least(3, t.n - 1)
  on conflict do nothing;

  -- shops, each closed month: the sum of the month; the same number of medals; the winners are told
  with ins as (
    insert into public.sales_medals (kind, owner_id, period, rank, amount)
    select 'outlet_month', t.oid, t.mon, t.k, t.v from (
      select x.oid, x.mon, x.v, (row_number() over (partition by x.mon order by x.v desc, x.code))::int as k, (count(*) over (partition by x.mon))::int as n
      from (select s.outlet_id as oid, date_trunc('month', s.sale_date)::date as mon, sum(s.total) as v, min(o.code) as code
            from public.outlet_sales s join public.outlets o on o.id = s.outlet_id and o.status = 'active'
            where s.sale_date < this_month group by s.outlet_id, date_trunc('month', s.sale_date)::date having sum(s.total) > 0) x
      where not exists (select 1 from public.sales_medals m where m.kind = 'outlet_month' and m.period = x.mon)) t
    where t.n >= 2 and t.k <= least(3, t.n - 1)
    on conflict do nothing
    returning owner_id, period, rank)
  select coalesce(jsonb_agg(jsonb_build_object('o', owner_id, 'p', period, 'r', rank)), '[]'::jsonb) into won from ins;
  if jsonb_array_length(won) > 0 and won is not null then
    perform set_config('eo.system_note', 'on', true);
    for w in select * from jsonb_array_elements(won) loop
      mw := case (w->>'r')::int when 1 then 'GOLD MEDAL #1' when 2 then 'SILVER MEDAL #2' else 'BRONZE MEDAL #3' end;
      perform public.outlet_staff_notify((w->>'o')::uuid, mw || ' · ' || upper(to_char((w->>'p')::date, 'FMMonth YYYY')),
        coalesce((select o.code from public.outlets o where o.id = (w->>'o')::uuid), 'Your shop') || ' won the ' || lower(mw) || ' of ' || to_char((w->>'p')::date, 'FMMonth YYYY') || '. Congratulations!');
      perform public.notify_admins(mw || ' · ' || coalesce((select o.code from public.outlets o where o.id = (w->>'o')::uuid), 'Shop'),
        upper(to_char((w->>'p')::date, 'FMMonth YYYY')) || ' monthly sales medal', 'outlet/' || (w->>'o'));
    end loop;
    perform set_config('eo.system_note', '', true);
  end if;

  -- customers: unchanged (the 3 best of each closed week, with the minimum purchases of each medal)
  insert into public.sales_medals (kind, owner_id, period, rank, amount)
  select 'customer', t.cid, t.wk, t.medal, t.v from (
    select x.cid, x.wk, x.v,
      case when k = 1 and x.v >= 100000 then 1 when k <= 2 and x.v >= 60000 then 2 when k <= 3 and x.v >= 25000 then 3 end as medal
    from (
      select y.cid, y.wk, sum(y.v) as v, (row_number() over (partition by y.wk order by sum(y.v) desc, min(c.account_no)))::int as k
      from (
        select i.customer_id as cid, date_trunc('week', i.invoice_date)::date as wk, i.total_amount as v
        from public.customer_invoices i where i.invoice_date < this_mon
        union all
        select m.customer_id, date_trunc('week', m.memo_date)::date, -m.request_amount
        from public.credit_memos m where m.status in ('approved', 'paid') and m.off_balance and m.memo_date < this_mon) y
      join public.customers c on c.id = y.cid and c.status = 'active'
      group by y.cid, y.wk) x
    where x.v > 0 and not exists (select 1 from public.sales_medals m where m.kind = 'customer' and m.period = x.wk)) t
  where t.medal is not null
  on conflict do nothing;

  -- 3.99.389: the MONTHLY RANK of customers (not a medal, no prize): each closed month, the 3 best net purchases of the
  -- month are #1 gold, #2 silver, #3 bronze; saved on the 1st of the next month and never changed.
  with ins as (
    insert into public.sales_medals (kind, owner_id, period, rank, amount)
    select 'customer_month', t.cid, t.mon, t.k, t.v from (
      select x.cid, x.mon, x.v, (row_number() over (partition by x.mon order by x.v desc, x.acct))::int as k
      from (
        select y.cid, y.mon, sum(y.v) as v, min(c.account_no) as acct
        from (
          select i.customer_id as cid, date_trunc('month', i.invoice_date)::date as mon, i.total_amount as v
          from public.customer_invoices i where i.invoice_date < this_month
          union all
          select m.customer_id, date_trunc('month', m.memo_date)::date, -m.request_amount
          from public.credit_memos m where m.status in ('approved', 'paid') and m.off_balance and m.memo_date < this_month) y
        join public.customers c on c.id = y.cid and c.status = 'active'
        group by y.cid, y.mon) x
      where x.v > 0 and not exists (select 1 from public.sales_medals m where m.kind = 'customer_month' and m.period = x.mon)) t
    where t.k <= 3
    on conflict do nothing
    returning owner_id, period, rank)
  select coalesce(jsonb_agg(jsonb_build_object('o', owner_id, 'p', period, 'r', rank)), '[]'::jsonb) into won from ins;
  -- EMON HASAN is told the ranks of the month just closed (not the older months saved now for the first time)
  if won is not null and jsonb_array_length(won) > 0 then
    perform set_config('eo.system_note', 'on', true);
    for w in select e.value from jsonb_array_elements(won) e where (e.value->>'p')::date = (this_month - interval '1 month')::date loop
      perform public.notify_admins('#' || (w->>'r') || ' RANK OF ' || upper(to_char((w->>'p')::date, 'FMMonth YYYY')) || ' · '
          || coalesce((select upper(trim(concat_ws(' ', c.first_name, c.last_name))) from public.customers c where c.id = (w->>'o')::uuid), 'Customer'),
        'Customer monthly rank', 'customer/' || (w->>'o'));
    end loop;
    perform set_config('eo.system_note', '', true);
  end if;
end $$;
revoke execute on function public.award_medals() from public, anon, authenticated;

-- last month's ranks (#1 gold, #2 silver, #3 bronze): shown beside the customer's name for the whole month
drop function if exists public.customer_month_medals();
create or replace function public.customer_month_ranks()
returns table (customer_id uuid, rank int, net numeric, month date)
language plpgsql volatile security definer set search_path = '' as $$
declare last_month date := (date_trunc('month', now() at time zone 'Asia/Manila') - interval '1 month')::date;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('customers'))) then return; end if;
  perform public.award_medals();
  return query
    select m.owner_id, m.rank, case when public.sees_money() then m.amount end, m.period
      from public.sales_medals m join public.customers c on c.id = m.owner_id and c.status = 'active'
     where m.kind = 'customer_month' and m.period = last_month order by m.rank;
end $$;
revoke execute on function public.customer_month_ranks() from public, anon;
grant execute on function public.customer_month_ranks() to authenticated;

select public.award_medals();
notify pgrst, 'reload schema';

select '169 OK - customer monthly rank: ' || (select count(*) from public.sales_medals where kind = 'customer_month') || ' saved' as result;
