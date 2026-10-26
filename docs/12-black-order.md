# Black order (substitui a pré-venda do docs/06)

Regra definida pelo dono em 26/10/2026.

## Compra na loja

- Qualquer peça do catálogo pode ser comprada, em qualquer quantidade (teto de 100.000 por linha só contra erro de digitação).
- No checkout (`POST /api/pedidos`), cada linha leva **o que houver em estoque** para o pedido normal; o que faltar vira **black order**.
- O pedido normal tem fatura com **só** o que tinha estoque. A black order não é cobrada e não vai ao Tiny.
- Pedido e black order usam o mesmo número de compra. Se nada tinha estoque, não há pedido (nem fatura): só black order.
- Pedidos antigos com `PedidoItem.EmBackorder = 1` (pré-venda) continuam no fluxo antigo até saírem: foram faturados cheios.

## Bolinha do estoque (`FG.nivelEstoque` no store.js)

| Estoque | Bolinha | Texto |
|---|---|---|
| > 20 | verde | Em estoque |
| 10 a 20 | amarela | Estoque baixo |
| 1 a 9 | vermelha | Últimas unidades |
| 0 | vermelha | Black order (+ previsão, se houver) |

## Fila e reserva

- A fila de black order vem **antes da loja**, por ordem de chegada (`BlackOrderId`).
- Na sincronização com o Tiny (cron e checagem do checkout): `Estoque = saldo − reserva dos pedidos − fila`, e a fila recebe `saldo − reserva dos pedidos` (`alocarBlackOrders`).
- Quem passa a ter peça separada (`QuantidadeReservada` subiu) recebe uma notificação com link para `#blackorder/carrinho`.

## Carrinho da black order (`POST /api/blackorders/comprar`)

- O cliente escolhe quanto quer de cada peça que chegou (até o reservado) e paga **o preço do dia**, pela lista da empresa. Vira pedido normal com fatura (`BlackOrderAtendimento` liga os dois).
- Comprou **tudo** o que chegou: o que não chegou segue na fila.
- Comprou **menos** do que chegou: essa é a quantidade final; a linha se encerra e o que sobrou vai para o próximo da fila (ou para a loja).
- O cliente pode desistir do restante a qualquer momento; o admin pode cancelar com motivo (o cliente é avisado).

## Admin

- Tela **Black order**: fila por peça, atualização em lote da situação do envio da Europa, previsão e observação (com aviso opcional aos clientes), cancelamento.

## Banco (migration 050)

`BlackOrder`, `BlackOrderAtendimento`, `Notificacao.Link` e `CK_Notificacao_Origem` aceitando `'blackorder'`.
