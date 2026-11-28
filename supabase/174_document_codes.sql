-- 3.99.403: DOCUMENT CODES. Every paper has its own 3-letter code and the 4-digit year, numbered in order:
--   INV-2026-0001 invoice · ACK-2026-0001 payment received (acknowledgment receipt) · COV-2026-0001 coverage
--   CLN-2026-0001 collection voucher · RPT-2026-0001 credit memo
-- The codes are kept in their own register: the saved records are not changed and their old numbers keep working
-- (search, barcodes, verification). On papers the old number is shown as the new code. Records made before this update get
-- their codes now, in date order. Safe to run again.

create table if not exists public.document_codes (
  kind text not null check (kind in ('INV', 'ACK', 'COV', 'CLN', 'RPT')),
  record_id uuid not null,
  old_no text,
  code text not null unique,
  doc_date date not null,
  created_at timestamptz not null default now(),
  primary key (kind, record_id)
);
create index if not exists document_codes_old on public.document_codes (old_no);
alter table public.document_codes enable row level security;
revoke all on public.document_codes from anon, authenticated;

-- a code for one record (once; the number of its year, in order)
create or replace function private.doc_code(p_kind text, p_id uuid, p_old text, p_date date) returns text
language plpgsql security definer set search_path = '' as $$
declare c text; y text := to_char(coalesce(p_date, (now() at time zone 'Asia/Manila')::date), 'YYYY');
begin
  select code into c from public.document_codes where kind = p_kind and record_id = p_id;
  if c is not null then return c; end if;
  c := p_kind || '-' || y || '-' || lpad(public.next_counter('DC-' || p_kind || '-' || y)::text, 4, '0');
  insert into public.document_codes (kind, record_id, old_no, code, doc_date) values (p_kind, p_id, nullif(trim(coalesce(p_old, '')), ''), c, coalesce(p_date, current_date))
  on conflict (kind, record_id) do nothing;
  return c;
end $$;
revoke execute on function private.doc_code(text, uuid, text, date) from public;

-- a new record gets its code at once
create or replace function public.doc_code_new() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb := to_jsonb(new);
begin
  case tg_table_name
    when 'customer_invoices'   then perform private.doc_code('INV', new.id, j->>'invoice_no', (j->>'invoice_date')::date);
    when 'payments_received'   then perform private.doc_code('ACK', new.id, j->>'receipt_no', (j->>'paid_date')::date);
    when 'order_insurance'     then perform private.doc_code('COV', new.id, j->>'ins_no', ((j->>'created_at')::timestamptz at time zone 'Asia/Manila')::date);
    when 'collection_vouchers' then perform private.doc_code('CLN', new.id, j->>'cv_no', (j->>'cv_date')::date);
    when 'credit_memos'        then perform private.doc_code('RPT', new.id, j->>'memo_no', (j->>'memo_date')::date);
  end case;
  return null;
end $$;
revoke execute on function public.doc_code_new() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['customer_invoices', 'payments_received', 'order_insurance', 'collection_vouchers', 'credit_memos'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists doc_code_new on public.%I', t);
    execute format('create trigger doc_code_new after insert on public.%I for each row execute function public.doc_code_new()', t);
  end loop;
end $$;

-- the records made before: their codes now, in date order
do $$
declare r record;
begin
  for r in select id, invoice_no as n, invoice_date as d from public.customer_invoices order by invoice_date, created_at, id loop
    perform private.doc_code('INV', r.id, r.n, r.d); end loop;
  for r in select id, receipt_no as n, paid_date as d from public.payments_received order by paid_date, created_at, id loop
    perform private.doc_code('ACK', r.id, r.n, r.d); end loop;
  for r in select id, ins_no as n, (created_at at time zone 'Asia/Manila')::date as d from public.order_insurance order by created_at, id loop
    perform private.doc_code('COV', r.id, r.n, r.d); end loop;
  for r in select id, cv_no as n, cv_date as d from public.collection_vouchers order by cv_date, created_at, id loop
    perform private.doc_code('CLN', r.id, r.n, r.d); end loop;
  for r in select id, memo_no as n, memo_date as d from public.credit_memos order by memo_date, created_at, id loop
    perform private.doc_code('RPT', r.id, r.n, r.d); end loop;
end $$;

-- papers: the new codes of the old numbers printed on them
create or replace function public.doc_codes_for(p_numbers text[]) returns table (old_no text, code text)
language sql stable security definer set search_path = '' as $$
  select d.old_no, d.code from public.document_codes d
   where auth.uid() is not null and d.old_no = any (p_numbers[1:300]);
$$;
revoke execute on function public.doc_codes_for(text[]) from public, anon;
grant execute on function public.doc_codes_for(text[]) to authenticated;

-- Verify a Record: a new code gives the old number to check (anyone can verify a paper)
create or replace function public.doc_code_old(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select d.old_no from public.document_codes d where d.code = upper(trim(coalesce(p_code, ''))) limit 1;
$$;
revoke execute on function public.doc_code_old(text) from public;
grant execute on function public.doc_code_old(text) to anon, authenticated;

notify pgrst, 'reload schema';

select '174 OK - document codes: ' || string_agg(kind || ' ' || n, ' · ' order by kind) as result
  from (select kind, count(*) as n from public.document_codes group by kind) x;
