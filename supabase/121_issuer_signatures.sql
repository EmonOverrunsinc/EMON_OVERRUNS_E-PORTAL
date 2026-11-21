-- 3.99.168: THE ISSUER'S SIGNATURE ON THE DOCUMENTS. A document prints, by itself, the approved signature of the person who
-- made it (Request Created By, Prepared by, Paid by), as it already prints the Director's on the approval side. Signed-in
-- EMON OVERRUNS staff may read only APPROVED signatures, for printing; a signature still waiting for approval stays private.
-- Safe to run again.

-- the approved signatures of some people (their profile ids)
create or replace function public.signatures_of(p_ids uuid[]) returns table (id uuid, full_name text, signature_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.signature_path from public.profiles p
  where p.id = any(coalesce(p_ids, '{}')) and p.signature_status = 'approved' and p.signature_path is not null
    and public.is_active() and (public.is_staff() or public.is_admin());
$$;
revoke execute on function public.signatures_of(uuid[]) from public, anon;
grant execute on function public.signatures_of(uuid[]) to authenticated;

-- is this stored picture an approved signature?
create or replace function public.is_approved_signature(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.signature_status = 'approved' and p.signature_path = p_name);
$$;
revoke execute on function public.is_approved_signature(text) from public, anon;
grant execute on function public.is_approved_signature(text) to authenticated;

-- the signature pictures: the owner, the Director, a Director's approved signature (everyone), and now any approved
-- signature for EMON OVERRUNS staff (to print it on the documents its owner made)
drop policy if exists "storage records: signatures" on storage.objects;
create policy "storage records: signatures" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'records' or coalesce((storage.foldername(name))[1], '') <> 'signature'
         or (storage.foldername(name))[2] = (select auth.uid())::text or (select public.is_admin()) or public.is_director_signature(name)
         or ((select public.is_staff()) and public.is_approved_signature(name)));

notify pgrst, 'reload schema';

select '121 OK - the issuer''s approved signature prints on the documents' as result;
