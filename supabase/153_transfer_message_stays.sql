-- 3.99.330: THE TRANSFER MESSAGE STAYS UNREAD until the employee presses READ & ACCEPT ("Mark read" / "Mark all read" do
-- not clear it). Needs 152 first. Safe to run again.

create or replace function public.notifications_keep_transfer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_read and not old.is_read and old.title like 'You now work at %'
     and coalesce(current_setting('eo.transfer_ok', true), '') <> 'on' then
    new.is_read := false;
  end if;
  return new;
end $$;
revoke execute on function public.notifications_keep_transfer() from public, anon, authenticated;
drop trigger if exists notifications_keep_transfer on public.notifications;
create trigger notifications_keep_transfer before update of is_read on public.notifications
  for each row execute function public.notifications_keep_transfer();

-- READ & ACCEPT clears it (and only the newest transfer waits; an older move does not need it any more)
create or replace function public.transfer_accept() returns text
language plpgsql security definer set search_path = '' as $$
declare emp public.employees; t public.employee_transfers;
begin
  select * into emp from public.employees where profile_id = auth.uid() order by created_at desc limit 1;
  if not found then raise exception 'Your login is not linked to an employee profile.'; end if;
  select * into t from public.employee_transfers where employee_id = emp.id order by moved_at desc limit 1;
  if not found then raise exception 'No transfer to accept.'; end if;
  perform set_config('eo.transfer_ok', 'on', true);
  update public.notifications set is_read = true where user_id = auth.uid() and title like 'You now work at %' and not is_read;
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

select '153 OK - the transfer message stays until READ & ACCEPT' as result;
