-- 3.99.175: SHOP SALES NOTIFICATIONS. When a shop's employee records (or changes) the day's sales, EMON HASAN gets a
-- notification: the shop, the date, the total with the cash and GCash, and who recorded it (it opens the shop's page).
-- Needs 109 first. Safe to run again.

create or replace function public.outlet_sales_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.outlets; who text; d text;
begin
  if public.is_admin() then return null; end if; -- the Director's own entry: no message to himself
  select * into o from public.outlets where id = new.outlet_id;
  who := coalesce(new.created_by_name, (select p.full_name from public.profiles p where p.id = auth.uid()), 'An employee');
  d := upper(to_char(new.sale_date, 'FMMonth DD YYYY'));
  perform public.notify_admins(
    coalesce(o.code, 'Shop') || ' · Daily Sales ' || case when tg_op = 'INSERT' then 'recorded' else 'changed' end,
    d || ' · PHP ' || to_char(new.total, 'FM999,999,990.00') || ' (Cash ' || to_char(new.cash, 'FM999,999,990.00') || ' · GCash ' || to_char(new.gcash, 'FM999,999,990.00') || ') · by ' || who,
    'outlet/' || new.outlet_id);
  return null;
end $$;
revoke execute on function public.outlet_sales_notify() from public, anon, authenticated;

drop trigger if exists outlet_sales_notify on public.outlet_sales;
create trigger outlet_sales_notify after insert or update of cash, gcash, maya, bank, card, other on public.outlet_sales
  for each row execute function public.outlet_sales_notify();

notify pgrst, 'reload schema';

select '123 OK - the Director is notified of every shop''s daily sales' as result;
