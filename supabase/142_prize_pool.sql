-- 3.99.235: THE PRIZE POOL on the dashboard: the medal prizes already redeemed (taken off customers' balances) and the
-- medals still to redeem (gold PHP 10,000 · silver 6,000 · bronze 3,000 each). Needs 126 and 131 first. Safe to run again.

create or replace function public.prize_pool() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_active() and (public.is_admin() or public.is_staff()) then jsonb_build_object(
    'redeemed', coalesce((select sum(l.amount) from public.order_letters l where l.subject = 'MEDAL PRIZE REDEEMED' and l.status = 'applied'), 0),
    'redeemed_n', (select count(*) from public.order_letters l where l.subject = 'MEDAL PRIZE REDEEMED' and l.status = 'applied'),
    'open', coalesce((select sum(case m.rank when 1 then 10000 when 2 then 6000 when 3 then 3000 else 0 end) from public.sales_medals m where m.kind = 'customer' and m.claimed_at is null), 0),
    'gold', (select count(*) from public.sales_medals m where m.kind = 'customer' and m.claimed_at is null and m.rank = 1),
    'silver', (select count(*) from public.sales_medals m where m.kind = 'customer' and m.claimed_at is null and m.rank = 2),
    'bronze', (select count(*) from public.sales_medals m where m.kind = 'customer' and m.claimed_at is null and m.rank = 3)) end;
$$;
revoke execute on function public.prize_pool() from public, anon;
grant execute on function public.prize_pool() to authenticated;

notify pgrst, 'reload schema';

select '142 OK - prize pool on the dashboard' as result;
