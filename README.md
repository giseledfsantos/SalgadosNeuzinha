# Salgados da Neuzinha

Projeto web simples para controle de:

- cadastro de produtos;
- cadastro de clientes;
- cadastro de vendas;
- consulta de pedidos e valores em aberto por cliente.

## Estrutura

```text
.
|-- index.html
|-- src
|   |-- app.js
|   |-- config.js
|   |-- styles.css
|   |-- lib
|   |   |-- formatters.js
|   |   `-- supabase-client.js
|   `-- services
|       |-- customers.service.js
|       |-- products.service.js
|       |-- receivables.service.js
|       `-- sales.service.js
`-- supabase
    `-- schema.sql
```

## Funcionalidades

- Produtos com descricao, valor de venda, unidade e estoque.
- Clientes com nome e percentual de desconto.
- Vendas com cliente, itens vendidos, desconto automatico do cliente e pagamento por `pix`, `dinheiro` ou em branco.
- Consulta de vendas cadastradas.
- Consulta de clientes com valores em aberto e listagem de pedidos pendentes.
- Botao para baixar pedidos em aberto como `pix` ou `dinheiro`.

## Como usar

1. Crie um projeto no Supabase.
2. No SQL Editor do Supabase, execute o arquivo [`supabase/schema.sql`](file:///c:/Users/zeleg/OneDrive/Documentos/Dev/Salgados%20da%20Neuzinha/supabase/schema.sql).
3. Edite o arquivo [`src/config.js`](file:///c:/Users/zeleg/OneDrive/Documentos/Dev/Salgados%20da%20Neuzinha/src/config.js) com:
   - `supabaseUrl`
   - `supabaseAnonKey`
4. Abra o arquivo [`index.html`](file:///c:/Users/zeleg/OneDrive/Documentos/Dev/Salgados%20da%20Neuzinha/index.html) no navegador.

## Observacoes

- O projeto foi feito sem dependencias locais porque o ambiente atual nao possui `Node.js` e `npm` instalados.
- A biblioteca do Supabase eh carregada via CDN.
- O registro da venda reduz o estoque automaticamente.
- Se a forma de pagamento ficar em branco, a venda entra como pedido em aberto.
