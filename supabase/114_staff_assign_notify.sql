-- 3.99.142: EMPLOYEE ASSIGNMENTS with notifications. An employee gets a notification when EMON HASAN assigns him or her
-- to a shop (Outlets) or to a company (Billing › company profile, e.g. MODINA FASHION), when removed from it, and when
-- TRANSFERRED (shop to shop, shop to company, or back to the EO OFFICE). A transfer also changes the employee's
-- Assigned Location. Needs 109 + 110 first. Safe to run again.

-- the employees assigned to a company (Billing)
create table if not exists public.pay_company_staff (
  company_id uuid not null references public.pay_companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (company_id, employee_id)
);
create index if not exists pay_company_staff_emp on public.pay_company_staff (employee_id);
create index if not exists outlet_staff_emp on public.outlet_staff (employee_id);
alter table public.pay_company_staff enable row level security;
drop policy if exists "pcs: read" on public.pay_company_staff;
drop policy if exists "pcs: add" on public.pay_company_staff;
drop policy if exists "pcs: remove" on public.pay_company_staff;
create policy "pcs: read" on public.pay_company_staff for select to authenticated
  using ((select public.is_admin()) or (select public.has_module('billing')));
create policy "pcs: add" on public.pay_company_staff for insert to authenticated with check ((select public.is_admin()));
create policy "pcs: remove" on public.pay_company_staff for delete to authenticated using ((select public.is_admin()));
grant select, insert, delete on public.pay_company_staff to authenticated;

-- the shop's / company's name for the messages
create or replace function public.staff_place(p_kind text, p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'outlet' then (select o.code || case when upper(o.name) <> upper(o.code) then ' · ' || o.name else '' end || coalesce(' · ' || nullif(o.address, ''), '') from public.outlets o where o.id = p_id)
    when 'company' then (select c.name || coalesce(' · ' || nullif(c.address, ''), '') from public.pay_companies c where c.id = p_id)
    else 'EO OFFICE' end;
$$;
revoke execute on function public.staff_place(text, uuid) from public, anon, authenticated;

-- assigned / removed: the employee is notified (a transfer sends one message of its own instead)
create or replace function public.staff_assign_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text := case when tg_table_name = 'outlet_staff' then 'outlet' else 'company' end;
  r record := case when tg_op = 'DELETE' then old else new end;
  place_id uuid; who uuid; place text; by_name text;
begin
  if coalesce(current_setting('eo.staff_quiet', true), '') = '1' then return null; end if;
  place_id := case when k = 'outlet' then (to_jsonb(r) ->> 'outlet_id')::uuid else (to_jsonb(r) ->> 'company_id')::uuid end;
  select e.profile_id into who from public.employees e where e.id = r.employee_id;
  if who is null then return null; end if;
  place := coalesce(public.staff_place(k, place_id), case when k = 'outlet' then 'a shop' else 'a company' end);
  by_name := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'EMON HASAN');
  if tg_op = 'INSERT' then
    perform public.notify_user(who, 'You are assigned to ' || split_part(place, ' · ', 1),
      'You now work at ' || place || '. Assigned by ' || by_name || '.', case when k = 'outlet' then 'outlets' else 'dashboard' end);
  else
    perform public.notify_user(who, 'You are removed from ' || split_part(place, ' · ', 1),
      'You no longer work at ' || place || '. Removed by ' || by_name || '.', 'dashboard');
  end if;
  return null;
end $$;
revoke execute on function public.staff_assign_notify() from public, anon, authenticated;

drop trigger if exists outlet_staff_notify on public.outlet_staff;
create trigger outlet_staff_notify after insert or delete on public.outlet_staff
  for each row execute function public.staff_assign_notify();
drop trigger if exists pay_company_staff_notify on public.pay_company_staff;
create trigger pay_company_staff_notify after insert or delete on public.pay_company_staff
  for each row execute function public.staff_assign_notify();

-- TRANSFER: from a shop / company to another shop / company, or to the EO OFFICE (p_to_kind 'office', p_to null)
create or replace function public.employee_transfer(p_employee uuid, p_from_kind text, p_from uuid, p_to_kind text, p_to uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare who uuid; a text; b text; by_name text;
begin
  if not public.is_admin() then raise exception 'Only the Director transfers an employee.'; end if;
  if p_from_kind not in ('outlet', 'company') or p_to_kind not in ('outlet', 'company', 'office') then raise exception 'Unknown place'; end if;
  if p_to_kind <> 'office' and p_to is null then raise exception 'Choose where the employee goes.'; end if;
  if p_from_kind = p_to_kind and p_from = p_to then raise exception 'Choose a different place.'; end if;
  select e.profile_id into who from public.employees e where e.id = p_employee;
  if not found then raise exception 'Employee not found.'; end if;
  a := public.staff_place(p_from_kind, p_from); b := public.staff_place(p_to_kind, p_to);
  if b is null then raise exception 'That place was not found.'; end if;
  perform set_config('eo.staff_quiet', '1', true);
  if p_from_kind = 'outlet' then delete from public.outlet_staff where outlet_id = p_from and employee_id = p_employee;
  else delete from public.pay_company_staff where company_id = p_from and employee_id = p_employee; end if;
  if p_to_kind = 'outlet' then insert into public.outlet_staff (outlet_id, employee_id) values (p_to, p_employee) on conflict do nothing;
  elsif p_to_kind = 'company' then insert into public.pay_company_staff (company_id, employee_id) values (p_to, p_employee) on conflict do nothing; end if;
  perform set_config('eo.staff_quiet', '', true);
  perform set_config('eo.allow_change', 'on', true);
  update public.employees set work_location = left(b, 300) where id = p_employee;
  perform set_config('eo.allow_change', '', true);
  by_name := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'EMON HASAN');
  perform public.notify_user(who, 'You are transferred to ' || split_part(b, ' · ', 1),
    'From ' || coalesce(split_part(a, ' · ', 1), '—') || ' to ' || b || '. Transferred by ' || by_name || '.',
    case when p_to_kind = 'outlet' then 'outlets' else 'dashboard' end);
  return b;
end $$;
revoke all on function public.employee_transfer(uuid, text, uuid, text, uuid) from public, anon;
grant execute on function public.employee_transfer(uuid, text, uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';

select '114 OK - employee assignments: notifications, company employees, transfer' as result;
