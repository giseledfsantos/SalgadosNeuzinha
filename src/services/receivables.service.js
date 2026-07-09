(function () {
  const client = window.SupabaseConnection.client;
  const missingViewMessages = [
    "vw_customer_open_balances",
    "vw_open_sales",
    "schema cache",
    "Could not find the table",
  ];

  function isMissingReceivablesStructure(error) {
    const message = String(error?.message || "");
    return missingViewMessages.some((item) => message.includes(item));
  }

  async function listBalances() {
    const { data, error } = await client
      .from("vw_customer_open_balances")
      .select("*")
      .order("customer_name", { ascending: true });

    if (error) {
      if (isMissingReceivablesStructure(error)) {
        return [];
      }
      throw error;
    }

    return data;
  }

  async function listOpenSalesByCustomer(customerId) {
    const { data, error } = await client
      .from("vw_open_sales")
      .select("*")
      .eq("customer_id", customerId)
      .order("sale_date", { ascending: false });

    if (error) {
      if (isMissingReceivablesStructure(error)) {
        return [];
      }
      throw error;
    }

    return data;
  }

  window.Services = window.Services || {};
  window.Services.Receivables = {
    listBalances,
    listOpenSalesByCustomer,
  };
})();
