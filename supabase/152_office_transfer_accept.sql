-- 3.99.326: TRANSFERS TO THE REGIONAL OFFICES, READ & ACCEPT, AND COMPANY AUTHORIZERS
-- * The Director transfers an employee to REGIONAL OFFICE MANILA or REGIONAL OFFICE DHAKA too (besides the EO OFFICE, a
--   shop or a company). The employee gets that place's area in the portal by itself (Manila: "11 Regional Office Manila";
--   Dhaka: Purchase Order, Billing, E-Bill; a shop: Outlets; a company: its office's billing).
-- * The employee presses READ & ACCEPT on the transfer message; the Director is told; the Transfer History shows it.
-- * A company's assigned people are an AUTHORIZER or an EMPLOYEE.
-- Needs 114, 141 and 150 first. Safe to run again.

alter table public.employee_transfers add column if not exists accepted_at timestamptz;
alter table public.employee_transfers drop constraint if exists employee_transfers_to_kind_check;
alter table public.employee_transfers add constraint employee_transfers_to_kind_check check (to_kind in ('outlet', 'company', 'office', 'manila', 'dhaka'));
alter table public.pay_company_staff add column if not exists role text not null default 'employee';
alter table public.pay_company_staff drop constraint if exists pay_company_staff_role_check;
alter table public.pay_company_staff add constraint pay_company_staff_role_check check (role in ('employee', 'authorizer'));

