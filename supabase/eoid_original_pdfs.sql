-- Private original employee ID PDFs. Run after 032_employee_id.sql.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eoid-originals','eoid-originals',false,20971520,array['application/pdf'])
on conflict (id) do update set public=false, file_size_limit=20971520, allowed_mime_types=array['application/pdf'];
drop policy if exists "EOID original read" on storage.objects;
create policy "EOID original read" on storage.objects for select to authenticated using (
 bucket_id='eoid-originals' and (public.is_admin() or exists (
 select 1 from public.employee_cards c join public.employees e on e.id=c.employee_id
 where storage.objects.name=c.card_no || '.pdf' and c.status='active' and c.valid_until>=current_date and e.profile_id=auth.uid()
 )));
drop policy if exists "EOID original insert" on storage.objects;
create policy "EOID original insert" on storage.objects for insert to authenticated with check (
 bucket_id='eoid-originals' and public.is_admin() and exists (select 1 from public.employee_cards c where storage.objects.name=c.card_no || '.pdf' and c.status='active'));
drop policy if exists "EOID original update" on storage.objects;
create policy "EOID original update" on storage.objects for update to authenticated using (bucket_id='eoid-originals' and public.is_admin()) with check (
 bucket_id='eoid-originals' and public.is_admin() and exists (select 1 from public.employee_cards c where storage.objects.name=c.card_no || '.pdf' and c.status='active'));
commit;
