-- 3.99.390: EMPLOYEE ID CARD FLOW. A card goes through these steps (each with its date and who did it):
--   1 GENERATED             the Director presses Generate New ID (the employee is approved and has a photo, a signature and details)
--   2 WAITING FOR PRINTING  the print file is downloaded and the card is sent to printing: a Collection Voucher of PHP 150
--                           (ID CARD FEE) is made at once, PAID, its date locked
--   3 ARRIVED OFFICE        the printed card arrived
--   4 RECEIVED OFFICE       the office received it: the employee is told "Please collect your Employee ID at the EMON OVERRUNS Office"
--   5 COLLECTED             the employee signed the Collection Employee Identification Card record and it was uploaded / scanned
--   6 ACTIVE                the Director activated the card
-- A card works (sign in, VALID when scanned) only once it is ACTIVE. The cards issued before this update stay as printed
-- (nothing on them changes) but are NOT ACTIVATED until the Director activates each one.
-- No card is made by itself any more (adding or approving an employee): the Director generates it. Safe to run again.

alter table public.employee_cards add column if not exists stage text;
alter table public.employee_cards drop constraint if exists employee_cards_stage_check;
alter table public.employee_cards add constraint employee_cards_stage_check
  check (stage is null or stage in ('generated', 'waiting_print', 'arrived', 'received', 'collected', 'active'));
alter table public.employee_cards add column if not exists fee_cv_id uuid references public.collection_vouchers(id) on delete set null;
alter table public.employee_cards add column if not exists printing_at timestamptz;
alter table public.employee_cards add column if not exists arrived_at timestamptz;
alter table public.employee_cards add column if not exists received_at timestamptz;
alter table public.employee_cards add column if not exists collected_at timestamptz;
alter table public.employee_cards add column if not exists collection_att_id uuid;
alter table public.employee_cards add column if not exists activated_at timestamptz;
alter table public.employee_cards add column if not exists activated_by uuid;
alter table public.employee_cards add column if not exists activated_by_name text;
alter table public.employee_cards add column if not exists steps jsonb not null default '[]'::jsonb; -- who did each step and when

-- the ID card fee voucher names the employee who paid (as in update 093)
alter table public.collection_vouchers add column if not exists employee_id uuid references public.employees(id) on delete set null;

-- the signed collection record is kept with the employee's files
alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check (kind in
  ('photo','requirement','signed_form','receipt','delivery_receipt','purchase_order','proof','application','signature','report',
   'approval','other','bill','shipping_bill','sales_report','contract','id_collection'));

-- no card is made by itself any more: only termination ends the card
create or replace function public.employees_card_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'terminated' then
    update public.employee_cards set status = 'revoked', ended_at = now() where employee_id = new.id and status = 'active';
  end if;
  return new;
end;
$$;
revoke execute on function public.employees_card_sync() from public, anon, authenticated;

-- one step of a card: checks the Director and the step it is at, writes who and when
create or replace function private.card_step(p_card uuid, p_from text[], p_to text) returns public.employee_cards
language plpgsql security definer set search_path = '' as $$
declare c public.employee_cards; me text;
begin
  if not public.is_admin() then raise exception 'Only the Director can do this step of the ID card.'; end if;
  select * into c from public.employee_cards where id = p_card for update;
  if c.id is null then raise exception 'ID card not found.'; end if;
  if c.status <> 'active' then raise exception 'ID card % is no longer in use.', c.card_no; end if;
  if not (coalesce(c.stage, 'old') = any (p_from)) then
    raise exception 'ID card % is at the step % now.', c.card_no, upper(replace(coalesce(c.stage, 'issued before'), '_', ' '));
  end if;
  select full_name into me from public.profiles where id = auth.uid();
  update public.employee_cards set stage = p_to,
    steps = steps || jsonb_build_array(jsonb_build_object('step', p_to, 'at', now(), 'by', me))
  where id = p_card returning * into c;
  return c;
end $$;
revoke execute on function private.card_step(uuid, text[], text) from public;

