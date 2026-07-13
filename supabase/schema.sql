create extension if not exists pgcrypto;

create sequence if not exists sale_code_seq start 1;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  description text not null unique,
  sale_price numeric(12,2) not null check (sale_price >= 0),
  sale_quantity numeric(12,3) not null check (sale_quantity > 0),
  stock_quantity numeric(12,3) not null default 0 check (stock_quantity >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  sale_code text not null unique default ('PED-' || lpad(nextval('sale_code_seq')::text, 6, '0')),
  customer_id uuid not null references customers(id),
  order_date date not null default current_date,
  delivered boolean not null default false,
  sale_date timestamptz not null default timezone('utc', now()),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  gross_amount numeric(12,2) not null default 0,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  description text not null,
  reference_quantity numeric(12,3) not null check (reference_quantity > 0),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,4) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_sales_customer_id on sales(customer_id);
create index if not exists idx_sales_order_date on sales(order_date);
create index if not exists idx_sales_delivered on sales(delivered);
create index if not exists idx_sales_paid_amount on sales(paid_amount);
create index if not exists idx_sale_items_sale_id on sale_items(sale_id);

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at
before update on customers
for each row
execute function set_updated_at();

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
before update on products
for each row
execute function set_updated_at();

drop trigger if exists trg_sales_updated_at on sales;
create trigger trg_sales_updated_at
before update on sales
for each row
execute function set_updated_at();

