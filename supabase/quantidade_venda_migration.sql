do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'sale_quantity'
  ) then
    alter table products add column sale_quantity numeric(12,3);
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'sale_unit'
  ) then
    update products
    set sale_quantity = case
      when sale_quantity is not null and sale_quantity > 0 then sale_quantity
      when trim(coalesce(sale_unit, '')) ~ '^[0-9]+([,.][0-9]+)?$'
        then replace(trim(sale_unit), ',', '.')::numeric
      else 1
    end
    where sale_quantity is null or sale_quantity <= 0;

    alter table products drop column sale_unit;
  end if;
end
$$;

update products
set sale_quantity = 1
where sale_quantity is null or sale_quantity <= 0;

alter table products
  alter column sale_quantity set default 1,
  alter column sale_quantity set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_sale_quantity_check'
  ) then
    alter table products
      add constraint products_sale_quantity_check
      check (sale_quantity > 0);
  end if;
end
$$;

alter table sale_items
  alter column unit_price type numeric(12,4)
  using unit_price::numeric(12,4);

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sale_items'
      and column_name = 'reference_quantity'
  ) then
    alter table sale_items add column reference_quantity numeric(12,3);
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sale_items'
      and column_name = 'sale_unit'
  ) then
    update sale_items si
    set reference_quantity = case
      when si.reference_quantity is not null and si.reference_quantity > 0 then si.reference_quantity
      when trim(coalesce(si.sale_unit, '')) ~ '^[0-9]+([,.][0-9]+)?$'
        then replace(trim(si.sale_unit), ',', '.')::numeric
      else coalesce(
        (select p.sale_quantity from products p where p.id = si.product_id),
        1
      )
    end
    where si.reference_quantity is null or si.reference_quantity <= 0;

    alter table sale_items drop column sale_unit;
  end if;
end
$$;

update sale_items si
set reference_quantity = coalesce(
  nullif(si.reference_quantity, 0),
  (select p.sale_quantity from products p where p.id = si.product_id),
  1
)
where si.reference_quantity is null or si.reference_quantity <= 0;

alter table sale_items
  alter column reference_quantity set default 1,
  alter column reference_quantity set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sale_items_reference_quantity_check'
  ) then
    alter table sale_items
      add constraint sale_items_reference_quantity_check
      check (reference_quantity > 0);
  end if;
end
$$;

create or replace function create_sale(
  p_customer_id uuid,
  p_order_date date default current_date,
  p_delivered boolean default false,
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
    payment_method,
    discount_percent,
    notes
  )
  values (
    p_customer_id,
    p_order_date,
    coalesce(p_delivered, false),
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

    if v_product.stock_quantity < v_quantity then
      raise exception 'Estoque insuficiente para o produto %.', v_product.description;
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

create or replace function update_sale(
  p_sale_id uuid,
  p_customer_id uuid,
  p_order_date date default current_date,
  p_delivered boolean default false,
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

    if v_product.stock_quantity < v_quantity then
      raise exception 'Estoque insuficiente para o produto %.', v_product.description;
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

    update products
    set stock_quantity = stock_quantity - v_quantity
    where id = v_product.id;
  end loop;

  v_discount_amount := round((v_gross_amount * (v_customer.discount_percent / 100))::numeric, 2);
  v_total_amount := round((v_gross_amount - v_discount_amount)::numeric, 2);

  update sales
  set
    customer_id = p_customer_id,
    order_date = p_order_date,
    delivered = coalesce(p_delivered, false),
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
  s.total_amount,
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
where s.payment_method is null
group by s.id, s.sale_code, s.customer_id, c.name, s.order_date, s.delivered, s.sale_date, s.total_amount;

grant select on vw_open_sales to anon, authenticated;
grant execute on function create_sale(uuid, date, boolean, payment_method, jsonb, text) to anon, authenticated;
grant execute on function update_sale(uuid, uuid, date, boolean, payment_method, jsonb, text) to anon, authenticated;
