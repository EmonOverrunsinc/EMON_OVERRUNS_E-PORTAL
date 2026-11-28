-- 164: DELETED USERS CAN BE OPENED AND DELETED IN SUPABASE AGAIN.
-- When a person is deleted in the portal but kept records still point to them, the login was blocked with
-- banned_until = 'infinity'. Supabase cannot read that date: Authentication > Users says "Database error loading user".
-- This gives those logins a far date instead (still blocked), and the portal's delete step uses the same date from now on.
-- Safe to run again.

update auth.users set banned_until = timestamptz '2999-12-31 00:00:00+00' where banned_until = 'infinity';

do $$
declare def text;
begin
  def := pg_get_functiondef('public.delete_user_account(uuid)'::regprocedure);
  if position('''infinity''' in def) > 0 then
    execute replace(def, '''infinity''', '''2999-12-31 00:00:00+00''');
  end if;
end $$;

select '164 OK - deleted users can be opened in Supabase; ' || (select count(*) from auth.users where banned_until = 'infinity') || ' left with infinity' as result;
