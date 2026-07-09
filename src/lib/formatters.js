(function () {
  const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const decimalFormatter = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });

  function formatCurrency(value) {
    return currencyFormatter.format(Number(value || 0));
  }

  function formatPercent(value) {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  function formatQuantity(value) {
    return decimalFormatter.format(Number(value || 0));
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }

    return new Date(value).toLocaleString("pt-BR");
  }

  window.Formatters = {
    formatCurrency,
    formatPercent,
    formatQuantity,
    formatDate,
  };
})();
