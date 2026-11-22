-- 3.99.221: BANK DEPOSIT for a shop. The cash taken out of a shop (Cash Out) is the NET BALANCE until it is used:
-- a bank deposit, the rent, a stock payment, bills or anything bought for the shop is taken off it. This adds the
-- "Bank Deposit" type to the shop expenses. Needs 113 first. Safe to run again.
alter table public.outlet_expenses drop constraint if exists outlet_expenses_kind_check;
alter table public.outlet_expenses add constraint outlet_expenses_kind_check
  check (kind in ('rent', 'supplier', 'bills', 'salary', 'other', 'daily', 'cashout', 'deposit'));

notify pgrst, 'reload schema';

select '135 OK - shops can record a Bank Deposit' as result;
