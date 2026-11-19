-- 3.99.123: EMPLOYEE ID CARDS: the Director can BLOCK a card (lost / stolen: it stops signing in and shows BLOCKED when
-- scanned; then Issue New Card), change a card's EXPIRATION DATE, and every printed card carries a security seal with
-- its own unique seal number (checked on Verify a Record). Needs 104 + 105 first. Safe to run again.

alter table public.employee_cards drop constraint if exists employee_cards_status_check;
alter table public.employee_cards add constraint employee_cards_status_check check (status in ('active', 'replaced', 'revoked', 'blocked'));

-- the Director blocks a card
create or replace function public.block_employee_card(p_card uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the Director blocks an ID card.'; end if;
  update public.employee_cards set status = 'blocked', ended_at = now() where id = p_card and status = 'active';
  if not found then raise exception 'This card is not active.'; end if;
end $$;
revoke all on function public.block_employee_card(uuid) from public, anon;
grant execute on function public.block_employee_card(uuid) to authenticated;

-- the Director changes a card's expiration date
create or replace function public.set_card_expiry(p_card uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the Director changes the expiration date.'; end if;
  if p_date is null or p_date < current_date then raise exception 'Choose a date from today on.'; end if;
  update public.employee_cards set valid_until = p_date where id = p_card and status = 'active';
  if not found then raise exception 'This card is not active.'; end if;
end $$;
revoke all on function public.set_card_expiry(uuid, date) from public, anon;
grant execute on function public.set_card_expiry(uuid, date) to authenticated;

-- a scanned blocked card says BLOCKED (the check function is changed in that one place)
do $$
declare def text := pg_get_functiondef('public.check_employee_card(text)'::regprocedure);
begin
  if position('''BLOCKED''' in def) = 0 then
    if position('when c.status = ''replaced'' then ''REPLACED''' in def) = 0 then raise exception 'Update 111: check_employee_card has changed - send this message to Claude'; end if;
    execute replace(def, 'when c.status = ''replaced'' then ''REPLACED''', 'when c.status = ''replaced'' then ''REPLACED'' when c.status = ''blocked'' then ''BLOCKED''');
  end if;
end $$;

-- the security seal of a printed ID card
alter table public.security_seals drop constraint if exists security_seals_kind_check;
alter table public.security_seals add constraint security_seals_kind_check check (kind in ('box', 'coverage', 'qc', 'invoice', 'receipt', 'idcard'));

create or replace function public.seal_issue(p_kind text, p_ref text) returns text
language plpgsql security definer set search_path = '' as $$
declare r text := upper(trim(coalesce(p_ref, ''))); v text; body text;
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Sign in first.'; end if;
  if p_kind = 'box' then
    if not public.is_staff() then raise exception 'Only EMON OVERRUNS staff print boxes.'; end if;
    if not exists (select 1 from public.box_stock b where upper(b.serial_no) = r) then raise exception 'No box %', r; end if;
  elsif p_kind = 'coverage' then
    if not exists (select 1 from public.order_insurance i where upper(i.ins_no) = r) then raise exception 'No certificate %', r; end if;
  elsif p_kind = 'qc' then
    if not public.is_staff() then raise exception 'Only EMON OVERRUNS staff print QC stickers.'; end if;
    if not exists (select 1 from public.qc_tests q where upper(q.qc_no) = r) then raise exception 'No QC test %', r; end if;
  elsif p_kind = 'invoice' then
    if not exists (select 1 from public.customer_invoices i where upper(i.invoice_no) = r) then raise exception 'No invoice %', r; end if;
  elsif p_kind = 'receipt' then
    if not exists (select 1 from public.payments_received p where upper(p.receipt_no) = r) then raise exception 'No receipt %', r; end if;
  elsif p_kind = 'idcard' then
    if not public.is_admin() then raise exception 'Only the Director prints ID cards.'; end if;
    if not exists (select 1 from public.employee_cards c where upper(c.card_no) = r) then raise exception 'No ID card %', r; end if;
  else
    raise exception 'Unknown kind';
  end if;
  select s.code into v from public.security_seals s where s.kind = p_kind and s.ref = r;
  if v is not null then return v; end if;
  for n in 1..20 loop
    body := lpad(((('x' || substr(md5(gen_random_uuid()::text), 1, 15))::bit(60)::bigint) % 1000000000000000)::text, 15, '0');
    v := body || public.seal_check_digit(body)::text;
    begin
      insert into public.security_seals (code, kind, ref) values (v, p_kind, r);
      return v;
    exception when unique_violation then
      select s.code into v from public.security_seals s where s.kind = p_kind and s.ref = r;
      if v is not null then return v; end if;
    end;
  end loop;
  raise exception 'Could not make a seal number, try again.';
end $$;
revoke all on function public.seal_issue(text, text) from public, anon;
grant execute on function public.seal_issue(text, text) to authenticated;

notify pgrst, 'reload schema';

select '111 OK - ID cards: block, expiration date, security seal' as result;
