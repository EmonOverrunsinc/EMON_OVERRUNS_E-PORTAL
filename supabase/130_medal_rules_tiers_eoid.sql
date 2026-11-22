-- 3.99.200: MEDAL RULES, TIERS, PRIZE POOL and the EOID of the person who prepared a paper.
-- CUSTOMER MEDALS need the week's net purchases: GOLD at least PHP 100,000, SILVER at least 60,000, BRONZE at least 25,000.
-- The #1 of the week gets the best medal its amount reaches (gold, silver or bronze), the #2 silver or bronze, the #3 bronze.
-- The customer medals saved before are counted again with these rules (once, now).
-- TIER (the colour of a customer's rank): total net sales of at least 100,000 GOLD, 60,000 SILVER, 25,000 BRONZE.
-- The Achieved tab counts the medals of this year for the PRIZE POOL (gold 10,000 · silver 6,000 · bronze 3,000).
-- Papers show the EOID (employee no) of the person who prepared them. Needs 125, 126 and 127 first. Safe to run again.

-- one medal per customer (or shop) per day / week (two customers can both reach silver in a week)
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'sales_medals_kind_period_rank_key') then
    alter table public.sales_medals drop constraint sales_medals_kind_period_rank_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_medals_kind_period_owner_key') then
    alter table public.sales_medals add constraint sales_medals_kind_period_owner_key unique (kind, period, owner_id);
  end if;
end $$;

create or replace function public.award_medals() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  last_day date := ((now() at time zone 'Asia/Manila') - interval '36 hours')::date;
  this_mon date := date_trunc('week', now() at time zone 'Asia/Manila')::date;
begin
  -- shops: the 3 best of each closed day (12 noon the next day)
  insert into public.sales_medals (kind, owner_id, period, rank, amount)
  select 'outlet', t.outlet_id, t.sale_date, t.k, t.v from (
    select s.outlet_id, s.sale_date, s.total as v, (row_number() over (partition by s.sale_date order by s.total desc, o.code))::int as k
    from public.outlet_sales s join public.outlets o on o.id = s.outlet_id and o.status = 'active'
    where s.sale_date <= last_day and s.total > 0
      and not exists (select 1 from public.sales_medals m where m.kind = 'outlet' and m.period = s.sale_date)) t
  where t.k <= 3
  on conflict do nothing;

  -- customers: the 3 best of each closed week, with the minimum purchases of each medal
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
end $$;
revoke execute on function public.award_medals() from public, anon, authenticated;

-- the customer medals saved before: counted again with the minimums (once)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_medals_kind_period_owner_key') then return; end if;
  if coalesce((select obj_description('public.award_medals()'::regprocedure)), '') <> 'rules 130' then
    perform set_config('eo.allow_change', 'on', true);
    delete from public.sales_medals where kind = 'customer';
    perform set_config('eo.allow_change', '', true);
    perform public.award_medals();
    comment on function public.award_medals() is 'rules 130';
  end if;
end $$;

-- the customer rank with its TIER (the colour of the rank)
drop function if exists public.customer_ranks();
create function public.customer_ranks()
returns table (customer_id uuid, rank int, net numeric, as_of date, tier text)
language plpgsql stable security definer set search_path = '' as $$
declare mon date;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('customers'))) then return; end if;
  mon := date_trunc('week', now() at time zone 'Asia/Manila')::date;
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
    select r.id, r.k, case when public.sees_money() then r.v end, mon,
      case when r.v >= 100000 then 'gold' when r.v >= 60000 then 'silver' when r.v >= 25000 then 'bronze' end
    from r order by r.k;
end $$;
revoke execute on function public.customer_ranks() from public, anon;
grant execute on function public.customer_ranks() to authenticated;

-- the achievements with the medals of this year (the prize pool)
create or replace function public.sales_achievements(p_kind text, p_owner uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r jsonb; st record; money boolean := public.sees_money(); y int := extract(year from now() at time zone 'Asia/Manila')::int;
begin
  if p_kind not in ('outlet', 'customer') then raise exception 'Kind is outlet or customer.'; end if;
  if not public.medals_allowed(p_kind) then return null; end if;
  select * into st from public.sales_stars(p_kind) s where s.owner_id = p_owner;
  select jsonb_build_object(
    'stars', coalesce(st.stars, 0), 'points', coalesce(st.points, 0), 'year', y,
    'gold', count(*) filter (where m.rank = 1), 'silver', count(*) filter (where m.rank = 2), 'bronze', count(*) filter (where m.rank = 3),
    'gold_y', count(*) filter (where m.rank = 1 and extract(year from m.period) = y),
    'silver_y', count(*) filter (where m.rank = 2 and extract(year from m.period) = y),
    'bronze_y', count(*) filter (where m.rank = 3 and extract(year from m.period) = y),
    'medals', coalesce((select jsonb_agg(jsonb_build_object('period', x.period, 'rank', x.rank, 'amount', case when money then x.amount end) order by x.period desc, x.rank)
                        from (select * from public.sales_medals z where z.kind = p_kind and z.owner_id = p_owner order by z.period desc limit 200) x), '[]'::jsonb))
  into r from public.sales_medals m where m.kind = p_kind and m.owner_id = p_owner;
  return r;
end $$;
revoke execute on function public.sales_achievements(text, uuid) from public, anon;
grant execute on function public.sales_achievements(text, uuid) to authenticated;

-- the EOID (employee no) of the people who prepared papers
create or replace function public.people_eoid(p_ids uuid[]) returns table (id uuid, full_name text, employee_no text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, (select e.employee_no from public.employees e where e.profile_id = p.id order by e.created_at desc limit 1)
  from public.profiles p
  where p.id = any(coalesce(p_ids, '{}')) and public.is_active() and (public.is_staff() or public.is_admin());
$$;
revoke execute on function public.people_eoid(uuid[]) from public, anon;
grant execute on function public.people_eoid(uuid[]) to authenticated;

notify pgrst, 'reload schema';

select '130 OK - medal rules and tiers ready · ' || (select count(*) from public.sales_medals where kind = 'customer') || ' customer medal(s) after the minimums' as result;
