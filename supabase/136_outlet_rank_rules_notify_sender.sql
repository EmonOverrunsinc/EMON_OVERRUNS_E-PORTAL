-- 3.99.226: SHOP RANK RULES · MONTHLY SHOP MEDALS · WHO SENT A NOTIFICATION.
-- RANK: the shops are ranked by the net sales of THIS WEEK (Monday to Sunday, Manila time); a new rank every Monday.
-- DAILY MEDALS: only the shops that recorded sales that day take part (a shop closed, on holiday or with no record does not).
--   At least 2 shops must take part; the number of medals is one less than the shops taking part (2 shops: 1 medal ·
--   3 shops: 2 medals · 4 or more: 3 medals). The daily medals saved before are checked again with these rules.
-- MONTHLY MEDALS: when a month ends, the shops with sales that month are ranked by the month's total (1 day or 30 days of
--   records, simply the sum) with the same number of medals. The shop's employees and EMON HASAN get a notification.
-- HOURS: today's hours or the hours of a day ahead (tomorrow …) are for that day only; then the normal hours come back.
-- NOTIFICATIONS: every notification keeps who sent it (name and role); the E-Portal's own notifications are marked as sent by
--   EMON OVERRUNS E-PORTAL. Needs 126, 130 and 131 first. Safe to run again.

alter table public.sales_medals drop constraint if exists sales_medals_kind_check;
alter table public.sales_medals add constraint sales_medals_kind_check check (kind in ('outlet', 'outlet_month', 'customer'));

-- ---------- who sent a notification ----------
alter table public.notifications add column if not exists sender_id uuid;
alter table public.notifications add column if not exists sender_name text;
alter table public.notifications add column if not exists sender_role text;
create or replace function public.notifications_sender() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('eo.system_note', true), '') = 'on' or auth.uid() is null then
    new.sender_id := null; new.sender_name := 'EMON OVERRUNS E-PORTAL'; new.sender_role := 'system';
  elsif new.sender_id is null then
    new.sender_id := auth.uid();
    select p.full_name, p.role into new.sender_name, new.sender_role from public.profiles p where p.id = auth.uid();
  end if;
  return new;
end $$;
revoke execute on function public.notifications_sender() from public, anon, authenticated;
drop trigger if exists notifications_sender on public.notifications;
create trigger notifications_sender before insert on public.notifications for each row execute function public.notifications_sender();

-- ---------- the medals ----------
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
end $$;
revoke execute on function public.award_medals() from public, anon, authenticated;

-- the daily shop medals saved before: those that break the new rules are taken away (a day with 1 shop, or too many medals)
do $$
begin
  perform set_config('eo.allow_change', 'on', true);
  delete from public.sales_medals m
  using (select s.sale_date, count(*)::int as n from public.outlet_sales s join public.outlets o on o.id = s.outlet_id and o.status = 'active'
         where s.total > 0 group by s.sale_date) d
  where m.kind = 'outlet' and m.period = d.sale_date and (d.n < 2 or m.rank > least(3, d.n - 1));
  delete from public.sales_medals m where m.kind = 'outlet'
    and not exists (select 1 from public.outlet_sales s where s.outlet_id = m.owner_id and s.sale_date = m.period and s.total > 0);
  perform set_config('eo.allow_change', '', true);
end $$;

-- ---------- the rank of the shops: this week (Monday to Sunday) ----------
create or replace function public.outlet_week_ranks(p_day date default null)
returns table (outlet_id uuid, rank int, net numeric, shops int, week_start date)
language plpgsql stable security definer set search_path = '' as $$
declare d1 date := date_trunc('week', coalesce(p_day, (now() at time zone 'Asia/Manila')::date))::date;
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('outlets'))) then return; end if;
  return query
    with t as (
      select o.id, o.code, coalesce(sum(s.total), 0)::numeric(14,2) as v
      from public.outlets o join public.outlet_sales s on s.outlet_id = o.id and s.sale_date >= d1 and s.sale_date < d1 + 7
      where o.status = 'active' group by o.id, o.code),
    r as (select t.id, t.v, (row_number() over (order by t.v desc, t.code))::int as k, (count(*) over ())::int as n from t where t.v > 0)
    select r.id, r.k, case when public.sees_money() then r.v end, r.n, d1 from r order by r.k;
