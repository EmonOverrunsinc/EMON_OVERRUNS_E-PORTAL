-- After update 157. A current office post is the employee's sole workplace.
begin;
create unique index if not exists employee_one_office_post on private.office_director_posts(employee_id) where ends_at is null;

create or replace function public.employee_place_set(p_employee uuid, p_kind text, p_to uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare who uuid; b text; by_name text;
begin
  if not public.is_admin() then raise exception 'Only the Director moves an employee.'; end if;
  perform 1 from public.employees where id=p_employee for update;
  if exists(select 1 from private.office_director_posts where employee_id=p_employee and ends_at is null) then
    raise exception 'Replace this employee in AUTHORIZED RESPONSIVE before assigning another workplace.';
  end if;
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

create or replace function public.set_office_director_post(p_office text,p_employee uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_active() and public.is_admin(),false) then raise exception 'Only the Director can change this post.'; end if;
 if p_office not in ('manila','dhaka') or p_office is null then raise exception 'Unknown office'; end if;
 perform pg_advisory_xact_lock(hashtext('office-post:'||p_office));
 perform 1 from public.employees where id=p_employee for update;
 if not exists(select 1 from public.employees where id=p_employee and status='active') then raise exception 'Choose an active employee.'; end if;
 if exists(select 1 from private.office_director_posts where office=p_office and employee_id=p_employee and ends_at is null) then return; end if;
 perform public.employee_place_set(p_employee,p_office,null);
 update private.office_director_posts set ends_at=clock_timestamp() where office=p_office and ends_at is null;
 insert into private.office_director_posts(office,employee_id,appointed_by,starts_at) values(p_office,p_employee,auth.uid(),clock_timestamp());
end $$;

create or replace function public.office_staff(p_office text) returns table (id uuid, employee_no text, full_name text, job_position text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_no, trim(concat_ws(' ', e.first_name, e.last_name)), e.position,
         (select t.moved_at from public.employee_transfers t where t.employee_id = e.id order by t.moved_at desc limit 1)
    from public.employees e
   where public.is_active() and (public.is_admin() or public.is_staff()) and e.status <> 'terminated'
     and e.work_location = case lower(p_office) when 'manila' then 'REGIONAL OFFICE MANILA' when 'dhaka' then 'REGIONAL OFFICE DHAKA' else '-' end
     and not exists (select 1 from public.outlet_staff s where s.employee_id = e.id)
     and not exists (select 1 from public.pay_company_staff s where s.employee_id = e.id)
     and not exists (select 1 from private.office_director_posts h where h.employee_id=e.id and h.ends_at is null)
   order by 3;
$$;

-- Older clients may still insert staff links directly.
create or replace function private.guard_staff_workplace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.employees where id=new.employee_id for update;
 if exists(select 1 from private.office_director_posts where employee_id=new.employee_id and ends_at is null) then
   raise exception 'Replace the AUTHORIZED RESPONSIVE appointment first.';
 end if;
 if exists(select 1 from public.outlet_staff where employee_id=new.employee_id and
         (tg_table_name<>'outlet_staff' or outlet_id is distinct from (to_jsonb(new)->>'outlet_id')::uuid))
 or exists(select 1 from public.pay_company_staff where employee_id=new.employee_id and
         (tg_table_name<>'pay_company_staff' or company_id is distinct from (to_jsonb(new)->>'company_id')::uuid)) then
   raise exception 'Use Transfer to change the employee’s workplace.';
 end if;
 return new;
end $$;
drop trigger if exists single_workplace on public.outlet_staff;
create trigger single_workplace before insert or update of employee_id,outlet_id on public.outlet_staff
for each row execute function private.guard_staff_workplace();
drop trigger if exists single_workplace on public.pay_company_staff;
create trigger single_workplace before insert or update of employee_id,company_id on public.pay_company_staff
for each row execute function private.guard_staff_workplace();

create or replace function public.employee_transfer(p_employee uuid, p_from_kind text, p_from uuid, p_to_kind text, p_to uuid)
returns text
language plpgsql security definer set search_path = '' as $$
begin
 if not coalesce(public.is_admin(), false) then raise exception 'Only the Director transfers employees.'; end if;
 perform 1 from public.employees where id=p_employee for update;
 if not ((p_from_kind='outlet' and exists(select 1 from public.outlet_staff where outlet_id=p_from and employee_id=p_employee))
   or (p_from_kind='company' and exists(select 1 from public.pay_company_staff where company_id=p_from and employee_id=p_employee))) then
   raise exception 'This assignment has changed. Refresh the page.';
 end if;
 return public.employee_place_set(p_employee,p_to_kind,p_to);
end $$;

-- Align legacy active appointments with their office. Keep the post history intact.
select set_config('eo.staff_quiet','1',true),set_config('eo.allow_change','on',true);
delete from public.outlet_staff s using private.office_director_posts h where h.ends_at is null and h.employee_id=s.employee_id;
delete from public.pay_company_staff s using private.office_director_posts h where h.ends_at is null and h.employee_id=s.employee_id;
update public.employees e set work_location=public.staff_place(h.office,null)
from private.office_director_posts h where h.ends_at is null and h.employee_id=e.id and e.work_location is distinct from public.staff_place(h.office,null);
select public.employee_place_access(employee_id,office,null) from private.office_director_posts where ends_at is null;
notify pgrst,'reload schema';
commit;
