-- 3.99.241: A STAMP TAKES ITS DETAILS FROM THE PERSON'S EMPLOYEE PROFILE: the position and the EOID. When a login is not
-- linked to an employee profile yet, the employee profile with the same email is used. Needs 138 first. Safe to run again.

create or replace function public.people_stamp(p_ids uuid[])
returns table (id uuid, full_name text, employee_no text, "position" text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, e.employee_no, e.position, p.role
  from public.profiles p
  left join lateral (select x.employee_no, x.position from public.employees x
                     where x.profile_id = p.id or (p.email is not null and lower(x.email) = lower(p.email))
                     order by (x.profile_id = p.id) desc nulls last, x.created_at desc limit 1) e on true
  where p.id = any(coalesce(p_ids, '{}')) and public.is_active() and (public.is_staff() or public.is_admin());
$$;
revoke execute on function public.people_stamp(uuid[]) from public, anon;
grant execute on function public.people_stamp(uuid[]) to authenticated;

notify pgrst, 'reload schema';

select '144 OK - stamps use the employee profile (position and EOID)' as result;
