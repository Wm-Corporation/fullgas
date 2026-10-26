# Adendo ao Lote 1 — Pré-venda e itens em backorder

> **Substituído em 26/10/2026 pela black order — ver `docs/12-black-order.md`.** Pedidos antigos com pré-venda seguem este fluxo até saírem.

> **Audiência**: Claude Code.
> Este adendo **estende o Item 4** de `docs/05-mudancas-lote-1.md` (detalhe
> expandido do pedido). Aplique como parte do mesmo branch
> `feat/pedido-detalhe-expandido` ou em branch separado `feat/pre-venda`,
> à sua escolha — mas é trabalho contínuo, não substitui o Item 4 original.

## Regra de negócio

A loja passa a aceitar pedidos que incluem itens **sem estoque**, sem rejeitar
o pedido inteiro. Esses itens entram em estado de **backorder** (pré-venda):
ficam aguardando reposição e são enviados depois, em entrega/fatura próprias
que referenciam o pedido original.

**Decisões já confirmadas com o usuário** (não reabrir):

1. **No checkout**: pedido é aceito normalmente, mas a tela mostra um aviso
   antes da confirmação final: "X itens em pré-venda, prazo de envio depende
   de reposição". Cliente clica e segue; não é exigida confirmação adicional
   explícita.
2. **Quando o item em backorder for enviado**: gera-se uma **Entrega NOVA** e
   uma **Fatura NOVA**, ligadas ao mesmo pedido original via
   `EntregaPedido` / `PedidoFatura`. Não atualiza a entrega/fatura existente.
3. **Visibilidade**: a "aba de pré-venda" aparece nos **dois lugares** — visão
   admin (organização interna) e visão cliente (transparência).

## Implementação

### Schema (migração 003)

Crie `database/migrations/003_backorder.sql`, idempotente.

Adicionar coluna em `dbo.PedidoItem`:
- `EmBackorder BIT NOT NULL CONSTRAINT DF_PedidoItem_Backorder DEFAULT (0)`.

Por que coluna em vez de status calculado: a separação "está em backorder"
é decisão tomada no momento do pedido (com base no estoque daquela hora) e
precisa persistir mesmo que o estoque do produto mude depois. Não é função
de `Quantidade > QuantidadeEnviada` — esse cálculo só representa "ainda falta
enviar", que vale para qualquer item parcial.

Índice filtrado:
```sql
CREATE INDEX IX_PedidoItem_Backorder
    ON dbo.PedidoItem (PedidoId)
    WHERE EmBackorder = 1;
```

### Endpoint de criação do pedido

Em `POST /api/pedidos`, mudar a regra de baixa de estoque:

- Para cada item, verificar estoque disponível **dentro da transação**.
- Se há estoque suficiente: decrementa normalmente, `EmBackorder = 0`.
- Se NÃO há estoque (ou é insuficiente): aceita o item com `EmBackorder = 1`,
  **não decrementa estoque** (estoque vira negativo conceitualmente, mas como
  não é decrementado, fica em 0). Quando a reposição chegar, o admin atualiza
  estoque manualmente e isso destrava o envio.
- Tudo numa transação só. Nada de aceitar item bom e travar item ruim.

No retorno, devolva também `itensEmBackorder: [{ sku, nome, quantidade }]`
para o front conseguir mostrar o aviso na tela de confirmação.

### Tela do carrinho

No `frontend/js/shop.js`, na rota `#/carrinho`:

- Antes do botão "Enviar pedido", se algum item da cesta tiver
  `estoque < quantidade`, mostrar um bloco de aviso laranja/amarelo:
  "Aviso: N item(ns) será(ão) enviado(s) em pré-venda. Prazo depende de
  reposição." Listar os itens em pré-venda com nome e quantidade.
- O botão "Enviar pedido" continua normal — não exige confirmação extra
  (decisão 1).
- A tela de confirmação pós-pedido (a que mostra "Pedido enviado! Número:")
  ganha uma seção extra se `itensEmBackorder` veio populado, repetindo o
  aviso para o cliente lembrar.

### Tela de detalhe do pedido (estende Item 4 do lote 1)

Tanto no portal (cliente) quanto no admin, o detalhe expandido do pedido
agora divide os itens em **duas seções**:

- **Itens em envio normal**: os com `EmBackorder = 0`.
- **Itens em pré-venda**: os com `EmBackorder = 1`. Mostrar com um banner
  pequeno em cima: "Estes itens serão enviados quando o estoque for reposto.
  Eles farão parte de uma entrega/fatura separada."

Cada seção tem sua própria tabela de itens (mesmas colunas), e a barra de
progresso geral do pedido **inclui ambos** — uma peça em backorder ainda
pendente conta para o cálculo "X% (Y de Z enviadas)".

Importante: a separação é **visual**, não estrutural. É a mesma lista de
`PedidoItem`, só agrupada por `EmBackorder` no momento de renderizar.

