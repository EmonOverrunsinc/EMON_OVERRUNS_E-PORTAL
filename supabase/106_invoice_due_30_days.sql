-- 3.99.113: every invoice has a DUE DATE. An invoice whose payment terms give no due date (no terms, or terms that are
-- not "N DAYS" or CASH ON DELIVERY) is due 30 DAYS after its invoice date. The view is changed in that one place only;
-- "15 DAYS", "30 DAYS", CASH ON DELIVERY and the coverage extension stay as they are. Safe to run again.

do $$
declare def text := pg_get_viewdef('public.invoice_balances'::regclass);
begin
  if position('ELSE NULL::date' in def) > 0 then
    def := replace(def, 'ELSE NULL::date', 'ELSE i.invoice_date + 30');
    execute 'create or replace view public.invoice_balances with (security_invoker = true) as ' || def;
  elsif position('i.invoice_date + 30' in def) = 0 then
    raise exception 'Update 106: invoice_balances has changed - send this message to Claude';
  end if;
end $$;

select '106 OK - every invoice has a due date (30 days when the terms give none): '
  || (select count(*) from public.invoice_balances where due_date is null) || ' invoice(s) without a due date' as result;
