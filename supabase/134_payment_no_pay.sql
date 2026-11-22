-- 3.99.216: PAYMENT numbers PAY-YYYYMM-#### (like PAY-202611-0001), counted each month. Only new payments get the new
-- number: a payment recorded before keeps its number, because it is printed on the receipt the customer already has.
-- Every payment also shows its TRX ID (its server ID) on the payment page and the receipt. Needs 002 first. Safe to run again.
do $$
declare def text; nw text;
begin
  if to_regprocedure('public.payments_before_insert()') is null then raise exception 'The payments are not set up yet.'; end if;
  def := pg_get_functiondef('public.payments_before_insert()'::regprocedure);
  if position('''PAY-'' || to_char(new.paid_date' in def) = 0 then
    nw := regexp_replace(def,
      'new\.receipt_no\s*:=\s*''A-''[^;]*;',
      'new.receipt_no := ''PAY-'' || to_char(new.paid_date, ''YYYYMM'') || ''-'' || lpad(public.next_counter(''PAYM'' || to_char(new.paid_date, ''YYYYMM''))::text, 4, ''0'');');
    if nw = def then raise exception 'The payment number rule was not found. Send this message to Claude.'; end if;
    execute nw;
  end if;
end $$;

notify pgrst, 'reload schema';

select case when position('''PAY-'' || to_char(new.paid_date' in pg_get_functiondef('public.payments_before_insert()'::regprocedure)) > 0
  then '134 OK - new payments get PAY-YYYYMM-#### numbers' else 'NOT READY - send this message to Claude' end as result;
