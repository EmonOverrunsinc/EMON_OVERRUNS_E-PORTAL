-- 3.99.199: PUBLIC IDENTIFICATION. Every customer gets a code made by the server from the name, like EMON HASAN → EMH267V10
-- (2 letters of the first name, 1 of the last name, 3 digits, a letter, 2 digits). It is unique, given once and never changed
-- (like the account no); the customers made before get theirs now. It is printed in the security line of the customer's papers.
-- HIDE IDENTITY: when it is ON for a customer, the printed / downloaded papers and the Verify page show the Public
-- Identification instead of the real name (the portal screens stay the same).
-- THE CUSTOMER PORTAL IS CLOSED: customers can no longer sign in with the Public ID and the Private PIN.
-- Needs 074 and 065 first. Safe to run again.

alter table public.customers add column if not exists public_ident text;
alter table public.customers add column if not exists hide_identity boolean not null default false;
create unique index if not exists customers_public_ident_uq on public.customers (public_ident);

create or replace function public.make_public_ident(p_first text, p_last text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare f text := upper(regexp_replace(coalesce(p_first, ''), '[^A-Za-z]', '', 'g')); l text := upper(regexp_replace(coalesce(p_last, ''), '[^A-Za-z]', '', 'g'));
  pre text; v text;
begin
  pre := rpad(left(f, 2) || left(l, 1), 3, 'X');
  for n in 1..80 loop
    v := pre || lpad((floor(random() * 1000))::int::text, 3, '0') || chr(65 + floor(random() * 26)::int) || lpad((floor(random() * 100))::int::text, 2, '0');
    if not exists (select 1 from public.customers c where c.public_ident = v) then return v; end if;
  end loop;
  raise exception 'Could not make a Public Identification, try again.';
end $$;
revoke execute on function public.make_public_ident(text, text) from public, anon, authenticated;

create or replace function public.customers_public_ident() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.public_ident is null then
    if new.public_ident is null then new.public_ident := public.make_public_ident(new.first_name, new.last_name); end if;
  elsif new.public_ident is distinct from old.public_ident then
    new.public_ident := old.public_ident; -- locked
  end if;
  return new;
end $$;
revoke execute on function public.customers_public_ident() from public, anon, authenticated;
drop trigger if exists customers_public_ident on public.customers;

-- the customers made before: their Public Identification now (before the lock is switched on)
do $$
declare r record;
begin
  perform set_config('eo.allow_change', 'on', true);
  for r in select id, first_name, last_name from public.customers where public_ident is null loop
    update public.customers set public_ident = public.make_public_ident(r.first_name, r.last_name) where id = r.id;
  end loop;
  perform set_config('eo.allow_change', '', true);
end $$;

create trigger customers_public_ident before insert or update on public.customers
  for each row execute function public.customers_public_ident();

-- HIDE IDENTITY on the papers: EMON HASAN or staff who may change customers; written in the customer's history
create or replace function public.customer_hide_identity(p_customer uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare who text := (select p.full_name from public.profiles p where p.id = auth.uid());
begin
  if not (public.is_admin() or (public.is_active() and public.can_write('customers'))) then
    raise exception 'Only EMON HASAN or staff who may change customers can do this.';
  end if;
  perform set_config('eo.allow_change', 'on', true);
  update public.customers set hide_identity = coalesce(p_on, false) where id = p_customer;
  if not found then raise exception 'Customer not found.'; end if;
  insert into public.customer_events (customer_id, action, note, actor, actor_name)
  values (p_customer, case when p_on then 'IDENTITY HIDDEN ON PAPERS' else 'IDENTITY SHOWN ON PAPERS' end,
          case when p_on then 'Printed and downloaded papers show the Public Identification instead of the name.' else 'Printed and downloaded papers show the name again.' end,
          auth.uid(), who);
  perform set_config('eo.allow_change', '', true);
end $$;
revoke execute on function public.customer_hide_identity(uuid, boolean) from public, anon;
grant execute on function public.customer_hide_identity(uuid, boolean) to authenticated;

-- THE CUSTOMER PORTAL IS CLOSED (every portal function checks the sign-in first)
create or replace function public.cust_signin_check(p_public text, p_pin text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error', 'The customer portal is closed. Please contact the office of EMON OVERRUNS.');
$$;
revoke execute on function public.cust_signin_check(text, text) from public, anon, authenticated;

-- THE VERIFY PAGE: a customer with HIDE IDENTITY shows the Public Identification instead of the name
create or replace function public.verify_hide_names(r jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.customers; fld jsonb; out jsonb := '[]'::jsonb; v text; full_name text;
begin
  if r is null or r -> 'fields' is null then return r; end if;
  select cu.* into c from jsonb_array_elements(r -> 'fields') f
    join public.customers cu on upper(cu.account_no) = upper(trim(f ->> 1)) or (cu.public_id is not null and upper(cu.public_id) = upper(trim(f ->> 1)))
  limit 1;
  if c.id is null or not c.hide_identity then return r; end if;
  full_name := trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''));
  for fld in select * from jsonb_array_elements(r -> 'fields') loop
    v := fld ->> 1;
    if v is not null and (v ilike '%' || coalesce(c.first_name, '~') || '%' and v ilike '%' || coalesce(c.last_name, '~') || '%') then
      fld := jsonb_build_array(fld ->> 0, c.public_ident);
    elsif fld ->> 0 ~* '^public id$' then
      fld := jsonb_build_array('Public Identification', c.public_ident);
    end if;
    out := out || jsonb_build_array(fld);
  end loop;
  r := jsonb_set(r, '{fields}', out);
  if r ? 'title' and (r ->> 'title') ilike '%' || coalesce(c.last_name, '~') || '%' then r := jsonb_set(r, '{title}', to_jsonb(c.public_ident)); end if;
  return r;
end $$;
revoke execute on function public.verify_hide_names(jsonb) from public, anon, authenticated;

create or replace function public.verify_record(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone to 'Asia/Manila' as $$
declare r jsonb := public.verify_hide_names(public.verify_record_full(p_code)); pid text;
begin
  if r is null or not coalesce((r ->> 'found')::boolean, false) or public.is_active() then return r; end if;
  if r ->> 'type' in ('E-Bill', 'E-Bill Statistics', 'Stock-Bill Statistics') then return r; end if;
  if r ->> 'type' = 'Customer Account' then
    select f ->> 1 into pid from jsonb_array_elements(coalesce(r -> 'fields', '[]'::jsonb)) f where f ->> 0 = 'Public ID' limit 1;
    if pid is not null and position(upper(replace(pid, '-', '')) in upper(replace(coalesce(p_code, ''), '-', ''))) > 0 then return r; end if;
  end if;
  return jsonb_build_object('found', true, 'limited', true, 'type', r ->> 'type', 'number', r ->> 'number', 'status', r ->> 'status',
    'fields', coalesce((select jsonb_agg(f) from jsonb_array_elements(coalesce(r -> 'fields', '[]'::jsonb)) f
      where f ->> 0 ~* '(\mno|date|period|status|type|opened)$' and f ->> 0 !~* '(account|customer|employee|reference|bill no|public)'), '[]'::jsonb));
end;
$$;
revoke execute on function public.verify_record(text) from public;
grant execute on function public.verify_record(text) to anon, authenticated;

notify pgrst, 'reload schema';

select '129 OK - Public Identification for ' || (select count(*) from public.customers where public_ident is not null) || ' customer(s) · customer portal closed' as result;
