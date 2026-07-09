(function () {
  const config = window.APP_CONFIG || {};
  const isConfigured =
    Boolean(config.supabaseUrl) &&
    Boolean(config.supabaseAnonKey) &&
    !config.supabaseUrl.includes("SUA-URL") &&
    !config.supabaseAnonKey.includes("SUA-CHAVE");

  function getClient() {
    if (!isConfigured) {
      return null;
    }

    const { createClient } = window.supabase;
    return createClient(config.supabaseUrl, config.supabaseAnonKey);
  }

  window.SupabaseConnection = {
    isConfigured,
    client: getClient(),
  };
})();
