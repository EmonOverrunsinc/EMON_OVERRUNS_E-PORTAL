-- 3.99.233: DELIVERY BY ASSIGNED EMPLOYEES.
-- An order gets one or more employees (the Manila office list) who deliver it. They get a notification, and the order
-- shows on their dashboard (Delivery). Once an order has delivery employees, ONLY THEY can mark it DELIVERED (on its
-- Complete Delivery page); the Director then approves it and the order is COMPLETED. Their names and EOIDs print on
-- the order paper. Orders without delivery employees work as before. Needs 056 and 090 first. Safe to run again.

create table if not exists public.order_assignees (
  order_id uuid not null references public.customer_orders(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  profile_id uuid,
  employee_no text,
  full_name text not null,
  assigned_by_name text,
  assigned_at timestamptz not null default now(),
  primary key (order_id, employee_id)
);
create index if not exists order_assignees_profile on public.order_assignees (profile_id);
alter table public.order_assignees enable row level security;
revoke all on public.order_assignees from anon;
revoke insert, update, delete, truncate on public.order_assignees from authenticated;
grant select on public.order_assignees to authenticated;
drop policy if exists "order assignees: read" on public.order_assignees;
create policy "order assignees: read" on public.order_assignees for select to authenticated
  using ((select public.co_can_read()) or profile_id = (select auth.uid()));

-- the employees who can be picked (active), Manila office first
create or replace function public.delivery_people() returns table (id uuid, full_name text, employee_no text, "position" text, work_location text, has_login boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), e.employee_no, e.position, e.work_location, e.profile_id is not null
  from public.employees e
  where e.status = 'active' and public.is_active() and (public.qc_can_write() or public.is_admin())
  order by (coalesce(e.work_location, '') ilike '%manila%') desc, e.first_name, e.last_name;
$$;
revoke execute on function public.delivery_people() from public, anon;
grant execute on function public.delivery_people() to authenticated;

-- set the delivery employees of an order (the list replaces the one before); each new one is told
create or replace function public.order_assign(p_order uuid, p_employees uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.customer_orders; e public.employees; me text; n integer := 0;
begin
  if not (public.is_active() and (public.qc_can_write() or public.is_admin())) then raise exception 'You cannot assign the delivery of an order.'; end if;
  select * into o from public.customer_orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if o.status not in ('pending', 'approved') then raise exception 'Order % is %: its delivery cannot be assigned.', o.order_no, upper(o.status); end if;
  me := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), '');
  delete from public.order_assignees a where a.order_id = p_order and not (a.employee_id = any(coalesce(p_employees, '{}')));
  for e in select * from public.employees x where x.id = any(coalesce(p_employees, '{}')) and x.status = 'active' loop
    n := n + 1;
    if exists (select 1 from public.order_assignees a where a.order_id = p_order and a.employee_id = e.id) then continue; end if;
    insert into public.order_assignees (order_id, employee_id, profile_id, employee_no, full_name, assigned_by_name)
    values (p_order, e.id, e.profile_id, e.employee_no, left(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), 120), left(me, 120));
    if o.status = 'approved' then
      insert into public.order_tracking (order_id, step, by_id, by_name, employee_id, employee_name)
      values (p_order, 'assigned', auth.uid(), left(me, 120), e.id, left(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), 120));
    end if;
    if e.profile_id is not null then
      perform public.notify_user(e.profile_id, 'Delivery assigned to you: ' || o.order_no,
        'Order ' || o.order_no || ' · ' || coalesce(o.total_boxes, 0) || ' box(es). Open Delivery on your dashboard.', 'dashboard');
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.order_assign(uuid, uuid[]) from public, anon;
grant execute on function public.order_assign(uuid, uuid[]) to authenticated;

-- my deliveries: the open orders I am assigned to (with their Complete Delivery page)
create or replace function public.my_deliveries() returns table (order_id uuid, order_no text, delivery_code text, status text, customer text, boxes integer, submitted boolean, assigned_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.order_no, o.delivery_code, o.status,
    coalesce(nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), ''), coalesce(o.total_boxes, 0)::integer,
    o.delivery_request_at is not null, a.assigned_at
  from public.order_assignees a join public.customer_orders o on o.id = a.order_id
  left join public.customers c on c.id = o.customer_id
  where a.profile_id = auth.uid() and public.is_active() and o.status in ('pending', 'approved')
  order by a.assigned_at desc;
$$;
revoke execute on function public.my_deliveries() from public, anon;
grant execute on function public.my_deliveries() to authenticated;

-- mark DELIVERED: when the order has delivery employees, only they (or the Director) can; the Director completes it
create or replace function public.delivery_complete(p_no text, p_code text) returns text
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare o public.customer_orders; allowed boolean := auth.uid() is not null and public.qc_can_write();
  who text := coalesce((select full_name from public.profiles where id = auth.uid()), 'NOT SIGNED IN');
  mine public.order_assignees; assigned boolean;
begin
  if to_regprocedure('private.guard(text,integer)') is not null then perform private.guard('delivery_complete', 20); end if;
  o := public.co_paper_open(p_no, p_code);
  assigned := exists (select 1 from public.order_assignees a where a.order_id = o.id);
  if assigned and not public.is_admin() then
    select * into mine from public.order_assignees a where a.order_id = o.id and a.profile_id = auth.uid() limit 1;
    if not found then raise exception 'Only the employees assigned to deliver order % can mark it delivered.', o.order_no; end if;
    update public.customer_orders set delivery_request_at = now(),
      delivery_request_by = left('DELIVERED BY ' || mine.full_name || coalesce(' · ' || mine.employee_no, ''), 120), delivered_at = now(), updated_at = now()
      where id = o.id returning * into o;
    perform public.notify_admins('Customer order ' || o.order_no || ' delivery waits for approval',
      'Delivered by ' || mine.full_name || coalesce(' (' || mine.employee_no || ')', '') || ' · ' || (select count(serial_no) from public.customer_order_boxes where order_id = o.id)
      || ' of ' || o.total_boxes || ' boxes · ' || cardinality(o.delivery_photos) || ' photo(s). Approve it to complete the order and bill the invoice.', 'custorder/' || o.id);
    return 'submitted';
  end if;
  if allowed then
    perform set_config('eo.paper_order', '', true);
    o := public.complete_customer_order(o.id);
    return 'completed';
  end if;
  update public.customer_orders set delivery_request_at = now(), delivery_request_by = left('ORDER PAPER · ' || who, 120), delivered_at = now(), updated_at = now()
    where id = o.id returning * into o;
  perform public.notify_admins('Customer order ' || o.order_no || ' delivery waits for approval',
    'Submitted by the order paper (' || who || ') · ' || (select count(serial_no) from public.customer_order_boxes where order_id = o.id) || ' of ' || o.total_boxes
    || ' boxes · ' || cardinality(o.delivery_photos) || ' photo(s). Approve it to complete the order and bill the invoice.', 'custorder/' || o.id);
  return 'submitted';
end;
$$;
revoke execute on function public.delivery_complete(text, text) from public;
grant execute on function public.delivery_complete(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select '140 OK - orders can be assigned to delivery employees' as result;
