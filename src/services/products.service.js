(function () {
  const client = window.SupabaseConnection.client;

  async function list() {
    const { data, error } = await client
      .from("products")
      .select("*")
      .order("description", { ascending: true });

    if (error) {
      throw error;
    }

    return data;
  }

  async function create(payload) {
    const { data, error } = await client
      .from("products")
      .insert([payload])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async function update(productId, payload) {
    const { data, error } = await client
      .from("products")
      .update(payload)
      .eq("id", productId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async function remove(productId) {
    const { error } = await client.from("products").delete().eq("id", productId);

    if (error) {
      throw error;
    }
  }

  window.Services = window.Services || {};
  window.Services.Products = {
    list,
    create,
    update,
    remove,
  };
})();
