-- 3.99.196: NON-WORKING DAYS of a shop. EMON HASAN or an employee assigned to the shop picks the day(s) on the calendar and
-- submits them; EMON HASAN approves (his own request is approved at once). On an approved day the shop shows CLOSED and opens
-- again the next day. EMON HASAN is notified of every request; the person who asked and the shop's employees are notified of
-- the decision. A past day cannot be asked. Needs 109 and 110 first. Safe to run again.

create table if not exists public.outlet_closures (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  day date not null,
  reason text check (char_length(reason) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid default auth.uid(),
  requested_by_name text,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (outlet_id, day)
);
create index if not exists outlet_closures_day on public.outlet_closures (day);
alter table public.outlet_closures enable row level security;
drop policy if exists "closures: read" on public.outlet_closures;
create policy "closures: read" on public.outlet_closures for select to authenticated
  using ((select public.is_admin()) or ((select public.has_module('outlets')) and public.outlet_mine(outlet_id)));
-- no direct writes: only through the functions below
revoke insert, update, delete on public.outlet_closures from anon, authenticated;
grant select on public.outlet_closures to authenticated;

-- the shop's employees get a notification
create or replace function public.outlet_staff_notify(p_outlet uuid, p_title text, p_body text) returns void
language sql security definer set search_path = '' as $$
  select public.notify_user(e.profile_id, p_title, p_body, 'outlet/' || p_outlet)
  from public.outlet_staff s join public.employees e on e.id = s.employee_id
  where s.outlet_id = p_outlet and e.profile_id is not null;
$$;
revoke execute on function public.outlet_staff_notify(uuid, text, text) from public, anon, authenticated;

-- ask for non-working day(s)
create or replace function public.outlet_closure_request(p_outlet uuid, p_days date[], p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; o public.outlets; adm boolean := public.is_admin(); n int; who text; list text;
begin
  if not (adm or (public.is_active() and public.has_module('outlets') and public.outlet_mine(p_outlet))) then
    raise exception 'Only EMON HASAN or an employee of this shop can ask for a non-working day.';
  end if;
  select * into o from public.outlets where id = p_outlet;
  if o.id is null then raise exception 'Shop not found.'; end if;
  if p_days is null or cardinality(p_days) = 0 then raise exception 'Choose at least one day.'; end if;
  if exists (select 1 from unnest(p_days) d where d < today) then raise exception 'A past day cannot be asked.'; end if;
  if cardinality(p_days) > 31 then raise exception 'At most 31 days at a time.'; end if;
  who := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'An employee');
  insert into public.outlet_closures (outlet_id, day, reason, status, requested_by, requested_by_name, decided_by_name, decided_at)
  select p_outlet, d, nullif(trim(p_reason), ''), case when adm then 'approved' else 'pending' end, auth.uid(), who,
         case when adm then who end, case when adm then now() end
  from (select distinct unnest(p_days) as d) x
  on conflict (outlet_id, day) do update set reason = excluded.reason, status = excluded.status, requested_by = excluded.requested_by,
    requested_by_name = excluded.requested_by_name, decided_by_name = excluded.decided_by_name, decided_at = excluded.decided_at, created_at = now()
    where public.outlet_closures.status = 'rejected'; -- a refused day can be asked again; the others stay as they are
  get diagnostics n = row_count;
  select string_agg(upper(to_char(d, 'FMMon DD YYYY')), ', ' order by d) into list from (select distinct unnest(p_days) as d) x;
  if n > 0 then
    if adm then
      perform public.outlet_staff_notify(p_outlet, coalesce(o.code, 'Shop') || ' · Non-working day', list || ' · the store is CLOSED on that day and opens again the next day.');
    else
      perform public.notify_admins(coalesce(o.code, 'Shop') || ' · Non-working day request', list || coalesce(' · ' || nullif(trim(p_reason), ''), '') || ' · by ' || who, 'outlet/' || p_outlet);
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.outlet_closure_request(uuid, date[], text) from public, anon;
grant execute on function public.outlet_closure_request(uuid, date[], text) to authenticated;

-- EMON HASAN approves or refuses
create or replace function public.outlet_closure_decide(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.outlet_closures; o public.outlets; msg text;
begin
  if not public.is_admin() then raise exception 'Only EMON HASAN decides a non-working day.'; end if;
  update public.outlet_closures set status = case when p_ok then 'approved' else 'rejected' end,
    decided_by_name = (select p.full_name from public.profiles p where p.id = auth.uid()), decided_at = now()
  where id = p_id returning * into r;
  if r.id is null then raise exception 'Request not found.'; end if;
  select * into o from public.outlets where id = r.outlet_id;
  msg := upper(to_char(r.day, 'FMMon DD YYYY')) || case when p_ok then ' · APPROVED · the store is CLOSED on that day and opens again the next day.' else ' · NOT APPROVED · the store stays open.' end;
  perform public.notify_user(r.requested_by, coalesce(o.code, 'Shop') || ' · Non-working day', msg, 'outlet/' || r.outlet_id);
  if p_ok then perform public.outlet_staff_notify(r.outlet_id, coalesce(o.code, 'Shop') || ' · Non-working day', msg); end if;
end $$;
revoke execute on function public.outlet_closure_decide(uuid, boolean) from public, anon;
grant execute on function public.outlet_closure_decide(uuid, boolean) to authenticated;

-- take a request back (EMON HASAN: any day not past; the employee: his or her own request while it waits)
create or replace function public.outlet_closure_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.outlet_closures;
begin
  select * into r from public.outlet_closures where id = p_id;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.day < (now() at time zone 'Asia/Manila')::date then raise exception 'A past day cannot be changed.'; end if;
  if not (public.is_admin() or (r.requested_by = auth.uid() and r.status = 'pending')) then raise exception 'Only EMON HASAN can take this day back.'; end if;
  delete from public.outlet_closures where id = p_id;
end $$;
revoke execute on function public.outlet_closure_cancel(uuid) from public, anon;
grant execute on function public.outlet_closure_cancel(uuid) to authenticated;

notify pgrst, 'reload schema';

select '128 OK - non-working days ready (' || (select count(*) from public.outlet_closures) || ' day(s) saved)' as result;
