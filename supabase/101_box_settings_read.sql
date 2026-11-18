-- =====================================================================
-- EMON OVERRUNS E-PORTAL - Update 3.99.52: the staff who see customer orders also read two box settings
-- (the COST PER BOX and whether the sheet has a DATE OF ARRIVAL), so their box search shows the same total cost and
-- SHIPPED boxes as the Director's. Only the Director changes them. Safe to run again.
-- =====================================================================
do $$ begin
  if to_regclass('public.ai_settings') is null then raise exception 'Update 3.99.52: the box database is missing (run RUN_050_BOXES_AND_099.sql first).'; end if;
  if to_regprocedure('public.co_can_read()') is null then raise exception 'Update 3.99.52: customer orders are missing (045).'; end if;
end $$;

drop policy if exists "ai settings: staff read box settings" on public.ai_settings;
create policy "ai settings: staff read box settings" on public.ai_settings for select to authenticated
  using (key in ('box_cost', 'box_sheet_read') and (select public.co_can_read()));

select 'UPDATE 3.99.52 READY' as result;
