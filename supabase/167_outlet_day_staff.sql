-- 3.99.385: THE STORE MANAGER OF A DAY. The Daily Sales Report shows the employee who worked at that shop on that day
-- (from the transfer history), not whoever is assigned today. The employee who recorded that day's sales comes first.
-- Needs 109 and 150. Safe to run again.

create or replace function public.outlet_day_staff(p_outlet uuid, p_day date)
returns table (id uuid, first_name text, last_name text, employee_no text, profile_id uuid, recorded boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  o_code text; place text;
  day_end timestamptz := ((p_day + 1)::timestamp at time zone 'Asia/Manila'); -- the end of that day in Manila
  rec uuid;
begin
  if not (select public.has_module('outlets')) then return; end if;
  select o.code into o_code from public.outlets o where o.id = p_outlet;
  if o_code is null then return; end if;
  place := public.staff_place('outlet', p_outlet);
  select s.created_by into rec from public.outlet_sales s where s.outlet_id = p_outlet and s.sale_date = p_day limit 1;
  return query
    with last_move as ( -- each employee's last move made before that day ended
      select distinct on (t.employee_id) t.employee_id, t.to_kind, t.to_place
        from public.employee_transfers t
       where t.moved_at < day_end
       order by t.employee_id, t.moved_at desc),
    there as (
      select m.employee_id from last_move m
       where m.to_kind = 'outlet' and (m.to_place = place or m.to_place = o_code or m.to_place like o_code || ' · %')
      union -- no history yet: assigned to this shop before that day ended
      select s.employee_id from public.outlet_staff s
       where s.outlet_id = p_outlet and s.assigned_at < day_end
         and not exists (select 1 from public.employee_transfers t where t.employee_id = s.employee_id))
    select e.id, e.first_name, e.last_name, e.employee_no, e.profile_id, (rec is not null and e.profile_id = rec)
      from there x join public.employees e on e.id = x.employee_id
     order by (rec is not null and e.profile_id = rec) desc, e.first_name, e.last_name;
end $$;
revoke execute on function public.outlet_day_staff(uuid, date) from public, anon;
grant execute on function public.outlet_day_staff(uuid, date) to authenticated;

notify pgrst, 'reload schema';

select '167 OK - store manager of the day on the Daily Sales Report' as result;
