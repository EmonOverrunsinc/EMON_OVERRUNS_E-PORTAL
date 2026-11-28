-- 3.99.408: OFFICE VOUCHERS (Regional Office Manila). One step makes TWO linked vouchers at once:
--   a COLLECTION VOUCHER (CLN-2026-0001): the money received, PAID
--   a CASH VOUCHER       (CSH-2026-0001): the same money paid out right away
-- Both have the same amount and date and point to each other. Saved vouchers cannot be changed. Needs 024 and 174.
-- Safe to run again.

create table if not exists public.cash_vouchers (
  id uuid primary key default gen_random_uuid(),
  csh_no text not null unique,
  csh_date date not null default ((now() at time zone 'Asia/Manila')::date),
  paid_to text not null,
  amount numeric(14,2) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'bank', 'gcash', 'check', 'other')),
  reference_no text,
  purpose text,
  collection_id uuid references public.collection_vouchers(id) on delete restrict,
  status text not null default 'paid' check (status in ('paid', 'cancelled')),
  cancelled_at timestamptz, cancelled_by_name text, cancel_note text,
  created_by uuid default auth.uid(), created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists cash_vouchers_date on public.cash_vouchers (csh_date desc);
alter table public.cash_vouchers enable row level security;
revoke all on public.cash_vouchers from anon, authenticated;
grant select on public.cash_vouchers to authenticated;
drop policy if exists "cash vouchers: read" on public.cash_vouchers;
create policy "cash vouchers: read" on public.cash_vouchers for select to authenticated
  using ((select public.is_admin()) or ((select public.is_staff()) and (select public.has_module('eooffice'))));

alter table public.collection_vouchers add column if not exists cash_id uuid;

-- the cash voucher code is a document code too
alter table public.document_codes drop constraint if exists document_codes_kind_check;
alter table public.document_codes add constraint document_codes_kind_check check (kind in ('INV', 'ACK', 'COV', 'CLN', 'RPT', 'CSH'));

-- ONE STEP, TWO VOUCHERS
create or replace function public.create_office_pair(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare me text; d date; amt numeric; who_in text; who_out text; m text; cv uuid; cvno text; cs uuid; csno text; ym text; y text;
begin
  if not (public.is_admin() or (public.is_staff() and public.can_write('eooffice'))) then raise exception 'Not allowed.'; end if;
  d := coalesce(nullif(p_data->>'date', '')::date, current_date);
  amt := round(coalesce(nullif(p_data->>'amount', '')::numeric, 0), 2);
  who_in := left(upper(trim(coalesce(p_data->>'received_from', ''))), 120);
  who_out := left(upper(trim(coalesce(p_data->>'paid_to', ''))), 120);
  m := coalesce(nullif(p_data->>'method', ''), 'cash');
  if amt <= 0 then raise exception 'Type the amount.'; end if;
  if who_in = '' then raise exception 'Type who the money is received from.'; end if;
  if who_out = '' then raise exception 'Type who the money is paid to.'; end if;
  if m not in ('cash', 'bank', 'gcash', 'check', 'other') then raise exception 'Choose the method.'; end if;
  select full_name into me from public.profiles where id = auth.uid();
  ym := to_char(d, 'YYYYMM'); y := to_char(d, 'YYYY');
  -- the collection voucher (money in), paid
  insert into public.collection_vouchers (cv_no, cv_date, issued_on, received_from, amount, method, reference_no, note, status, paid_at, paid_by_name, received_by, created_by, created_by_name)
  values ('CV-' || ym || '-' || lpad(public.next_counter('CV' || ym)::text, 3, '0'), d, d, who_in, amt, m, nullif(trim(coalesce(p_data->>'reference_no', '')), ''),
          left(coalesce(nullif(upper(trim(p_data->>'purpose')), ''), 'OFFICE COLLECTION') || ' · PAID OUT TO ' || who_out, 300), 'paid', now(), who_in, left(coalesce(me, ''), 120), auth.uid(), left(coalesce(me, ''), 120))
  returning id, cv_no into cv, cvno;
  -- the cash voucher (money out), the same money
  csno := 'CSH-' || y || '-' || lpad(public.next_counter('DC-CSH-' || y)::text, 4, '0');
  insert into public.cash_vouchers (csh_no, csh_date, paid_to, amount, method, reference_no, purpose, collection_id, created_by_name)
  values (csno, d, who_out, amt, m, nullif(trim(coalesce(p_data->>'reference_no', '')), ''),
          left(coalesce(nullif(upper(trim(p_data->>'purpose')), ''), 'OFFICE PAYMENT') || ' · RECEIVED FROM ' || who_in, 300), cv, left(coalesce(me, ''), 120))
  returning id into cs;
  update public.collection_vouchers set cash_id = cs where id = cv;
  insert into public.document_codes (kind, record_id, old_no, code, doc_date) values ('CSH', cs, null, csno, d) on conflict do nothing;
  return jsonb_build_object('collection_id', cv, 'cv_no', cvno, 'cash_id', cs, 'csh_no', csno,
    'cln', (select code from public.document_codes where kind = 'CLN' and record_id = cv));
end $$;
revoke execute on function public.create_office_pair(jsonb) from public, anon;
grant execute on function public.create_office_pair(jsonb) to authenticated;

notify pgrst, 'reload schema';

select '175 OK - office vouchers (collection + cash voucher together)' as result;
