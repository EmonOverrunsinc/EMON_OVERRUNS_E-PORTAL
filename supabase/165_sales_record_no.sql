-- 3.99.375: THE SALES RECORD NO IS THE SHOP CODE + THE DATE: SHOP-1-20261119 (was DSR-SHOP1-20261119).
-- The Verify page finds both: the new numbers and the papers printed before. Needs 139. Safe to run again.

create or replace function public.dsr_no(p_sale uuid) returns text
language sql stable security definer set search_path = '' as $$
  select upper(coalesce(o.code, '')) || '-' || to_char(s.sale_date, 'YYYYMMDD')
  from public.outlet_sales s join public.outlets o on o.id = s.outlet_id where s.id = p_sale;
$$;
revoke execute on function public.dsr_no(uuid) from public, anon, authenticated;

create or replace function public.verify_dsr(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m text[]; s record; staff boolean := coalesce(public.is_active() and (public.is_staff() or public.is_admin()), false);
begin
  -- SHOP-1-20261119 (new) or DSR-SHOP1-20261119 (printed before); the shop code is compared without its hyphens
  m := regexp_match(upper(trim(coalesce(p_code, ''))), '^(?:DSR-)?([A-Z0-9-]+?)-(\d{8})$');
  if m is null then return jsonb_build_object('found', false); end if;
  select x.*, o.code as o_code, o.name as o_name into s
  from public.outlet_sales x join public.outlets o on o.id = x.outlet_id
  where regexp_replace(upper(coalesce(o.code, '')), '[^A-Z0-9]', '', 'g') = regexp_replace(m[1], '[^A-Z0-9]', '', 'g')
    and x.sale_date = to_date(m[2], 'YYYYMMDD') limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'type', 'Daily Sales Report', 'number', upper(s.o_code) || '-' || to_char(s.sale_date, 'YYYYMMDD'), 'status', 'recorded', 'limited', not staff,
    'fields', jsonb_build_array(
      jsonb_build_array('Sales Record No', upper(s.o_code) || '-' || to_char(s.sale_date, 'YYYYMMDD')),
      jsonb_build_array('Outlet', s.o_code || case when s.o_name is not null and s.o_name <> s.o_code then ' · ' || s.o_name else '' end),
      jsonb_build_array('Sales Date', to_char(s.sale_date, 'FMMonth DD YYYY')),
      jsonb_build_array('Recorded By', coalesce(s.created_by_name, '')),
      jsonb_build_array('Recorded On', to_char(s.created_at at time zone 'Asia/Manila', 'FMMonth DD YYYY'))
    ) || case when staff then jsonb_build_array(jsonb_build_array('Total Sales', 'PHP ' || to_char(coalesce(s.total, 0), 'FM999,999,999,990.00'))) else '[]'::jsonb end);
end $$;
revoke execute on function public.verify_dsr(text) from public;
grant execute on function public.verify_dsr(text) to anon, authenticated;

notify pgrst, 'reload schema';

select '165 OK - sales record no SHOP-1-20261119' as result;
