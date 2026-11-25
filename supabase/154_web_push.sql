-- 3.99.335: WEB PUSH: a person's phone / computer gets an alert for every new notification (a request, a transfer, a
-- message …) even when the portal is closed, once that device pressed Allow. The Director's portal makes the alert keys
-- (VAPID) the first time and keeps them here (only the database reads the private part). When a notification is saved,
-- the database calls www.emonoverruns.online/api/push with the person's devices. Needs pg_net (Supabase: Database ›
-- Extensions). Safe to run again.

create extension if not exists pg_net;

create table if not exists public.push_config (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_config enable row level security; -- no policy: nobody reads it from the app

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security; -- no policy: only through the functions below

-- the public key, for the devices to subscribe
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select c.public_key from public.push_config c where c.id = 1 and public.is_active();
$$;
revoke execute on function public.push_public_key() from public, anon;
grant execute on function public.push_public_key() to authenticated;

-- the Director's portal saves the keys once (made on the Director's device)
create or replace function public.push_setup(p_public text, p_private jsonb) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the Director sets up the alerts.'; end if;
  if exists (select 1 from public.push_config) then return (select public_key from public.push_config where id = 1); end if;
  if coalesce(p_private ->> 'd', '') = '' or coalesce(p_public, '') = '' then raise exception 'The keys are missing.'; end if;
  insert into public.push_config (id, public_key, private_jwk) values (1, p_public, p_private);
  return p_public;
end $$;
revoke execute on function public.push_setup(text, jsonb) from public, anon;
grant execute on function public.push_setup(text, jsonb) to authenticated;

-- a device that allowed alerts
create or replace function public.push_subscribe(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active() then raise exception 'Not signed in.'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Not a push address.'; end if;
  insert into public.push_subscriptions (endpoint, user_id) values (p_endpoint, auth.uid())
  on conflict (endpoint) do update set user_id = auth.uid(), last_seen = now();
end $$;
revoke execute on function public.push_subscribe(text) from public, anon;
grant execute on function public.push_subscribe(text) to authenticated;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- a new notification: alert the person's devices (never stops the notification itself)
create or replace function public.notifications_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare eps jsonb; k jsonb;
begin
  begin
    select private_jwk into k from public.push_config where id = 1;
    if k is null then return null; end if;
    select jsonb_agg(endpoint) into eps from (select endpoint from public.push_subscriptions where user_id = new.user_id order by last_seen desc limit 10) s;
    if eps is null then return null; end if;
    perform net.http_post(url := 'https://www.emonoverruns.online/api/push',
      body := jsonb_build_object('jwk', k, 'endpoints', eps),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then null;
  end;
  return null;
end $$;
revoke execute on function public.notifications_push() from public, anon, authenticated;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert or update of title, body, created_at on public.notifications
  for each row when (new.is_read = false) execute function public.notifications_push();

notify pgrst, 'reload schema';

select '154 OK - web push alerts' as result;
