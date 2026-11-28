-- 3.99.393: FREEZE, BLACKLIST AND CANCEL. EMON OVERRUNS can act on an employee's access or ID card at any time:
--   FREEZE     everything is on hold: no sign-in at all (email, ID card or any device) and the card does not work. The
--              employee sees "Your access is locked. Contact the EMON OVERRUNS Office to unfreeze." UNFREEZE gives it back.
--   BLACKLIST  the ID card can never be used again.
--   CANCEL     the ID card is cancelled (ended).
-- A new card issued while the employee is frozen, or after the card was blacklisted, BLACKLISTS the card before it
-- (otherwise the card before is REPLACED, as now). Needs 170 and 171. Safe to run again.

alter table public.employee_cards drop constraint if exists employee_cards_status_check;
alter table public.employee_cards add constraint employee_cards_status_check
  check (status in ('active', 'replaced', 'revoked', 'blocked', 'blacklisted', 'cancelled'));
alter table public.employee_cards add column if not exists ended_note text;
alter table public.employee_cards add column if not exists ended_by_name text;

alter table public.employees add column if not exists frozen_at timestamptz;
alter table public.employees add column if not exists frozen_by_name text;
alter table public.employees add column if not exists frozen_note text;
alter table public.employees add column if not exists frozen_prev_status text;

-- FREEZE: the login is turned off (inactive) and marked frozen; the card stops with it
create or replace function public.freeze_employee(p_employee uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees; me text;
begin
  if not public.is_admin() then raise exception 'Only the Director can freeze an employee.'; end if;
  select * into e from public.employees where id = p_employee for update;
  if e.id is null then raise exception 'Employee not found.'; end if;
  if e.frozen_at is not null then raise exception 'This employee is already frozen.'; end if;
  if e.status = 'terminated' then raise exception 'A terminated employee cannot be frozen.'; end if;
  if e.profile_id = auth.uid() then raise exception 'You cannot freeze yourself.'; end if;
  select full_name into me from public.profiles where id = auth.uid();
  perform public.allow_record_change();
  update public.employees set frozen_at = now(), frozen_by_name = me, frozen_note = nullif(trim(coalesce(p_note, '')), ''),
    frozen_prev_status = status, status = 'inactive' where id = p_employee;
  update public.profiles set status = 'disabled' where id = e.profile_id;
  delete from auth.sessions where user_id = e.profile_id; -- signed out everywhere at once
end $$;
revoke execute on function public.freeze_employee(uuid, text) from public, anon;
grant execute on function public.freeze_employee(uuid, text) to authenticated;

create or replace function public.unfreeze_employee(p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees;
begin
  if not public.is_admin() then raise exception 'Only the Director can unfreeze an employee.'; end if;
  select * into e from public.employees where id = p_employee for update;
  if e.id is null or e.frozen_at is null then raise exception 'This employee is not frozen.'; end if;
  perform public.allow_record_change();
  update public.employees set frozen_at = null, frozen_by_name = null, frozen_note = null,
    status = coalesce(nullif(frozen_prev_status, 'inactive'), 'active'), frozen_prev_status = null where id = p_employee;
  update public.profiles set status = 'active' where id = e.profile_id;
end $$;
revoke execute on function public.unfreeze_employee(uuid) from public, anon;
grant execute on function public.unfreeze_employee(uuid) to authenticated;

-- BLACKLIST or CANCEL a card (it stops at once)
create or replace function public.end_employee_card(p_card uuid, p_how text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me text;
begin
  if not public.is_admin() then raise exception 'Only the Director can do this.'; end if;
  if p_how not in ('blacklisted', 'cancelled') then raise exception 'Blacklist or cancel.'; end if;
  select full_name into me from public.profiles where id = auth.uid();
  update public.employee_cards set status = p_how, ended_at = now(), ended_by_name = me, ended_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_card and status = 'active';
  if not found then raise exception 'This card is not in use.'; end if;
end $$;
revoke execute on function public.end_employee_card(uuid, text, text) from public, anon;
grant execute on function public.end_employee_card(uuid, text, text) to authenticated;

-- a new card: the card before is BLACKLISTED when the employee is frozen or a card of theirs was blacklisted
create or replace function private.issue_card(p_employee uuid, p_by uuid) returns public.employee_cards
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare c public.employee_cards; yr text := to_char(current_date, 'YYYY'); bad boolean;
begin
  bad := exists (select 1 from public.employees e where e.id = p_employee and e.frozen_at is not null)
      or exists (select 1 from public.employee_cards x where x.employee_id = p_employee and x.status = 'blacklisted');
  update public.employee_cards set status = case when bad then 'blacklisted' else 'replaced' end, ended_at = now(),
    ended_note = case when bad then 'BLACKLISTED WHEN A NEW CARD WAS ISSUED' end
   where employee_id = p_employee and status = 'active';
  insert into public.employee_cards (employee_id, card_no, valid_until, issued_by, issued_by_name)
  values (p_employee, 'EOID-' || yr || '-' || lpad(public.next_counter('EOID' || yr)::text, 4, '0'), (current_date + interval '1 year')::date,
          p_by, (select full_name from public.profiles where id = p_by))
  returning * into c;
  insert into private.employee_card_keys (card_id, secret)
  values (c.id, upper(left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 40)));
  return c;
end;
$$;
revoke execute on function private.issue_card(uuid, uuid) from public;

-- the ID card sign-in and the scan say FROZEN / BLACKLISTED / CANCELLED
do $$
declare def text;
begin
  def := pg_get_functiondef('public.card_state(text)'::regprocedure);
  if position('''frozen''' in def) = 0 then
    def := replace(def, $x$  if c.status = 'replaced' then return jsonb_build_object('state', 'replaced', 'name', nm); end if;$x$,
      $x$  if e.frozen_at is not null then return jsonb_build_object('state', 'frozen', 'name', nm); end if;
  if c.status = 'blacklisted' then return jsonb_build_object('state', 'blacklisted', 'name', nm); end if;
  if c.status = 'replaced' then return jsonb_build_object('state', 'replaced', 'name', nm); end if;$x$);
    execute def;
  end if;
  def := pg_get_functiondef('public.check_employee_card(text)'::regprocedure);
  if position('''FROZEN''' in def) = 0 then
    def := replace(def, $x$'state', case when c.status = 'replaced' then 'REPLACED'$x$,
      $x$'state', case when e.frozen_at is not null then 'FROZEN' when c.status = 'blacklisted' then 'BLACKLISTED' when c.status = 'cancelled' then 'CANCELLED' when c.status = 'replaced' then 'REPLACED'$x$);
    execute def;
  end if;
  def := pg_get_functiondef('public.card_set_password(text,text)'::regprocedure);
  if position('access is locked' in def) = 0 then
    execute replace(def, $x$when 'ended' then 'This ID card is no longer valid.'$x$,
      $x$when 'ended' then 'This ID card is no longer valid.' when 'frozen' then 'Your access is locked. Contact the EMON OVERRUNS Office to unfreeze.' when 'blacklisted' then 'This ID card is blacklisted.'$x$);
  end if;
end $$;

-- the signed-in person: is their access frozen (shown on the locked screen)
create or replace function public.my_access_lock() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('frozen', e.frozen_at is not null, 'at', e.frozen_at, 'note', e.frozen_note)
  from public.employees e where e.profile_id = auth.uid() limit 1;
$$;
revoke execute on function public.my_access_lock() from public, anon;
grant execute on function public.my_access_lock() to authenticated;

notify pgrst, 'reload schema';

select '172 OK - freeze, blacklist and cancel' as result;
