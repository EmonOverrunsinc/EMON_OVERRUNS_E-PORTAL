-- 3.99.285: THE DIRECTOR CHANGES ANY SHOP EXPENSE OR CASH OUT (date, type, paid to, amount, note) in one safe step.
-- Needs 109 and 145 first. Safe to run again.

create or replace function public.outlet_expense_edit(p_id uuid, p_date date, p_kind text, p_payee text, p_amount numeric, p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare x public.outlet_expenses;
begin
  if not (public.is_active() and public.is_admin()) then raise exception 'Only the Director changes a shop expense or cash out.'; end if;
  select * into x from public.outlet_expenses where id = p_id for update;
  if not found then raise exception 'Record not found.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Write the amount.'; end if;
  if p_date is null then raise exception 'Choose the date.'; end if;
  perform set_config('eo.allow_change', 'on', true);
  update public.outlet_expenses set exp_date = p_date, kind = coalesce(nullif(p_kind, ''), kind), amount = p_amount,
    payee = nullif(left(btrim(coalesce(p_payee, '')), 120), ''), note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
    edit_count = coalesce(edit_count, 0) + 1
  where id = p_id;
  perform set_config('eo.allow_change', '', true);
  return (select edit_count from public.outlet_expenses where id = p_id);
end $$;
revoke execute on function public.outlet_expense_edit(uuid, date, text, text, numeric, text) from public, anon;
grant execute on function public.outlet_expense_edit(uuid, date, text, text, numeric, text) to authenticated;

notify pgrst, 'reload schema';

select '147 OK - the Director edits shop expenses and cash out' as result;
