-- 3.99.340. Apply after 155. Keeps existing notification rows and permissions.
begin;

alter table public.notifications add column if not exists device_request_id uuid;
create index if not exists notifications_device_request_idx
  on public.notifications (device_request_id, created_at) where device_request_id is not null;

-- Record the exact device for newly issued alerts. Older alerts remain
-- readable, and the live queue still lists any pending pre-migration device.
create or replace function public.notify_device_request(p_device uuid, p_title text, p_body text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, title, body, link, device_request_id)
  select p.id, p_title, p_body, 'devices', p_device
  from public.profiles p where p.role = 'admin' and p.status = 'active';
$$;
revoke execute on function public.notify_device_request(uuid, text, text) from public, anon, authenticated;

create or replace function public.device_check(p_device text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.profiles; d public.user_devices; on_ boolean; grace timestamptz; st text; how_ text; nm text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_device is null or p_device !~ '^[A-Za-z0-9-]{16,64}$' then raise exception 'This device has no device ID. Allow the browser to keep site data and try again.'; end if;
  select * into p from public.profiles where id = uid;
  if not found then raise exception 'Your profile is not ready yet.'; end if;
  select coalesce(s.device_approval, true), s.device_grace_until into on_, grace from public.company_settings s where s.id = 1;
  on_ := coalesce(on_, true);
  nm := left(upper(trim(coalesce(p_name, ''))), 120);
  select * into d from public.user_devices where user_id = uid and device_id = p_device for update;
  if not found then
    if not exists (select 1 from public.user_devices where user_id = uid) then st := 'approved'; how_ := 'FIRST DEVICE · REGISTERED AUTOMATICALLY';
    elsif grace is not null and now() < grace then st := 'approved'; how_ := 'DEVICE IN USE · REGISTERED AUTOMATICALLY';
    elsif not on_ then st := 'approved'; how_ := 'REGISTERED AUTOMATICALLY (DEVICE APPROVAL OFF)';
    else st := 'pending'; how_ := null; end if;
    insert into public.user_devices (user_id, device_id, name, status, how, ip_address)
      values (uid, p_device, nm, st, how_, public.legal_ip())
      on conflict (user_id, device_id) do nothing returning * into d;
    if not found then
      select * into d from public.user_devices where user_id = uid and device_id = p_device;
    elsif d.status = 'pending' then
      perform public.notify_device_request(d.id, 'NEW DEVICE WAITING FOR APPROVAL',
        coalesce(nullif(p.full_name, ''), p.email, 'A login') || ' signed in on a new device: ' || coalesce(nullif(nm, ''), 'UNKNOWN DEVICE') || '. Approve or block it on Devices.');
    end if;
  else
    -- a removed device signing in again asks for approval again (approved at once while the approval is off)
    if d.status = 'removed' then
      update public.user_devices set status = case when on_ then 'pending' else 'approved' end, how = case when on_ then null else 'REGISTERED AUTOMATICALLY (DEVICE APPROVAL OFF)' end,
        decided_by = null, decided_by_name = null, decided_at = null, first_seen = now() where id = d.id;
      if on_ then
        perform public.notify_device_request(d.id, 'NEW DEVICE WAITING FOR APPROVAL',
          coalesce(nullif(p.full_name, ''), p.email, 'A login') || ' signed in again on a removed device: ' || coalesce(nullif(nm, ''), d.name, 'UNKNOWN DEVICE') || '. Approve or block it on Devices.');
      end if;
    end if;
    update public.user_devices set last_seen = now(), ip_address = coalesce(public.legal_ip(), ip_address), name = coalesce(nullif(nm, ''), name)
      where id = d.id returning * into d;
  end if;
  return jsonb_build_object('status', case when not on_ and d.status <> 'blocked' then 'approved' else d.status end, 'id', d.id, 'name', d.name,
    'how', d.how, 'admin', p.role = 'admin', 'grace_until', grace, 'approval', on_);
end;
$$;

create or replace function public.finish_device_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set is_read = true, done_at = coalesce(done_at, now())
  where device_request_id = old.id and created_at = old.first_seen and link = 'devices';
  return null;
end $$;
revoke execute on function public.finish_device_notification() from public, anon, authenticated;
drop trigger if exists finish_device_notification on public.user_devices;
create trigger finish_device_notification after update of status on public.user_devices
for each row when (old.status = 'pending' and new.status <> 'pending')
execute function public.finish_device_notification();

-- Only the unique, non-terminated employee record linked to this active login
-- can supply a transfer request. An administrator follows the same rule.
create or replace function public.notification_employee() returns uuid
language sql stable security definer set search_path = '' as $$
  select (array_agg(e.id))[1]
  from public.employees e
  where e.profile_id = auth.uid() and e.status <> 'terminated' and public.is_active()
  having count(*) = 1;
$$;
revoke execute on function public.notification_employee() from public, anon, authenticated;

-- Each live request has an exact subject and revision. The live queues supply actionable
-- rows when historical notifications lack an exact request reference.
create or replace function public.notification_requests()
returns table (kind text, request_id uuid, revision timestamptz, title text, body text, link text)
language sql stable security definer set search_path = '' as $$
  select 'device', d.id, d.first_seen, 'New device waiting for approval',
    concat_ws(' · ', coalesce(nullif(p.full_name, ''), p.email), coalesce(nullif(d.name, ''), 'Unknown device')), 'devices'
  from public.user_devices d join public.profiles p on p.id = d.user_id
  where (select public.is_admin()) and d.status = 'pending'
  union all
  select 'closure', c.id, c.created_at, o.code || ' · Non-working day request',
    concat_ws(' · ', c.day::text, c.reason, c.requested_by_name), 'outlet/' || c.outlet_id
  from public.outlet_closures c join public.outlets o on o.id = c.outlet_id
  where (select public.is_admin()) and c.status = 'pending'
  union all
  select 'customer', o.id, o.updated_at, 'Customer order ' || o.order_no || ' to review', null, 'custorder/' || o.id
  from public.customer_orders o where (select public.is_admin()) and o.status = 'pending'
  union all
  select 'purchase', p.id, coalesce(p.updated_at, p.created_at), 'Purchase order ' || p.po_no || ' to review', p.lot_name, 'po/' || p.id
  from public.purchase_orders p where (select public.is_admin()) and p.status = 'pending'
  union all
  select 'insurance', i.id, coalesce(i.proof_at, i.created_at), 'Insurance ' || i.ins_no || ' payment to review', 'Order ' || i.order_no, 'insurance/' || i.id
  from public.order_insurance i where (select public.is_admin()) and i.status = 'review'
  union all
  select 'transfer', t.id, t.moved_at, 'You now work at ' || split_part(t.to_place, ' · ', 1),
    'Your workplace: ' || t.to_place, null
  from (
    select x.* from public.employee_transfers x
    where x.employee_id = public.notification_employee()
    order by x.moved_at desc, x.id desc limit 1
  ) t
  where t.accepted_at is null and t.moved_by is not null;
$$;
revoke execute on function public.notification_requests() from public, anon, authenticated;

-- Read and action state come from the same snapshot in both surfaces. Pending
-- requests bypass the history window and list limit.
create or replace function public.notification_inbox(p_history integer default 150, p_days integer default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with own as not materialized (
    select n.* from public.notifications n where n.user_id = auth.uid()
      and (select public.is_active()) and (n.link is null or n.link not like 'chat/%')
  ), requests as materialized (
    select * from public.notification_requests()
  ), pending as materialized (
    select r.*, n.id as note_id
    from requests r
    left join lateral (
      select o.id from own o
      where (r.kind = 'device' and o.device_request_id = r.request_id
        and o.created_at = r.revision and o.link = r.link)
      or (o.title = r.title and (
        (r.kind = 'transfer' and o.created_at = r.revision)
        or (r.kind in ('customer', 'purchase') and o.link = r.link)
        or (r.kind = 'insurance' and o.link = r.link and o.created_at = r.revision)
      ))
      order by o.id desc limit 1
    ) n on true
    where p_history >= 0
  ), history as (
    select o.* from own o
    where (p_days is null or o.created_at >= now() - make_interval(days => p_days))
      and not exists (select 1 from pending p where p.note_id = o.id)
    order by o.created_at desc, o.id desc limit greatest(0, least(p_history, 300))
  ), rows as (
    select to_jsonb(h) as item, h.created_at from history h
    union all
    select case when o.id is not null then to_jsonb(o) else jsonb_build_object(
      'id', p.kind || '/' || p.request_id, 'title', p.title, 'body', p.body,
      'link', p.link, 'created_at', p.revision, 'is_read', true) end
      || jsonb_build_object('request', jsonb_build_object('kind', p.kind, 'id', p.request_id, 'revision', p.revision)),
      coalesce(o.created_at, p.revision)
    from pending p left join own o on o.id = p.note_id
  )
  select jsonb_build_object(
    'pending', (select count(*) from requests),
    'rows', coalesce((select jsonb_agg(item order by (item ? 'request') desc, created_at desc, item->>'id' desc) from rows), '[]'::jsonb)
  );
$$;
revoke execute on function public.notification_inbox(integer, integer) from public, anon;
grant execute on function public.notification_inbox(integer, integer) to authenticated;

-- A normal read stays independent of approval, including for transfers.
drop trigger if exists notifications_keep_transfer on public.notifications;

-- Lock the exact request before checking its current revision. This also
-- guards against an old tab racing a decision or a resubmission.
create or replace function public.notification_decide(
  p_kind text, p_id uuid, p_revision timestamptz, p_action text, p_note text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare emp uuid; t public.employee_transfers; r record;
begin
  if p_kind = 'transfer' then
    if p_action is distinct from 'approve' then raise exception 'Unknown action.'; end if;
    emp := public.notification_employee();
    if emp is null then raise exception 'Your active login must be linked to one employee profile.'; end if;
    perform 1 from public.employees where id = emp and profile_id = auth.uid() for update;
    if not found then return 'resolved'; end if;
    perform 1 from public.employee_transfers where id = p_id and employee_id = emp for update;
  else
    if not public.is_admin() then raise exception 'Only the Director decides this request.'; end if;
    if p_action is null or p_action not in ('approve', 'reject') then raise exception 'Unknown action.'; end if;
    case p_kind
      when 'device' then perform 1 from public.user_devices where id = p_id for update;
      when 'closure' then perform 1 from public.outlet_closures where id = p_id for update;
      when 'customer' then perform 1 from public.customer_orders where id = p_id for update;
      when 'purchase' then perform 1 from public.purchase_orders where id = p_id for update;
      when 'insurance' then perform 1 from public.order_insurance where id = p_id for update;
      else raise exception 'Unknown request.';
    end case;
  end if;
  select * into r from public.notification_requests() q
  where q.kind = p_kind and q.request_id = p_id and q.revision = p_revision;
  if not found then return 'resolved'; end if;

  case p_kind
    when 'device' then perform public.device_decide(p_id, case p_action when 'approve' then 'approve' else 'block' end);
    when 'closure' then perform public.outlet_closure_decide(p_id, p_action = 'approve');
    when 'customer' then perform public.decide_customer_order(p_id, case p_action when 'approve' then 'approve' else 'cancel' end);
    when 'purchase' then perform public.decide_purchase_order(p_id, case p_action when 'approve' then 'approve' else 'cancel' end);
    when 'insurance' then perform public.decide_insurance(p_id, p_action, p_note);
    when 'transfer' then
      update public.employee_transfers set accepted_at = now() where id = p_id returning * into t;
      perform public.notify_admins(
        (select trim(concat_ws(' ', e.first_name, e.last_name)) from public.employees e where e.id = emp) || ' accepted the transfer',
        'READ & ACCEPTED · ' || split_part(t.to_place, ' · ', 1)
          || coalesce(' · ' || (select e.employee_no from public.employees e where e.id = emp), ''), 'employee/' || emp);
  end case;

  update public.notifications n set is_read = true, done_at = coalesce(n.done_at, now())
  where (p_kind = 'device' and n.device_request_id = p_id
    and n.created_at = p_revision and n.link = r.link)
  or (n.title = r.title and (
    (p_kind = 'transfer' and n.user_id = auth.uid() and n.created_at = p_revision)
    or (p_kind in ('customer', 'purchase') and n.link = r.link)
    or (p_kind = 'insurance' and n.link = r.link and n.created_at = p_revision)
  ));
  return 'ok';
end $$;
revoke execute on function public.notification_decide(text, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.notification_decide(text, uuid, timestamptz, text, text) to authenticated;

-- Keep the earlier client entry point, with the same login and transfer checks.
create or replace function public.transfer_accept() returns text
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if public.notification_employee() is null then
    raise exception 'Your active login must be linked to one employee profile.';
  end if;
  select * into r from public.notification_requests() where kind = 'transfer';
  if not found then return 'already'; end if;
  return public.notification_decide('transfer', r.request_id, r.revision, 'approve');
end $$;

-- Keep the existing order decisions and permissions, and retain their notification history.
create or replace function public.decide_purchase_order(p_id uuid, p_action text, p_note text default null, p_items jsonb default null) returns text[]
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare po public.purchase_orders; me text := (select full_name from public.profiles where id = auth.uid()); it jsonb; gone text[];
begin
  if not public.is_admin() then raise exception 'Only the Director decides a purchase order'; end if;
  select * into po from public.purchase_orders where id = p_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if po.status not in ('pending','negotiation') then raise exception 'Purchase order % is already %', po.po_no, upper(po.status); end if;
  if p_action = 'approve' then
    gone := po.voices; -- the voice notes are deleted from the server once the order is approved
    update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_by_name = me, approved_at = now(), voices = '{}',
      director_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p_id;
    perform public.notify_user(po.created_by, 'Your ' || po.lot_name || ' lot was APPROVED (' || po.po_no || ')',
      'Approved by Director ' || coalesce(me, '') || '. Buy at the approved price.', 'po/' || po.id);
  elsif p_action = 'negotiate' then
    it := case when p_items is null then po.items else public.po_clean_items(p_items) end;
    update public.purchase_orders set status = 'negotiation', items = it,
      total_qty = (select sum((x ->> 'qty')::numeric) from jsonb_array_elements(it) x), total_amount = (select sum((x ->> 'amount')::numeric) from jsonb_array_elements(it) x),
      director_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p_id;
    perform public.notify_user(po.created_by, 'Price not agreed: ' || po.lot_name || ' (' || po.po_no || ')',
      'EMON OVERRUNS authority does not agree with that price. Please negotiate the price, then edit and submit again.' || coalesce(' Note: ' || nullif(trim(p_note), ''), ''), 'po/' || po.id);
    if po.created_by is not null and po.created_by <> auth.uid() then
      insert into public.messages (sender_id, recipient_id, body)
      values (auth.uid(), po.created_by, 'Purchase order ' || po.po_no || ' (' || po.lot_name || '): EMON OVERRUNS authority does not agree with that price. '
        || 'Please negotiate the price, then edit the details and submit again.' || coalesce(' Note: ' || nullif(trim(p_note), ''), ''));
    end if;
  elsif p_action = 'cancel' then
    gone := po.photos || po.voices;
    update public.purchase_orders set status = 'cancelled', photos = '{}', voices = '{}', cancelled_by_name = me, cancelled_at = now(),
      director_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p_id;
    perform public.notify_user(po.created_by, 'Purchase order ' || po.po_no || ' was cancelled', po.lot_name || coalesce(' - ' || nullif(trim(p_note), ''), ''), 'po/' || po.id);
  else
    raise exception 'Unknown action %', p_action;
  end if;
  update public.notifications set is_read = true, done_at = coalesce(done_at, now())
  where link = 'po/' || po.id and title = 'Purchase order ' || po.po_no || ' to review';
  return coalesce(gone, '{}');
end;
$$;

create or replace function public.decide_customer_order(p_id uuid, p_action text, p_note text default null) returns public.customer_orders
language plpgsql security definer set search_path = '' as $$
declare o public.customer_orders; me text := (select full_name from public.profiles where id = auth.uid());
begin
  select * into o from public.customer_orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_action = 'approve' then
    if not public.is_admin() then raise exception 'Only the Director can approve an order'; end if;
    if o.status <> 'pending' then raise exception 'Order % is % (not waiting for approval)', o.order_no, upper(o.status); end if;
    update public.customer_orders set status = 'approved', approved_by = auth.uid(), approved_by_name = me, approved_at = now(), updated_at = now()
    where id = p_id returning * into o;
    if o.created_by is distinct from auth.uid() then
      perform public.notify_user(o.created_by, 'Customer order ' || o.order_no || ' APPROVED', 'Ready for delivery', 'custorder/' || o.id);
    end if;
  elsif p_action = 'cancel' then
    if o.status not in ('pending','approved') then raise exception 'Order % is % and cannot be cancelled', o.order_no, upper(o.status); end if;
    if not (public.is_admin() or (o.created_by = auth.uid() and o.status = 'pending')) then raise exception 'Only the Director can cancel this order'; end if;
    update public.customer_orders set status = 'cancelled', cancelled_at = now(), cancelled_by_name = me, cancel_note = nullif(left(trim(coalesce(p_note, '')), 300), ''), updated_at = now()
    where id = p_id returning * into o;
    if o.created_by is distinct from auth.uid() then
      perform public.notify_user(o.created_by, 'Customer order ' || o.order_no || ' was cancelled', coalesce(o.cancel_note, ''), 'custorder/' || o.id);
    end if;
  else
    raise exception 'Unknown action';
  end if;
  update public.notifications set is_read = true, done_at = coalesce(done_at, now())
  where link = 'custorder/' || o.id and title = 'Customer order ' || o.order_no || ' to review';
  return o;
end;
$$;

notify pgrst, 'reload schema';
commit;
