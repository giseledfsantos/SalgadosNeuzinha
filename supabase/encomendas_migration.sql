alter table sales
  add column if not exists order_date date,
  add column if not exists delivered boolean,
  add column if not exists paid_amount numeric(12,2);

update sales
set order_date = coalesce(order_date, sale_date::date)
where order_date is null;

update sales
set delivered = coalesce(delivered, false)
where delivered is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales'
      and column_name = 'payment_method'
  ) then
    execute $sql$
      update sales
      set paid_amount = case
        when paid_amount is not null and paid_amount >= 0 then paid_amount
        when payment_method is not null then coalesce(total_amount, 0)
        else 0
      end
      where paid_amount is null or paid_amount < 0
    $sql$;
  else
    update sales
    set paid_amount = 0
    where paid_amount is null or paid_amount < 0;
  end if;
end
$$;

alter table sales
  alter column order_date set default current_date,
  alter column order_date set not null,
  alter column delivered set default false,
  alter column delivered set not null,
  alter column paid_amount set default 0,
  alter column paid_amount set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_paid_amount_check'
  ) then
    alter table sales
      add constraint sales_paid_amount_check
      check (paid_amount >= 0);
  end if;
end
$$;

drop view if exists vw_customer_open_balances;
drop view if exists vw_open_sales;

drop function if exists create_sale(uuid, date, boolean, numeric, jsonb, text);
drop function if exists update_sale(uuid, uuid, date, boolean, numeric, jsonb, text);
drop function if exists mark_sale_paid(uuid);
do $$
begin
  if to_regtype('payment_method') is not null then
    execute 'drop function if exists create_sale(uuid, payment_method, jsonb, text)';
    execute 'drop function if exists create_sale(uuid, date, boolean, payment_method, jsonb, text)';
    execute 'drop function if exists update_sale(uuid, uuid, payment_method, jsonb, text)';
    execute 'drop function if exists update_sale(uuid, uuid, date, boolean, payment_method, jsonb, text)';
    execute 'drop function if exists mark_sale_paid(uuid, payment_method)';
  end if;
end
$$;

drop index if exists idx_sales_payment_method;
create index if not exists idx_sales_order_date on sales(order_date);
create index if not exists idx_sales_delivered on sales(delivered);
create index if not exists idx_sales_paid_amount on sales(paid_amount);

alter table sales
  drop column if exists payment_method;

drop type if exists payment_method;

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
  set paid_amount = total_amount
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
declare
  v_existing_item record;
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

grant select on vw_open_sales to anon, authenticated;
grant select on vw_customer_open_balances to anon, authenticated;
grant execute on function create_sale(uuid, date, boolean, numeric, jsonb, text) to anon, authenticated;
grant execute on function update_sale(uuid, uuid, date, boolean, numeric, jsonb, text) to anon, authenticated;
grant execute on function delete_sale(uuid) to anon, authenticated;
grant execute on function mark_sale_paid(uuid) to anon, authenticated;
