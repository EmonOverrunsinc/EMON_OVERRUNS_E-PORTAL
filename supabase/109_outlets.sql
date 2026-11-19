-- 3.99.116: OUTLETS (the shops: SHOP-1, SHOP-2 …). Each shop: address, opening / closing hours, monthly rental and its
-- due day, the employees assigned to it, a customer account (its stock comes as orders and invoices like a customer; every
-- payment of that account is taken off the shop's money), the DAILY SALES with the cash breakdown (cash, GCash, Maya,
-- bank, card, other) and a photo of the sales report, and the EXPENSES (rental, supplier, bills, salary, other) that are
-- taken off its net sales. Who may: EMON HASAN, and staff with the new access "14 Outlets". Safe to run again.

create table if not exists public.outlets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) between 1 and 30),
  name text not null check (char_length(name) between 1 and 120),
  address text check (char_length(address) <= 300),
  opens text check (char_length(opens) <= 20),
  closes text check (char_length(closes) <= 20),
  monthly_rent numeric(14,2) not null default 0 check (monthly_rent >= 0),
  rent_day integer check (rent_day between 1 and 31),
  customer_id uuid references public.customers(id) on delete set null,
  notes text check (char_length(notes) <= 1000),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.outlet_staff (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (outlet_id, employee_id)
);

create table if not exists public.outlet_sales (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  sale_date date not null,
  cash numeric(14,2) not null default 0 check (cash >= 0),
  gcash numeric(14,2) not null default 0 check (gcash >= 0),
  maya numeric(14,2) not null default 0 check (maya >= 0),
  bank numeric(14,2) not null default 0 check (bank >= 0),
  card numeric(14,2) not null default 0 check (card >= 0),
  other numeric(14,2) not null default 0 check (other >= 0),
  total numeric(14,2) generated always as (cash + gcash + maya + bank + card + other) stored,
  note text check (char_length(note) <= 500),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (outlet_id, sale_date)
);

create table if not exists public.outlet_expenses (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  exp_date date not null,
  kind text not null check (kind in ('rent', 'supplier', 'bills', 'salary', 'other')),
  payee text check (char_length(payee) <= 120),
  amount numeric(14,2) not null check (amount > 0),
  note text check (char_length(note) <= 500),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists outlet_sales_by_date on public.outlet_sales (outlet_id, sale_date);
create index if not exists outlet_expenses_by_date on public.outlet_expenses (outlet_id, exp_date);

-- who may: read with the Outlets access; add and change with it (staff); remove: EMON HASAN only
do $$
declare t text;
begin
  foreach t in array array['outlets', 'outlet_staff', 'outlet_sales', 'outlet_expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "outlets: read" on public.%I', t);
    execute format('drop policy if exists "outlets: add" on public.%I', t);
    execute format('drop policy if exists "outlets: change" on public.%I', t);
    execute format('drop policy if exists "outlets: remove" on public.%I', t);
    execute format('create policy "outlets: read" on public.%I for select to authenticated using ((select public.has_module(''outlets'')))', t);
    execute format('create policy "outlets: add" on public.%I for insert to authenticated with check ((select public.can_write(''outlets'')))', t);
    execute format('create policy "outlets: change" on public.%I for update to authenticated using ((select public.can_write(''outlets''))) with check ((select public.can_write(''outlets'')))', t);
    execute format('create policy "outlets: remove" on public.%I for delete to authenticated using ((select public.is_admin()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- photos (the shop, a day's sales report, an expense's receipt) in the files of the portal
alter table public.attachments drop constraint if exists attachments_owner_type_check;
alter table public.attachments add constraint attachments_owner_type_check check (owner_type in
  ('customer','invoice','payment','credit_memo','employee','resolution','project','project_payment','supplier','supplier_payment',
   'statement','job_application','payslip','order_letter','pay_company','pay_account','pay_voucher','stock_bill','stock_bill_entry',
   'outlet','outlet_sales','outlet_expense'));

create or replace function public.can_see_kind(p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or case coalesce(p_kind, '')
    when 'customer' then public.has_module('customers') or public.has_module('invoices') or public.has_module('payments') or public.has_module('creditmemos') or public.has_module('eooffice')
    when 'statement' then public.has_module('customers') or public.has_module('invoices') or public.has_module('payments')
    when 'invoice' then public.has_module('invoices') or public.has_module('customers') or public.has_module('payments')
    when 'payment' then public.has_module('payments') or public.has_module('invoices') or public.has_module('customers')
    when 'credit_memo' then public.has_module('creditmemos') or public.has_module('customers') or public.has_module('invoices')
    when 'order_letter' then public.has_module('customers')
    when 'pay_company' then public.has_module('billing')
    when 'pay_account' then public.has_module('billing')
    when 'pay_voucher' then public.has_module('billing')
    when 'supplier' then public.has_module('billing')
    when 'supplier_payment' then public.has_module('billing')
    when 'project' then public.has_module('projects')
    when 'project_payment' then public.has_module('projects')
    when 'stock_bill' then public.has_module('inventory') or public.has_module('billing')
    when 'stock_bill_entry' then public.has_module('inventory') or public.has_module('billing')
    when 'outlet' then public.has_module('outlets')
    when 'outlet_sales' then public.has_module('outlets')
    when 'outlet_expense' then public.has_module('outlets')
    else true end;
$$;
revoke execute on function public.can_see_kind(text) from public, anon;
grant execute on function public.can_see_kind(text) to authenticated;

notify pgrst, 'reload schema';

select '109 OK - outlets ready (' || (select count(*) from public.outlets) || ' shop(s))' as result;
