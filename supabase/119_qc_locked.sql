-- 3.99.160: a SUBMITTED QC test is LOCKED: its result, its goods and its notes cannot be changed any more. The paper form
-- (with its sticker) can still be uploaded; only the Director removes an upload (or deletes the QC test). Safe to run again.

do $$
declare def text := pg_get_functiondef('public.qc_save(uuid,jsonb)'::regprocedure);
  a text := '  if not exists (select 1 from public.qc_tests where id = p_id) then raise exception ''QC form not found''; end if;';
begin
  if position('3.99.160' in def) = 0 then
    if position(a in def) = 0 then raise exception 'Update 119: qc_save has changed - send this message to Claude'; end if;
    execute replace(def, a, a || '
  if exists (select 1 from public.qc_tests where id = p_id and status = ''done'') then raise exception ''This QC test is submitted and locked: it cannot be changed''; end if; -- 3.99.160');
  end if;
end $$;

do $$
declare def text := pg_get_functiondef('public.qc_set_docs(uuid,text[])'::regprocedure);
  a text := '  select docs into old from public.qc_results where qc_id = p_id;';
begin
  if position('3.99.160' in def) = 0 then
    if position(a in def) = 0 then raise exception 'Update 119: qc_set_docs has changed - send this message to Claude'; end if;
    execute replace(def, a, a || '
  if not public.is_admin() and exists (select 1 from public.qc_tests where id = p_id and status = ''done'')
     and exists (select 1 from unnest(coalesce(old, ''{}'')) x where x <> all (coalesce(p_docs, ''{}''))) then
    raise exception ''This QC test is locked: only the Director removes an uploaded form''; -- 3.99.160
  end if;');
  end if;
end $$;

notify pgrst, 'reload schema';

select '119 OK - submitted QC tests are locked' as result;
