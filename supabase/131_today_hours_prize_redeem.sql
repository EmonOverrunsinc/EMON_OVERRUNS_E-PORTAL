-- 3.99.204: TODAY'S HOURS of a shop and MEDAL PRIZE REDEMPTION.
-- TODAY'S HOURS: EMON HASAN or an employee of the shop changes today's opening / closing time (opened late, closed early,
-- closed now). Only for today; tomorrow the normal hours come back. EMON HASAN is notified when an employee changes them.
-- PRIZES: EMON HASAN redeems a customer's medal prizes (gold 10,000 · silver 6,000 · bronze 3,000 each) to the account: a
-- SETTLEMENT (reduce) takes the amount off the balance due (it shows on the statement); the medals are marked CLAIMED and
-- cannot be redeemed again (new medals can). Written in the customer's history. Needs 126 and 130 first. Safe to run again.

-- ---------- today's hours ----------
create table if not exists public.outlet_day_hours (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  day date not null,
  opens text check (opens is null or opens ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  closes text check (closes is null or closes ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  note text check (char_length(note) <= 200),
  set_by_name text,
  updated_at timestamptz not null default now(),
  primary key (outlet_id, day)
);
alter table public.outlet_day_hours enable row level security;
drop policy if exists "day hours: read" on public.outlet_day_hours;
create policy "day hours: read" on public.outlet_day_hours for select to authenticated
  using ((select public.is_admin()) or ((select public.has_module('outlets')) and public.outlet_mine(outlet_id)));
revoke insert, update, delete on public.outlet_day_hours from anon, authenticated;
grant select on public.outlet_day_hours to authenticated;

create or replace function public.outlet_set_today(p_outlet uuid, p_opens text, p_closes text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; o public.outlets; adm boolean := public.is_admin(); who text;
  t12 text;
begin
  if not (adm or (public.is_active() and public.has_module('outlets') and public.outlet_mine(p_outlet))) then
    raise exception 'Only EMON HASAN or an employee of this shop can change today''s hours.';
  end if;
  select * into o from public.outlets where id = p_outlet;
  if o.id is null then raise exception 'Shop not found.'; end if;
  if nullif(p_opens, '') is null and nullif(p_closes, '') is null then raise exception 'Give the opening or the closing time.'; end if;
  who := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'An employee');
  insert into public.outlet_day_hours (outlet_id, day, opens, closes, note, set_by_name, updated_at)
  values (p_outlet, today, nullif(p_opens, ''), nullif(p_closes, ''), nullif(trim(p_note), ''), who, now())
  on conflict (outlet_id, day) do update set opens = excluded.opens, closes = excluded.closes, note = excluded.note,
    set_by_name = excluded.set_by_name, updated_at = now();
  if not adm then
    t12 := concat_ws(' · ', case when nullif(p_opens, '') is not null then 'Opens ' || to_char(p_opens::time, 'FMHH12:MI AM') end,
                            case when nullif(p_closes, '') is not null then 'Closes ' || to_char(p_closes::time, 'FMHH12:MI AM') end);
    perform public.notify_admins(coalesce(o.code, 'Shop') || ' · Today''s hours changed', t12 || coalesce(' · ' || nullif(trim(p_note), ''), '') || ' · by ' || who, 'outlet/' || p_outlet);
  end if;
end $$;
revoke execute on function public.outlet_set_today(uuid, text, text, text) from public, anon;
grant execute on function public.outlet_set_today(uuid, text, text, text) to authenticated;

create or replace function public.outlet_clear_today(p_outlet uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or (public.is_active() and public.has_module('outlets') and public.outlet_mine(p_outlet))) then
    raise exception 'Only EMON HASAN or an employee of this shop can change today''s hours.';
  end if;
  delete from public.outlet_day_hours where outlet_id = p_outlet and day = (now() at time zone 'Asia/Manila')::date;
end $$;
revoke execute on function public.outlet_clear_today(uuid) from public, anon;
grant execute on function public.outlet_clear_today(uuid) to authenticated;

-- ---------- medal prizes ----------
alter table public.sales_medals add column if not exists claimed_at timestamptz;
alter table public.sales_medals add column if not exists claimed_ref text;

create or replace function public.redeem_medal_prizes(p_customer uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g int; s int; b int; total numeric; lid uuid; no text; d text; who text;
begin
  if not public.is_admin() then raise exception 'Only EMON HASAN redeems the medal prizes.'; end if;
  select count(*) filter (where rank = 1), count(*) filter (where rank = 2), count(*) filter (where rank = 3),
         string_agg(case rank when 1 then 'GOLD' when 2 then 'SILVER' else 'BRONZE' end || ' ' || upper(to_char(period, 'FMMon DD YYYY')), ', ' order by period)
  into g, s, b, d
  from public.sales_medals where kind = 'customer' and owner_id = p_customer and claimed_at is null;
  total := coalesce(g, 0) * 10000 + coalesce(s, 0) * 6000 + coalesce(b, 0) * 3000;
  if total <= 0 then raise exception 'There is no medal to redeem.'; end if;
  who := (select p.full_name from public.profiles p where p.id = auth.uid());
  insert into public.order_letters (customer_id, subject_type, subject, details, amount, adjust_type)
  values (p_customer, 'settlement', 'MEDAL PRIZE REDEEMED',
          'Medal prizes taken off the balance: ' || d || ' (gold PHP 10,000 · silver 6,000 · bronze 3,000 each).', total, 'reduce')
  returning id, order_no into lid, no;
  perform set_config('eo.allow_change', 'on', true);
  update public.order_letters set status = 'applied', approved_by = auth.uid(), approved_by_name = who, approved_at = now(),
    applied_by_name = who, applied_at = now(), applied_result = 'Medal prize PHP ' || to_char(total, 'FM999,999,990.00') || ' taken off the balance'
  where id = lid;
  delete from public.notifications where link = 'order/' || lid; -- no "needs approval" message: it is applied at once
  update public.sales_medals set claimed_at = now(), claimed_ref = no
  where kind = 'customer' and owner_id = p_customer and claimed_at is null;
  insert into public.customer_events (customer_id, action, note, actor, actor_name)
  values (p_customer, 'MEDAL PRIZE REDEEMED', no || ' · PHP ' || to_char(total, 'FM999,999,990.00') || ' taken off the balance due · ' || d, auth.uid(), who);
  perform set_config('eo.allow_change', '', true);
  return jsonb_build_object('order_no', no, 'amount', total, 'gold', g, 'silver', s, 'bronze', b);
end $$;
revoke execute on function public.redeem_medal_prizes(uuid) from public, anon;
grant execute on function public.redeem_medal_prizes(uuid) to authenticated;

-- the achievements: each medal says if it is CLAIMED; the medals still to redeem
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
                          'claimed', x.claimed_at is not null, 'ref', x.claimed_ref) order by x.period desc, x.rank)
                        from (select * from public.sales_medals z where z.kind = p_kind and z.owner_id = p_owner order by z.period desc limit 200) x), '[]'::jsonb))
  into r from public.sales_medals m where m.kind = p_kind and m.owner_id = p_owner;
  return r;
end $$;
revoke execute on function public.sales_achievements(text, uuid) from public, anon;
grant execute on function public.sales_achievements(text, uuid) to authenticated;

notify pgrst, 'reload schema';

select '131 OK - today''s hours and medal prize redemption ready' as result;
