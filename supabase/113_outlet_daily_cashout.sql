-- 3.99.140: OUTLETS: two more kinds for a shop's money out: DAILY EXPENSE (recorded with the day's sales) and CASH OUT
-- (cash taken out of the shop). Both are taken off the shop's balance. Needs 109 first. Safe to run again.
alter table public.outlet_expenses drop constraint if exists outlet_expenses_kind_check;
alter table public.outlet_expenses add constraint outlet_expenses_kind_check check (kind in ('rent', 'supplier', 'bills', 'salary', 'other', 'daily', 'cashout'));
notify pgrst, 'reload schema';
select '113 OK - outlets: daily expense and cash out' as result;
