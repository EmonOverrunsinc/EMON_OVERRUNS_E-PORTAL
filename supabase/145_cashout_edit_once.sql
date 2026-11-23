-- 3.99.263: CASH OUT CAN BE CORRECTED ONCE by the shop's employee (the amount, who received it and the note); after that
-- only the Director changes it. The Director still changes every expense any time. Needs 118 first. Safe to run again.

alter table public.outlet_expenses add column if not exists edit_count integer not null default 0;

create or replace function public.outlet_cashout_edit(p_id uuid, p_amount numeric, p_payee text, p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare x public.outlet_expenses;
begin
  select * into x from public.outlet_expenses where id = p_id for update;
  if not found then raise exception 'Cash out not found.'; end if;
  if x.kind <> 'cashout' then raise exception 'Only a cash out can be corrected here.'; end if;
  if not public.is_admin() then
    if not (public.is_active() and public.has_module('outlets') and public.outlet_mine(x.outlet_id)) then raise exception 'You cannot change this cash out.'; end if;
    if x.edit_count >= 1 then raise exception 'This cash out was already corrected once. Only the Director can change it now.'; end if;
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Write the amount.'; end if;
  perform set_config('eo.allow_change', 'on', true);
  update public.outlet_expenses set amount = p_amount, payee = nullif(left(btrim(coalesce(p_payee, '')), 120), ''),
    note = nullif(left(btrim(coalesce(p_note, '')), 300), ''), edit_count = edit_count + 1 where id = p_id;
  perform set_config('eo.allow_change', '', true);
  return (select edit_count from public.outlet_expenses where id = p_id);
end $$;
revoke execute on function public.outlet_cashout_edit(uuid, numeric, text, text) from public, anon;
grant execute on function public.outlet_cashout_edit(uuid, numeric, text, text) to authenticated;

notify pgrst, 'reload schema';

select '145 OK - a cash out can be corrected once by the shop' as result;