-- 1. GENERATE NEW ID: the employee is approved and has a photo, a signature and the details
create or replace function public.issue_employee_card(p_employee uuid) returns public.employee_cards
language plpgsql security definer set search_path = '' as $$
declare e public.employees; sig text; c public.employee_cards; me text;
begin
  if not public.is_admin() then raise exception 'Only the Director can generate an ID card.'; end if;
  select * into e from public.employees where id = p_employee;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if e.status = 'terminated' then raise exception 'A terminated employee cannot get an ID card.'; end if;
  if coalesce(e.approval_status, 'approved') <> 'approved' then raise exception 'Approve the employee first.'; end if;
  if nullif(trim(coalesce(e.photo_path, '')), '') is null then raise exception 'Add the employee''s photo first.'; end if;
  select p.signature_status into sig from public.profiles p where p.id = e.profile_id;
  if sig is distinct from 'approved' then raise exception 'The employee needs an approved signature first.'; end if;
  if nullif(trim(coalesce(e.first_name, '')), '') is null or nullif(trim(coalesce(e.last_name, '')), '') is null
     or nullif(trim(coalesce(e.position, '')), '') is null then raise exception 'Complete the employee''s name and position first.'; end if;
  c := private.issue_card(p_employee, auth.uid());
  select full_name into me from public.profiles where id = auth.uid();
  update public.employee_cards set stage = 'generated', steps = jsonb_build_array(jsonb_build_object('step', 'generated', 'at', now(), 'by', me))
   where id = c.id returning * into c;
  return c;
end;
$$;
revoke execute on function public.issue_employee_card(uuid) from public, anon;
grant execute on function public.issue_employee_card(uuid) to authenticated;

-- 2. SENT TO PRINTING: the PHP 150 ID card fee is collected at once (a paid Collection Voucher, its date locked)
create or replace function public.card_send_printing(p_card uuid) returns public.employee_cards
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare c public.employee_cards; e public.employees; me text; cv uuid; ym text := to_char(current_date, 'YYYYMM');
begin
  c := private.card_step(p_card, array['generated'], 'waiting_print');
  select * into e from public.employees where id = c.employee_id;
  select full_name into me from public.profiles where id = auth.uid();
  insert into public.collection_vouchers (cv_no, cv_date, issued_on, received_from, amount, method, note, status, paid_at, paid_by_name, received_by,
                                          employee_id, created_by, created_by_name)
  values ('CV-' || ym || '-' || lpad(public.next_counter('CV' || ym)::text, 3, '0'), current_date, current_date,
          left(upper(trim(e.first_name || ' ' || e.last_name)), 120), 150, 'cash',
          left('EMPLOYEE ID CARD FEE · ' || c.card_no || ' · ' || coalesce(e.employee_no, ''), 300), 'paid', now(),
          left(upper(trim(e.first_name || ' ' || e.last_name)), 120), left(coalesce(me, ''), 120), e.id, auth.uid(), left(coalesce(me, ''), 120))
  returning id into cv;
  update public.employee_cards set fee_cv_id = cv, printing_at = now() where id = c.id returning * into c;
  return c;
end $$;
revoke execute on function public.card_send_printing(uuid) from public, anon;
grant execute on function public.card_send_printing(uuid) to authenticated;

-- the ID card fee voucher is locked: no change of its date, amount, payer or status, and it cannot be deleted
create or replace function public.card_fee_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.employee_cards c where c.fee_cv_id = old.id) then
    if tg_op = 'DELETE' then raise exception 'The ID card fee voucher % cannot be deleted.', old.cv_no; end if;
    if new.cv_date is distinct from old.cv_date or new.amount is distinct from old.amount or new.status is distinct from old.status
       or new.received_from is distinct from old.received_from or new.method is distinct from old.method then
      raise exception 'The ID card fee voucher % is locked.', old.cv_no;
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.card_fee_lock() from public, anon, authenticated;
drop trigger if exists card_fee_lock on public.collection_vouchers;
create trigger card_fee_lock before update or delete on public.collection_vouchers for each row execute function public.card_fee_lock();

-- 3. ARRIVED OFFICE
create or replace function public.card_arrived(p_card uuid) returns public.employee_cards
language plpgsql security definer set search_path = '' as $$
declare c public.employee_cards;
begin
  c := private.card_step(p_card, array['waiting_print'], 'arrived');
  update public.employee_cards set arrived_at = now() where id = c.id returning * into c;
  return c;
