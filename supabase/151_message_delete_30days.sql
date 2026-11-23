-- 3.99.325: MESSENGER: the sender deletes their own message (text or photo); every message is removed by itself after
-- 30 days (daily clean-up at 00:20 UTC = 08:20 Manila). Needs the messages table (1.1) and 149. Safe to run again.

create or replace function public.message_delete(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id = p_id;
  if not found then raise exception 'Message not found.'; end if;
  if m.sender_id is distinct from auth.uid() then raise exception 'You can delete only your own messages.'; end if;
  delete from public.messages where id = p_id;
  -- the recipient's "new message" notification goes too when nothing unread is left from this sender
  update public.notifications set is_read = true
   where user_id = m.recipient_id and link = 'chat/' || m.sender_id and not is_read
     and not exists (select 1 from public.messages x where x.sender_id = m.sender_id and x.recipient_id = m.recipient_id and x.read_at is null);
  return m.file_path; -- the photo's path (the app removes the file)
end $$;
revoke execute on function public.message_delete(uuid) from public, anon;
grant execute on function public.message_delete(uuid) to authenticated;

-- messages older than 30 days are removed every day
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'emon-messages-30-days';
  perform cron.schedule('emon-messages-30-days', '20 0 * * *', $q$delete from public.messages where created_at < now() - interval '30 days'$q$);
exception when others then
  raise notice 'pg_cron not available (%); the app hides messages older than 30 days.', sqlerrm;
end $$;
delete from public.messages where created_at < now() - interval '30 days';

notify pgrst, 'reload schema';

select '151 OK - delete own messages; messages removed after 30 days' as result;
