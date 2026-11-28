-- 3.99.394: TEMPORARY PIN. When the Collection (release) paper of an ID card is printed, a one-time 4-number TEMPORARY PIN is
-- made for the employee and printed on it. At the employee's next sign-in a window opens by itself: type the temporary PIN
-- and a new PIN of their own. Then: "PIN setup has been successful." Needs 170. Safe to run again.

alter table private.employee_pins add column if not exists must_change boolean not null default false;

-- the Director: a new temporary PIN for the card's employee (shown once, on the paper)
create or replace function public.card_temp_pin(p_card uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare e uuid; pin text;
begin
  if not public.is_admin() then raise exception 'Only the Director.'; end if;
  select employee_id into e from public.employee_cards where id = p_card and status = 'active';
  if e is null then raise exception 'This card is not in use.'; end if;
  loop
    pin := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when pin !~ '^([0-9])\1{3}$' and pin not in ('0123', '1234', '2345', '3456', '4567', '5678', '6789', '9876', '8765', '7654', '6543', '5432', '4321', '3210');
  end loop;
  insert into private.employee_pins (employee_id, pin_hash, set_at, must_change) values (e, private.pin_hash(e, pin), now(), true)
  on conflict (employee_id) do update set pin_hash = excluded.pin_hash, set_at = now(), failed = 0, locked_until = null, must_change = true;
  return pin;
end $$;
revoke execute on function public.card_temp_pin(uuid) from public, anon;
grant execute on function public.card_temp_pin(uuid) to authenticated;

-- the signed-in employee: must the temporary PIN be changed?
create or replace function public.my_pin_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('must_change', coalesce(p.must_change, false), 'card_no', c.card_no, 'card_id', c.id)
  from public.employees e
  left join private.employee_pins p on p.employee_id = e.id
  left join public.employee_cards c on c.employee_id = e.id and c.status = 'active'
  where e.profile_id = auth.uid() limit 1;
$$;
revoke execute on function public.my_pin_state() from public, anon;
grant execute on function public.my_pin_state() to authenticated;

-- the employee changes the temporary PIN to their own (5 wrong temporary PINs lock it for 15 minutes)
create or replace function public.change_temp_pin(p_temp text, p_new text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e uuid; pn record; c record;
begin
  select id into e from public.employees where profile_id = auth.uid() and status = 'active';
  if e is null then raise exception 'Only an active employee has an ID card PIN.'; end if;
  select * into pn from private.employee_pins where employee_id = e for update;
  if pn.employee_id is null or not pn.must_change then raise exception 'There is no temporary PIN to change.'; end if;
  if pn.locked_until is not null and pn.locked_until > now() then raise exception 'Too many wrong PINs. Try again after 15 minutes.'; end if;
  if pn.pin_hash is distinct from private.pin_hash(e, p_temp) then
    update private.employee_pins set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' end where employee_id = e;
    return jsonb_build_object('ok', false, 'why', 'The temporary PIN is not right.');
  end if;
  if coalesce(p_new, '') !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'why', 'The new PIN is 4 numbers.'); end if;
  if p_new = p_temp then return jsonb_build_object('ok', false, 'why', 'Choose a new PIN, not the temporary one.'); end if;
  if p_new ~ '^([0-9])\1{3}$' or p_new in ('0123', '1234', '2345', '3456', '4567', '5678', '6789', '9876', '8765', '7654', '6543', '5432', '4321', '3210') then
    return jsonb_build_object('ok', false, 'why', 'This PIN is too easy to guess. Choose another one.');
  end if;
  update private.employee_pins set pin_hash = private.pin_hash(e, p_new), set_at = now(), failed = 0, locked_until = null, must_change = false where employee_id = e;
  select x.card_no, x.id into c from public.employee_cards x where x.employee_id = e and x.status = 'active';
  return jsonb_build_object('ok', true, 'card_no', c.card_no, 'trx', c.id, 'employee_no', (select employee_no from public.employees where id = e));
end $$;
revoke execute on function public.change_temp_pin(text, text) from public, anon;
grant execute on function public.change_temp_pin(text, text) to authenticated;

notify pgrst, 'reload schema';

select '173 OK - temporary PIN on the ID card release paper' as result;
