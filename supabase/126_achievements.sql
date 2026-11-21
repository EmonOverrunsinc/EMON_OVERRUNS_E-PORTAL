-- 3.99.180: ACHIEVEMENTS · MEDALS AND STARS.
-- SHOPS: every day the 3 shops with the highest sales get a medal: GOLD (1st), SILVER (2nd), BRONZE (3rd). The day's medals
-- are saved at 12 noon the next day (Manila time), so sales recorded late at night still count. Once saved they never change.
-- CUSTOMERS: every week (Monday to Sunday) the 3 customers with the highest net sales of that week get a medal; saved on Monday.
-- STARS (max 5, half stars too): from the medal points (gold 3, silver 2, bronze 1) of the last 30 days (shops) or the last
-- 12 weeks (customers). The one with the most points has 5 stars; the others in proportion (2.5 when they have half).
-- The days and weeks before this update get their medals too. Needs 109 and 125 first. Safe to run again.

create table if not exists public.sales_medals (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('outlet', 'customer')),
  owner_id uuid not null,
  period date not null, -- the day (shops) or the Monday the week starts (customers)
  rank int not null check (rank between 1 and 3),
  amount numeric(14,2) not null,
  saved_at timestamptz not null default now(),
  unique (kind, period, rank)
);
create index if not exists sales_medals_owner on public.sales_medals (kind, owner_id, period desc);
alter table public.sales_medals enable row level security; -- read only through the functions below
revoke all on public.sales_medals from anon, authenticated;

-- a saved medal is never changed or taken away
create or replace function public.sales_medals_keep() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('eo.allow_change', true), '') = 'on' then return coalesce(new, old); end if;
  raise exception 'A saved medal cannot be changed or removed.';
end $$;
drop trigger if exists sales_medals_keep on public.sales_medals;
create trigger sales_medals_keep before update or delete on public.sales_medals
  for each row execute function public.sales_medals_keep();

-- saves the medals of the days and weeks that are closed and not saved yet
create or replace function public.award_medals() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  last_day date := ((now() at time zone 'Asia/Manila') - interval '36 hours')::date; -- a day closes at 12 noon the next day
  this_mon date := date_trunc('week', now() at time zone 'Asia/Manila')::date;
begin
  insert into public.sales_medals (kind, owner_id, period, rank, amount)
  select 'outlet', t.outlet_id, t.sale_date, t.k, t.v from (
    select s.outlet_id, s.sale_date, s.total as v, (row_number() over (partition by s.sale_date order by s.total desc, o.code))::int as k
    from public.outlet_sales s join public.outlets o on o.id = s.outlet_id and o.status = 'active'
    where s.sale_date <= last_day and s.total > 0
      and not exists (select 1 from public.sales_medals m where m.kind = 'outlet' and m.period = s.sale_date)) t
  where t.k <= 3
  on conflict (kind, period, rank) do nothing;

  insert into public.sales_medals (kind, owner_id, period, rank, amount)
  select 'customer', t.cid, t.wk, t.k, t.v from (
    select x.cid, x.wk, x.v, (row_number() over (partition by x.wk order by x.v desc, c.account_no))::int as k
    from (
      select y.cid, y.wk, sum(y.v) as v from (
        select i.customer_id as cid, date_trunc('week', i.invoice_date)::date as wk, i.total_amount as v
        from public.customer_invoices i where i.invoice_date < this_mon
        union all
        select m.customer_id, date_trunc('week', m.memo_date)::date, -m.request_amount
        from public.credit_memos m where m.status in ('approved', 'paid') and m.off_balance and m.memo_date < this_mon) y
      group by y.cid, y.wk) x
    join public.customers c on c.id = x.cid and c.status = 'active'
    where x.v > 0 and not exists (select 1 from public.sales_medals m where m.kind = 'customer' and m.period = x.wk)) t
  where t.k <= 3
  on conflict (kind, period, rank) do nothing;
end $$;
revoke execute on function public.award_medals() from public, anon, authenticated;

create or replace function public.medals_allowed(p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (public.is_active() and public.has_module(case when p_kind = 'outlet' then 'outlets' else 'customers' end));
$$;
revoke execute on function public.medals_allowed(text) from public, anon, authenticated;

-- the stars of every shop (or customer) that has medal points in the window
create or replace function public.sales_stars(p_kind text)
returns table (owner_id uuid, stars numeric, points int, gold int)
language plpgsql volatile security definer set search_path = '' as $$
declare since date;
begin
  if p_kind not in ('outlet', 'customer') then raise exception 'Kind is outlet or customer.'; end if;
  if not public.medals_allowed(p_kind) then return; end if;
  perform public.award_medals();
  since := case when p_kind = 'outlet' then (now() at time zone 'Asia/Manila')::date - 30
                else date_trunc('week', now() at time zone 'Asia/Manila')::date - 84 end;
  return query
    with p as (
      select m.owner_id as oid, sum(4 - m.rank)::int as pts, (count(*) filter (where m.rank = 1))::int as g
      from public.sales_medals m where m.kind = p_kind and m.period >= since group by m.owner_id),
    t as (select max(p.pts) as top from p)
    select p.oid, greatest(0.5, round(5.0 * p.pts / nullif(t.top, 0) * 2) / 2)::numeric, p.pts, p.g
    from p, t where p.pts > 0 order by p.pts desc;
end $$;
revoke execute on function public.sales_stars(text) from public, anon;
grant execute on function public.sales_stars(text) to authenticated;

-- one shop's (or customer's) achievements: the stars, the medals counted (all time) and the latest 60 medals
create or replace function public.sales_achievements(p_kind text, p_owner uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r jsonb; st record; money boolean := public.sees_money();
begin
  if p_kind not in ('outlet', 'customer') then raise exception 'Kind is outlet or customer.'; end if;
  if not public.medals_allowed(p_kind) then return null; end if;
  select * into st from public.sales_stars(p_kind) s where s.owner_id = p_owner;
  select jsonb_build_object(
    'stars', coalesce(st.stars, 0), 'points', coalesce(st.points, 0),
    'gold', count(*) filter (where m.rank = 1), 'silver', count(*) filter (where m.rank = 2), 'bronze', count(*) filter (where m.rank = 3),
    'medals', coalesce((select jsonb_agg(jsonb_build_object('period', x.period, 'rank', x.rank, 'amount', case when money then x.amount end) order by x.period desc, x.rank)
                        from (select * from public.sales_medals z where z.kind = p_kind and z.owner_id = p_owner order by z.period desc limit 60) x), '[]'::jsonb))
  into r from public.sales_medals m where m.kind = p_kind and m.owner_id = p_owner;
  return r;
end $$;
revoke execute on function public.sales_achievements(text, uuid) from public, anon;
grant execute on function public.sales_achievements(text, uuid) to authenticated;

select public.award_medals();
notify pgrst, 'reload schema';

select '126 OK - medals saved: ' || (select count(*) from public.sales_medals where kind = 'outlet') || ' shop medal(s) · '
  || (select count(*) from public.sales_medals where kind = 'customer') || ' customer medal(s)' as result;