end $$;
revoke execute on function public.outlet_week_ranks(date) from public, anon;
grant execute on function public.outlet_week_ranks(date) to authenticated;

-- ---------- a shop's achievements: the daily and the monthly medals ----------
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
    'gold_u', count(*) filter (where m.rank = 1 and m.claimed_at is null),
    'silver_u', count(*) filter (where m.rank = 2 and m.claimed_at is null),
    'bronze_u', count(*) filter (where m.rank = 3 and m.claimed_at is null),
    'medals', coalesce((select jsonb_agg(jsonb_build_object('period', x.period, 'rank', x.rank, 'amount', case when money then x.amount end,
                          'claimed', x.claimed_at is not null, 'ref', x.claimed_ref, 'monthly', x.kind = 'outlet_month', 'given', x.saved_at) order by x.period desc, x.kind desc, x.rank)
                        from (select * from public.sales_medals z where (z.kind = p_kind or (p_kind = 'outlet' and z.kind = 'outlet_month')) and z.owner_id = p_owner
                              order by z.period desc limit 200) x), '[]'::jsonb))
  into r from public.sales_medals m where (m.kind = p_kind or (p_kind = 'outlet' and m.kind = 'outlet_month')) and m.owner_id = p_owner;
  return r;
end $$;
revoke execute on function public.sales_achievements(text, uuid) from public, anon;
grant execute on function public.sales_achievements(text, uuid) to authenticated;


-- ---------- hours for a chosen day: today or a day ahead (up to 30 days); that day only, the normal hours stay ----------
create or replace function public.outlet_set_day(p_outlet uuid, p_day date, p_opens text, p_closes text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; o public.outlets; adm boolean := public.is_admin(); who text; t12 text;
begin
  if not (adm or (public.is_active() and public.has_module('outlets') and public.outlet_mine(p_outlet))) then
    raise exception 'Only EMON HASAN or an employee of this shop can change the hours.';
  end if;
  if p_day is null or p_day < today or p_day > today + 30 then raise exception 'Choose today or a day in the next 30 days.'; end if;
  select * into o from public.outlets where id = p_outlet;
  if o.id is null then raise exception 'Shop not found.'; end if;
  if nullif(p_opens, '') is null and nullif(p_closes, '') is null then raise exception 'Give the opening or the closing time.'; end if;
  who := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'An employee');
  insert into public.outlet_day_hours (outlet_id, day, opens, closes, note, set_by_name, updated_at)
  values (p_outlet, p_day, nullif(p_opens, ''), nullif(p_closes, ''), nullif(trim(p_note), ''), who, now())
  on conflict (outlet_id, day) do update set opens = excluded.opens, closes = excluded.closes, note = excluded.note, set_by_name = excluded.set_by_name, updated_at = now();
  if not adm then
    t12 := concat_ws(' · ', case when nullif(p_opens, '') is not null then 'Opens ' || to_char(p_opens::time, 'FMHH12:MI AM') end,
                            case when nullif(p_closes, '') is not null then 'Closes ' || to_char(p_closes::time, 'FMHH12:MI AM') end);
    perform public.notify_admins(coalesce(o.code, 'Shop') || ' · Hours changed · ' || upper(to_char(p_day, 'FMMon DD YYYY')), t12 || coalesce(' · ' || nullif(trim(p_note), ''), ''), 'outlet/' || p_outlet);
  end if;
end $$;
revoke execute on function public.outlet_set_day(uuid, date, text, text, text) from public, anon;
grant execute on function public.outlet_set_day(uuid, date, text, text, text) to authenticated;

create or replace function public.outlet_clear_day(p_outlet uuid, p_day date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('outlets') and public.outlet_mine(p_outlet))) then
    raise exception 'Only EMON HASAN or an employee of this shop can change the hours.';
  end if;
  delete from public.outlet_day_hours where outlet_id = p_outlet and day = p_day and day >= (now() at time zone 'Asia/Manila')::date;
end $$;
revoke execute on function public.outlet_clear_day(uuid, date) from public, anon;
grant execute on function public.outlet_clear_day(uuid, date) to authenticated;

select public.award_medals();
notify pgrst, 'reload schema';

select '136 OK - shop rank by week, medals: ' || (select count(*) from public.sales_medals where kind = 'outlet') || ' daily · '
  || (select count(*) from public.sales_medals where kind = 'outlet_month') || ' monthly' as result;
