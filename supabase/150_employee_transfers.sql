-- 3.99.294: TRANSFER HISTORY of an employee: every move to a shop, a company or the EO OFFICE is kept (from, to, when,
-- by whom) and shown on the employee's profile under "Currently Working At". Needs 114 and 141 first. Safe to run again.

create table if not exists public.employee_transfers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  to_kind text not null check (to_kind in ('outlet', 'company', 'office')),
  from_place text,
  to_place text not null,
  moved_at timestamptz not null default now(),
  moved_by uuid default auth.uid(),
  moved_by_name text
);
create index if not exists employee_transfers_emp on public.employee_transfers (employee_id, moved_at desc);
alter table public.employee_transfers enable row level security;
drop policy if exists "transfers: read" on public.employee_transfers;
create policy "transfers: read" on public.employee_transfers for select to authenticated
  using ((select public.is_active()) and ((select public.is_staff())
    or exists (select 1 from public.employees e where e.id = employee_id and e.profile_id = (select auth.uid()))));

create or replace function public.employee_transfer_log(p_employee uuid, p_kind text, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare last text;
begin
  select to_place into last from public.employee_transfers where employee_id = p_employee order by moved_at desc limit 1;
  if last is not distinct from p_to then return; end if; -- the same place again: nothing moved
  insert into public.employee_transfers (employee_id, to_kind, from_place, to_place, moved_by_name)
  values (p_employee, p_kind, coalesce(last, (select nullif(e.work_location, '') from public.employees e where e.id = p_employee)), p_to,
          coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), 'EMON OVERRUNS E-PORTAL'));
end $$;
revoke execute on function public.employee_transfer_log(uuid, text, text) from public, anon, authenticated;

-- an assignment to a shop or a company (from the employee page or the shop / company page) is a transfer
create or replace function public.staff_transfer_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text := case when tg_table_name = 'outlet_staff' then 'outlet' else 'company' end;
begin
  perform public.employee_transfer_log(new.employee_id, k, public.staff_place(k, ((to_jsonb(new)) ->> (case when k = 'outlet' then 'outlet_id' else 'company_id' end))::uuid));
  return null;
end $$;
revoke execute on function public.staff_transfer_log() from public, anon, authenticated;
drop trigger if exists staff_transfer_log on public.outlet_staff;
create trigger staff_transfer_log after insert on public.outlet_staff for each row execute function public.staff_transfer_log();
drop trigger if exists staff_transfer_log on public.pay_company_staff;
create trigger staff_transfer_log after insert on public.pay_company_staff for each row execute function public.staff_transfer_log();

-- back to the EO OFFICE is a transfer too (no shop or company row is added for it)
create or replace function public.employee_office_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.work_location = 'EO OFFICE' and old.work_location is distinct from new.work_location then
    perform public.employee_transfer_log(new.id, 'office', 'EO OFFICE');
  end if;
  return null;
end $$;
revoke execute on function public.employee_office_log() from public, anon, authenticated;
drop trigger if exists employee_office_log on public.employees;
create trigger employee_office_log after update of work_location on public.employees for each row execute function public.employee_office_log();

-- where each employee works now is the first line of the history
insert into public.employee_transfers (employee_id, to_kind, to_place, moved_at, moved_by_name)
select e.id, coalesce(x.k, 'office'), coalesce(x.place, 'EO OFFICE'), coalesce(x.since, e.created_at), 'EMON OVERRUNS E-PORTAL'
  from public.employees e
  left join lateral (
    select * from (
      select 'outlet' as k, public.staff_place('outlet', s.outlet_id) as place, s.assigned_at as since from public.outlet_staff s where s.employee_id = e.id
      union all
      select 'company', public.staff_place('company', s.company_id), s.assigned_at from public.pay_company_staff s where s.employee_id = e.id) a
    order by since desc limit 1) x on true
 where e.status <> 'terminated' and not exists (select 1 from public.employee_transfers t where t.employee_id = e.id);

notify pgrst, 'reload schema';

select '150 OK - employee transfer history' as result;