end $$;
revoke execute on function public.card_arrived(uuid) from public, anon;
grant execute on function public.card_arrived(uuid) to authenticated;

-- 4. RECEIVED OFFICE: the employee is told to collect the card
create or replace function public.card_received_office(p_card uuid) returns public.employee_cards
language plpgsql security definer set search_path = '' as $$
declare c public.employee_cards; who uuid;
begin
  c := private.card_step(p_card, array['arrived'], 'received');
  update public.employee_cards set received_at = now() where id = c.id returning * into c;
  select e.profile_id into who from public.employees e where e.id = c.employee_id;
  if who is not null then
    insert into public.notifications (user_id, title, body, link)
    values (who, 'Your Employee ID is ready', 'Please collect your Employee ID (' || c.card_no || ') at the EMON OVERRUNS Office.', 'profile');
  end if;
  return c;
end $$;
revoke execute on function public.card_received_office(uuid) from public, anon;
grant execute on function public.card_received_office(uuid) to authenticated;

-- 5. COLLECTED: the signed Collection Employee Identification Card record is uploaded (kept with the employee's files)
create or replace function public.card_collected(p_card uuid, p_attachment uuid) returns public.employee_cards
language plpgsql security definer set search_path = '' as $$
declare c public.employee_cards;
begin
  select * into c from public.employee_cards where id = p_card;
  if not exists (select 1 from public.attachments a where a.id = p_attachment and a.owner_type = 'employee' and a.owner_id = c.employee_id and a.kind = 'id_collection') then
    raise exception 'Upload or scan the signed collection record first.';
  end if;
  c := private.card_step(p_card, array['received'], 'collected');
  update public.employee_cards set collected_at = now(), collection_att_id = p_attachment where id = c.id returning * into c;
  return c;
end $$;
revoke execute on function public.card_collected(uuid, uuid) from public, anon;
grant execute on function public.card_collected(uuid, uuid) to authenticated;

-- 6. ACTIVATE: the Director; a new card after its record is collected, a card issued before this update at once
create or replace function public.activate_employee_card(p_card uuid) returns public.employee_cards
language plpgsql security definer set search_path = '' as $$
declare c public.employee_cards; me text; who uuid;
begin
  c := private.card_step(p_card, array['collected', 'old'], 'active');
  select full_name into me from public.profiles where id = auth.uid();
  update public.employee_cards set activated_at = now(), activated_by = auth.uid(), activated_by_name = me where id = c.id returning * into c;
  select e.profile_id into who from public.employees e where e.id = c.employee_id;
  if who is not null then
    insert into public.notifications (user_id, title, body, link)
    values (who, 'Your Employee ID is active', 'Your Employee ID ' || c.card_no || ' is now active. You can use it to sign in.', 'profile');
  end if;
  return c;
end $$;
revoke execute on function public.activate_employee_card(uuid) from public, anon;
grant execute on function public.activate_employee_card(uuid) to authenticated;

-- the card works only once it is active
create or replace function public.card_state(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare m text[]; c public.employee_cards; sec text; e public.employees; pr public.profiles; nm text; uid uuid; ok timestamptz;
begin
  m := regexp_match(upper(trim(coalesce(p_code, ''))), '^EMONID\|(EOID-[0-9]{4}-[0-9]{4,})\|([0-9A-F]{40})$');
  if m is null then return jsonb_build_object('state', 'invalid'); end if;
  select * into c from public.employee_cards where card_no = m[1];
  select k.secret into sec from private.employee_card_keys k where k.card_id = c.id;
  if c.id is null or sec is distinct from m[2] then return jsonb_build_object('state', 'invalid'); end if;
  select * into e from public.employees where id = c.employee_id;
  nm := upper(trim(e.first_name || ' ' || e.last_name));
  if c.status = 'replaced' then return jsonb_build_object('state', 'replaced', 'name', nm); end if;
  if c.status <> 'active' then return jsonb_build_object('state', 'ended', 'name', nm); end if;
  if c.activated_at is null then return jsonb_build_object('state', 'inactive', 'name', nm); end if; -- 3.99.390: not activated yet
  if c.valid_until < current_date then return jsonb_build_object('state', 'expired', 'name', nm, 'valid_until', c.valid_until); end if;
  if e.status not in ('active', 'waiting') then return jsonb_build_object('state', 'blocked', 'name', nm); end if;
  if e.profile_id is null then
    select u.email_confirmed_at into ok from auth.users u where lower(u.email) = lower(trim(e.email)) order by u.email_confirmed_at nulls last limit 1;
    if ok is not null then
      return jsonb_build_object('state', 'account_exists', 'name', nm, 'email_hint', regexp_replace(lower(e.email), '^(.)[^@]*', '\1•••'));
    end if;
    return jsonb_build_object('state', 'set_password', 'name', nm);
  end if;
  select * into pr from public.profiles where id = e.profile_id;
  select u.id, u.email_confirmed_at into uid, ok from auth.users u where u.id = e.profile_id;
  if e.status <> 'active' or pr.id is null or pr.status <> 'active' or uid is null then return jsonb_build_object('state', 'blocked', 'name', nm); end if;
  if ok is null then return jsonb_build_object('state', 'set_password', 'name', nm); end if; -- started with Create Account, never confirmed
  return jsonb_build_object('state', 'password', 'name', nm, 'email', lower(pr.email));
end;
$$;
revoke execute on function public.card_state(text) from public;
grant execute on function public.card_state(text) to anon, authenticated;

create or replace function public.check_employee_card(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare m text[]; c public.employee_cards; sec text; e public.employees;
begin
  m := regexp_match(upper(trim(coalesce(p_code, ''))), '^EMONID\|(EOID-[0-9]{4}-[0-9]{4,})\|([0-9A-F]{40})$');
  if m is null then return jsonb_build_object('found', false); end if;
  select * into c from public.employee_cards where card_no = m[1];
  select k.secret into sec from private.employee_card_keys k where k.card_id = c.id;
  if c.id is null or sec is distinct from m[2] then return jsonb_build_object('found', false); end if;
  select * into e from public.employees where id = c.employee_id;
  return jsonb_build_object('found', true, 'card_no', c.card_no, 'employee_id', case when public.is_staff() then e.id end,
    'name', upper(trim(e.first_name || ' ' || e.last_name)), 'position', e.position, 'employee_no', e.employee_no,
    'issued_at', c.issued_at, 'valid_until', c.valid_until, 'activated_at', c.activated_at,
    'state', case when c.status = 'replaced' then 'REPLACED' when c.status <> 'active' or e.status = 'terminated' then 'NOT VALID'
                  when c.activated_at is null then 'NOT ACTIVATED' when c.valid_until < current_date then 'EXPIRED' else 'VALID' end);
end;
$$;
revoke execute on function public.check_employee_card(text) from public;
grant execute on function public.check_employee_card(text) to anon, authenticated;

-- the first-password step says why a card that is not active cannot be used
do $$
declare def text;
begin
  def := pg_get_functiondef('public.card_set_password(text,text)'::regprocedure);
  if position('not activated yet' in def) = 0 then
    execute replace(def, $x$when 'ended' then 'This ID card is no longer valid.'$x$,
      $x$when 'ended' then 'This ID card is no longer valid.' when 'inactive' then 'This ID card is not activated yet. Ask the Director.'$x$);
  end if;
end $$;

-- My Profile: the card and its step
create or replace function public.my_id_card() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('card_no', c.card_no, 'valid_until', c.valid_until, 'issued_at', c.issued_at, 'employee_no', e.employee_no,
                            'pin_set', exists (select 1 from private.employee_pins p where p.employee_id = e.id),
                            'stage', coalesce(c.stage, case when c.activated_at is null then 'old' else 'active' end), 'activated_at', c.activated_at)
  from public.employees e join public.employee_cards c on c.employee_id = e.id and c.status = 'active'
  where e.profile_id = auth.uid() and e.status = 'active'
  limit 1;
$$;
revoke execute on function public.my_id_card() from public, anon;
grant execute on function public.my_id_card() to authenticated;

notify pgrst, 'reload schema';

select '170 OK - employee ID card flow · ' || (select count(*) from public.employee_cards where status = 'active' and activated_at is null) || ' card(s) waiting to be activated' as result;
