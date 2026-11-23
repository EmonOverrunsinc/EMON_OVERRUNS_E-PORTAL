-- 3.99.267: A SHOP'S SALES AND CASH OUT ARE CHANGED BY THE DIRECTOR ONLY, AND NOBODY DELETES THEM.
-- The shop's employees still add the daily sales, expenses and cash out. Every change shows CORRECTED on the report.
-- Needs 109, 110, 118 and 145 first. Safe to run again.

drop policy if exists "outlets: change" on public.outlet_sales;
create policy "outlets: change" on public.outlet_sales for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "outlets: remove" on public.outlet_sales;
drop policy if exists "outlets: remove" on public.outlet_expenses;

-- the cash out correction: the Director only
create or replace function public.outlet_cashout_edit(p_id uuid, p_amount numeric, p_payee text, p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare x public.outlet_expenses;
begin
  if not public.is_admin() then raise exception 'Only the Director changes a cash out.'; end if;
  select * into x from public.outlet_expenses where id = p_id for update;
  if not found then raise exception 'Cash out not found.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Write the amount.'; end if;
  perform set_config('eo.allow_change', 'on', true);
  update public.outlet_expenses set amount = p_amount, payee = nullif(left(btrim(coalesce(p_payee, '')), 120), ''),
    note = nullif(left(btrim(coalesce(p_note, '')), 300), ''), edit_count = edit_count + 1 where id = p_id;
  perform set_config('eo.allow_change', '', true);
  return (select edit_count from public.outlet_expenses where id = p_id);
end $$;

notify pgrst, 'reload schema';

select '146 OK - shop sales and cash out: Director edits, nobody deletes' as result;
