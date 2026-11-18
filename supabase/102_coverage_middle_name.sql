-- =====================================================================
-- EMON OVERRUNS E-PORTAL - Update 3.99.71: the customer's MIDDLE NAME on the coverage (insurance) records
-- The customer name a coverage keeps is written FIRST MIDDLE LAST (a new coverage, and the coverages saved before).
-- Safe to run again.
-- =====================================================================
do $$ begin
  if to_regclass('public.order_insurance') is null then raise exception 'Update 3.99.71: the coverage table is missing (077).'; end if;
end $$;

create or replace function public.order_insurance_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is not null then
    new.customer_name := coalesce((select nullif(trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.middle_name), ''), nullif(trim(c.last_name), ''))), '')
                                   from public.customers c where c.id = new.customer_id), new.customer_name);
  end if;
  return new;
end;
$$;
revoke execute on function public.order_insurance_name() from public, anon, authenticated;
drop trigger if exists order_insurance_name on public.order_insurance;
create trigger order_insurance_name before insert or update of customer_id on public.order_insurance
  for each row execute function public.order_insurance_name();

-- the coverages saved before: the middle name added
update public.order_insurance i
   set customer_name = trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.middle_name), ''), nullif(trim(c.last_name), '')))
  from public.customers c
 where c.id = i.customer_id and nullif(trim(c.middle_name), '') is not null
   and i.customer_name is distinct from trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.middle_name), ''), nullif(trim(c.last_name), '')));

select 'UPDATE 3.99.71 READY' as result;
