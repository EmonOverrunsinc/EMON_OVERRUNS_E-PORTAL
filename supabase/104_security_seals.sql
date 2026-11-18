-- 3.99.93: SECURITY SEALS. Every printed box (1-box print) and Coverage Certificate gets ONE unique 16-digit seal number
-- (15 random digits + 1 check digit). The seal shows it; anyone can check it on Verify a Record (emonoverruns.online/verify).
-- Safe to run again.

create table if not exists public.security_seals (
  code text primary key check (code ~ '^[0-9]{16}$'),
  kind text not null check (kind in ('box', 'coverage')),
  ref text not null check (char_length(ref) between 1 and 60),
  issued_at timestamptz not null default now(),
  issued_by uuid default auth.uid(),
  unique (kind, ref)
);
alter table public.security_seals enable row level security;
-- no policies: only the two functions below read or write the seals
revoke all on public.security_seals from anon, authenticated;

-- the check digit (Luhn) of the 15 digits: a mistyped digit is found at once
create or replace function public.seal_check_digit(p text) returns int
language sql immutable set search_path = '' as $$
  select (10 - (sum(case when (length(p) - i) % 2 = 0
                         then (substr(p, i, 1)::int * 2) - case when substr(p, i, 1)::int * 2 > 9 then 9 else 0 end
                         else substr(p, i, 1)::int end) % 10)::int) % 10
  from generate_series(1, length(p)) i;
$$;

-- the seal number of a record (made the first time it is printed, the same number every time after)
create or replace function public.seal_issue(p_kind text, p_ref text) returns text
language plpgsql security definer set search_path = '' as $$
declare r text := upper(trim(coalesce(p_ref, ''))); v text; body text;
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Sign in first.'; end if;
  if p_kind = 'box' then
    if not public.is_staff() then raise exception 'Only EMON OVERRUNS staff print boxes.'; end if;
    if not exists (select 1 from public.box_stock b where upper(b.serial_no) = r) then raise exception 'No box %', r; end if;
  elsif p_kind = 'coverage' then
    if not exists (select 1 from public.order_insurance i where upper(i.ins_no) = r) then raise exception 'No certificate %', r; end if;
  else
    raise exception 'Unknown kind';
  end if;
  select s.code into v from public.security_seals s where s.kind = p_kind and s.ref = r;
  if v is not null then return v; end if;
  for n in 1..20 loop
    body := lpad(((('x' || substr(md5(gen_random_uuid()::text), 1, 15))::bit(60)::bigint) % 1000000000000000)::text, 15, '0');
    v := body || public.seal_check_digit(body)::text;
    begin
      insert into public.security_seals (code, kind, ref) values (v, p_kind, r);
      return v;
    exception when unique_violation then
      select s.code into v from public.security_seals s where s.kind = p_kind and s.ref = r;
      if v is not null then return v; end if; -- printed at the same moment on another device
    end;
  end loop;
  raise exception 'Could not make a seal number, try again.';
end $$;

-- anyone: is this a genuine seal? (kind, the record's no, when it was issued; a box also shows what is in it)
create or replace function public.seal_verify(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c text := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g'); s public.security_seals; b public.box_stock;
begin
  if c !~ '^[0-9]{16}$' then return jsonb_build_object('found', false, 'reason', 'format'); end if;
  if public.seal_check_digit(left(c, 15)) <> right(c, 1)::int then return jsonb_build_object('found', false, 'reason', 'check'); end if;
  select * into s from public.security_seals where code = c;
  if not found then return jsonb_build_object('found', false, 'reason', 'none'); end if;
  if s.kind = 'box' then
    select * into b from public.box_stock where upper(serial_no) = s.ref limit 1;
    return jsonb_build_object('found', true, 'kind', s.kind, 'ref', s.ref, 'issued_at', s.issued_at,
      'product', b.product, 'brand', b.brand, 'batch', b.batch, 'pcs', b.qty);
  end if;
  return jsonb_build_object('found', true, 'kind', s.kind, 'ref', s.ref, 'issued_at', s.issued_at);
end $$;

revoke all on function public.seal_issue(text, text) from public, anon;
grant execute on function public.seal_issue(text, text) to authenticated;
revoke all on function public.seal_verify(text) from public;
grant execute on function public.seal_verify(text) to anon, authenticated;
revoke all on function public.seal_check_digit(text) from public, anon, authenticated;

select '104 OK - security seals ready' as result;
