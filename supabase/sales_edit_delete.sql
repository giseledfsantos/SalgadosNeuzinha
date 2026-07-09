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

grant execute on function update_sale(uuid, uuid, payment_method, jsonb, text) to anon, authenticated;
grant execute on function delete_sale(uuid) to anon, authenticated;
