-- 3.99.234: WHERE AN EMPLOYEE WORKS, and THE DIRECTOR'S LOGIN LINKED TO THE DIRECTOR'S EMPLOYEE PROFILE.
-- * employee_place: the shop (with its details), the company or the EO OFFICE an employee works at, and since when.
-- * employee_place_set: the Director moves an employee to a shop, a company or the EO OFFICE (the employee is told).
-- * link_my_employee: the Director links the Director's own login to the Director's employee profile (once).
-- * A login linked to an employee profile is LOCKED: it can no longer be changed to another login.
-- Needs 109 and 114 first. Safe to run again.

create or replace function public.employee_place(p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; r jsonb;
begin
  select * into e from public.employees where id = p_employee;
  if not found then return null; end if;
  if not (public.is_active() and (public.is_admin() or public.is_staff() or e.profile_id = auth.uid())) then return null; end if;
  select jsonb_build_object('kind', 'outlet', 'id', o.id, 'code', o.code, 'name', o.name, 'address', o.address, 'branch_id', to_jsonb(o) ->> 'branch_id',
      'since', s.assigned_at, 'position', e.position, 'outlet', to_jsonb(o))
    into r from public.outlet_staff s join public.outlets o on o.id = s.outlet_id where s.employee_id = e.id order by s.assigned_at desc limit 1;
  if r is not null then return r; end if;
  if to_regclass('public.pay_company_staff') is not null then
    execute 'select jsonb_build_object(''kind'', ''company'', ''id'', c.id, ''code'', c.name, ''name'', c.name, ''since'', s.assigned_at, ''position'', $2)
      from public.pay_company_staff s join public.pay_companies c on c.id = s.company_id where s.employee_id = $1 order by s.assigned_at desc limit 1'
      into r using e.id, e.position;
    if r is not null then return r; end if;
  end if;
  return jsonb_build_object('kind', 'office', 'code', 'EO OFFICE', 'name', coalesce(nullif(e.work_location, ''), 'OPERATIONAL OFFICE'), 'since', e.date_hired, 'position', e.position);
end $$;
revoke execute on function public.employee_place(uuid) from public, anon;
grant execute on function public.employee_place(uuid) to authenticated;

create or replace function public.my_place() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.employee_place((select e.id from public.employees e where e.profile_id = auth.uid() order by e.created_at desc limit 1));
$$;
revoke execute on function public.my_place() from public, anon;
grant execute on function public.my_place() to authenticated;

-- the Director moves an employee (to: 'outlet' + shop id, 'company' + company id, or 'office')
create or replace function public.employee_place_set(p_employee uuid, p_kind text, p_to uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare who uuid; b text; by_name text;
begin
  if not public.is_admin() then raise exception 'Only the Director moves an employee.'; end if;
  if p_kind not in ('outlet', 'company', 'office') then raise exception 'Unknown place'; end if;
  if p_kind <> 'office' and p_to is null then raise exception 'Choose where the employee goes.'; end if;
  select e.profile_id into who from public.employees e where e.id = p_employee;
  if not found then raise exception 'Employee not found.'; end if;
  b := public.staff_place(p_kind, p_to);
  if b is null then raise exception 'That place was not found.'; end if;
  perform set_config('eo.staff_quiet', '1', true);
  delete from public.outlet_staff where employee_id = p_employee and not (p_kind = 'outlet' and outlet_id = p_to);
  if to_regclass('public.pay_company_staff') is not null then
    execute 'delete from public.pay_company_staff where employee_id = $1 and not ($2 = ''company'' and company_id = $3)' using p_employee, p_kind, p_to;
  end if;
  if p_kind = 'outlet' then insert into public.outlet_staff (outlet_id, employee_id) values (p_to, p_employee) on conflict do nothing;
  elsif p_kind = 'company' then execute 'insert into public.pay_company_staff (company_id, employee_id) values ($1, $2) on conflict do nothing' using p_to, p_employee; end if;
  perform set_config('eo.staff_quiet', '', true);
  perform set_config('eo.allow_change', 'on', true);
  update public.employees set work_location = left(b, 300) where id = p_employee;
  perform set_config('eo.allow_change', '', true);
  by_name := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'EMON HASAN');
  if who is not null then
    perform public.notify_user(who, 'You now work at ' || split_part(b, ' · ', 1), 'Your workplace: ' || b || '. Set by ' || by_name || '.',
      case when p_kind = 'outlet' then 'outlets' else 'dashboard' end);
  end if;
  return b;
end $$;
revoke execute on function public.employee_place_set(uuid, text, uuid) from public, anon;
grant execute on function public.employee_place_set(uuid, text, uuid) to authenticated;

-- the Director's login on the Director's own employee profile (once; then locked)
create or replace function public.link_my_employee(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees;
begin
  if not public.is_admin() then raise exception 'Only the Director can link the Director''s own login.'; end if;
  if exists (select 1 from public.employees x where x.profile_id = auth.uid()) then raise exception 'Your login is already linked to an employee profile.'; end if;
  select * into e from public.employees where id = p_employee for update;
  if not found then raise exception 'Employee not found.'; end if;
  if e.profile_id is not null then raise exception 'This employee profile already has a login.'; end if;
  perform set_config('eo.allow_change', 'on', true);
  update public.employees set profile_id = auth.uid(), status = case when status = 'waiting' then 'active' else status end where id = p_employee;
  perform set_config('eo.allow_change', '', true);
end $$;
revoke execute on function public.link_my_employee(uuid) from public, anon;
grant execute on function public.link_my_employee(uuid) to authenticated;

-- a linked login is locked to its employee profile (cleared only when that login itself is deleted)
create or replace function public.employees_login_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.profile_id is not null and new.profile_id is distinct from old.profile_id then
    if new.profile_id is null and not exists (select 1 from public.profiles p where p.id = old.profile_id) then return new; end if;
    raise exception 'The login of this employee is locked: it cannot be changed.';
  end if;
  return new;
end $$;
revoke execute on function public.employees_login_lock() from public, anon, authenticated;
drop trigger if exists employees_login_lock on public.employees;
create trigger employees_login_lock before update of profile_id on public.employees
  for each row execute function public.employees_login_lock();

notify pgrst, 'reload schema';

select '141 OK - workplace badges, moving employees, Director login linked and locked' as result;
