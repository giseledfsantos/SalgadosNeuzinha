(function () {
  const { formatCurrency, formatPercent, formatQuantity, formatDate } =
    window.Formatters;
  const { Products, Customers, Sales, Receivables } = window.Services;
  const screenMeta = {
    painel: {
      title: "Painel Comercial",
      description: "Resumo dos Pedidos em Aberto e das Próximas Encomendas.",
    },
    produtos: {
      title: "Produtos",
      description: "Cadastro e Consulta dos Produtos com Quantidade e Valor de Venda.",
    },
    clientes: {
      title: "Clientes",
      description: "Cadastro e Consulta dos Clientes com Percentual de Desconto.",
    },
    vendas: {
      title: "Encomendas",
      description: "Cadastro de Encomendas com Data, Entrega e Consulta dos Pedidos Registrados.",
    },
    recebimentos: {
      title: "Valores em Aberto",
      description: "Consulta dos Clientes com Pedidos Pendentes e Recebimentos.",
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
    deleteModalResolver: null,
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
    saleOrderTime: document.getElementById("sale-order-time"),
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
    confirmModal: document.getElementById("confirm-modal"),
    confirmModalTitle: document.getElementById("confirm-modal-title"),
    confirmModalMessage: document.getElementById("confirm-modal-message"),
    confirmModalClose: document.getElementById("confirm-modal-close"),
    confirmModalCancel: document.getElementById("confirm-modal-cancel"),
    confirmModalConfirm: document.getElementById("confirm-modal-confirm"),
  };

  const icons = {
    edit: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
      </svg>
    `,
    view: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    `,
    check: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    `,
    remove: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18 6 6 18" />
        <path d="M6 6l12 12" />
      </svg>
    `,
    delete: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    `,
  };

  function showFeedback(message, type) {
    elements.feedback.textContent = message;
    elements.feedback.className = `feedback ${type}`;
  }

  function clearFeedback() {
    elements.feedback.className = "feedback hidden";
    elements.feedback.textContent = "";
  }

  function closeDeleteModal(confirmed) {
    elements.confirmModal.classList.add("hidden");
    elements.confirmModal.setAttribute("aria-hidden", "true");
    elements.confirmModalTitle.textContent = "Confirmar Exclusão";
    elements.confirmModalMessage.textContent =
      "Deseja Continuar com Esta Exclusão?";

    if (state.deleteModalResolver) {
      state.deleteModalResolver(confirmed);
      state.deleteModalResolver = null;
    }
  }

  function requestDeleteConfirmation(title, message) {
    elements.confirmModalTitle.textContent = title;
    elements.confirmModalMessage.textContent = message;
    elements.confirmModal.classList.remove("hidden");
    elements.confirmModal.setAttribute("aria-hidden", "false");
    elements.confirmModalConfirm.focus();

    return new Promise((resolve) => {
      state.deleteModalResolver = resolve;
    });
  }

  function requireConfiguration() {
    if (window.SupabaseConnection.isConfigured) {
      return true;
    }

    showFeedback(
      "Preencha o Arquivo src/config.js com os Dados do Supabase Antes de Usar o Sistema.",
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
        showFeedback("Dados Atualizados com Sucesso.", "success");
      }
    } catch (error) {
      showFeedback(error.message || "Erro ao Atualizar Dados.", "error");
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

  function getCurrentTimeValue() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
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
    elements.productSubmitButton.textContent = "Salvar Produto";
    elements.productCancelButton.classList.add("hidden");
  }

  function resetCustomerForm() {
    state.editingCustomerId = "";
    elements.customerId.value = "";
    elements.customerForm.reset();
    elements.customerSubmitButton.textContent = "Salvar Cliente";
    elements.customerCancelButton.classList.add("hidden");
  }

  function resetSaleForm() {
    state.editingSaleId = "";
    elements.saleId.value = "";
    elements.saleForm.reset();
    elements.saleItems.innerHTML = "";
    addSaleItemRow("", "");
    elements.saleOrderDate.value = getTodayDateValue();
    elements.saleOrderTime.value = getCurrentTimeValue();
    elements.saleDelivered.checked = false;
    elements.salePaidAmount.value = "0";
    elements.saleSubmitButton.textContent = "Salvar Encomenda";
    elements.saleCancelButton.classList.add("hidden");
    updateSaleSummary();
  }

  function renderCrudActionButtons(entityName, entityId) {
    return `
      <div class="action-group action-group-icons">
        <button
          type="button"
          class="table-action icon-button"
          data-${entityName}-action="edit"
          data-${entityName}-id="${entityId}"
          aria-label="Alterar"
          title="Alterar"
        >
          ${icons.edit}
          <span class="sr-only">Alterar</span>
        </button>
        <button
          type="button"
          class="danger-button icon-button"
          data-${entityName}-action="delete"
          data-${entityName}-id="${entityId}"
          aria-label="Excluir"
          title="Excluir"
        >
          ${icons.delete}
          <span class="sr-only">Excluir</span>
        </button>
      </div>
    `;
  }

  function enableProductEditing(product) {
    state.editingProductId = product.id;
    elements.productId.value = product.id;
    document.getElementById("product-description").value = product.description;
    document.getElementById("product-price").value = product.sale_price;
    document.getElementById("product-sale-quantity").value = product.sale_quantity;
    elements.productSubmitButton.textContent = "Atualizar Produto";
    elements.productCancelButton.classList.remove("hidden");
    showScreen("produtos");
  }

  function enableCustomerEditing(customer) {
    state.editingCustomerId = customer.id;
    elements.customerId.value = customer.id;
    document.getElementById("customer-name").value = customer.name;
    document.getElementById("customer-discount").value = customer.discount_percent;
    elements.customerSubmitButton.textContent = "Atualizar Cliente";
    elements.customerCancelButton.classList.remove("hidden");
    showScreen("clientes");
  }

  function enableSaleEditing(sale) {
    state.editingSaleId = sale.id;
    elements.saleId.value = sale.id;
    elements.saleCustomer.value = sale.customer_id || sale.customers?.id || "";
    elements.saleOrderDate.value = sale.order_date || getTodayDateValue();
    elements.saleOrderTime.value =
      (sale.order_time || "")
        .toString()
        .slice(0, 5) || getCurrentTimeValue();
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

    elements.saleSubmitButton.textContent = "Atualizar Encomenda";
    elements.saleCancelButton.classList.remove("hidden");
    updateSaleSummary();
    showScreen("vendas");
  }

  function renderProducts() {
    if (!state.products.length) {
      elements.productsTable.innerHTML =
        '<tr><td colspan="3" class="empty-cell">Nenhum Produto Cadastrado.</td></tr>';
      return;
    }

    elements.productsTable.innerHTML = state.products
      .map(
        (product) => `
          <tr>
            <td>${escapeHtml(product.description)}</td>
            <td>${formatCurrency(product.sale_price)}</td>
            <td>${renderCrudActionButtons("product", product.id)}</td>
          </tr>
        `
      )
      .join("");
  }

  function renderCustomers() {
    if (!state.customers.length) {
      elements.customersTable.innerHTML =
        '<tr><td colspan="3" class="empty-cell">Nenhum Cliente Cadastrado.</td></tr>';
      return;
    }

    elements.customersTable.innerHTML = state.customers
      .map(
        (customer) => `
          <tr>
            <td>${escapeHtml(customer.name)}</td>
            <td>${formatPercent(customer.discount_percent)}</td>
            <td>${renderCrudActionButtons("customer", customer.id)}</td>
          </tr>
        `
      )
      .join("");
  }

  function renderSales() {
    if (!state.sales.length) {
      elements.salesTable.innerHTML =
        '<tr><td colspan="3" class="empty-cell">Nenhuma Encomenda Registrada.</td></tr>';
      return;
    }

    elements.salesTable.innerHTML = state.sales
      .map((sale) => {
        return `
          <tr>
            <td>${getOrderDateLabel(sale)}</td>
            <td>${escapeHtml(sale.customers?.name || "")}</td>
            <td>${renderCrudActionButtons("sale", sale.id)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderBalances() {
    if (!state.balances.length) {
      elements.balancesTable.innerHTML =
        '<tr><td colspan="4" class="empty-cell">Nenhum Valor em Aberto no Momento.</td></tr>';
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
              <div class="action-group action-group-icons">
                <button
                  type="button"
                  class="table-action icon-button"
                  data-customer-id="${balance.customer_id}"
                  data-customer-name="${escapeHtml(balance.customer_name)}"
                  aria-label="Ver Pedidos"
                  title="Ver Pedidos"
                >
                  ${icons.view}
                  <span class="sr-only">Ver Pedidos</span>
                </button>
              </div>
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
        "Nenhuma Encomenda Pendente no Momento.";
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
              <span class="upcoming-badge">Entrega Pendente</span>
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
      '<option value="">Selecione um Cliente</option>' + options;
  }

  function buildProductOptions(selectedProductId) {
    return [
      '<option value="">Selecione um Produto</option>',
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
      details.textContent = "Selecione um Produto para Calcular Automaticamente.";
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
        <button
          type="button"
          class="secondary-button icon-button remove-item-button"
          aria-label="Remover Item"
          title="Remover Item"
        >
          ${icons.remove}
          <span class="sr-only">Remover Item</span>
        </button>
      </div>
      <div class="sale-item-meta">
        <span class="sale-item-details">Selecione um Produto para Calcular Automaticamente.</span>
        <strong class="sale-item-line-total">${formatCurrency(0)}</strong>
      </div>
    `;

    elements.saleItems.appendChild(itemRow);
    updateSaleItemRowDisplay(itemRow);
  }

  function renderOpenSales(openSales, customerName) {
    elements.openSalesTitle.textContent = customerName
      ? `Pedidos em aberto de ${customerName}`
      : "Selecione um Cliente para Consultar.";

    if (!openSales.length) {
      elements.openSalesList.className = "open-sales-list empty-state";
      elements.openSalesList.textContent =
        "Selecione um Pedido para Visualizar.";
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
              <span>Valor Pago</span>
              <p>${formatCurrency(sale.paid_amount || 0)}</p>
            </div>
            <div>
              <span>Em Aberto</span>
              <strong>${formatCurrency(sale.open_amount || 0)}</strong>
            </div>
            <div>
              <span>Entregue</span>
              <p>${sale.delivered ? "Sim" : "Não"}</p>
            </div>
            <div>
              <span>Produtos</span>
              <p>${escapeHtml(sale.items_summary || "Sem Itens")}</p>
            </div>
            <div class="open-sale-actions">
              <button
                type="button"
                class="success-button icon-button"
                data-sale-id="${sale.sale_id}"
                aria-label="Quitar Pedido"
                title="Quitar Pedido"
              >
                ${icons.check}
                <span class="sr-only">Quitar Pedido</span>
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
    };

    if (payload.sale_quantity <= 0) {
      showFeedback("Informe uma Quantidade de Venda Maior que Zero.", "error");
      return;
    }

    try {
      if (state.editingProductId) {
        await Products.update(state.editingProductId, payload);
        resetProductForm();
        await loadDashboard();
        showScreen("produtos");
        showFeedback("Produto Atualizado com Sucesso.", "success");
        return;
      }

      await Products.create(payload);
      resetProductForm();
      await loadDashboard();
      showScreen("produtos");
      showFeedback("Produto Cadastrado com Sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao Salvar Produto.", "error");
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
      discount_percent: Number(formData.get("discount_percent") || 0),
    };

    try {
      if (state.editingCustomerId) {
        await Customers.update(state.editingCustomerId, payload);
        resetCustomerForm();
        await loadDashboard();
        showScreen("clientes");
        showFeedback("Cliente Atualizado com Sucesso.", "success");
        return;
      }

      await Customers.create(payload);
      resetCustomerForm();
      await loadDashboard();
      showScreen("clientes");
      showFeedback("Cliente Cadastrado com Sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao Salvar Cliente.", "error");
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
      showFeedback("Adicione pelo Menos um Item Válido para Registrar a Encomenda.", "error");
      return;
    }

    if (!elements.saleCustomer.value) {
      showFeedback("Selecione um Cliente para Registrar a Encomenda.", "error");
      return;
    }

    if (!elements.saleOrderDate.value) {
      showFeedback("Informe a Data da Encomenda.", "error");
      return;
    }

    if (!elements.saleOrderTime.value) {
      showFeedback("Informe o Horário da Encomenda.", "error");
      return;
    }

    const payload = {
      customerId: elements.saleCustomer.value,
      orderDate: elements.saleOrderDate.value,
      orderTime: elements.saleOrderTime.value,
      delivered: elements.saleDelivered.checked,
      paidAmount: Number(elements.salePaidAmount.value || 0),
      notes: elements.saleNotes.value.trim(),
      items,
    };

    const { total } = getSaleSummaryValues();

    if (payload.paidAmount < 0) {
      showFeedback("Informe um Valor Pago Igual ou Maior que Zero.", "error");
      return;
    }

    if (payload.paidAmount > total) {
      showFeedback("O Valor Pago Não Pode Ser Maior que o Total da Encomenda.", "error");
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
        showFeedback("Encomenda Atualizada com Sucesso.", "success");
        return;
      }

      await Sales.create(payload);
      resetSaleForm();
      await loadDashboard();
      showScreen("vendas");
      showFeedback("Encomenda Cadastrada com Sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao Salvar Encomenda.", "error");
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

    const confirmed = await requestDeleteConfirmation(
      "Excluir Produto",
      `Deseja Excluir o Produto "${product.description}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      await Products.remove(productId);
      if (state.editingProductId === productId) {
        resetProductForm();
      }
      await loadDashboard();
      showFeedback("Produto Excluído com Sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao Excluir Produto.", "error");
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

    const confirmed = await requestDeleteConfirmation(
      "Excluir Cliente",
      `Deseja Excluir o Cliente "${customer.name}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      await Customers.remove(customerId);
      if (state.editingCustomerId === customerId) {
        resetCustomerForm();
      }
      await loadDashboard();
      showFeedback("Cliente Excluído com Sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao Excluir Cliente.", "error");
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

    const confirmed = await requestDeleteConfirmation(
      "Excluir Encomenda",
      `Deseja Excluir a Encomenda ${sale.sale_code}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      await Sales.remove(saleId);
      if (state.editingSaleId === saleId) {
        resetSaleForm();
      }
      await loadDashboard();
      showScreen("vendas");
      showFeedback("Encomenda Excluída com Sucesso.", "success");
    } catch (error) {
      showFeedback(
        error.message ||
          "Erro ao Excluir Encomenda. Execute o SQL Complementar de Alteração no Supabase.",
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
        showFeedback(`Consulta Carregada para ${customerName}.`, "success");
      }
    } catch (error) {
      showFeedback(error.message || "Erro ao Consultar Pedidos em Aberto.", "error");
    }
  }

  async function handleMarkAsPaid(saleId) {
    if (!requireConfiguration()) {
      return;
    }

    try {
      await Sales.markAsPaid(saleId);
      await loadDashboard();
      showFeedback("Pedido Baixado com Sucesso.", "success");
    } catch (error) {
      showFeedback(error.message || "Erro ao Baixar o Pedido.", "error");
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

    elements.confirmModalClose.addEventListener("click", () => {
      closeDeleteModal(false);
    });

    elements.confirmModalCancel.addEventListener("click", () => {
      closeDeleteModal(false);
    });

    elements.confirmModalConfirm.addEventListener("click", () => {
      closeDeleteModal(true);
    });

    elements.confirmModal.addEventListener("click", (event) => {
      if (event.target === elements.confirmModal) {
        closeDeleteModal(false);
      }
    });

    window.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        !elements.confirmModal.classList.contains("hidden")
      ) {
        closeDeleteModal(false);
      }
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
      const removeButton = event.target.closest(".remove-item-button");
      if (!removeButton) {
        return;
      }

      const rows = elements.saleItems.querySelectorAll(".sale-item-row");
      if (rows.length === 1) {
        showFeedback("A Encomenda Precisa Ter pelo Menos uma Linha de Item.", "error");
        return;
      }

      removeButton.closest(".sale-item-row").remove();
      updateSaleSummary();
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
      showFeedback(error.message || "Erro ao Carregar os Dados Iniciais.", "error");
    }
  }

  init();
})();
