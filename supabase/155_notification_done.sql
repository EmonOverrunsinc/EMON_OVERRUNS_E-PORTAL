-- 3.99.336: A REQUEST STAYS OPEN UNTIL IT IS DECIDED. "Read" (the bell) and "done" (approved / rejected / accepted) are
-- kept apart: marking a notification read in the bell no longer hides its Approve / Accept buttons in Messages.
-- Needs 152 and 153. Safe to run again.

alter table public.notifications add column if not exists done_at timestamptz;

create or replace function public.note_done(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set done_at = coalesce(done_at, now()), is_read = true where id = p_id and user_id = auth.uid();
end $$;
revoke execute on function public.note_done(bigint) from public, anon;
grant execute on function public.note_done(bigint) to authenticated;

-- READ & ACCEPT also marks the transfer message done
create or replace function public.transfer_accept() returns text
language plpgsql security definer set search_path = '' as $$
declare emp public.employees; t public.employee_transfers;
begin
  select * into emp from public.employees where profile_id = auth.uid() order by created_at desc limit 1;
  if not found then raise exception 'Your login is not linked to an employee profile.'; end if;
  select * into t from public.employee_transfers where employee_id = emp.id order by moved_at desc limit 1;
  if not found then raise exception 'No transfer to accept.'; end if;
  perform set_config('eo.transfer_ok', 'on', true);
  update public.notifications set is_read = true, done_at = coalesce(done_at, now()) where user_id = auth.uid() and title like 'You now work at %' and done_at is null;
  perform set_config('eo.transfer_ok', '', true);
  if t.accepted_at is not null then return 'already'; end if;
  update public.employee_transfers set accepted_at = now() where id = t.id;
  perform public.notify_admins(trim(concat_ws(' ', emp.first_name, emp.last_name)) || ' accepted the transfer',
    'READ & ACCEPTED · ' || split_part(t.to_place, ' · ', 1) || coalesce(' · ' || emp.employee_no, ''), 'employee/' || emp.id);
  return 'ok';
end $$;
revoke execute on function public.transfer_accept() from public, anon;
grant execute on function public.transfer_accept() to authenticated;

notify pgrst, 'reload schema';

select '155 OK - requests stay open until decided' as result;