-- the places' names
create or replace function public.staff_place(p_kind text, p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'outlet' then (select o.code || case when upper(o.name) <> upper(o.code) then ' · ' || o.name else '' end || coalesce(' · ' || nullif(o.address, ''), '') from public.outlets o where o.id = p_id)
    when 'company' then (select c.name || coalesce(' · ' || nullif(c.address, ''), '') from public.pay_companies c where c.id = p_id)
    when 'manila' then 'REGIONAL OFFICE MANILA'
    when 'dhaka' then 'REGIONAL OFFICE DHAKA'
    else 'EO OFFICE' end;
$$;
revoke execute on function public.staff_place(text, uuid) from public, anon, authenticated;

-- the portal area an employee gets with the new place (added to what they have; a full-access login stays full)
create or replace function public.employee_place_access(p_employee uuid, p_kind text, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare add text[]; who uuid; cur text[];
begin
  add := case p_kind
    when 'manila' then array['eooffice']
    when 'dhaka' then array['purchase', 'billing', 'inventory']
    when 'outlet' then array['outlets']
    when 'company' then (select case when c.office = 'manila' then array['mbilling'] else array['billing'] end from public.pay_companies c where c.id = p_to)
    else array[]::text[] end;
  if add is null or cardinality(add) = 0 then return; end if;
  perform set_config('eo.allow_change', 'on', true);
  update public.employees e set modules = (select array(select distinct x from unnest(coalesce(e.modules, '{}') || add) x)) where e.id = p_employee;
  select e.profile_id into who from public.employees e where e.id = p_employee;
  if who is not null then
    select p.modules into cur from public.profiles p where p.id = who;
    if cur is not null then update public.profiles p set modules = (select array(select distinct x from unnest(cur || add) x)) where p.id = who; end if;
  end if;
  perform set_config('eo.allow_change', '', true);
end $$;
revoke execute on function public.employee_place_access(uuid, text, uuid) from public, anon, authenticated;

-- the Director moves an employee: 'outlet' / 'company' (with its id), 'office' (EO OFFICE), 'manila', 'dhaka'
create or replace function public.employee_place_set(p_employee uuid, p_kind text, p_to uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare who uuid; b text; by_name text;
begin
  if not public.is_admin() then raise exception 'Only the Director moves an employee.'; end if;
  if p_kind not in ('outlet', 'company', 'office', 'manila', 'dhaka') then raise exception 'Unknown place'; end if;
  if p_kind in ('outlet', 'company') and p_to is null then raise exception 'Choose where the employee goes.'; end if;
  select e.profile_id into who from public.employees e where e.id = p_employee;
  if not found then raise exception 'Employee not found.'; end if;
  b := public.staff_place(p_kind, p_to);
  if b is null then raise exception 'That place was not found.'; end if;
  perform set_config('eo.staff_quiet', '1', true);
  delete from public.outlet_staff where employee_id = p_employee and not (p_kind = 'outlet' and outlet_id = p_to);
  delete from public.pay_company_staff where employee_id = p_employee and not (p_kind = 'company' and company_id = p_to);
  if p_kind = 'outlet' then insert into public.outlet_staff (outlet_id, employee_id) values (p_to, p_employee) on conflict do nothing;
  elsif p_kind = 'company' then insert into public.pay_company_staff (company_id, employee_id) values (p_to, p_employee) on conflict do nothing; end if;
  perform set_config('eo.staff_quiet', '', true);
  perform set_config('eo.allow_change', 'on', true);
  update public.employees set work_location = left(b, 300) where id = p_employee;
  perform set_config('eo.allow_change', '', true);
  if p_kind in ('manila', 'dhaka') then perform public.employee_transfer_log(p_employee, p_kind, b); end if;
  perform public.employee_place_access(p_employee, p_kind, p_to);
  by_name := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'EMON HASAN');
  if who is not null then
    perform public.notify_user(who, 'You now work at ' || split_part(b, ' · ', 1), 'Your workplace: ' || b || '. Set by ' || by_name || '. Press READ & ACCEPT.',
      case when p_kind = 'outlet' then 'outlets' when p_kind = 'manila' then 'eooffice' when p_kind = 'dhaka' then 'regional' else 'dashboard' end);
  end if;
  return b;
end $$;
revoke execute on function public.employee_place_set(uuid, text, uuid) from public, anon;
grant execute on function public.employee_place_set(uuid, text, uuid) to authenticated;

-- where an employee works: the regional offices too
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
  select jsonb_build_object('kind', 'company', 'id', c.id, 'code', c.name, 'name', c.name, 'since', s.assigned_at, 'position', e.position, 'role', s.role)
    into r from public.pay_company_staff s join public.pay_companies c on c.id = s.company_id where s.employee_id = e.id order by s.assigned_at desc limit 1;
  if r is not null then return r; end if;
  if e.work_location in ('REGIONAL OFFICE MANILA', 'REGIONAL OFFICE DHAKA') then
    return jsonb_build_object('kind', 'office', 'code', e.work_location, 'name', e.work_location,
      'since', (select t.moved_at from public.employee_transfers t where t.employee_id = e.id order by t.moved_at desc limit 1), 'position', e.position);
  end if;
  return jsonb_build_object('kind', 'office', 'code', 'EO OFFICE', 'name', coalesce(nullif(e.work_location, ''), 'OPERATIONAL OFFICE'), 'since', e.date_hired, 'position', e.position);
end $$;
revoke execute on function public.employee_place(uuid) from public, anon;
grant execute on function public.employee_place(uuid) to authenticated;

-- the employees of a regional office (its page shows them on top)
create or replace function public.office_staff(p_office text) returns table (id uuid, employee_no text, full_name text, job_position text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_no, trim(concat_ws(' ', e.first_name, e.last_name)), e.position,
         (select t.moved_at from public.employee_transfers t where t.employee_id = e.id order by t.moved_at desc limit 1)
    from public.employees e
   where public.is_active() and (public.is_admin() or public.is_staff()) and e.status <> 'terminated'
     and e.work_location = case lower(p_office) when 'manila' then 'REGIONAL OFFICE MANILA' when 'dhaka' then 'REGIONAL OFFICE DHAKA' else '-' end
     and not exists (select 1 from public.outlet_staff s where s.employee_id = e.id)
     and not exists (select 1 from public.pay_company_staff s where s.employee_id = e.id)
   order by 3;
$$;
revoke execute on function public.office_staff(text) from public, anon;
grant execute on function public.office_staff(text) to authenticated;

-- READ & ACCEPT: the employee accepts the latest transfer; the Director is told
create or replace function public.transfer_accept() returns text
language plpgsql security definer set search_path = '' as $$
declare emp public.employees; t public.employee_transfers;
begin
  select * into emp from public.employees where profile_id = auth.uid() order by created_at desc limit 1;
  if not found then raise exception 'Your login is not linked to an employee profile.'; end if;
  select * into t from public.employee_transfers where employee_id = emp.id order by moved_at desc limit 1;
  if not found then raise exception 'No transfer to accept.'; end if;
  if t.accepted_at is not null then return 'already'; end if;
  update public.employee_transfers set accepted_at = now() where id = t.id;
  update public.notifications set is_read = true where user_id = auth.uid() and title like 'You now work at %' and not is_read;
  perform public.notify_admins(trim(concat_ws(' ', emp.first_name, emp.last_name)) || ' accepted the transfer',
    'READ & ACCEPTED · ' || split_part(t.to_place, ' · ', 1) || coalesce(' · ' || emp.employee_no, ''), 'employee/' || emp.id);
  return 'ok';
end $$;
revoke execute on function public.transfer_accept() from public, anon;
grant execute on function public.transfer_accept() to authenticated;

-- a company's person: AUTHORIZER or EMPLOYEE (the Director)
create or replace function public.company_staff_role(p_company uuid, p_employee uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the Director sets this.'; end if;
  if p_role not in ('employee', 'authorizer') then raise exception 'Choose Authorizer or Employee.'; end if;
  update public.pay_company_staff set role = p_role where company_id = p_company and employee_id = p_employee;
  if not found then raise exception 'This employee is not assigned to the company.'; end if;
end $$;
revoke execute on function public.company_staff_role(uuid, uuid, text) from public, anon;
grant execute on function public.company_staff_role(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';

select '152 OK - office transfers, read & accept, company authorizers' as result;
