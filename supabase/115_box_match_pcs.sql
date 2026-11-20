-- 3.99.144: a scanned box that fits no order line by code / batch no / product goes to the order line with the SAME PCS
-- per box, then the line with the same batch no, then the line with the same code. So it is no longer NOT ORDERED: the
-- line shows the pcs to adjust and the invoice is charged as scanned. Needs 064 first. Safe to run again.

do $$
declare def text := pg_get_functiondef('public.co_delivered(uuid)'::regprocedure);
  a text := '          else 9 end as rk';
  b text := '          when bx.pcs > 0 and ln.nbox > 0 and ln.qty / ln.nbox = bx.pcs then 5 -- 3.99.144: the same pcs per box
          when bx.lot <> '''' and ln.lot = bx.lot then 6 -- the same batch no (another code)
          when bx.code <> '''' and ln.code = bx.code then 7 -- the same code (another batch no)
          else 9 end as rk';
begin
  if position('3.99.144' in def) = 0 then
    if position(a in def) = 0 then raise exception 'Update 115: co_delivered has changed - send this message to Claude'; end if;
    execute replace(def, a, b);
  end if;
end $$;

notify pgrst, 'reload schema';

select '115 OK - a box is matched by its pcs and batch no' as result;
