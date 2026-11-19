-- 3.99.114: PAID as a payment term (the invoice is paid already): its due date is the invoice date, like COD.
-- The view is changed in that one place only. Safe to run again. (Run 106 first.)
do $$
declare def text := pg_get_viewdef('public.invoice_balances'::regclass);
begin
  if position('''PAID''::text' in def) = 0 then
    if position('ARRAY[''COD''::text, ''CASH ON DELIVERY''::text]' in def) = 0 then raise exception 'Update 107: invoice_balances has changed - send this message to Claude'; end if;
    def := replace(def, 'ARRAY[''COD''::text, ''CASH ON DELIVERY''::text]', 'ARRAY[''COD''::text, ''CASH ON DELIVERY''::text, ''PAID''::text]');
    execute 'create or replace view public.invoice_balances with (security_invoker = true) as ' || def;
  end if;
end $$;

select '107 OK - PAID is a payment term (due on the invoice date)' as result;
