-- 3.99.106: SECURITY SEALS also on the QC TEST stickers, the INVOICES and the ACKNOWLEDGMENT RECEIPTS (104 had boxes and
-- Coverage Certificates). Each gets its own unique 16-digit seal number, checked on Verify a Record. Safe to run again.
-- Needs 104_security_seals.sql first.

alter table public.security_seals drop constraint if exists security_seals_kind_check;
alter table public.security_seals add constraint security_seals_kind_check check (kind in ('box', 'coverage', 'qc', 'invoice', 'receipt'));

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

select '105 OK - seals for QC stickers, invoices and receipts ready' as result;
