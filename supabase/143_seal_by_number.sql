-- 3.99.240: EVERY STICKER SHOWS ITS OWN NUMBER (box serial no, QC no, ID card no, invoice no …) instead of the 16-digit
-- seal code. The Verify page checks such a number too: the seal of that number is found and shown as GENUINE SEAL.
-- Needs 104 and 105 first. Safe to run again.

create or replace function public.seal_by_ref(p_ref text) returns text
language sql stable security definer set search_path = '' as $$
  select s.code from public.security_seals s
  where upper(s.ref) = upper(btrim(coalesce(p_ref, ''))) and char_length(btrim(coalesce(p_ref, ''))) between 3 and 60
  order by s.issued_at desc limit 1;
$$;
revoke execute on function public.seal_by_ref(text) from public;
grant execute on function public.seal_by_ref(text) to anon, authenticated;

notify pgrst, 'reload schema';

select '143 OK - sticker numbers can be checked on the Verify page' as result;
