(function () {
  const client = window.SupabaseConnection.client;

  async function create(payload) {
    const { data, error } = await client.rpc("create_sale", {
      p_customer_id: payload.customerId,
      p_payment_method: payload.paymentMethod || null,
      p_items: payload.items,
      p_notes: payload.notes || null,
    });

    if (error) {
      throw error;
    }

    return data;
  }

  async function list() {
    const { data, error } = await client
      .from("sales")
      .select(
        `
          id,
          sale_code,
          customer_id,
          sale_date,
          payment_method,
          gross_amount,
          discount_percent,
          discount_amount,
          total_amount,
          notes,
          customers (
            id,
            name
          ),
          sale_items (
            id,
            product_id,
            quantity,
            unit_price,
            line_total,
            description,
            sale_unit
          )
        `
      )
      .order("sale_date", { ascending: false });

    if (error) {
      throw error;
    }

    return data;
  }

  async function update(payload) {
    const { data, error } = await client.rpc("update_sale", {
      p_sale_id: payload.saleId,
      p_customer_id: payload.customerId,
      p_payment_method: payload.paymentMethod || null,
      p_items: payload.items,
      p_notes: payload.notes || null,
    });

    if (error) {
      throw error;
    }

    return data;
  }

  async function remove(saleId) {
    const { error } = await client.rpc("delete_sale", {
      p_sale_id: saleId,
    });

    if (error) {
      throw error;
    }
  }

  async function markAsPaid(saleId, paymentMethod) {
    const { error } = await client.rpc("mark_sale_paid", {
      p_sale_id: saleId,
      p_payment_method: paymentMethod,
    });

    if (error) {
      throw error;
    }
  }

  window.Services = window.Services || {};
  window.Services.Sales = {
    create,
    list,
    update,
    remove,
    markAsPaid,
  };
})();
