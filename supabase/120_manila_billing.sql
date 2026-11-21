-- 3.99.163: BILLING FOR TWO OFFICES. Every billing company belongs to an office: DHAKA (Regional Office Dhaka, all the
-- companies made before this) or MANILA (Regional Office Manila › Billing). The companies of an office, their accounts,
-- payment vouchers and employees are seen and used only with that office's access: "8 Billing" for Dhaka, the new
-- "15 Manila Billing" for Manila. EMON HASAN (the Director) sees both. A Manila voucher number starts with MN
-- (MN20261122001), a Dhaka one with BD as before. Safe to run again.

alter table public.pay_companies add column if not exists office text not null default 'dhaka';
alter table public.pay_companies drop constraint if exists pay_companies_office_check;
alter table public.pay_companies add constraint pay_companies_office_check check (office in ('dhaka', 'manila'));
create index if not exists pay_companies_office on public.pay_companies (office);

-- may this login see (or write) the billing of an office / of a company?
create or replace function public.pay_office_ok(p_office text, p_write boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or case when p_office = 'manila'
    then (case when p_write then public.can_write('mbilling') else public.has_module('mbilling') end)
    else (case when p_write then public.can_write('billing') else public.has_module('billing') end) end;
$$;
revoke execute on function public.pay_office_ok(text, boolean) from public, anon;
grant execute on function public.pay_office_ok(text, boolean) to authenticated;

create or replace function public.pay_company_ok(p_company uuid, p_write boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pay_office_ok(coalesce((select c.office from public.pay_companies c where c.id = p_company), 'dhaka'), p_write);
$$;
revoke execute on function public.pay_company_ok(uuid, boolean) from public, anon;
grant execute on function public.pay_company_ok(uuid, boolean) to authenticated;

-- the companies
drop policy if exists "pc: read" on public.pay_companies;
drop policy if exists "pc: insert" on public.pay_companies;
create policy "pc: read" on public.pay_companies for select to authenticated
  using (public.pay_office_ok(office) or (office <> 'manila' and (select public.has_module('inventory'))));
create policy "pc: insert" on public.pay_companies for insert to authenticated with check (public.pay_office_ok(office, true));

-- their accounts
drop policy if exists "pa: read" on public.pay_accounts;
drop policy if exists "pa: insert" on public.pay_accounts;
create policy "pa: read" on public.pay_accounts for select to authenticated using (public.pay_company_ok(company_id));
create policy "pa: insert" on public.pay_accounts for insert to authenticated with check (public.pay_company_ok(company_id, true));

-- their payment vouchers (an e-bill's voucher stays readable for E-Bill)
drop policy if exists "pv: read" on public.pay_vouchers;
drop policy if exists "pv: insert" on public.pay_vouchers;
create policy "pv: read" on public.pay_vouchers for select to authenticated
  using (public.pay_company_ok(company_id) or (stock_bill_id is not null and (select public.has_module('inventory'))));
create policy "pv: insert" on public.pay_vouchers for insert to authenticated with check (public.pay_company_ok(company_id, true));

-- their assigned employees (114)
do $$
begin
  if to_regclass('public.pay_company_staff') is not null then
    execute 'drop policy if exists "pcs: read" on public.pay_company_staff';
    execute 'create policy "pcs: read" on public.pay_company_staff for select to authenticated using ((select public.is_admin()) or public.pay_company_ok(company_id))';
  end if;
end $$;

-- a Manila voucher number starts with MN (the trigger is changed in that one place)
do $$
declare def text := pg_get_functiondef('public.pay_vouchers_before_insert()'::regprocedure);
  a text := 'new.voucher_no := ''BD'' || to_char(new.pay_date, ''YYYYMMDD'') || lpad(public.next_counter(''BD'' || to_char(new.pay_date, ''YYYYMMDD''))::text, 3, ''0'');';
  b text := 'new.voucher_no := (case when co.office = ''manila'' then ''MN'' else ''BD'' end) || to_char(new.pay_date, ''YYYYMMDD'') || lpad(public.next_counter((case when co.office = ''manila'' then ''MN'' else ''BD'' end) || to_char(new.pay_date, ''YYYYMMDD''))::text, 3, ''0''); -- 3.99.163';
begin
  if position('3.99.163' in def) = 0 then
    if position(a in def) = 0 then raise exception 'Update 120: pay_vouchers_before_insert has changed - send this message to Claude'; end if;
    execute replace(def, a, b);
  end if;
end $$;

notify pgrst, 'reload schema';

select '120 OK - billing for two offices: Dhaka and Manila' as result;
