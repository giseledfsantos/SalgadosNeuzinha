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

grant execute on function update_sale(uuid, uuid, date, boolean, numeric, jsonb, text) to anon, authenticated;
grant execute on function delete_sale(uuid) to anon, authenticated;