create or replace function create_sale(
  p_customer_id uuid,
  p_order_date date default current_date,
  p_delivered boolean default false,
  p_paid_amount numeric(12,2) default 0,
  p_items jsonb default '[]'::jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer customers%rowtype;
  v_item jsonb;
  v_product products%rowtype;
  v_sale_id uuid;
  v_quantity numeric(12,3);
  v_unit_price numeric(12,4);
  v_gross_amount numeric(12,2) := 0;
  v_discount_amount numeric(12,2) := 0;
  v_total_amount numeric(12,2) := 0;
  v_line_total numeric(12,2);
begin
  if p_customer_id is null then
    raise exception 'Informe o cliente da encomenda.';
  end if;

  if p_order_date is null then
    raise exception 'Informe a data da encomenda.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um item para a encomenda.';
  end if;

  select *
  into v_customer
  from customers
  where id = p_customer_id;

  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  insert into sales (
    customer_id,
    order_date,
    delivered,
    paid_amount,
    discount_percent,
    notes
  )
  values (
    p_customer_id,
    p_order_date,
    coalesce(p_delivered, false),
    greatest(coalesce(p_paid_amount, 0), 0),
    v_customer.discount_percent,
    nullif(trim(p_notes), '')
  )
  returning id into v_sale_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_quantity := nullif(trim(v_item ->> 'quantity'), '')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida informada para um dos itens.';
    end if;

    select *
    into v_product
    from products
    where id = (v_item ->> 'product_id')::uuid
    for update;

    if not found then
      raise exception 'Produto não encontrado para um dos itens.';
    end if;

    if v_product.sale_quantity <= 0 then
      raise exception 'A quantidade de venda do produto % deve ser maior que zero.', v_product.description;
    end if;

    v_unit_price := round((v_product.sale_price / v_product.sale_quantity)::numeric, 4);
    v_line_total := round((v_unit_price * v_quantity)::numeric, 2);
    v_gross_amount := v_gross_amount + v_line_total;

    insert into sale_items (
      sale_id,
      product_id,
      description,
      reference_quantity,
      quantity,
      unit_price,
      line_total
    )
    values (
      v_sale_id,
      v_product.id,
      v_product.description,
      v_product.sale_quantity,
      v_quantity,
      v_unit_price,
      v_line_total
    );

  end loop;

  v_discount_amount := round((v_gross_amount * (v_customer.discount_percent / 100))::numeric, 2);
  v_total_amount := round((v_gross_amount - v_discount_amount)::numeric, 2);

  if coalesce(p_paid_amount, 0) > v_total_amount then
    raise exception 'O valor pago não pode ser maior que o total da encomenda.';
  end if;

  update sales
  set
    paid_amount = coalesce(p_paid_amount, 0),
    gross_amount = v_gross_amount,
    discount_amount = v_discount_amount,
    total_amount = v_total_amount
  where id = v_sale_id;

  return v_sale_id;
end;
$$;

create or replace function mark_sale_paid(
  p_sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sale_id is null then
    raise exception 'Informe a encomenda.';
  end if;

  update sales
  set
    paid_amount = total_amount,
    delivered = true
  where id = p_sale_id;

  if not found then
    raise exception 'Encomenda não encontrada.';
  end if;
end;
$$;

create or replace function update_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_order_date date default current_date,
  p_delivered boolean default false,
  p_paid_amount numeric(12,2) default 0,
  p_items jsonb default '[]'::jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer customers%rowtype;
  v_item jsonb;
  v_product products%rowtype;
  v_existing_item record;
  v_quantity numeric(12,3);
  v_unit_price numeric(12,4);
  v_gross_amount numeric(12,2) := 0;
  v_discount_amount numeric(12,2) := 0;
  v_total_amount numeric(12,2) := 0;
  v_line_total numeric(12,2);
begin
  if p_sale_id is null then
    raise exception 'Informe a encomenda.';
  end if;

  if p_customer_id is null then
    raise exception 'Informe o cliente da encomenda.';
  end if;

  if p_order_date is null then
    raise exception 'Informe a data da encomenda.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um item para a encomenda.';
  end if;

  if not exists (
    select 1
    from sales
    where id = p_sale_id
  ) then
    raise exception 'Encomenda não encontrada.';
  end if;

  select *
  into v_customer
  from customers
  where id = p_customer_id;

  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  delete from sale_items
  where sale_id = p_sale_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_quantity := nullif(trim(v_item ->> 'quantity'), '')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade inválida informada para um dos itens.';
    end if;

    select *
    into v_product
    from products
    where id = (v_item ->> 'product_id')::uuid
    for update;

    if not found then
      raise exception 'Produto não encontrado para um dos itens.';
    end if;

    if v_product.sale_quantity <= 0 then
      raise exception 'A quantidade de venda do produto % deve ser maior que zero.', v_product.description;
    end if;

    v_unit_price := round((v_product.sale_price / v_product.sale_quantity)::numeric, 4);
    v_line_total := round((v_unit_price * v_quantity)::numeric, 2);
    v_gross_amount := v_gross_amount + v_line_total;

    insert into sale_items (
      sale_id,
      product_id,
      description,
      reference_quantity,
      quantity,
      unit_price,
      line_total
    )
    values (
      p_sale_id,
      v_product.id,
      v_product.description,
      v_product.sale_quantity,
      v_quantity,
      v_unit_price,
      v_line_total
    );

  end loop;

  v_discount_amount := round((v_gross_amount * (v_customer.discount_percent / 100))::numeric, 2);
  v_total_amount := round((v_gross_amount - v_discount_amount)::numeric, 2);

  if coalesce(p_paid_amount, 0) > v_total_amount then
    raise exception 'O valor pago não pode ser maior que o total da encomenda.';
  end if;

  update sales
  set
    customer_id = p_customer_id,
    order_date = p_order_date,
    delivered = coalesce(p_delivered, false),
    paid_amount = coalesce(p_paid_amount, 0),
    discount_percent = v_customer.discount_percent,
    gross_amount = v_gross_amount,
    discount_amount = v_discount_amount,
    total_amount = v_total_amount,
    notes = nullif(trim(p_notes), '')
  where id = p_sale_id;

  return p_sale_id;
end;
$$;

create or replace function delete_sale(
  p_sale_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sale_id is null then
    raise exception 'Informe a encomenda.';
  end if;

  if not exists (
    select 1
    from sales
    where id = p_sale_id
  ) then
    raise exception 'Encomenda não encontrada.';
  end if;

  delete from sales
  where id = p_sale_id;
end;
$$;

drop view if exists vw_customer_open_balances;
drop view if exists vw_open_sales;

create view vw_open_sales as
select
  s.id as sale_id,
  s.sale_code,
  s.customer_id,
  c.name as customer_name,
  s.order_date,
  s.delivered,
  s.sale_date,
  s.paid_amount,
  s.total_amount,
  greatest(s.total_amount - s.paid_amount, 0) as open_amount,
  string_agg(
    concat(
      trim(to_char(si.quantity, 'FM999999990.###')),
      ' de ',
      si.description
    ),
    ', '
    order by si.description
  ) as items_summary
from sales s
join customers c on c.id = s.customer_id
join sale_items si on si.sale_id = s.id
where s.total_amount > s.paid_amount
group by s.id, s.sale_code, s.customer_id, c.name, s.order_date, s.delivered, s.sale_date, s.paid_amount, s.total_amount;

create view vw_customer_open_balances as
select
  s.customer_id,
  c.name as customer_name,
  count(*) as open_orders,
  sum(greatest(s.total_amount - s.paid_amount, 0)) as total_open_amount
from sales s
join customers c on c.id = s.customer_id
where s.total_amount > s.paid_amount
group by s.customer_id, c.name;

alter table customers enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;

drop policy if exists customers_full_access on customers;
create policy customers_full_access
on customers
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists products_full_access on products;
create policy products_full_access
on products
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists sales_full_access on sales;
create policy sales_full_access
on sales
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists sale_items_full_access on sale_items;
create policy sale_items_full_access
on sale_items
for all
to anon, authenticated
using (true)
with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on customers to anon, authenticated;
grant select, insert, update, delete on products to anon, authenticated;
grant select, insert, update, delete on sales to anon, authenticated;
grant select, insert, update, delete on sale_items to anon, authenticated;
grant select on vw_open_sales to anon, authenticated;
grant select on vw_customer_open_balances to anon, authenticated;
grant usage, select on sequence sale_code_seq to anon, authenticated;
grant execute on function create_sale(uuid, date, boolean, numeric, jsonb, text) to anon, authenticated;
grant execute on function update_sale(uuid, uuid, date, boolean, numeric, jsonb, text) to anon, authenticated;
grant execute on function delete_sale(uuid) to anon, authenticated;
grant execute on function mark_sale_paid(uuid) to anon, authenticated;
