-- 3.99.175: BILLING OFFICES: only MODINA FASHION stays with REGIONAL OFFICE DHAKA; every other billing company moves to
-- REGIONAL OFFICE MANILA (its accounts, vouchers and employees go with it). Vouchers already made keep their numbers.
-- Needs 120 first. Safe to run again. The last lines list each company and its office.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pay_companies' and column_name = 'office') then
    raise exception 'Run 120_manila_billing.sql first, then run this again.';
  end if;
end $$;

do $$
begin
  perform set_config('eo.allow_change', 'on', true); -- an approved change of the Director (saved records are locked)
  update public.pay_companies set office = 'manila' where upper(name) not like '%MODINA%' and office <> 'manila';
  update public.pay_companies set office = 'dhaka' where upper(name) like '%MODINA%' and office <> 'dhaka';
  perform set_config('eo.allow_change', '', true);
end $$;

notify pgrst, 'reload schema';

select upper(office) as office, name from public.pay_companies order by office, name;
