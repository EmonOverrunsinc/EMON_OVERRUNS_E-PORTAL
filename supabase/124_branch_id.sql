-- 3.99.177: EVERY SHOP GETS A BRANCH ID made by the system: EO- and 8 random digits (EO-4827-1936), not a running number.
-- It is unique, given once and never changed; the shops made before get theirs now. Needs 109 first. Safe to run again.

alter table public.outlets add column if not exists branch_id text;
create unique index if not exists outlets_branch_id_uq on public.outlets (branch_id);

-- a new random Branch ID that no shop has yet
create or replace function public.new_branch_id() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text;
begin
  for n in 1..50 loop
    v := 'EO-' || lpad((floor(random() * 10000))::int::text, 4, '0') || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    if v !~ '^EO-0000-' and not exists (select 1 from public.outlets o where o.branch_id = v) then return v; end if;
  end loop;
  raise exception 'Could not make a Branch ID, try again.';
end $$;
revoke execute on function public.new_branch_id() from public, anon, authenticated;

-- given by the system when the shop is made, and never changed after
create or replace function public.outlets_branch_id() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.branch_id := public.new_branch_id();
  elsif new.branch_id is distinct from old.branch_id then new.branch_id := old.branch_id; -- locked
  end if;
  return new;
end $$;
revoke execute on function public.outlets_branch_id() from public, anon, authenticated;
drop trigger if exists outlets_branch_id on public.outlets;

-- the shops made before: their Branch ID now (before the lock is switched on)
do $$
declare r record;
begin
  for r in select id from public.outlets where branch_id is null loop
    update public.outlets set branch_id = public.new_branch_id() where id = r.id;
  end loop;
end $$;

create trigger outlets_branch_id before insert or update on public.outlets
  for each row execute function public.outlets_branch_id();

notify pgrst, 'reload schema';

select code || ' = ' || branch_id as result from public.outlets order by code;
