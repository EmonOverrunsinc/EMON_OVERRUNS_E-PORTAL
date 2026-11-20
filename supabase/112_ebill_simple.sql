-- 3.99.131: E-BILL simpler: the bill is ONE total amount (no item table), with the serial range of its boxes (code A:
-- A2026001 to A2026050); a new cost: OPERATIONAL COST (taken off the net sales like the other fees). Safe to run again.

alter table public.stock_bills add column if not exists serial_code text check (serial_code is null or char_length(serial_code) <= 10);
alter table public.stock_bills add column if not exists serial_from text check (serial_from is null or char_length(serial_from) <= 40);
alter table public.stock_bills add column if not exists serial_to text check (serial_to is null or char_length(serial_to) <= 40);

alter table public.stock_bill_entries drop constraint if exists stock_bill_entries_entry_type_check;
alter table public.stock_bill_entries add constraint stock_bill_entries_entry_type_check check (entry_type in ('sales','eoo_fee','fee','penalty','operational'));

-- the operational cost counts with the other fees in the totals and the profit (the view is changed in that one place)
do $$
declare def text := pg_get_viewdef('public.stock_bill_totals'::regclass);
begin
  if position('''operational''' in def) = 0 then
    if position('(x.entry_type = ''fee''::text)' in def) = 0 then raise exception 'Update 112: stock_bill_totals has changed - send this message to Claude'; end if;
    def := replace(def, '(x.entry_type = ''fee''::text)', '(x.entry_type = ANY (ARRAY[''fee''::text, ''operational''::text]))');
    execute 'create or replace view public.stock_bill_totals with (security_invoker = true) as ' || def;
  end if;
end $$;

notify pgrst, 'reload schema';

select '112 OK - e-bill: one total amount, serial range, operational cost' as result;
