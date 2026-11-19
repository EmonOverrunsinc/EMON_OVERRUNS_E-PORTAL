-- 3.99.115: an invoice with NO payment terms shows "30 DAYS" (its due date was already 30 days after the invoice date,
-- update 106): the empty terms of the saved invoices are filled in, and a new invoice saved without terms gets 30 DAYS.
-- Only the empty terms change; amounts, dates and paid status stay the same. Safe to run again.

alter table public.customer_invoices alter column payment_terms set default '30 DAYS';

create or replace function public.invoice_terms_default() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.payment_terms is null or btrim(new.payment_terms) = '' then new.payment_terms := '30 DAYS'; end if;
  return new;
end $$;
drop trigger if exists invoice_terms_default on public.customer_invoices;
create trigger invoice_terms_default before insert on public.customer_invoices
  for each row execute function public.invoice_terms_default();

do $$
begin
  perform public.allow_record_change();
  update public.customer_invoices set payment_terms = '30 DAYS' where payment_terms is null or btrim(payment_terms) = '';
  perform set_config('eo.allow_change', 'off', true);
end $$;

select '108 OK - invoices without terms now show 30 DAYS: '
  || (select count(*) from public.customer_invoices where payment_terms is null or btrim(payment_terms) = '') || ' left empty' as result;
