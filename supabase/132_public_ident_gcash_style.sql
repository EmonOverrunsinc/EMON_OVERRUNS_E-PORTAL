-- 3.99.209: PUBLIC IDENTIFICATION in the GCash style, easy to know who it is but the name stays hidden:
--   EMON HASAN → EM*N H. 267V10 · MARIA CRISTINA DELA CRUZ SANTOS → MA**A S. 421P92 · MD RIPON ISLAM → RI**N I. 504K33
-- (first name: first 2 letters, stars, last letter; "MD" / "MOHAMMAD" is skipped; last name: first letter of its last word;
-- then the same number as before). Every customer gets the new style now; the number part stays the same.
-- It stays unique and locked like before. Each change is written in the customer's history. Needs 129 first. Safe to run again.

-- the name part, e.g. EMON HASAN → EM*N H.
create or replace function public.ident_name(p_first text, p_last text) returns text
language plpgsql immutable set search_path = '' as $$
declare w text[]; f text; l text; n int;
begin
  w := regexp_split_to_array(trim(upper(regexp_replace(coalesce(p_first, ''), '[^A-Za-z ]', ' ', 'g'))), '\s+');
  f := coalesce(w[1], '');
  if coalesce(array_length(w, 1), 0) > 1 and f in ('MD', 'MOHAMMAD', 'MOHAMMED', 'MUHAMMAD', 'MOHAMMOD', 'MOHAMED', 'MOHAMMEED', 'MST', 'MOST') then
    f := w[2];
  end if;
  n := length(f);
  f := case when n <= 2 then f
            when n = 3 then left(f, 1) || '*' || right(f, 1)
            else left(f, 2) || repeat('*', least(n - 3, 3)) || right(f, 1) end;
  l := left(coalesce((regexp_match(trim(upper(regexp_replace(coalesce(p_last, ''), '[^A-Za-z ]', ' ', 'g'))), '(\S+)$'))[1], ''), 1);
  return coalesce(nullif(trim(concat_ws(' ', nullif(f, ''), case when l <> '' then l || '.' end)), ''), 'EO');
end $$;
revoke execute on function public.ident_name(text, text) from public, anon, authenticated;

-- a new customer: name part + a new unique number (3 digits, a letter, 2 digits)
create or replace function public.make_public_ident(p_first text, p_last text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare pre text := public.ident_name(p_first, p_last); v text;
begin
  for n in 1..80 loop
    v := pre || ' ' || lpad((floor(random() * 1000))::int::text, 3, '0') || chr(65 + floor(random() * 26)::int) || lpad((floor(random() * 100))::int::text, 2, '0');
    if not exists (select 1 from public.customers c where c.public_ident = v) then return v; end if;
  end loop;
  raise exception 'Could not make a Public Identification, try again.';
end $$;
revoke execute on function public.make_public_ident(text, text) from public, anon, authenticated;

-- still locked; only this file may change it (its own switch, not the general one)
create or replace function public.customers_public_ident() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.public_ident is null then
    if new.public_ident is null then new.public_ident := public.make_public_ident(new.first_name, new.last_name); end if;
  elsif new.public_ident is distinct from old.public_ident and coalesce(current_setting('eo.ident_change', true), '') <> 'on' then
    new.public_ident := old.public_ident; -- locked
  end if;
  return new;
end $$;
revoke execute on function public.customers_public_ident() from public, anon, authenticated;

-- every customer in the old style (EMH267V10) → the new style, same number
do $$
declare r record; tail text; v text;
begin
  perform set_config('eo.allow_change', 'on', true);
  perform set_config('eo.ident_change', 'on', true);
  for r in select id, first_name, last_name, public_ident from public.customers
           where public_ident ~ '^[A-Z]{3}[0-9]{3}[A-Z][0-9]{2}$' order by created_at loop
    tail := right(r.public_ident, 6);
    v := public.ident_name(r.first_name, r.last_name) || ' ' || tail;
    if exists (select 1 from public.customers c where c.public_ident = v and c.id <> r.id) then
      v := public.make_public_ident(r.first_name, r.last_name);
    end if;
    update public.customers set public_ident = v where id = r.id;
    insert into public.customer_events (customer_id, action, note, actor_name)
    values (r.id, 'PUBLIC IDENTIFICATION NEW STYLE', r.public_ident || ' → ' || v, 'E-PORTAL');
  end loop;
  perform set_config('eo.ident_change', '', true);
  perform set_config('eo.allow_change', '', true);
end $$;

notify pgrst, 'reload schema';

select '132 OK - Public Identification in the new style (example: ' || public.ident_name('EMON', 'HASAN') || ' 267V10)' as result;
