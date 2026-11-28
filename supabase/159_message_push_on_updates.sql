-- Send a device alert for each new message, including messages from a sender
-- whose unread portal notification is updated instead of inserted.
begin;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert or update of title, body, created_at on public.notifications
  for each row when (new.is_read = false)
  execute function public.notifications_push();
commit;
