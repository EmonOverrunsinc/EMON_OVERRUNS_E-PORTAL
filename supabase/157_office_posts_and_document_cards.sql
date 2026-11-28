begin;
create table if not exists private.office_director_posts (
  id uuid primary key default gen_random_uuid(),
  office text not null check (office in ('manila','dhaka')),
  employee_id uuid not null references public.employees(id),
  appointed_by uuid not null references public.profiles(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz
);
create unique index if not exists office_one_director_post on private.office_director_posts(office) where ends_at is null;

create or replace function public.office_director_post(p_office text)
returns table(id uuid, full_name text, card_no text, job_position text, since timestamptz)
language sql stable security definer set search_path='' as $$
 select e.id,trim(concat_ws(' ',e.first_name,e.last_name)),c.card_no,e.position,h.starts_at
 from private.office_director_posts h join public.employees e on e.id=h.employee_id
 left join public.employee_cards c on c.employee_id=e.id and c.status='active'
 where public.is_active() and (public.is_staff() or public.is_admin()) and h.office=p_office and h.ends_at is null
$$;
create or replace function public.set_office_director_post(p_office text,p_employee uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_active() and public.is_admin(),false) then raise exception 'Only the Director can change this post.'; end if;
 if p_office not in ('manila','dhaka') or p_office is null then raise exception 'Unknown office'; end if;
 perform pg_advisory_xact_lock(hashtext('office-post:'||p_office));
 if not exists(select 1 from public.employees where id=p_employee and status='active') then raise exception 'Choose an active employee.'; end if;
 if exists(select 1 from private.office_director_posts where office=p_office and employee_id=p_employee and ends_at is null) then return; end if;
 update private.office_director_posts set ends_at=clock_timestamp() where office=p_office and ends_at is null;
 insert into private.office_director_posts(office,employee_id,appointed_by,starts_at) values(p_office,p_employee,auth.uid(),clock_timestamp());
end $$;
create or replace function public.document_people(p_numbers text[],p_profiles uuid[])
returns table(employee_no text,profile_id uuid,card_no text,full_name text,job_position text,is_director boolean,posts jsonb)
language sql stable security definer set search_path='' as $$
 select e.employee_no,e.profile_id,c.card_no,trim(concat_ws(' ',e.first_name,e.last_name)),e.position,p.role='admin',
 coalesce((select jsonb_agg(jsonb_build_array(h.starts_at,h.ends_at)) from private.office_director_posts h where h.employee_id=e.id),'[]'::jsonb)
 from public.employees e left join public.profiles p on p.id=e.profile_id
 left join public.employee_cards c on c.employee_id=e.id and c.status='active'
 where public.is_active() and (public.is_staff() or public.is_admin() or e.profile_id=auth.uid())
 and (e.employee_no=any(p_numbers) or e.profile_id=any(p_profiles))
$$;
revoke all on function public.office_director_post(text),public.set_office_director_post(text,uuid),public.document_people(text[],uuid[]) from public,anon;
grant execute on function public.office_director_post(text),public.set_office_director_post(text,uuid),public.document_people(text[],uuid[]) to authenticated;
create table if not exists private.document_prints (
  id uuid primary key default gen_random_uuid(), issued_by uuid not null, issued_at timestamptz not null default now()
);
create or replace function public.issue_document_trx() returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 if not coalesce(public.is_active(),false) then raise exception 'Active account required'; end if;
 insert into private.document_prints(issued_by) values(auth.uid()) returning id into v;
 return v;
end $$;
create or replace function public.document_trx_date(p_id uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select issued_at from private.document_prints where id=p_id
$$;
revoke all on function public.issue_document_trx(),public.document_trx_date(uuid) from public;
grant execute on function public.issue_document_trx() to authenticated;
grant execute on function public.document_trx_date(uuid) to authenticated,anon;
notify pgrst,'reload schema';
commit;
