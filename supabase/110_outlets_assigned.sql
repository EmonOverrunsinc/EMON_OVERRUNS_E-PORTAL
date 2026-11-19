-- 3.99.119: OUTLETS by assignment. EMON HASAN (the Director) sees and manages every shop. An employee sees ONLY the shops
-- he or she is assigned to (Outlet › Assigned Employees, linked by the employee's login) and records the daily sales and
-- the expenses only there. Only the Director adds or changes a shop and its assigned employees. A shop's documents
-- (the CONTRACT OF LEASE and others) are kept in its Documents area. Needs 109 first. Safe to run again.

create or replace function public.outlet_mine(p_outlet uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.outlet_staff s join public.employees e on e.id = s.employee_id
                 where s.outlet_id = p_outlet and e.profile_id = auth.uid());
$$;
revoke execute on function public.outlet_mine(uuid) from public, anon;
grant execute on function public.outlet_mine(uuid) to authenticated;

-- the shops and their assigned employees: the Director, or the shop's own employees (read only)
drop policy if exists "outlets: read" on public.outlets;
drop policy if exists "outlets: add" on public.outlets;
drop policy if exists "outlets: change" on public.outlets;
create policy "outlets: read" on public.outlets for select to authenticated
  using ((select public.is_admin()) or ((select public.has_module('outlets')) and public.outlet_mine(id)));
create policy "outlets: add" on public.outlets for insert to authenticated with check ((select public.is_admin()));
create policy "outlets: change" on public.outlets for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "outlets: read" on public.outlet_staff;
drop policy if exists "outlets: add" on public.outlet_staff;
drop policy if exists "outlets: change" on public.outlet_staff;
create policy "outlets: read" on public.outlet_staff for select to authenticated
  using ((select public.is_admin()) or ((select public.has_module('outlets')) and public.outlet_mine(outlet_id)));
create policy "outlets: add" on public.outlet_staff for insert to authenticated with check ((select public.is_admin()));
create policy "outlets: change" on public.outlet_staff for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- the daily sales and the expenses: the Director, or the shop's own employees (with the Outlets access)
do $$
declare t text;
begin
  foreach t in array array['outlet_sales', 'outlet_expenses'] loop
    execute format('drop policy if exists "outlets: read" on public.%I', t);
    execute format('drop policy if exists "outlets: add" on public.%I', t);
    execute format('drop policy if exists "outlets: change" on public.%I', t);
    execute format('create policy "outlets: read" on public.%I for select to authenticated using ((select public.is_admin()) or ((select public.has_module(''outlets'')) and public.outlet_mine(outlet_id)))', t);
    execute format('create policy "outlets: add" on public.%I for insert to authenticated with check ((select public.is_admin()) or ((select public.can_write(''outlets'')) and public.outlet_mine(outlet_id)))', t);
    execute format('create policy "outlets: change" on public.%I for update to authenticated using ((select public.is_admin()) or ((select public.can_write(''outlets'')) and public.outlet_mine(outlet_id))) with check ((select public.is_admin()) or ((select public.can_write(''outlets'')) and public.outlet_mine(outlet_id)))', t);
  end loop;
end $$;

-- a shop's documents: the Contract of Lease (its pages saved as one document) and others
alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check (kind in
  ('photo','requirement','signed_form','receipt','delivery_receipt','purchase_order','proof','application','signature','report',
   'approval','other','bill','shipping_bill','sales_report','contract'));

notify pgrst, 'reload schema';

select '110 OK - outlets by assignment: the Director sees every shop, an employee only his or her own' as result;
