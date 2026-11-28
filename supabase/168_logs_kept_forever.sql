-- 3.99.386: LOGS ARE KEPT FOREVER. No one can delete or change a log line: not staff, not the Director, not the portal.
-- Logs: customer history (customer_events), record changes, stock bill history, order tracking, transfer history,
-- issued numbers, AI gate log, legal acceptances / rejections, document verification log.
--  * a log line cannot be deleted, and a log table cannot be emptied (TRUNCATE)
--  * a log line cannot be edited (only the transfer's "accepted" time may be filled in once)
--  * deleting a customer, an order, a stock bill, an employee or a login no longer deletes their log lines
--  * the Director's "delete history line" is switched off
-- Postgres already compresses long text in these tables by itself; the size of each log is shown at the end.
-- Safe to run again.

-- 1) the guard: no delete, no edit (only the columns named in the trigger may change, and only from empty)
create or replace function public.keep_log_row() returns trigger
language plpgsql set search_path = '' as $$
declare k text; o jsonb; n jsonb;
begin
  if tg_op = 'TRUNCATE' or tg_op = 'DELETE' then
    raise exception 'Logs are kept permanently. No one can delete them.' using errcode = '42501';
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  for k in select key from jsonb_each(n) loop
    if (o -> k) is distinct from (n -> k) then
      -- allowed: a column named in the trigger, filled in once (from empty)
      if k = any (tg_argv) and (o -> k) = 'null'::jsonb then continue; end if;
      -- allowed: a link cleared because the linked record was deleted (on delete set null)
      if (n -> k) = 'null'::jsonb and k <> 'id' and exists (
          select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
           where c.conrelid = tg_relid and c.contype = 'f' and c.confdeltype = 'n' and a.attname = k) then continue; end if;
      raise exception 'Logs are kept permanently. No one can change them.' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.keep_log_row() from public, anon, authenticated;

do $$
declare
  t text; arg text; c record;
  logs text[][] := array[
    ['customer_events', ''], ['record_changes', ''], ['stock_bill_events', ''], ['order_tracking', ''],
    ['employee_transfers', 'accepted_at'], ['issued_numbers', ''], ['ai_gate_log', ''],
    ['legal_acceptances', ''], ['legal_rejections', ''], ['verification_log', '']];
  i int;
begin
  for i in 1 .. array_length(logs, 1) loop
    t := logs[i][1]; arg := logs[i][2];
    if to_regclass('public.' || t) is null then continue; end if;
    -- 2) a deleted customer / order / bill / employee / login no longer takes its log lines with it:
    --    the link to it is kept as a plain number (no cascade); ai_gate_log keeps its link to customers (the AI page
    --    reads the name through it) but only clears it
    for c in select con.conname, a.attname, con.confdeltype from pg_constraint con
               join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
              where con.conrelid = ('public.' || t)::regclass and con.contype = 'f' and con.confdeltype <> 'n' loop
      if t = 'ai_gate_log' and c.attname = 'customer_id' then
        execute format('alter table public.%I alter column %I drop not null', t, c.attname);
        execute format('alter table public.%I drop constraint %I', t, c.conname);
        execute format('alter table public.%I add constraint %I foreign key (%I) references public.customers(id) on delete set null', t, c.conname, c.attname);
      else
        execute format('alter table public.%I drop constraint %I', t, c.conname);
      end if;
    end loop;
    -- 3) the guard on every log table
    execute format('drop trigger if exists keep_log_row on public.%I', t);
    execute format('create trigger keep_log_row before update or delete on public.%I for each row execute function public.keep_log_row(%s)',
                   t, case when arg = '' then '' else quote_literal(arg) end);
    execute format('drop trigger if exists keep_log_truncate on public.%I', t);
    execute format('create trigger keep_log_truncate before truncate on public.%I for each statement execute function public.keep_log_row()', t);
    -- no one may delete or empty them from the app either
    execute format('revoke delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 4) the Director's "delete history line" is switched off
create or replace function public.delete_history_line(p_source text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'History is kept permanently. No one can delete it.';
end $$;
revoke execute on function public.delete_history_line(text, bigint) from public, anon;
grant execute on function public.delete_history_line(text, bigint) to authenticated;

-- 5) deleting a record keeps its change log (it used to remove it)
do $$
declare def text;
begin
  if to_regprocedure('public.delete_record(text,uuid)') is null then return; end if;
  def := pg_get_functiondef('public.delete_record(text,uuid)'::regprocedure);
  if position('delete from public.record_changes where target_table = p_table and target_id = p_id;' in def) > 0 then
    execute replace(def, 'delete from public.record_changes where target_table = p_table and target_id = p_id;', '-- 168: the change log is kept');
  end if;
end $$;

notify pgrst, 'reload schema';

-- the size of the logs (Postgres compresses long text by itself), and what still stops a login being deleted in Supabase
select '168 OK - logs kept forever: ' || string_agg(format('%s %s', c.relname, pg_size_pretty(pg_total_relation_size(c.oid))), ' · ' order by c.relname) as result
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
 where s.nspname = 'public' and c.relname in ('customer_events', 'record_changes', 'stock_bill_events', 'order_tracking', 'employee_transfers',
                                              'issued_numbers', 'ai_gate_log', 'legal_acceptances', 'legal_rejections', 'verification_log')
union all
select 'LOGIN DELETE BLOCKED BY: ' || coalesce(string_agg(format('%s.%s', con.conrelid::regclass, a.attname), ', ' order by 1), 'nothing')
  from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
 where con.contype = 'f' and con.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass) and con.confdeltype in ('a', 'r');
