-- 3.99.290: A NEW MESSAGE IN THE PORTAL MESSENGER MAKES A NOTIFICATION for the person who gets it (the mail icon with the red
-- number). One notification per sender while it is unread: more messages from the same person update it ("3 new messages").
-- Pressing it opens that chat. Needs 136 first. Safe to run again.

create or replace function public.messages_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text; nid bigint; n integer; txt text;
begin
  select coalesce(nullif(btrim(p.full_name), ''), 'Someone') into who from public.profiles p where p.id = new.sender_id;
  txt := case when coalesce(btrim(new.body), '') <> '' then left(btrim(new.body), 140) else '📎 ' || coalesce(new.file_name, 'File') end;
  select id into nid from public.notifications
   where user_id = new.recipient_id and link = 'chat/' || new.sender_id and not is_read
   order by created_at desc limit 1;
  if nid is null then
    insert into public.notifications (user_id, title, body, link, sender_id, sender_name)
    values (new.recipient_id, 'New message from ' || upper(who), txt, 'chat/' || new.sender_id, new.sender_id, who);
  else
    select count(*) into n from public.messages
     where sender_id = new.sender_id and recipient_id = new.recipient_id and read_at is null;
    update public.notifications set title = n || ' new messages from ' || upper(who), body = txt, created_at = now() where id = nid;
  end if;
  return new;
end $$;
revoke execute on function public.messages_notify() from public, anon, authenticated;
drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages for each row
  when (new.recipient_id is distinct from new.sender_id) execute function public.messages_notify();

-- reading the chat clears its notification
create or replace function public.messages_read_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set is_read = true
   where user_id = new.recipient_id and link = 'chat/' || new.sender_id and not is_read
     and not exists (select 1 from public.messages m where m.sender_id = new.sender_id and m.recipient_id = new.recipient_id and m.read_at is null);
  return null;
end $$;
revoke execute on function public.messages_read_note() from public, anon, authenticated;
drop trigger if exists messages_read_note on public.messages;
create trigger messages_read_note after update of read_at on public.messages for each row
  when (old.read_at is null and new.read_at is not null) execute function public.messages_read_note();

notify pgrst, 'reload schema';

select '149 OK - new Messenger messages make a notification' as result;
