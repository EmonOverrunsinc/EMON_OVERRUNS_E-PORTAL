-- 3.99.391: ID CARD FEE AND DIRECTOR AUTHORIZATION.
-- FEE: every card needs the PHP 150 ID card fee before it is ACTIVE: PAID (a Collection Voucher, paid, date locked) or
--   DEDUCTED FROM SALARY (taken in the employee's next payslip as an other deduction). A new card chooses it when it is sent
--   to printing; a card issued before the new steps chooses it when the Director activates it.
-- AUTHORIZATION: printing or downloading an ID card needs the Director: the Director's own ID card is scanned and the
--   Director's 4-number PIN typed. 5 wrong PINs lock it for 15 minutes. The Director sets the PIN in My Profile.
-- Needs 170. Safe to run again.

alter table public.employee_cards add column if not exists fee_method text;
alter table public.employee_cards drop constraint if exists employee_cards_fee_method_check;
alter table public.employee_cards add constraint employee_cards_fee_method_check check (fee_method is null or fee_method in ('cash', 'salary'));
alter table public.employee_cards add column if not exists fee_payslip_id uuid;   -- the payslip the fee was deducted in
alter table public.employee_cards add column if not exists fee_deducted_at timestamptz;

-- the fee of a card: a paid voucher, or a salary deduction waiting for the next payslip
create or replace function private.card_fee(p_card uuid, p_fee text) returns void
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare c public.employee_cards; e public.employees; me text; cv uuid; ym text := to_char(current_date, 'YYYYMM');
begin
  select * into c from public.employee_cards where id = p_card;
  if c.fee_method is not null then return; end if; -- the fee is already settled
  if p_fee is null or p_fee not in ('cash', 'salary') then raise exception 'Choose how the PHP 150 ID card fee is paid: cash or salary deduction.'; end if;
  select * into e from public.employees where id = c.employee_id;
  select full_name into me from public.profiles where id = auth.uid();
  if p_fee = 'cash' then
    insert into public.collection_vouchers (cv_no, cv_date, issued_on, received_from, amount, method, note, status, paid_at, paid_by_name, received_by,
                                            employee_id, created_by, created_by_name)
    values ('CV-' || ym || '-' || lpad(public.next_counter('CV' || ym)::text, 3, '0'), current_date, current_date,
            left(upper(trim(e.first_name || ' ' || e.last_name)), 120), 150, 'cash',
            left('EMPLOYEE ID CARD FEE · ' || c.card_no || ' · ' || coalesce(e.employee_no, ''), 300), 'paid', now(),
            left(upper(trim(e.first_name || ' ' || e.last_name)), 120), left(coalesce(me, ''), 120), e.id, auth.uid(), left(coalesce(me, ''), 120))
    returning id into cv;
    update public.employee_cards set fee_method = 'cash', fee_cv_id = cv where id = c.id;
  else
    update public.employee_cards set fee_method = 'salary' where id = c.id;
  end if;
end $$;
revoke execute on function private.card_fee(uuid, text) from public;

-- 2. SENT TO PRINTING, with the fee: cash (paid voucher) or salary deduction
drop function if exists public.card_send_printing(uuid);
create or replace function public.card_send_printing(p_card uuid, p_fee text default 'cash') returns public.employee_cards
language plpgsql security definer set search_path = '' as $$
declare c public.employee_cards;
begin
  c := private.card_step(p_card, array['generated'], 'waiting_print');
  perform private.card_fee(c.id, p_fee);
  update public.employee_cards set printing_at = now() where id = c.id returning * into c;
  return c;
end $$;
revoke execute on function public.card_send_printing(uuid, text) from public, anon;
grant execute on function public.card_send_printing(uuid, text) to authenticated;

-- 6. ACTIVATE: a card issued before the new steps settles its fee now (cash or salary deduction)
drop function if exists public.activate_employee_card(uuid);
create or replace function public.activate_employee_card(p_card uuid, p_fee text default null) returns public.employee_cards
language plpgsql security definer set search_path = '' as $$
declare c public.employee_cards; me text; who uuid;
begin
  select * into c from public.employee_cards where id = p_card;
  c := private.card_step(p_card, array['collected', 'old'], 'active');
  perform private.card_fee(c.id, p_fee);
  select full_name into me from public.profiles where id = auth.uid();
  update public.employee_cards set activated_at = now(), activated_by = auth.uid(), activated_by_name = me where id = c.id returning * into c;
  select e.profile_id into who from public.employees e where e.id = c.employee_id;
  if who is not null then
    insert into public.notifications (user_id, title, body, link)
    values (who, 'Your Employee ID is active', 'Your Employee ID ' || c.card_no || ' is now active. You can use it to sign in.'
      || case when c.fee_method = 'salary' and c.fee_deducted_at is null then ' The PHP 150 ID card fee is deducted from your next salary.' else '' end, 'profile');
  end if;
  return c;
end $$;
revoke execute on function public.activate_employee_card(uuid, text) from public, anon;
grant execute on function public.activate_employee_card(uuid, text) to authenticated;

-- the ID card fees still to deduct from an employee's salary (for the payslip form)
create or replace function public.card_fees_to_deduct(p_employee uuid) returns table (card_id uuid, card_no text, amount numeric)
language sql stable security definer set search_path = '' as $$
  select c.id, c.card_no, 150::numeric from public.employee_cards c
   where public.is_admin() and c.employee_id = p_employee and c.fee_method = 'salary' and c.fee_deducted_at is null order by c.issued_at;
$$;
revoke execute on function public.card_fees_to_deduct(uuid) from public, anon;
grant execute on function public.card_fees_to_deduct(uuid) to authenticated;

-- after a payslip with the fee in its other deductions: the fees are marked deducted
create or replace function public.card_fees_deducted(p_payslip uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare ps record; n int := 0; need numeric; c record;
begin
  if not public.is_admin() then raise exception 'Only the Director.'; end if;
  select * into ps from public.payslips where id = p_payslip;
  if ps.id is null then raise exception 'Payslip not found.'; end if;
  need := coalesce(ps.other_deductions, 0);
  for c in select x.id from public.employee_cards x where x.employee_id = ps.employee_id and x.fee_method = 'salary' and x.fee_deducted_at is null order by x.issued_at loop
    exit when need < 150;
    update public.employee_cards set fee_deducted_at = now(), fee_payslip_id = ps.id where id = c.id;
    need := need - 150; n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.card_fees_deducted(uuid) from public, anon;
grant execute on function public.card_fees_deducted(uuid) to authenticated;

-- ---------- DIRECTOR AUTHORIZATION: the Director's ID card (scanned) and PIN ----------
create or replace function public.director_authorize(p_code text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare m text[]; c public.employee_cards; sec text; e public.employees; pr public.profiles; pn record;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  m := regexp_match(upper(trim(coalesce(p_code, ''))), '^EMONID\|(EOID-[0-9]{4}-[0-9]{4,})\|([0-9A-F]{40})$');
  if m is null then return jsonb_build_object('ok', false, 'why', 'This is not an EMON OVERRUNS ID card.'); end if;
  select * into c from public.employee_cards where card_no = m[1];
  select k.secret into sec from private.employee_card_keys k where k.card_id = c.id;
  if c.id is null or sec is distinct from m[2] then return jsonb_build_object('ok', false, 'why', 'This ID card is not valid.'); end if;
  if c.status <> 'active' or c.valid_until < current_date then return jsonb_build_object('ok', false, 'why', 'This ID card is no longer valid.'); end if;
  select * into e from public.employees where id = c.employee_id;
  select * into pr from public.profiles where id = e.profile_id;
  if pr.id is null or pr.role <> 'admin' or pr.status <> 'active' then return jsonb_build_object('ok', false, 'why', 'Only a Director''s ID card can authorize.'); end if;
  select * into pn from private.employee_pins where employee_id = e.id for update;
  if pn.employee_id is null then return jsonb_build_object('ok', false, 'why', 'The Director has no PIN yet. Set it in My Profile.'); end if;
  if pn.locked_until is not null and pn.locked_until > now() then return jsonb_build_object('ok', false, 'why', 'Too many wrong PINs. Try again after 15 minutes.'); end if;
  if pn.pin_hash is distinct from private.pin_hash(e.id, p_pin) then
    update private.employee_pins set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' end where employee_id = e.id;
    return jsonb_build_object('ok', false, 'why', 'Wrong PIN.');
  end if;
  update private.employee_pins set failed = 0, locked_until = null where employee_id = e.id;
  return jsonb_build_object('ok', true, 'name', upper(pr.full_name), 'card_no', c.card_no);
end $$;
revoke execute on function public.director_authorize(text, text) from public, anon;
grant execute on function public.director_authorize(text, text) to authenticated;

-- the card code for printing an ID card is given only after the Director's authorization (a wrong PIN is counted)
drop function if exists public.card_print_code(uuid, text, text);
create or replace function public.card_print_code(p_card uuid, p_code text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'why', 'Only the Director can print an ID card.'); end if;
  a := public.director_authorize(p_code, p_pin);
  if not (a->>'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'code', public.employee_card_code(p_card), 'name', a->>'name');
end $$;
revoke execute on function public.card_print_code(uuid, text, text) from public, anon;
grant execute on function public.card_print_code(uuid, text, text) to authenticated;

-- My Profile: whether the Director's PIN is set
create or replace function public.my_pin_set() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employees e join private.employee_pins p on p.employee_id = e.id where e.profile_id = auth.uid());
$$;
revoke execute on function public.my_pin_set() from public, anon;
grant execute on function public.my_pin_set() to authenticated;

notify pgrst, 'reload schema';

select '171 OK - ID card fee (cash or salary) and Director authorization' as result;
