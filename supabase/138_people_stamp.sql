-- 3.99.229: EVERY EMPLOYEE'S STAMP.
-- Papers now carry a blue stamp of who prepared or approved them (name · position · EOID) in place of a signature picture.
-- A signature picture is only used on the ID card and on the Director's Verification Copy (Verify page).
-- This gives a print the name, position and EOID of the people on it (staff and the Director only). Safe to run again.

create or replace function public.people_stamp(p_ids uuid[])
returns table (id uuid, full_name text, employee_no text, "position" text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, e.employee_no, e.position, p.role
  from public.profiles p
  left join lateral (select x.employee_no, x.position from public.employees x where x.profile_id = p.id order by x.created_at desc limit 1) e on true
  where p.id = any(coalesce(p_ids, '{}')) and public.is_active() and (public.is_staff() or public.is_admin());
$$;
revoke execute on function public.people_stamp(uuid[]) from public, anon;
grant execute on function public.people_stamp(uuid[]) to authenticated;

notify pgrst, 'reload schema';

select '138 OK - employee stamps ready' as result;
