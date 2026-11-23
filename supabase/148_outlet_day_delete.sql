-- 3.99.289: DELETE A SHOP DAY (the Director only). One step deletes that day's sales, its daily operation cost and its
-- cash out, with their photos, so no half day is left in the list. Then a one-time clean-up of SHOP-2 Nov 20-22 2026
-- (those days lost their sales before; only the expenses and cash out were left). Needs 109, 113 and 146 first.
-- Safe to run again.

create or replace function public.outlet_day_delete(p_outlet uuid, p_date date) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; k integer; ids uuid[];
begin
  if not (public.is_active() and public.is_admin()) then raise exception 'Only the Director deletes a shop day.'; end if;
  if p_outlet is null or p_date is null then raise exception 'Choose the shop and the day.'; end if;
  perform set_config('eo.allow_change', 'on', true);
  select array_agg(id) into ids from public.outlet_sales where outlet_id = p_outlet and sale_date = p_date;
  delete from public.attachments where owner_type = 'outlet_sales' and owner_id = any (coalesce(ids, '{}'));
  delete from public.outlet_sales where outlet_id = p_outlet and sale_date = p_date;
  get diagnostics k = row_count; n := n + k;
  select array_agg(id) into ids from public.outlet_expenses where outlet_id = p_outlet and exp_date = p_date and kind in ('daily', 'cashout');
  delete from public.attachments where owner_type = 'outlet_expense' and owner_id = any (coalesce(ids, '{}'));
  delete from public.outlet_expenses where outlet_id = p_outlet and exp_date = p_date and kind in ('daily', 'cashout');
  get diagnostics k = row_count; n := n + k;
  perform set_config('eo.allow_change', '', true);
  return n;
end $$;
revoke execute on function public.outlet_day_delete(uuid, date) from public, anon;
grant execute on function public.outlet_day_delete(uuid, date) to authenticated;

-- one-time: SHOP-2, Nov 20, 21 and 22 2026, only where the day has no sales record
do $$
declare ids uuid[];
begin
  perform set_config('eo.allow_change', 'on', true);
  select array_agg(e.id) into ids from public.outlet_expenses e join public.outlets o on o.id = e.outlet_id
   where o.code = 'SHOP-2' and e.exp_date between date '2026-11-20' and date '2026-11-22' and e.kind in ('daily', 'cashout')
     and not exists (select 1 from public.outlet_sales s where s.outlet_id = e.outlet_id and s.sale_date = e.exp_date);
  delete from public.attachments where owner_type = 'outlet_expense' and owner_id = any (coalesce(ids, '{}'));
  delete from public.outlet_expenses where id = any (coalesce(ids, '{}'));
  perform set_config('eo.allow_change', '', true);
end $$;

notify pgrst, 'reload schema';

select '148 OK - the Director deletes a shop day; SHOP-2 Nov 20-22 cleaned' as result;