### Visão admin — controle do envio em duas etapas

No painel admin, detalhe do pedido:

- Itens normais: input numérico para `QuantidadeEnviada` (como já planejado
  no Item 4 do lote).
- Itens em backorder: o input aparece **desabilitado** se
  `Produto.Estoque < (Quantidade - QuantidadeEnviada)`, com tooltip "sem
  estoque para envio". Quando o estoque é reposto (admin cadastra entrada
  via catálogo), o input destrava.
- Botão novo: **"Marcar pedido como Enviado (normal)"** — gera entrega+fatura
  cobrindo apenas os itens com `EmBackorder = 0` que ainda têm
  `QuantidadeEnviada < Quantidade`.
- Botão novo: **"Marcar pré-venda como Enviada"** — gera entrega+fatura
  separadas cobrindo apenas os itens com `EmBackorder = 1`. Aparece
  desabilitado se nenhum item em backorder tem estoque ainda.

Ambos os botões geram a entrega/fatura via lógica existente; a diferença é
o **filtro de quais itens incluir**.

### Endpoint de envio segmentado

Substituir/estender `PUT /api/pedidos/:numero/status` para aceitar um
parâmetro `escopo`:

- `escopo = 'normal'` — afeta apenas itens com `EmBackorder = 0`.
- `escopo = 'backorder'` — afeta apenas itens com `EmBackorder = 1`.
- `escopo = 'tudo'` ou ausente — comportamento antigo, todos os itens.

Cada chamada gera entrega+fatura próprias, com `Total` calculado apenas
sobre os itens daquele escopo. Idempotência: não gerar duplicado se já
existe entrega para aquele escopo daquele pedido.

### Recálculo de status do pedido

O status do pedido (`Pendente`/`Processando`/`Enviado`/`Entregue`) continua
sendo controlado **manualmente pelo admin**. Mas com pré-venda, vale documentar
o significado de `Enviado` no caso de pedidos mistos:

- "Enviado" no painel admin só faz sentido quando **todos** os itens
  (normais + backorder) foram enviados. Antes disso, o status correto é
  "Processando".
- Adicionar uma dica visual no painel: badge "Parcial" quando o pedido tem
  alguma entrega gerada mas ainda há itens não enviados. Texto pequeno
  abaixo do status atual.

## Critério de aceitação

Sequência manual para validar (com `val-cliente@powermotors.com` e
`val-admin@fullgas.com.br`):

1. **Setup**: como admin, escolha 2 SKUs: um com estoque positivo (digamos,
   `A54606015000`, com 90 em estoque) e um com estoque zero
   (`A45030905544` Kit Factory 300, que tem `previsao` setada).
2. **Pedido misto**: como cliente, adicione 2 unidades de cada à cesta. Na
   tela do carrinho, deve aparecer o aviso de pré-venda mencionando o Kit
   Factory. Confirme o pedido.
3. **Verificação pós-pedido**:
   - Pedido criado, número devolvido normalmente.
   - Estoque do `A54606015000` baixou para 88; estoque do `A45030905544`
     continua 0 (não decrementou).
   - No banco: 2 linhas em `PedidoItem`, uma com `EmBackorder = 0`, outra
     com `EmBackorder = 1`.
4. **Visão cliente em `#pedido/:numero`**: ver duas seções, "Itens em envio
   normal" com o filtro de ar, e "Itens em pré-venda" com o Kit Factory e
   banner explicativo. Barra de progresso 0%.
5. **Envio normal (admin)**: clicar em "Marcar pedido como Enviado (normal)".
   Gera Entrega A + Fatura A cobrindo apenas o filtro de ar. Barra de
   progresso do pedido vai para 50% (2 de 4). Status do pedido mostra
   "Processando" + badge "Parcial".
6. **Reposição (admin)**: edita o produto Kit Factory, sobe estoque para 5.
   O input de `QuantidadeEnviada` daquele item destrava na tela admin.
7. **Envio backorder (admin)**: clicar em "Marcar pré-venda como Enviada".
   Gera Entrega B + Fatura B cobrindo apenas o Kit Factory. Barra de
   progresso vai para 100%. Status pode passar para "Enviado".
8. **Aba financeira do cliente**: ver as DUAS faturas listadas, ambas
   referenciando o mesmo número de pedido.

## Itens fora do escopo deste adendo

- **Notificação automática para o cliente** quando a pré-venda for enviada:
  não faz parte. Pode entrar em um lote futuro junto com sistema de
  notificações por e-mail (que ainda não existe).
- **Reserva de estoque**: não há. Se dois clientes pedem o último item, o
  primeiro leva, o segundo entra em backorder automaticamente. Sem fila,
  sem promessa de ordem.
- **Cancelar item em backorder**: não há. Se quiser cancelar, cancela o
  pedido inteiro (funcionalidade existente).
