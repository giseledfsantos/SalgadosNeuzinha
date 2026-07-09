create extension if not exists pgcrypto;

create sequence if not exists sale_code_seq start 1;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'payment_method'
  ) then
    create type payment_method as enum ('pix', 'dinheiro');
  end if;
end
$$;

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
  sale_unit text not null,
  stock_quantity numeric(12,3) not null default 0 check (stock_quantity >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  sale_code text not null unique default ('PED-' || lpad(nextval('sale_code_seq')::text, 6, '0')),
  customer_id uuid not null references customers(id),
  sale_date timestamptz not null default timezone('utc', now()),
  payment_method payment_method null,
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
  sale_unit text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_sales_customer_id on sales(customer_id);
create index if not exists idx_sales_payment_method on sales(payment_method);
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
  p_payment_method payment_method default null,
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
  v_gross_amount numeric(12,2) := 0;
  v_discount_amount numeric(12,2) := 0;
  v_total_amount numeric(12,2) := 0;
  v_line_total numeric(12,2);
begin
  if p_customer_id is null then
    raise exception 'Informe o cliente da venda.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um item para a venda.';
  end if;

  select *
  into v_customer
  from customers
  where id = p_customer_id;

  if not found then
    raise exception 'Cliente nao encontrado.';
  end if;

  insert into sales (
    customer_id,
    payment_method,
    discount_percent,
    notes
  )
  values (
    p_customer_id,
    p_payment_method,
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
      raise exception 'Quantidade invalida informada para um dos itens.';
    end if;

    select *
    into v_product
    from products
    where id = (v_item ->> 'product_id')::uuid
    for update;

    if not found then
      raise exception 'Produto nao encontrado para um dos itens.';
    end if;

    if v_product.stock_quantity < v_quantity then
      raise exception 'Estoque insuficiente para o produto %.', v_product.description;
    end if;

    v_line_total := round((v_product.sale_price * v_quantity)::numeric, 2);
    v_gross_amount := v_gross_amount + v_line_total;

    insert into sale_items (
      sale_id,
      product_id,
      description,
      sale_unit,
      quantity,
      unit_price,
      line_total
    )
    values (
      v_sale_id,
      v_product.id,
      v_product.description,
      v_product.sale_unit,
      v_quantity,
      v_product.sale_price,
      v_line_total
    );

    update products
    set stock_quantity = stock_quantity - v_quantity
    where id = v_product.id;
  end loop;

  v_discount_amount := round((v_gross_amount * (v_customer.discount_percent / 100))::numeric, 2);
  v_total_amount := round((v_gross_amount - v_discount_amount)::numeric, 2);

  update sales
  set
    gross_amount = v_gross_amount,
    discount_amount = v_discount_amount,
    total_amount = v_total_amount
  where id = v_sale_id;

  return v_sale_id;
end;
$$;

create or replace function mark_sale_paid(
  p_sale_id uuid,
  p_payment_method payment_method
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sale_id is null then
    raise exception 'Informe a venda.';
  end if;

  if p_payment_method is null then
    raise exception 'Informe a forma de pagamento.';
  end if;

  update sales
  set payment_method = p_payment_method
  where id = p_sale_id;

  if not found then
    raise exception 'Venda nao encontrada.';
  end if;
end;
$$;

create or replace function update_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_payment_method payment_method default null,
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
  v_gross_amount numeric(12,2) := 0;
  v_discount_amount numeric(12,2) := 0;
  v_total_amount numeric(12,2) := 0;
  v_line_total numeric(12,2);
begin
  if p_sale_id is null then
    raise exception 'Informe a venda.';
  end if;

  if p_customer_id is null then
    raise exception 'Informe o cliente da venda.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um item para a venda.';
  end if;

  if not exists (
    select 1
    from sales
    where id = p_sale_id
  ) then
    raise exception 'Venda nao encontrada.';
  end if;

  select *
  into v_customer
  from customers
  where id = p_customer_id;

  if not found then
    raise exception 'Cliente nao encontrado.';
  end if;

  for v_existing_item in
    select product_id, quantity
    from sale_items
    where sale_id = p_sale_id
  loop
    update products
    set stock_quantity = stock_quantity + v_existing_item.quantity
    where id = v_existing_item.product_id;
  end loop;

  delete from sale_items
  where sale_id = p_sale_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_quantity := nullif(trim(v_item ->> 'quantity'), '')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Quantidade invalida informada para um dos itens.';
    end if;

    select *
    into v_product
    from products
    where id = (v_item ->> 'product_id')::uuid
    for update;

    if not found then
      raise exception 'Produto nao encontrado para um dos itens.';
    end if;

    if v_product.stock_quantity < v_quantity then
      raise exception 'Estoque insuficiente para o produto %.', v_product.description;
    end if;

    v_line_total := round((v_product.sale_price * v_quantity)::numeric, 2);
    v_gross_amount := v_gross_amount + v_line_total;

    insert into sale_items (
      sale_id,
      product_id,
      description,
      sale_unit,
      quantity,
      unit_price,
      line_total
    )
    values (
      p_sale_id,
      v_product.id,
      v_product.description,
      v_product.sale_unit,
      v_quantity,
      v_product.sale_price,
      v_line_total
    );

    update products
    set stock_quantity = stock_quantity - v_quantity
    where id = v_product.id;
  end loop;

  v_discount_amount := round((v_gross_amount * (v_customer.discount_percent / 100))::numeric, 2);
  v_total_amount := round((v_gross_amount - v_discount_amount)::numeric, 2);

  update sales
  set
    customer_id = p_customer_id,
    payment_method = p_payment_method,
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
declare
  v_existing_item record;
begin
  if p_sale_id is null then
    raise exception 'Informe a venda.';
  end if;

  if not exists (
    select 1
    from sales
    where id = p_sale_id
  ) then
    raise exception 'Venda nao encontrada.';
  end if;

  for v_existing_item in
    select product_id, quantity
    from sale_items
    where sale_id = p_sale_id
  loop
    update products
    set stock_quantity = stock_quantity + v_existing_item.quantity
    where id = v_existing_item.product_id;
  end loop;

  delete from sales
  where id = p_sale_id;
end;
$$;

create or replace view vw_open_sales as
select
  s.id as sale_id,
  s.sale_code,
  s.customer_id,
  c.name as customer_name,
  s.sale_date,
  s.total_amount,
  string_agg(
    concat(
      trim(to_char(si.quantity, 'FM999999990.###')),
      ' ',
      si.sale_unit,
      ' de ',
      si.description
    ),
    ', '
    order by si.description
  ) as items_summary
from sales s
join customers c on c.id = s.customer_id
join sale_items si on si.sale_id = s.id
where s.payment_method is null
group by s.id, s.sale_code, s.customer_id, c.name, s.sale_date, s.total_amount;

create or replace view vw_customer_open_balances as
select
  s.customer_id,
  c.name as customer_name,
  count(*) as open_orders,
  sum(s.total_amount) as total_open_amount
from sales s
join customers c on c.id = s.customer_id
where s.payment_method is null
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
grant execute on function create_sale(uuid, payment_method, jsonb, text) to anon, authenticated;
grant execute on function update_sale(uuid, uuid, payment_method, jsonb, text) to anon, authenticated;
grant execute on function delete_sale(uuid) to anon, authenticated;
grant execute on function mark_sale_paid(uuid, payment_method) to anon, authenticated;
