-- 3.99.155: an outlet's EXPENSES (daily expense, cash out, rental, bills, supplier, salary, other) are changed by the
-- Director (EMON HASAN) only. The shop's employees still add them (and the daily sales). Needs 110 first. Safe to run again.

drop policy if exists "outlets: change" on public.outlet_expenses;
create policy "outlets: change" on public.outlet_expenses for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

notify pgrst, 'reload schema';

select '118 OK - outlet expenses: only the Director edits' as result;
