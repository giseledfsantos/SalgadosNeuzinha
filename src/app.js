(function () {
  const { formatCurrency, formatPercent, formatQuantity, formatDate } =
    window.Formatters;
  const { Products, Customers, Sales, Receivables } = window.Services;
  const screenMeta = {
    painel: {
      title: "Painel Comercial",
      description: "Resumo dos pedidos em aberto e das próximas encomendas.",
    },
    produtos: {
      title: "Produtos",
      description: "Cadastro e consulta dos produtos com estoque e valor de venda.",
    },
    clientes: {
      title: "Clientes",
      description: "Cadastro e consulta dos clientes com percentual de desconto.",
    },
    vendas: {
      title: "Encomendas",
      description: "Cadastro de encomendas com data, entrega e consulta dos pedidos registrados.",
    },
    recebimentos: {
      title: "Valores Em Aberto",
      description: "Consulta dos clientes com pedidos pendentes e recebimentos.",
    },
  };

  const state = {
    products: [],
    customers: [],
    sales: [],
    balances: [],
    selectedCustomerId: "",
    currentScreen: "painel",
    editingProductId: "",
    editingCustomerId: "",
    editingSaleId: "",
    isLoadingScreenData: false,
  };

  const elements = {
    configAlert: document.getElementById("config-alert"),
    feedback: document.getElementById("feedback"),
    screens: Array.from(document.querySelectorAll(".screen")),
    menuLinks: Array.from(document.querySelectorAll("[data-screen-link]")),
    productForm: document.getElementById("product-form"),
    productId: document.getElementById("product-id"),
    productSubmitButton: document.getElementById("product-submit-button"),
    productCancelButton: document.getElementById("product-cancel-button"),
    customerForm: document.getElementById("customer-form"),
    customerId: document.getElementById("customer-id"),
    customerSubmitButton: document.getElementById("customer-submit-button"),
    customerCancelButton: document.getElementById("customer-cancel-button"),
    saleForm: document.getElementById("sale-form"),
    saleId: document.getElementById("sale-id"),
    saleSubmitButton: document.getElementById("sale-submit-button"),
    saleCancelButton: document.getElementById("sale-cancel-button"),
    saleCustomer: document.getElementById("sale-customer"),
    saleOrderDate: document.getElementById("sale-order-date"),
    saleDelivered: document.getElementById("sale-delivered"),
    salePaidAmount: document.getElementById("sale-paid-amount"),
    saleNotes: document.getElementById("sale-notes"),
    saleItems: document.getElementById("sale-items"),
    addItemButton: document.getElementById("add-item-button"),
    productsTable: document.getElementById("products-table"),
    customersTable: document.getElementById("customers-table"),
    salesTable: document.getElementById("sales-table"),
    balancesTable: document.getElementById("balances-table"),
    openSalesList: document.getElementById("open-sales-list"),
    openSalesTitle: document.getElementById("open-sales-title"),
    saleSubtotal: document.getElementById("sale-subtotal"),
    saleDiscount: document.getElementById("sale-discount"),
    saleTotal: document.getElementById("sale-total"),
    saleOpenAmount: document.getElementById("sale-open-amount"),
    homeOpenAmount: document.getElementById("home-open-amount"),
    homeOpenOrders: document.getElementById("home-open-orders"),
    homeUpcomingList: document.getElementById("home-upcoming-list"),
  };

  function showFeedback(message, type) {
    elements.feedback.textContent = message;
    elements.feedback.className = `feedback ${type}`;
  }

  function clearFeedback() {
    elements.feedback.className = "feedback hidden";
    elements.feedback.textContent = "";
  }

  function requireConfiguration() {
    if (window.SupabaseConnection.isConfigured) {
      return true;
    }

    showFeedback(
      "Preencha o arquivo src/config.js com os dados do Supabase antes de usar o sistema.",
      "error"
    );
    return false;
  }

  function getScreenFromHash() {
    const hash = window.location.hash.replace("#", "").trim();
    return screenMeta[hash] ? hash : "painel";
  }

  function updateHeaderForScreen(screenName) {
    const meta = screenMeta[screenName] || screenMeta.painel;
    if (document.title) {
      document.title = `Salgados da Neuzinha | ${meta.title}`;
    }
  }

  function showScreen(screenName) {
    state.currentScreen = screenName;
    elements.screens.forEach((screen) => {
      screen.classList.toggle(
        "screen-active",
        screen.dataset.screen === screenName
      );
    });

    elements.menuLinks.forEach((link) => {
      link.classList.toggle(
        "active",
        link.dataset.screenLink === screenName
      );
    });

    updateHeaderForScreen(screenName);
  }

  async function refreshScreenData(showSuccessMessage = false) {
    if (!window.SupabaseConnection.isConfigured || state.isLoadingScreenData) {
      return;
    }

    state.isLoadingScreenData = true;

    try {
      await loadDashboard();
      if (showSuccessMessage) {
        showFeedback("Dados atualizados com sucesso.", "success");
      }
    } catch (error) {
      showFeedback(error.message || "Erro ao atualizar dados.", "error");
    } finally {
      state.isLoadingScreenData = false;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getSelectedCustomer() {
    return state.customers.find(
      (customer) => customer.id === elements.saleCustomer.value
    );
  }

  function getProductById(productId) {
    return state.products.find((product) => product.id === productId);
  }

  function getSaleById(saleId) {
    return state.sales.find((sale) => sale.id === saleId);
  }

  function getDeliveredLabel(delivered) {
    return delivered ? "Sim" : "Não";
  }

  function getTodayDateValue() {
    const now = new Date();
    const timezoneOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
  }

  function getOrderDateLabel(sale) {
    return formatDate(sale.order_date || sale.sale_date);
  }

  function getProductSaleQuantity(product) {
    return Number(product?.sale_quantity || 0);
  }

  function getProductUnitPrice(product) {
    const saleQuantity = getProductSaleQuantity(product);
    if (!product || saleQuantity <= 0) {
      return 0;
    }

    return Number(product.sale_price || 0) / saleQuantity;
  }

  function calculateSaleItemTotal(product, quantity) {
    if (!product || !quantity) {
      return 0;
    }

    return getProductUnitPrice(product) * Number(quantity);
  }

  function getSaleSummaryValues() {
    const items = collectSaleItems();
    const customer = getSelectedCustomer();
    const subtotal = items.reduce((sum, item) => {
      const product = getProductById(item.product_id);
      return sum + calculateSaleItemTotal(product, item.quantity);
    }, 0);
    const discount = subtotal * (Number(customer?.discount_percent || 0) / 100);
    const total = subtotal - discount;
    const paidAmount = Number(elements.salePaidAmount.value || 0);
    const openAmount = Math.max(total - paidAmount, 0);

    return {
      subtotal,
      discount,
      total,
      paidAmount,
      openAmount,
    };
  }

  function resetProductForm() {
    state.editingProductId = "";
    elements.productId.value = "";
    elements.productForm.reset();
    elements.productSubmitButton.textContent = "Salvar produto";
    elements.productCancelButton.classList.add("hidden");
  }

  function resetCustomerForm() {
    state.editingCustomerId = "";
    elements.customerId.value = "";
    elements.customerForm.reset();
    elements.customerSubmitButton.textContent = "Salvar cliente";
    elements.customerCancelButton.classList.add("hidden");
  }

  function resetSaleForm() {
    state.editingSaleId = "";
    elements.saleId.value = "";
    elements.saleForm.reset();
    elements.saleItems.innerHTML = "";
    addSaleItemRow("", "");
    elements.saleOrderDate.value = getTodayDateValue();
    elements.saleDelivered.checked = false;
    elements.salePaidAmount.value = "0";
    elements.saleSubmitButton.textContent = "Salvar encomenda";
    elements.saleCancelButton.classList.add("hidden");
    updateSaleSummary();
  }

  function enableProductEditing(product) {
    state.editingProductId = product.id;
    elements.productId.value = product.id;
    document.getElementById("product-description").value = product.description;
    document.getElementById("product-price").value = product.sale_price;
    document.getElementById("product-sale-quantity").value = product.sale_quantity;
    document.getElementById("product-stock").value = product.stock_quantity;
    elements.productSubmitButton.textContent = "Atualizar produto";
    elements.productCancelButton.classList.remove("hidden");
    showScreen("produtos");
  }

  function enableCustomerEditing(customer) {
    state.editingCustomerId = customer.id;
    elements.customerId.value = customer.id;
    document.getElementById("customer-name").value = customer.name;
    document.getElementById("customer-discount").value = customer.discount_percent;
    elements.customerSubmitButton.textContent = "Atualizar cliente";
    elements.customerCancelButton.classList.remove("hidden");
    showScreen("clientes");
  }

  function enableSaleEditing(sale) {
    state.editingSaleId = sale.id;
    elements.saleId.value = sale.id;
    elements.saleCustomer.value = sale.customer_id || sale.customers?.id || "";
    elements.saleOrderDate.value = sale.order_date || getTodayDateValue();
    elements.saleDelivered.checked = Boolean(sale.delivered);
    elements.salePaidAmount.value = Number(sale.paid_amount || 0);
    elements.saleNotes.value = sale.notes || "";
    elements.saleItems.innerHTML = "";

    sale.sale_items.forEach((item) => {
      addSaleItemRow(item.product_id, item.quantity);
    });

    if (!sale.sale_items.length) {
      addSaleItemRow("", "");
    }

    elements.saleSubmitButton.textContent = "Atualizar encomenda";
    elements.saleCancelButton.classList.remove("hidden");
    updateSaleSummary();
    showScreen("vendas");
  }

  function renderProducts() {
    if (!state.products.length) {
      elements.productsTable.innerHTML =
        '<tr><td colspan="5" class="empty-cell">Nenhum produto cadastrado.</td></tr>';
      return;
    }

    elements.productsTable.innerHTML = state.products
      .map(
        (product) => `
          <tr>
            <td>${escapeHtml(product.description)}</td>
            <td>${formatCurrency(product.sale_price)}</td>
            <td>${formatQuantity(product.sale_quantity)}</td>
            <td>${formatQuantity(product.stock_quantity)}</td>
            <td>
              <div class="action-group">
                <button
                  type="button"
                  class="table-action"
                  data-product-action="edit"
                  data-product-id="${product.id}"
                >
                  Alterar
                </button>
                <button
                  type="button"
                  class="danger-button"
                  data-product-action="delete"
                  data-product-id="${product.id}"
                >
                  Excluir
                </button>
              </div>
            </td>
          </tr>
        `
      )
      .join("");
  }

  function renderCustomers() {
    if (!state.customers.length) {
      elements.customersTable.innerHTML =
        '<tr><td colspan="3" class="empty-cell">Nenhum cliente cadastrado.</td></tr>';
      return;
    }

    elements.customersTable.innerHTML = state.customers
      .map(
        (customer) => `
          <tr>
            <td>${escapeHtml(customer.name)}</td>
            <td>${formatPercent(customer.discount_percent)}</td>
            <td>
              <div class="action-group">
                <button
                  type="button"
                  class="table-action"
                  data-customer-action="edit"
                  data-customer-id="${customer.id}"
                >
                  Alterar
                </button>
                <button
                  type="button"
                  class="danger-button"
                  data-customer-action="delete"
                  data-customer-id="${customer.id}"
                >
                  Excluir
                </button>
              </div>
            </td>
          </tr>
        `
      )
      .join("");
  }

  function renderSales() {
    if (!state.sales.length) {
      elements.salesTable.innerHTML =
        '<tr><td colspan="7" class="empty-cell">Nenhuma encomenda registrada.</td></tr>';
      return;
    }

    elements.salesTable.innerHTML = state.sales
      .map((sale) => {
        const items = sale.sale_items
          .map(
            (item) =>
              `${formatQuantity(item.quantity)} de ${escapeHtml(item.description)}`
          )
          .join("<br />");

        return `
          <tr>
            <td>${getOrderDateLabel(sale)}</td>
            <td>${escapeHtml(sale.customers?.name || "")}</td>
            <td>${items}</td>
            <td>${getDeliveredLabel(sale.delivered)}</td>
            <td>${formatCurrency(sale.paid_amount || 0)}</td>
            <td>${formatCurrency(sale.total_amount)}</td>
            <td>
              <div class="action-group">
                <button
                  type="button"
                  class="table-action"
                  data-sale-action="edit"
                  data-sale-id="${sale.id}"
                >
                  Alterar
                </button>
                <button
                  type="button"
                  class="danger-button"
                  data-sale-action="delete"
                  data-sale-id="${sale.id}"
                >
                  Excluir
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderBalances() {
    if (!state.balances.length) {
      elements.balancesTable.innerHTML =
        '<tr><td colspan="4" class="empty-cell">Nenhum valor em aberto no momento.</td></tr>';
      return;
    }

    elements.balancesTable.innerHTML = state.balances
      .map(
        (balance) => `
          <tr>
            <td>${escapeHtml(balance.customer_name)}</td>
            <td>${balance.open_orders}</td>
            <td>${formatCurrency(balance.total_open_amount)}</td>
            <td>
              <button
                type="button"
                class="table-action"
                data-customer-id="${balance.customer_id}"
                data-customer-name="${escapeHtml(balance.customer_name)}"
              >
                Ver pedidos
              </button>
            </td>
          </tr>
        `
      )
      .join("");
  }

  function renderHomePanel() {
    const openAmount = state.balances.reduce(
      (sum, balance) => sum + Number(balance.total_open_amount || 0),
      0
    );
    const upcomingSales = state.sales
      .filter((sale) => !sale.delivered)
      .slice()
      .sort((firstSale, secondSale) => {
        return new Date(firstSale.order_date || firstSale.sale_date) - new Date(secondSale.order_date || secondSale.sale_date);
      });

    elements.homeOpenAmount.textContent = formatCurrency(openAmount);
    elements.homeOpenOrders.textContent = String(upcomingSales.length);

    if (!upcomingSales.length) {
      elements.homeUpcomingList.className = "upcoming-list empty-state";
      elements.homeUpcomingList.textContent =
        "Nenhuma encomenda pendente no momento.";
      return;
    }

    elements.homeUpcomingList.className = "upcoming-list";
    elements.homeUpcomingList.innerHTML = upcomingSales
      .slice(0, 5)
      .map((sale) => {
        const itemCount = sale.sale_items.length;
        return `
          <article class="upcoming-card">
            <div class="upcoming-card-head">
              <div>
                <strong>${escapeHtml(sale.customers?.name || "")}</strong>
                <span>${getOrderDateLabel(sale)}</span>
              </div>
              <span class="upcoming-badge">Entrega pendente</span>
            </div>
            <div class="upcoming-card-body">
              <p>${itemCount} item(ns) na encomenda</p>
              <strong>${formatCurrency(sale.total_amount)}</strong>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderCustomerOptions() {
    const options = state.customers
      .map(
        (customer) => `
          <option value="${customer.id}">
            ${escapeHtml(customer.name)} (${formatPercent(customer.discount_percent)})
          </option>
        `
      )
      .join("");

    elements.saleCustomer.innerHTML =
      '<option value="">Selecione um cliente</option>' + options;
  }

  function buildProductOptions(selectedProductId) {
    return [
      '<option value="">Selecione um produto</option>',
      ...state.products.map(
        (product) => `
          <option value="${product.id}" ${
            product.id === selectedProductId ? "selected" : ""
          }>
            ${escapeHtml(product.description)} (${formatCurrency(
              product.sale_price
            )} por ${formatQuantity(product.sale_quantity)})
          </option>
        `
      ),
    ].join("");
  }

  function updateSaleItemRowDisplay(row) {
    const productId = row.querySelector(".sale-item-product").value;
    const quantity = Number(row.querySelector(".sale-item-quantity").value);
    const product = getProductById(productId);
    const details = row.querySelector(".sale-item-details");
    const totalElement = row.querySelector(".sale-item-line-total");

    if (!product) {
      details.textContent = "Selecione um produto para calcular automaticamente.";
      totalElement.textContent = formatCurrency(0);
      return;
    }

    const saleQuantity = getProductSaleQuantity(product);
    const unitPrice = getProductUnitPrice(product);
    const lineTotal = calculateSaleItemTotal(product, quantity);

    details.textContent = `Referência: ${formatCurrency(product.sale_price)} para ${formatQuantity(
      saleQuantity
    )}. Valor proporcional: ${formatCurrency(unitPrice)} por unidade.`;
    totalElement.textContent = formatCurrency(lineTotal);
  }

  function addSaleItemRow(selectedProductId, quantity) {
    const itemRow = document.createElement("div");
    itemRow.className = "sale-item-row";
    itemRow.innerHTML = `
      <label>
        Produto
        <select class="sale-item-product">
          ${buildProductOptions(selectedProductId || "")}
        </select>
      </label>
      <label>
        Quantidade
        <input
          class="sale-item-quantity"
          type="number"
          min="0.001"
          step="0.001"
          value="${quantity || ""}"
        />
      </label>
      <div class="sale-item-actions">
        <button type="button" class="secondary-button remove-item-button">
          Remover
        </button>
      </div>
      <div class="sale-item-meta">
        <span class="sale-item-details">Selecione um produto para calcular automaticamente.</span>
        <strong class="sale-item-line-total">${formatCurrency(0)}</strong>
      </div>
    `;

    elements.saleItems.appendChild(itemRow);
    updateSaleItemRowDisplay(itemRow);
  }

  function renderOpenSales(openSales, customerName) {
    elements.openSalesTitle.textContent = customerName
      ? `Pedidos em aberto de ${customerName}`
      : "Selecione um cliente para consultar.";

    if (!openSales.length) {
      elements.openSalesList.className = "open-sales-list empty-state";
      elements.openSalesList.textContent =
        "Este cliente não possui pedidos pendentes.";
      return;
    }

    elements.openSalesList.className = "open-sales-list";
    elements.openSalesList.innerHTML = openSales
      .map(
        (sale) => `
          <article class="open-sale-card">
            <div>
              <strong>Pedido ${sale.sale_code}</strong>
              <span>${formatDate(sale.order_date || sale.sale_date)}</span>
            </div>
            <div>
              <span>Total</span>
              <strong>${formatCurrency(sale.total_amount)}</strong>
            </div>
            <div>
              <span>Valor pago</span>
              <p>${formatCurrency(sale.paid_amount || 0)}</p>
            </div>
            <div>
              <span>Em aberto</span>
              <strong>${formatCurrency(sale.open_amount || 0)}</strong>
            </div>
            <div>
              <span>Entregue</span>
              <p>${sale.delivered ? "Sim" : "Não"}</p>
            </div>
            <div>
              <span>Produtos</span>
              <p>${escapeHtml(sale.items_summary || "Sem itens")}</p>
            </div>
            <div class="open-sale-actions">
              <button
                type="button"
                class="table-action"
                data-sale-id="${sale.sale_id}"
              >
                Quitar pedido
              </button>
            </div>
          </article>
        `
      )
      .join("");
  }

  function collectSaleItems() {
    const rows = Array.from(
      elements.saleItems.querySelectorAll(".sale-item-row")
    );

    return rows
      .map((row) => ({
        product_id: row.querySelector(".sale-item-product").value,
        quantity: Number(row.querySelector(".sale-item-quantity").value),
      }))
      .filter((item) => item.product_id && item.quantity > 0);
  }

  function updateSaleSummary() {
    const { subtotal, discount, total, openAmount } = getSaleSummaryValues();
    elements.saleSubtotal.textContent = formatCurrency(subtotal);
    elements.saleDiscount.textContent = formatCurrency(discount);
    elements.saleTotal.textContent = formatCurrency(total);
    elements.saleOpenAmount.textContent = formatCurrency(openAmount);
  }

  async function loadDashboard() {
    const [products, customers, sales, balances] = await Promise.all([
      Products.list(),
      Customers.list(),
      Sales.list(),
      Receivables.listBalances(),
    ]);

    state.products = products;
    state.customers = customers;
    state.sales = sales;
    state.balances = balances;

    renderProducts();
    renderCustomers();
    renderSales();
    renderBalances();
    renderHomePanel();
    renderCustomerOptions();

    if (state.editingSaleId) {
      const editingSale = getSaleById(state.editingSaleId);
      if (editingSale) {
        enableSaleEditing(editingSale);
      } else {
        resetSaleForm();
      }
    } else if (!elements.saleItems.children.length) {
      addSaleItemRow("", "");
    } else {
      Array.from(elements.saleItems.querySelectorAll(".sale-item-row")).forEach((row) => {
        const select = row.querySelector(".sale-item-product");
        const currentValue = select.value;
        select.innerHTML = buildProductOptions(currentValue);
        updateSaleItemRowDisplay(row);
      });
    }

    updateSaleSummary();

    if (state.selectedCustomerId) {
      const selectedBalance = state.balances.find(
        (balance) => balance.customer_id === state.selectedCustomerId
      );

      if (selectedBalance) {
        await handleBalanceClick(
          selectedBalance.customer_id,
          selectedBalance.customer_name,
          false
        );
      } else {
        state.selectedCustomerId = "";
        renderOpenSales([], "");
      }
    }
  }

  async function handleProductSubmit(event) {
    event.preventDefault();
    clearFeedback();

    if (!requireConfiguration()) {
      return;
    }

    const formData = new FormData(elements.productForm);
    const payload = {
      description: formData.get("description").trim(),
      sale_price: Number(formData.get("sale_price")),
      sale_quantity: Number(formData.get("sale_quantity")),
      stock_quantity: Number(formData.get("stock_quantity")),
    };

    if (payload.sale_quantity <= 0) {
      showFeedback("Informe uma quantidade de venda maior que zero.", "error");
      return;
    }

    try {
      if (state.editingProductId) {
        await Products.update(state.editingProductId, payload);
        resetProductForm();
        await loadDashboard();
        showScreen("produtos");
        showFeedback("Produto atualizado com sucesso.", "success");
        return;
      }

      await Products.create(payload);
      resetProductForm();
      await loadDashboard();
      showScreen("produtos");
      showFeedback("Produto cadastrado com sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao salvar produto.", "error");
    }
  }

  async function handleCustomerSubmit(event) {
    event.preventDefault();
    clearFeedback();

    if (!requireConfiguration()) {
      return;
    }

    const formData = new FormData(elements.customerForm);
    const payload = {
      name: formData.get("name").trim(),
      discount_percent: Number(formData.get("discount_percent")),
    };

    try {
      if (state.editingCustomerId) {
        await Customers.update(state.editingCustomerId, payload);
        resetCustomerForm();
        await loadDashboard();
        showScreen("clientes");
        showFeedback("Cliente atualizado com sucesso.", "success");
        return;
      }

      await Customers.create(payload);
      resetCustomerForm();
      await loadDashboard();
      showScreen("clientes");
      showFeedback("Cliente cadastrado com sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao salvar cliente.", "error");
    }
  }

  async function handleSaleSubmit(event) {
    event.preventDefault();
    clearFeedback();

    if (!requireConfiguration()) {
      return;
    }

    const items = collectSaleItems();
    if (!items.length) {
      showFeedback("Adicione pelo menos um item válido para registrar a encomenda.", "error");
      return;
    }

    if (!elements.saleCustomer.value) {
      showFeedback("Selecione um cliente para registrar a encomenda.", "error");
      return;
    }

    if (!elements.saleOrderDate.value) {
      showFeedback("Informe a data da encomenda.", "error");
      return;
    }

    const payload = {
      customerId: elements.saleCustomer.value,
      orderDate: elements.saleOrderDate.value,
      delivered: elements.saleDelivered.checked,
      paidAmount: Number(elements.salePaidAmount.value || 0),
      notes: elements.saleNotes.value.trim(),
      items,
    };

    const { total } = getSaleSummaryValues();

    if (payload.paidAmount < 0) {
      showFeedback("Informe um valor pago igual ou maior que zero.", "error");
      return;
    }

    if (payload.paidAmount > total) {
      showFeedback("O valor pago não pode ser maior que o total da encomenda.", "error");
      return;
    }

    try {
      if (state.editingSaleId) {
        await Sales.update({
          saleId: state.editingSaleId,
          ...payload,
        });
        resetSaleForm();
        await loadDashboard();
        showScreen("vendas");
        showFeedback("Encomenda atualizada com sucesso.", "success");
        return;
      }

      await Sales.create(payload);
      resetSaleForm();
      await loadDashboard();
      showScreen("vendas");
      showFeedback("Encomenda cadastrada com sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao salvar encomenda.", "error");
    }
  }

  async function handleProductAction(productId, action) {
    const product = getProductById(productId);
    if (!product) {
      return;
    }

    if (action === "edit") {
      clearFeedback();
      enableProductEditing(product);
      return;
    }

    if (!window.confirm(`Deseja excluir o produto "${product.description}"?`)) {
      return;
    }

    try {
      await Products.remove(productId);
      if (state.editingProductId === productId) {
        resetProductForm();
      }
      await loadDashboard();
      showFeedback("Produto excluído com sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao excluir produto.", "error");
    }
  }

  async function handleCustomerAction(customerId, action) {
    const customer = state.customers.find((item) => item.id === customerId);
    if (!customer) {
      return;
    }

    if (action === "edit") {
      clearFeedback();
      enableCustomerEditing(customer);
      return;
    }

    if (!window.confirm(`Deseja excluir o cliente "${customer.name}"?`)) {
      return;
    }

    try {
      await Customers.remove(customerId);
      if (state.editingCustomerId === customerId) {
        resetCustomerForm();
      }
      await loadDashboard();
      showFeedback("Cliente excluído com sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao excluir cliente.", "error");
    }
  }

  async function handleSaleAction(saleId, action) {
    const sale = getSaleById(saleId);
    if (!sale) {
      return;
    }

    if (action === "edit") {
      clearFeedback();
      enableSaleEditing(sale);
      return;
    }

    if (!window.confirm(`Deseja excluir a encomenda ${sale.sale_code}?`)) {
      return;
    }

    try {
      await Sales.remove(saleId);
      if (state.editingSaleId === saleId) {
        resetSaleForm();
      }
      await loadDashboard();
      showScreen("vendas");
      showFeedback("Encomenda excluída com sucesso.", "success");
    } catch (error) {
      showFeedback(
        error.message ||
          "Erro ao excluir encomenda. Execute o SQL complementar de alteração no Supabase.",
        "error"
      );
    }
  }

  async function handleBalanceClick(customerId, customerName, showMessage) {
    if (!requireConfiguration()) {
      return;
    }

    try {
      state.selectedCustomerId = customerId;
      const openSales = await Receivables.listOpenSalesByCustomer(customerId);
      renderOpenSales(openSales, customerName);

      if (showMessage) {
        showFeedback(`Consulta carregada para ${customerName}.`, "success");
      }
    } catch (error) {
      showFeedback(error.message || "Erro ao consultar pedidos em aberto.", "error");
    }
  }

  async function handleMarkAsPaid(saleId) {
    if (!requireConfiguration()) {
      return;
    }

    try {
      await Sales.markAsPaid(saleId);
      await loadDashboard();
      showFeedback("Pedido baixado com sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao baixar o pedido.", "error");
    }
  }

  function bindEvents() {
    elements.menuLinks.forEach((link) => {
      link.addEventListener("click", async () => {
        if (link.dataset.screenLink === state.currentScreen) {
          showScreen(link.dataset.screenLink);
          await refreshScreenData();
        }
      });
    });

    window.addEventListener("hashchange", async () => {
      showScreen(getScreenFromHash());
      await refreshScreenData();
    });

    elements.productForm.addEventListener("submit", handleProductSubmit);
    elements.customerForm.addEventListener("submit", handleCustomerSubmit);
    elements.saleForm.addEventListener("submit", handleSaleSubmit);

    elements.productCancelButton.addEventListener("click", () => {
      clearFeedback();
      resetProductForm();
    });

    elements.customerCancelButton.addEventListener("click", () => {
      clearFeedback();
      resetCustomerForm();
    });

    elements.saleCancelButton.addEventListener("click", () => {
      clearFeedback();
      resetSaleForm();
    });

    elements.productsTable.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-product-action]");
      if (!button) {
        return;
      }

      await handleProductAction(
        button.dataset.productId,
        button.dataset.productAction
      );
    });

    elements.customersTable.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-customer-action]");
      if (!button) {
        return;
      }

      await handleCustomerAction(
        button.dataset.customerId,
        button.dataset.customerAction
      );
    });

    elements.salesTable.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-sale-action]");
      if (!button) {
        return;
      }

      await handleSaleAction(button.dataset.saleId, button.dataset.saleAction);
    });

    elements.saleCustomer.addEventListener("change", updateSaleSummary);
    elements.salePaidAmount.addEventListener("input", updateSaleSummary);
    elements.addItemButton.addEventListener("click", () => {
      addSaleItemRow("", "");
      updateSaleSummary();
    });

    elements.saleItems.addEventListener("click", (event) => {
      if (event.target.classList.contains("remove-item-button")) {
        const rows = elements.saleItems.querySelectorAll(".sale-item-row");
        if (rows.length === 1) {
          showFeedback("A encomenda precisa ter pelo menos uma linha de item.", "error");
          return;
        }

        event.target.closest(".sale-item-row").remove();
        updateSaleSummary();
      }
    });

    elements.saleItems.addEventListener("input", (event) => {
      const row = event.target.closest(".sale-item-row");
      if (row) {
        updateSaleItemRowDisplay(row);
      }
      updateSaleSummary();
    });
    elements.saleItems.addEventListener("change", (event) => {
      const row = event.target.closest(".sale-item-row");
      if (row) {
        updateSaleItemRowDisplay(row);
      }
      updateSaleSummary();
    });

    elements.balancesTable.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-customer-id]");
      if (!button) {
        return;
      }

      await handleBalanceClick(
        button.dataset.customerId,
        button.dataset.customerName,
        true
      );
      showScreen("recebimentos");
    });

    elements.openSalesList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-sale-id]");
      if (!button) {
        return;
      }

      await handleMarkAsPaid(button.dataset.saleId);
    });
  }

  async function init() {
    bindEvents();
    showScreen(getScreenFromHash());

    resetProductForm();
    resetCustomerForm();
    resetSaleForm();

    if (!window.SupabaseConnection.isConfigured) {
      elements.configAlert.classList.remove("hidden");
      renderProducts();
      renderCustomers();
      renderSales();
      renderBalances();
      renderHomePanel();
      return;
    }

    try {
      await loadDashboard();
      renderOpenSales([], "");
    } catch (error) {
      showFeedback(error.message || "Erro ao carregar os dados iniciais.", "error");
    }
  }

  init();
})();
