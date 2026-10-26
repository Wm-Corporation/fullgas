// Black order: o que faltou no estoque no checkout vira fila por peça (sem fatura, sem Tiny).
// A fila segura o saldo do Tiny antes da loja, na ordem de chegada; quem recebe peça é avisado
// e compra pelo carrinho da black order (POST /api/blackorders/comprar), que vira pedido normal.
import { query, sql } from './db.js';
import { criarNotificacao } from './notificacoes.js';

export const ABERTAS = ['Fila', 'Disponivel'];
export const LINK_CARRINHO = '#blackorder/carrinho';

// O que a linha ainda espera (inclui o que já está reservado).
export const pendente = (r) => r.Quantidade - r.QuantidadeAtendida - r.QuantidadeDescartada;

// Status depois de uma mudança de quantidades.
export function statusDe({ Quantidade, QuantidadeReservada, QuantidadeAtendida, QuantidadeDescartada }) {
  if (Quantidade - QuantidadeAtendida - QuantidadeDescartada > 0) return QuantidadeReservada > 0 ? 'Disponivel' : 'Fila';
  return QuantidadeAtendida > 0 ? 'Atendida' : 'Cancelada';
}

// Quanto do saldo do Tiny a fila segura: tudo o que ainda espera (a loja só vê o que sobra).
export async function reservaBlackOrders(produtoId) {
  const r = (await query(
    `SELECT ISNULL(SUM(Quantidade - QuantidadeAtendida - QuantidadeDescartada), 0) AS Reserva
       FROM dbo.BlackOrder
      WHERE ProdutoId = @pid AND Status IN ('Fila', 'Disponivel')`,
    { pid: produtoId }
  ))[0];
  return Number(r?.Reserva) || 0;
}

// Distribui `livre` pela fila em ordem de chegada. linhas: [{ BlackOrderId, pendente }] já ordenadas.
export function distribuir(linhas, livre) {
  let resto = Math.max(0, Math.floor(Number(livre) || 0));
  return linhas.map(l => {
    const reservada = Math.min(l.pendente, resto);
    resto -= reservada;
    return { id: l.BlackOrderId, reservada };
  });
}

// Recalcula a reserva da fila de uma peça. `livre` = saldo do Tiny menos a reserva dos pedidos.
// Grava só o que mudou e só se a linha não mudou no meio (compra/desistência concorrente).
// Quem passou a ter peça (reservada subiu) é avisado. Nunca lança: o estoque já foi gravado.
export async function alocarBlackOrders(produtoId, livre) {
  try {
    const linhas = await query(
      `SELECT BlackOrderId, EmpresaId, NumeroPedido, Sku, NomeProduto, Quantidade,
              QuantidadeReservada, QuantidadeAtendida, QuantidadeDescartada
         FROM dbo.BlackOrder
        WHERE ProdutoId = @pid AND Status IN ('Fila', 'Disponivel')
        ORDER BY BlackOrderId`,
      { pid: produtoId }
    );
    if (!linhas.length) return [];
    const plano = distribuir(linhas.map(l => ({ BlackOrderId: l.BlackOrderId, pendente: pendente(l) })), livre);

    const avisos = [];
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const nova = plano[i].reservada;
      if (nova === l.QuantidadeReservada) continue;
      const status = statusDe({ ...l, QuantidadeReservada: nova });
      const r = await query(
        `UPDATE dbo.BlackOrder
            SET QuantidadeReservada = @res, Status = @st, AtualizadoEm = SYSUTCDATETIME(),
                AvisadoEm = CASE WHEN @res > QuantidadeReservada THEN SYSUTCDATETIME() ELSE AvisadoEm END
          OUTPUT inserted.BlackOrderId
          WHERE BlackOrderId = @id AND QuantidadeReservada = @resAntes
            AND QuantidadeAtendida = @atd AND QuantidadeDescartada = @desc
            AND Status IN ('Fila', 'Disponivel')`,
        {
          res: nova, st: status, id: l.BlackOrderId, resAntes: l.QuantidadeReservada,
          atd: l.QuantidadeAtendida, desc: l.QuantidadeDescartada
        }
      );
      if (r.length && nova > l.QuantidadeReservada) avisos.push({ ...l, reservada: nova });
    }
    await avisarDisponiveis(avisos);
    return avisos;
  } catch (e) {
    console.error(`Falha ao distribuir a black order do produto ${produtoId}:`, e.message);
    return [];
  }
}

// Um aviso por empresa, com o link do carrinho da black order.
async function avisarDisponiveis(avisos) {
  const porEmpresa = new Map();
  for (const a of avisos) {
    if (!porEmpresa.has(a.EmpresaId)) porEmpresa.set(a.EmpresaId, []);
    porEmpresa.get(a.EmpresaId).push(a);
  }
  for (const [empresaId, lista] of porEmpresa) {
    const pecas = lista.map(a => `• ${a.NomeProduto} (${a.Sku}): ${a.reservada} un. — compra ${a.NumeroPedido}`);
    await criarNotificacao({
      empresaId,
      publico: 'cliente',
      origem: 'blackorder',
      link: LINK_CARRINHO,
      titulo: lista.length === 1
        ? `Chegou peça da sua black order: ${lista[0].NomeProduto}`
        : `Chegaram ${lista.length} peças da sua black order`,
      texto: 'Estas peças estão separadas para você:\n' + pecas.join('\n') +
        '\n\nAbra o carrinho da black order para escolher quanto quer de cada uma. ' +
        'Você paga só o que comprar; o que não quiser volta para o estoque.'
    });
  }
}

// Cria as linhas de black order de uma compra (na transação do checkout).
// itens: [{ produtoId, sku, nome, qtd }] — qtd é o que faltou no estoque.
export async function criarBlackOrders(tx, { numeroPedido, pedidoId, empresaId, usuarioId, itens }) {
  const criadas = [];
  for (const it of itens) {
    const r = await new sql.Request(tx)
      .input('num', sql.VarChar(20), numeroPedido)
      .input('pid', sql.Int, pedidoId)
      .input('eid', sql.Int, empresaId)
      .input('uid', sql.Int, usuarioId)
      .input('prod', sql.Int, it.produtoId)
      .input('sku', sql.VarChar(40), it.sku)
      .input('nome', sql.NVarChar(200), it.nome)
      .input('qtd', sql.Int, it.qtd)
      .query(`INSERT INTO dbo.BlackOrder (NumeroPedido, PedidoId, EmpresaId, UsuarioId, ProdutoId, Sku, NomeProduto, Quantidade)
              OUTPUT inserted.BlackOrderId
              VALUES (@num, @pid, @eid, @uid, @prod, @sku, @nome, @qtd)`);
    criadas.push({ id: r.recordset[0]?.BlackOrderId, sku: it.sku, nome: it.nome, quantidade: it.qtd });
  }
  return criadas;
}
