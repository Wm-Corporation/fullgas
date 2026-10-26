# Black order (substitui a pré-venda do docs/06)

Regra definida pelo dono em 26/10/2026.

## Compra na loja

- Qualquer peça do catálogo pode ser comprada, em qualquer quantidade (teto de 100.000 por linha só contra erro de digitação).
- No checkout (`POST /api/pedidos`), cada linha leva **o que houver em estoque** para o pedido normal; o que faltar vira **black order**.
- O pedido normal **não gera fatura no checkout**: cada "Confirmar envio" exportado ao Tiny gera a fatura só das peças daquela remessa (`Pedido.FaturaNaRemessa`, `FaturaItem`). A black order não é cobrada e não vai ao Tiny.
- Peça não encontrada na prateleira: o admin marca a quantidade e o motivo ("Não foi encontrado", "Estoque incorreto", "Peça danificada" ou texto) e escolhe **retirar do pedido** ou **mandar para a black order** do cliente. Não é faturada; o cliente vê o motivo e é avisado. Conferir o estoque no Tiny (se estiver errado, a peça volta à loja).
- Pedido e black order usam o mesmo número de compra. Se nada tinha estoque, não há pedido (nem fatura): só black order.
- Pedidos antigos com `PedidoItem.EmBackorder = 1` (pré-venda) continuam no fluxo antigo até saírem: foram faturados cheios.

## Bolinha do estoque (`FG.nivelEstoque` no store.js)

| Estoque | Bolinha | Texto |
|---|---|---|
| > 20 | verde | Em estoque |
| 10 a 20 | amarela | Em estoque |
| 1 a 9 | vermelha | Em estoque |
| 0 | vermelha | Black order (+ previsão, se houver) |

## Fila e reserva (revisto em 27/10/2026)

- O saldo do Tiny usado é **saldo − reservado** (`saldoLivre`): pedido aprovado no Tiny (nossa remessa ou Magento) reserva a peça sem tirá-la do saldo até ser faturado. Sem descontar, a mesma peça era vendida duas vezes (caso real de 26/10).
- A fila vem **antes da loja**: `Estoque = saldo livre − reserva dos pedidos − toda a fila`.
- Reserva **tudo ou nada** e **o primeiro da fila sempre antes**: só reserva quando chegou a quantidade inteira dele; enquanto não chega, as peças ficam guardadas (fora da loja) e quem vem atrás espera.
- Só o dono é avisado, quando a quantidade dele fica completa. O vigia (`vigiarBlackOrders`, tiny-cron.js) lê no Tiny, a cada 2 min, só as peças com fila aberta.
- Cancelar pedido recalcula o estoque pelo Tiny: o que volta passa pela fila antes da loja.

## Carrinho da black order (`POST /api/blackorders/comprar`)

- O cliente escolhe quanto quer de cada peça que chegou (até o reservado) e paga **o preço do dia**, pela lista da empresa. Vira pedido normal com fatura (`BlackOrderAtendimento` liga os dois).
- Comprou **tudo** o que chegou: o que não chegou segue na fila.
- Comprou **menos** do que chegou: essa é a quantidade final; a linha se encerra e o que sobrou vai para o próximo da fila (ou para a loja).
- O cliente pode desistir do restante a qualquer momento; o admin pode cancelar com motivo (o cliente é avisado).

## Admin

- Tela **Black order**: fila por peça, atualização em lote da situação do envio da Europa, previsão e observação (com aviso opcional aos clientes), cancelamento.

## Banco (migrations 050 e 051)

050: `BlackOrder`, `BlackOrderAtendimento`, `Notificacao.Link` e `CK_Notificacao_Origem` aceitando `'blackorder'`.
051: `Pedido.FaturaNaRemessa`, `PedidoItem.QuantidadeNaoEncontrada`/`MotivoNaoEncontrada` (quantidade do item pode ir a 0) e `FaturaItem`. Pedidos antigos seguem com a fatura cheia.
