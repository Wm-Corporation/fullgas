// Black order: o que faltou no estoque no checkout (sem fatura, sem Tiny). Não há fila: cada uma é
// atendida à parte. O admin libera a peça quando chega (liberarBlackOrder), ela fica guardada para o
// cliente e ele compra pelo carrinho da black order (POST /api/blackorders/comprar), que vira pedido normal.
import { query, getPool, sql } from './db.js';
import { criarNotificacao } from './notificacoes.js';

export const ABERTAS = ['Fila', 'Disponivel'];
export const LINK_CARRINHO = '#blackorder/carrinho';

// O que a linha ainda espera (inclui o que já está reservado).
export const pendente = (r) => r.Quantidade - r.QuantidadeAtendida - r.QuantidadeDescartada;

// Status depois de uma mudança de quantidades ('Fila' = aguardando chegada).
export function statusDe({ Quantidade, QuantidadeReservada, QuantidadeAtendida, QuantidadeDescartada }) {
  if (Quantidade - QuantidadeAtendida - QuantidadeDescartada > 0) return QuantidadeReservada > 0 ? 'Disponivel' : 'Fila';
  return QuantidadeAtendida > 0 ? 'Atendida' : 'Cancelada';
}

// Quanto do saldo do Tiny está guardado para black orders liberadas (a loja só vê o que sobra).
export async function reservaBlackOrders(produtoId) {
  const r = (await query(
    `SELECT ISNULL(SUM(QuantidadeReservada), 0) AS Reserva
       FROM dbo.BlackOrder
      WHERE ProdutoId = @pid AND Status = 'Disponivel'`,
    { pid: produtoId }
  ))[0];
  return Number(r?.Reserva) || 0;
}

// Admin libera peças de black orders abertas. pedidos: [{ id, quantidade? }] (sem quantidade = tudo o que falta).
// Tira do estoque da loja numa instrução só (sem estoque, recusa) e guarda para o cliente; avisa uma vez por empresa.
// Devolve { liberadas: [...], recusadas: [{ id, erro }] }.
export async function liberarBlackOrders(pedidos, adminId) {
  const ids = pedidos.map(p => p.id);
  const params = {};
  const marks = ids.map((id, i) => { params['i' + i] = id; return '@i' + i; });
  const linhas = await query(
    `SELECT BlackOrderId, ProdutoId, EmpresaId, NumeroPedido, Sku, NomeProduto, Quantidade,
            QuantidadeReservada, QuantidadeAtendida, QuantidadeDescartada, Status
       FROM dbo.BlackOrder WHERE BlackOrderId IN (${marks.join(',')})`,
    params
  );

  const liberadas = [];
  const recusadas = [];
  const pool = await getPool();
  for (const ped of pedidos) {
    const l = linhas.find(x => x.BlackOrderId === ped.id);
    if (!l) { recusadas.push({ id: ped.id, erro: 'Black order não encontrada.' }); continue; }
    const falta = pendente(l) - l.QuantidadeReservada;
    if (!ABERTAS.includes(l.Status) || falta <= 0) {
      recusadas.push({ id: ped.id, erro: `${l.NomeProduto} (${l.Sku}): nada a liberar.` });
      continue;
    }
    const q = ped.quantidade == null ? falta : Math.min(falta, ped.quantidade);
    if (!(q > 0)) { recusadas.push({ id: ped.id, erro: `${l.NomeProduto} (${l.Sku}): quantidade inválida.` }); continue; }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const baixa = await new sql.Request(tx)
        .input('pid', sql.Int, l.ProdutoId).input('q', sql.Int, q)
        .query(`UPDATE dbo.Produto SET Estoque = Estoque - @q, AtualizadoEm = SYSUTCDATETIME()
                OUTPUT inserted.Estoque
                 WHERE ProdutoId = @pid AND Estoque >= @q`);
      if (!baixa.recordset.length) {
        await tx.rollback();
        recusadas.push({ id: ped.id, erro: `${l.NomeProduto} (${l.Sku}): o estoque não tem ${q} un. livres.` });
        continue;
      }
      const res = l.QuantidadeReservada + q;
      const upd = await new sql.Request(tx)
        .input('id', sql.Int, l.BlackOrderId).input('res', sql.Int, res).input('resAntes', sql.Int, l.QuantidadeReservada)
        .input('st', sql.VarChar(12), statusDe({ ...l, QuantidadeReservada: res }))
        .input('atd', sql.Int, l.QuantidadeAtendida).input('desc', sql.Int, l.QuantidadeDescartada)
        .query(`UPDATE dbo.BlackOrder
                   SET QuantidadeReservada = @res, Status = @st, AvisadoEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
                OUTPUT inserted.BlackOrderId
                 WHERE BlackOrderId = @id AND QuantidadeReservada = @resAntes
                   AND QuantidadeAtendida = @atd AND QuantidadeDescartada = @desc AND Status IN ('Fila', 'Disponivel')`);
      if (!upd.recordset.length) {
        await tx.rollback();
        recusadas.push({ id: ped.id, erro: `${l.NomeProduto} (${l.Sku}): a black order mudou. Recarregue a página.` });
        continue;
      }
      await tx.commit();
      liberadas.push({ ...l, liberada: q, reservada: res });
    } catch (e) {
      try { await tx.rollback(); } catch { /* já desfeita */ }
      throw e;
    }
  }
  await avisarDisponiveis(liberadas, adminId);
  return { liberadas, recusadas };
}

// Um aviso por empresa, com o link do carrinho da black order.
async function avisarDisponiveis(avisos, criadoPor = null) {
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
      criadoPor,
      titulo: lista.length === 1
        ? `Chegou peça da sua black order: ${lista[0].NomeProduto}`
        : `Chegaram ${lista.length} peças da sua black order`,
      texto: 'Estas peças estão disponíveis em estoque e separadas para você:\n' + pecas.join('\n') +
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
