(function () {
  const client = window.SupabaseConnection.client;

  async function list() {
    const { data, error } = await client
      .from("customers")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return data;
  }

  async function create(payload) {
    const { data, error } = await client
      .from("customers")
      .insert([payload])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async function update(customerId, payload) {
    const { data, error } = await client
      .from("customers")
      .update(payload)
      .eq("id", customerId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async function remove(customerId) {
    const { error } = await client.from("customers").delete().eq("id", customerId);

    if (error) {
      throw error;
    }
  }

  window.Services = window.Services || {};
  window.Services.Customers = {
    list,
    create,
    update,
    remove,
  };
})();
