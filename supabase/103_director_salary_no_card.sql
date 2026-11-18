-- =====================================================================
-- EMON OVERRUNS E-PORTAL - Update 3.99.76: the DIRECTOR pays a salary without scanning the employee's ID card
-- Everyone else still scans the employee's ID card. A payment made by the Director without the card says so in its notes.
-- Safe to run again.
-- =====================================================================
do $$ begin
  if to_regprocedure('public.pay_salary(uuid,numeric,date,text,text,text,text)') is null then raise exception 'Update 3.99.76: payroll is missing (063).'; end if;
end $$;

create or replace function public.pay_salary(p_payslip uuid, p_amount numeric, p_date date, p_method text, p_ref text, p_notes text, p_card text)
returns public.salary_payments
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare s public.payslips; e public.employees; c public.employee_cards; sec text; mm text[]; paid numeric; left_amt numeric;
  amt numeric := round(coalesce(p_amount, 0), 2); d date := coalesce(p_date, current_date); r public.salary_payments;
  me text := (select full_name from public.profiles where id = auth.uid());
begin
  if not public.can_write('employees') then raise exception 'Not allowed'; end if;
  select * into s from public.payslips where id = p_payslip for update;
  if not found then raise exception 'Payslip not found'; end if;
  select * into e from public.employees where id = s.employee_id;
  if s.issued_at is null then raise exception 'Payslip % was paid when it was made', s.payslip_no; end if;
  select coalesce(sum(amount), 0) into paid from public.salary_payments where payslip_id = s.id;
  left_amt := s.net_pay - paid;
  if left_amt <= 0 then raise exception 'Payslip % is paid already', s.payslip_no; end if;
  if amt <= 0 then raise exception 'Enter the amount to pay'; end if;
  if amt > left_amt then raise exception 'Only PHP % is left to pay on payslip %', to_char(left_amt, 'FM999,999,990.00'), s.payslip_no; end if;
  if d > current_date then raise exception 'The pay date cannot be after today'; end if;
  -- the employee's ID card: the card of this employee, valid today (3.99.76: the Director may pay without the card)
  if not (public.is_admin() and coalesce(trim(p_card), '') = '') then
    mm := regexp_match(upper(trim(coalesce(p_card, ''))), '^EMONID\|(EOID-[0-9]{4}-[0-9]{4,})\|([0-9A-F]{40})$');
    if mm is null then raise exception 'Scan the QR code on the employee''s ID card first'; end if;
    select * into c from public.employee_cards where card_no = mm[1];
    select k.secret into sec from private.employee_card_keys k where k.card_id = c.id;
    if c.id is null or sec is distinct from mm[2] then raise exception 'This ID card is not valid'; end if;
    if c.employee_id <> s.employee_id then raise exception 'This ID card is not the card of % - scan the card of the employee who is paid', upper(e.first_name || ' ' || e.last_name); end if;
    if c.status <> 'active' then raise exception 'This ID card is no longer valid (%) - use the new card', upper(c.status); end if;
    if c.valid_until < current_date then raise exception 'This ID card expired on %', to_char(c.valid_until, 'FMMONTH DD YYYY'); end if;
  end if;
  insert into public.salary_payments (payment_no, employee_id, payslip_id, amount, pay_date, method, reference_no, notes, card_no, created_by_name)
  values ('SP-' || to_char(d, 'YYYYMM') || '-' || lpad(public.next_counter('SP' || to_char(d, 'YYYYMM'))::text, 3, '0'), s.employee_id, s.id, amt, d,
    nullif(left(trim(coalesce(p_method, '')), 40), ''), nullif(left(trim(coalesce(p_ref, '')), 60), ''), nullif(left(trim(coalesce(p_notes, '') || case when c.card_no is null then case when coalesce(trim(p_notes), '') = '' then '' else ' · ' end || 'Paid by the Director without the ID card' else '' end), 300), ''), c.card_no, me)
  returning * into r;
  if e.profile_id is not null then
    perform public.notify_user(e.profile_id, 'Salary paid - ' || r.payment_no,
      'PHP ' || to_char(amt, 'FM999,999,990.00') || ' paid on payslip ' || s.payslip_no
      || case when amt < left_amt then ' (PHP ' || to_char(left_amt - amt, 'FM999,999,990.00') || ' still unpaid)' else ' (paid in full)' end, 'payslip/' || s.id);
  end if;
  return r;
end;
$$;
revoke execute on function public.pay_salary(uuid, numeric, date, text, text, text, text) from public, anon;
grant execute on function public.pay_salary(uuid, numeric, date, text, text, text, text) to authenticated;

select 'UPDATE 3.99.76 READY' as result;
