// ---- Pedidos ----
// Ciclo: Pendente → Aprovado → (remessa) Parcial → (remessa) Enviado → Entregue; Cancelado de qualquer não final.
// Aprovar não vai ao Tiny. Só o "Confirmar envio" (remessa) exporta as peças que saíram.
import { Router } from 'express';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin, requireAreaAny } from '../auth.js';
import {
  exportacaoLigada, atualizarEstoqueCesta, inserirExportacao,
  processarExportacoes, cancelarExportacoesDoPedido
} from '../tiny-pedidos.js';
import { registrarEventoPedido, historicoDoPedido, resumoPecas } from '../historico-pedido.js';
import { listaDaEmpresa, aplicarPercentual } from '../lista-preco.js';
import { criarBlackOrders } from '../black-order.js';
import { criarNotificacao } from '../notificacoes.js';

const router = Router();

// Status escolhíveis pelo admin. 'Parcial' é consequência do envio (statusPorEnvio).
const STATUS_VALIDOS = ['Pendente', 'Aprovado', 'Enviado', 'Entregue', 'Cancelado'];
// Status terminais: uma vez aqui, o pedido não muda mais.
const STATUS_FINAIS = ['Entregue', 'Cancelado'];
// Escopos de envio aceitos.
const ESCOPOS = ['normal', 'backorder', 'tudo'];
// Teto por linha da cesta (evita número absurdo digitado por engano).
const QTD_MAX = 100000;

function toIso(d) {
  return d instanceof Date ? d.toISOString() : (d || null);
}

// Item no formato do front, com envio parcial e pré-venda.
function montarItem(r) {
  return {
    itemId: r.PedidoItemId,
    artigo: r.Sku,
    nome: r.NomeProduto,
    preco: Number(r.PrecoUnitario),
    qtd: r.Quantidade,
    qtdEnviada: r.QuantidadeEnviada,
    // Já foi ao Tiny. qtdEnviada - qtdExportada = próxima remessa.
    qtdExportada: r.QuantidadeExportada,
    backorder: !!r.EmBackorder,
    // Nº da reivindicação de varejo aprovada que atingiu este item (ou null).
    garantiaNumero: r.GarantiaNumero || null,
    // Peças que o admin não encontrou (saíram do pedido ou foram para a black order) e o motivo.
    naoEncontrada: r.QuantidadeNaoEncontrada || 0,
    motivoNaoEncontrada: r.MotivoNaoEncontrada || null
  };
}

// Valores só para quem tem a área 'financeiro' (ou admin, gestor, acesso total).
export function podeVerFinanceiro(u) {
  return u.papel === 'admin' || u.gestor || !Array.isArray(u.perm) || u.perm.includes('financeiro');
}

// Remove os valores do pedido (somem, em vez de virar R$ 0,00).
function semValores(pedido) {
  const { total, faturas, ...resto } = pedido;
  return {
    ...resto,
    itens: (resto.itens || []).map(({ preco, ...i }) => i)
  };
}

// Lista de pedidos no formato do store.js + progresso de envio por pedido.
// boGeradas: Map<PedidoId, { n, pecas }>; daBlackOrder: Set<PedidoId> (comprados pelo carrinho da black order).
function montarPedidos(pedidoRows, itemRows, boGeradas = new Map(), daBlackOrder = new Set()) {
  const porPedido = new Map();
  for (const r of itemRows) {
    if (!porPedido.has(r.PedidoId)) porPedido.set(r.PedidoId, []);
    porPedido.get(r.PedidoId).push(montarItem(r));
  }
  return pedidoRows.map(p => {
    const itens = porPedido.get(p.PedidoId) || [];
    const somaQtd = itens.reduce((s, i) => s + i.qtd, 0);
    const somaEnv = itens.reduce((s, i) => s + i.qtdEnviada, 0);
    return {
      id: p.NumeroPedido,
      data: toIso(p.DataPedido),
      usuario: p.UsuarioEmail,
      empresa: p.Empresa,
      garantia: p.Tipo === 'garantia',
      itens,
      total: Number(p.Total),
      status: p.Status,
      progresso: {
        qtd: somaQtd,
        enviada: somaEnv,
        pct: somaQtd ? Math.round((somaEnv / somaQtd) * 100) : 0,
        parcial: somaEnv > 0 && somaEnv < somaQtd
      },
      temBackorder: itens.some(i => i.backorder),
      faturaNaRemessa: !!p.FaturaNaRemessa,
      blackOrders: boGeradas.get(p.PedidoId) || null,
      daBlackOrder: daBlackOrder.has(p.PedidoId)
    };
  });
}

const SELECT_PEDIDO =
  `SELECT p.PedidoId, p.NumeroPedido, p.DataPedido, p.Status, p.Total, p.Tipo, p.FaturaNaRemessa,
          u.Email AS UsuarioEmail, e.RazaoSocial AS Empresa
     FROM dbo.Pedido p
     JOIN dbo.Usuario u ON u.UsuarioId = p.UsuarioId
     JOIN dbo.Empresa e ON e.EmpresaId = p.EmpresaId`;

const SELECT_ITENS =
  `SELECT pi.PedidoId, pi.PedidoItemId, pi.Sku, pi.NomeProduto, pi.PrecoUnitario,
          pi.Quantidade, pi.QuantidadeEnviada, pi.QuantidadeExportada,
          pi.EmBackorder, pi.GarantiaNumero, pi.QuantidadeNaoEncontrada, pi.MotivoNaoEncontrada`;

// Fatura do pedido. Pedidos antigos com pré-venda (EmBackorder) foram faturados cheios.
async function gerarFaturaPedido(tx, pedidoId, empresaId, total) {
  const fat = await new sql.Request(tx)
    .input('eid', sql.Int, empresaId)
    .input('val', sql.Decimal(12, 2), total)
    .query(`INSERT INTO dbo.Fatura (NumeroFatura, Tipo, EmpresaId, Valor)
            OUTPUT inserted.FaturaId, inserted.NumeroFatura
            VALUES (CAST(NEXT VALUE FOR dbo.Seq_NumeroFatura AS VARCHAR(24)), 'Fatura', @eid, @val)`);
  const { FaturaId, NumeroFatura } = fat.recordset[0];
  await new sql.Request(tx)
    .input('pid', sql.Int, pedidoId).input('fid', sql.Int, FaturaId)
    .query('INSERT INTO dbo.PedidoFatura (PedidoId, FaturaId) VALUES (@pid, @fid)');
  return { faturaId: FaturaId, numeroFatura: NumeroFatura };
}

// (Entregas e rastreios saíram do fluxo; as tabelas ficam pelos pedidos antigos.)

// Fatura de UMA remessa (pedidos com FaturaNaRemessa): só as peças que saíram nela, com os itens gravados.
async function gerarFaturaRemessa(tx, pedidoId, empresaId, itens) {
  const total = Math.round(itens.reduce((s, i) => s + i.preco * i.qtd, 0) * 100) / 100;
  const fat = await gerarFaturaPedido(tx, pedidoId, empresaId, total);
  for (const it of itens) {
    await new sql.Request(tx)
      .input('fid', sql.Int, fat.faturaId)
      .input('sku', sql.VarChar(40), it.sku)
      .input('nome', sql.NVarChar(200), it.nome)
      .input('preco', sql.Decimal(12, 2), it.preco)
      .input('qtd', sql.Int, it.qtd)
      .query(`INSERT INTO dbo.FaturaItem (FaturaId, Sku, NomeProduto, PrecoUnitario, Quantidade)
              VALUES (@fid, @sku, @nome, @preco, @qtd)`);
  }
  return { ...fat, total };
}

// Fecha a remessa: o que foi enviado e ainda não foi ao Tiny vira UM pedido lá.
// Só peças em estoque. Roda na transação do envio; devolve os itens da remessa.
// Pedido novo (FaturaNaRemessa) ganha aqui a fatura desta remessa, em `itens.fatura`.
async function confirmarRemessa(tx, pedidoId) {
  const pend = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT PedidoItemId, Sku, NomeProduto, PrecoUnitario,
                   QuantidadeEnviada - QuantidadeExportada AS Qtd
              FROM dbo.PedidoItem
             WHERE PedidoId = @pid AND EmBackorder = 0
               AND QuantidadeEnviada > QuantidadeExportada`);
  const itens = pend.recordset.map(r => ({
    sku: r.Sku, nome: r.NomeProduto, preco: Number(r.PrecoUnitario), qtd: r.Qtd
  }));
  if (!itens.length) return [];

  // Marca mesmo com a exportação desligada, para não reenviar ao ligar.
  await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`UPDATE dbo.PedidoItem SET QuantidadeExportada = QuantidadeEnviada
             WHERE PedidoId = @pid AND EmBackorder = 0
               AND QuantidadeEnviada > QuantidadeExportada`);
  if (exportacaoLigada()) await inserirExportacao(tx, pedidoId, 'remessa', itens);

  const ped = (await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query('SELECT EmpresaId, FaturaNaRemessa FROM dbo.Pedido WHERE PedidoId = @pid')).recordset[0];
  if (ped?.FaturaNaRemessa) itens.fatura = await gerarFaturaRemessa(tx, pedidoId, ped.EmpresaId, itens);
  return itens;
}

// Texto da fatura gerada na remessa, para o histórico.
const textoFatura = (itens) => (itens.fatura
  ? ` · fatura ${itens.fatura.numeroFatura} (R$ ${itens.fatura.total.toFixed(2).replace('.', ',')})` : '');

// Peças enviadas que ainda não foram ao Tiny (falta "Confirmar envio").
async function enviadasSemConfirmar(tx, pedidoId) {
  const r = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT ISNULL(SUM(QuantidadeEnviada - QuantidadeExportada), 0) AS n
              FROM dbo.PedidoItem
             WHERE PedidoId = @pid AND EmBackorder = 0
               AND QuantidadeEnviada > QuantidadeExportada`);
  return r.recordset[0]?.n || 0;
}

// Algo já foi ao Tiny? Se sim, o pedido não volta a 'Pendente'.
async function jaFoiAoTiny(tx, pedidoId) {
  const r = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT
              (SELECT COUNT(*) FROM dbo.PedidoItem
                WHERE PedidoId = @pid AND QuantidadeExportada > 0) +
              (SELECT COUNT(*) FROM dbo.TinyPedidoExport
                WHERE PedidoId = @pid AND Status <> 'cancelado') AS n`);
  return (r.recordset[0]?.n || 0) > 0;
}

// Pré-venda liberada vai ao Tiny à parte (-PV); marcar evita reenvio na remessa.
async function marcarExportados(tx, pedidoItemIds) {
  for (const id of pedidoItemIds) {
    await new sql.Request(tx).input('iid', sql.Int, id)
      .query('UPDATE dbo.PedidoItem SET QuantidadeExportada = QuantidadeEnviada WHERE PedidoItemId = @iid');
  }
}

// Status pelo que já saiu E está no Tiny (só peças em estoque):
//   nada → mantém (Parcial/Enviado sem nada volta a Aprovado) · parte → Parcial · tudo → Enviado
async function statusPorEnvio(tx, pedidoId, statusAtual) {
  const c = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT
              SUM(CASE WHEN EmBackorder = 0 THEN 1 ELSE 0 END) AS totNormais,
              SUM(CASE WHEN EmBackorder = 0 AND Quantidade > Confirmada THEN 1 ELSE 0 END) AS pendNormais,
              SUM(CASE WHEN Confirmada > 0 THEN 1 ELSE 0 END) AS comEnvio,
              SUM(CASE WHEN Quantidade > Confirmada THEN 1 ELSE 0 END) AS pendTotal
            FROM (SELECT EmBackorder, Quantidade,
                         CASE WHEN EmBackorder = 1 OR QuantidadeEnviada < QuantidadeExportada
                              THEN QuantidadeEnviada ELSE QuantidadeExportada END AS Confirmada
                    FROM dbo.PedidoItem WHERE PedidoId = @pid) x`);
  const { totNormais, pendNormais, comEnvio, pendTotal } = c.recordset[0];
  if (!comEnvio) return ['Parcial', 'Enviado'].includes(statusAtual) ? 'Aprovado' : statusAtual;
  const faltam = totNormais > 0 ? pendNormais > 0 : pendTotal > 0;
  return faltam ? 'Parcial' : 'Enviado';
}

// GET /api/pedidos — cliente vê os da empresa; admin vê todos. Valores dependem de 'financeiro'.
router.get('/pedidos', requireAuth, requireAreaAny(['loja', 'pedidos']), async (req, res, next) => {
  try {
    const admin = req.user.papel === 'admin';
    const eid = admin ? null : req.user.empresaId;

    const pedidoRows = await query(
      SELECT_PEDIDO +
      ' WHERE (@eid IS NULL OR p.EmpresaId = @eid) ORDER BY p.DataPedido DESC, p.PedidoId DESC',
      { eid }
    );
    const itemRows = await query(
      SELECT_ITENS +
      `   FROM dbo.PedidoItem pi
          JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
         WHERE (@eid IS NULL OR p.EmpresaId = @eid)
         ORDER BY pi.PedidoItemId`,
      { eid }
    );
    const boRows = await query(
      `SELECT PedidoId, COUNT(*) AS n, SUM(Quantidade) AS pecas
         FROM dbo.BlackOrder
        WHERE PedidoId IS NOT NULL AND (@eid IS NULL OR EmpresaId = @eid)
        GROUP BY PedidoId`,
      { eid }
    );
    const atendRows = await query(
      `SELECT DISTINCT a.PedidoId
         FROM dbo.BlackOrderAtendimento a
         JOIN dbo.BlackOrder bo ON bo.BlackOrderId = a.BlackOrderId
        WHERE (@eid IS NULL OR bo.EmpresaId = @eid)`,
      { eid }
    );
    const pedidos = montarPedidos(pedidoRows, itemRows,
      new Map(boRows.map(r => [r.PedidoId, { n: r.n, pecas: r.pecas }])),
      new Set(atendRows.map(r => r.PedidoId)));
    res.json(podeVerFinanceiro(req.user) ? pedidos : pedidos.map(semValores));
  } catch (e) { next(e); }
});

// GET /api/pedidos/:numero — detalhe, itens, faturas e progresso de envio.
router.get('/pedidos/:numero', requireAuth, requireAreaAny(['loja', 'pedidos']), async (req, res, next) => {
  try {
    const admin = req.user.papel === 'admin';
    const eid = admin ? null : req.user.empresaId;
    const num = req.params.numero;

    const pedidoRows = await query(
      SELECT_PEDIDO + ' WHERE p.NumeroPedido = @num AND (@eid IS NULL OR p.EmpresaId = @eid)',
      { num, eid }
    );
    if (!pedidoRows.length) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    const p = pedidoRows[0];

    const itemRows = await query(
      SELECT_ITENS + `, pr.Estoque AS EstoqueAtual
         FROM dbo.PedidoItem pi
         JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
         LEFT JOIN dbo.Produto pr ON pr.ProdutoId = pi.ProdutoId
        WHERE p.NumeroPedido = @num
        ORDER BY pi.PedidoItemId`,
      { num }
    );
    const itens = itemRows.map(r => Object.assign(montarItem(r), {
      estoque: r.EstoqueAtual == null ? null : r.EstoqueAtual
    }));

    // Faturas do pedido (via PedidoFatura). Entregas/rastreios saíram do fluxo.
    const faturaRows = await query(
      `SELECT f.NumeroFatura, f.DataEmissao, f.Valor, f.Status
         FROM dbo.PedidoFatura pf
         JOIN dbo.Fatura f ON f.FaturaId = pf.FaturaId
         JOIN dbo.Pedido p ON p.PedidoId = pf.PedidoId
        WHERE p.NumeroPedido = @num
        ORDER BY f.FaturaId`,
      { num }
    );
    const faturas = faturaRows.map(f => ({
      numero: f.NumeroFatura, data: toIso(f.DataEmissao),
      valor: Number(f.Valor), status: f.Status
    }));

    const somaQtd = itens.reduce((s, i) => s + i.qtd, 0);
    const somaEnv = itens.reduce((s, i) => s + i.qtdEnviada, 0);

    const detalhe = {
      id: p.NumeroPedido,
      data: toIso(p.DataPedido),
      usuario: p.UsuarioEmail,
      empresa: p.Empresa,
      garantia: p.Tipo === 'garantia',
      total: Number(p.Total),
      status: p.Status,
      faturaNaRemessa: !!p.FaturaNaRemessa,
      itens,
      faturas,
      progresso: {
        qtd: somaQtd,
        enviada: somaEnv,
        pct: somaQtd ? Math.round((somaEnv / somaQtd) * 100) : 0,
        parcial: somaEnv > 0 && somaEnv < somaQtd
      },
      temBackorder: itens.some(i => i.backorder)
    };
    // Black orders que esta compra gerou, e a black order que este pedido atendeu (se veio do carrinho dela).
    const boRows = await query(
      `SELECT BlackOrderId, Sku, NomeProduto, Quantidade, QuantidadeReservada, QuantidadeAtendida,
              QuantidadeDescartada, Status
         FROM dbo.BlackOrder WHERE PedidoId = @pid ORDER BY BlackOrderId`,
      { pid: p.PedidoId }
    );
    detalhe.blackOrders = boRows.map(b => ({
      id: b.BlackOrderId, artigo: b.Sku, nome: b.NomeProduto, qtd: b.Quantidade,
      reservada: b.QuantidadeReservada, atendida: b.QuantidadeAtendida, descartada: b.QuantidadeDescartada,
      pendente: b.Quantidade - b.QuantidadeAtendida - b.QuantidadeDescartada, status: b.Status
    }));
    const origemRows = await query(
      `SELECT bo.BlackOrderId, bo.NumeroPedido, bo.Sku, bo.NomeProduto, a.Quantidade
         FROM dbo.BlackOrderAtendimento a
         JOIN dbo.BlackOrder bo ON bo.BlackOrderId = a.BlackOrderId
        WHERE a.PedidoId = @pid ORDER BY bo.BlackOrderId`,
      { pid: p.PedidoId }
    );
    detalhe.daBlackOrder = origemRows.map(o => ({
      id: o.BlackOrderId, compra: o.NumeroPedido, artigo: o.Sku, nome: o.NomeProduto, qtd: o.Quantidade
    }));

    // Linha do tempo (migration 047); sem 'financeiro', eventos com valor saem sem detalhe.
    const verValores = podeVerFinanceiro(req.user);
    detalhe.historico = (await historicoDoPedido(p.PedidoId)).map(ev =>
      verValores || !/R\$/.test(ev.detalhe) ? ev : { ...ev, detalhe: '' });

    // Sem 'financeiro': sem total, preços e faturas.
    res.json(verValores ? detalhe : semValores(detalhe));
  } catch (e) { next(e); }
});

// Número da compra por SEQUENCE ('0005' + 6 dígitos). Pedido e black order da compra usam o mesmo.
export async function novoNumeroPedido(tx) {
  const num = await new sql.Request(tx).query(`
    SELECT
      '0005' + RIGHT('000000' + CAST(NEXT VALUE FOR dbo.Seq_NumeroPedido AS VARCHAR(20)), 6) AS NumeroPedido,
      SYSUTCDATETIME() AS Agora;`);
  return num.recordset[0];
}

// Grava pedido 'Pendente' + itens (todos em estoque). Roda na transação de quem chama.
// Sem fatura aqui: ela sai em cada remessa exportada ao Tiny (FaturaNaRemessa), só com o que foi encontrado.
// itens: [{ produtoId, sku, nome, preco, qtd }] com o preço já da lista.
export async function gravarPedido(tx, { numero, agora, user, lista, itens }) {
  const total = Math.round(itens.reduce((s, i) => s + i.preco * i.qtd, 0) * 100) / 100;
  const insPed = await new sql.Request(tx)
    .input('num', sql.VarChar(20), numero)
    .input('uid', sql.Int, user.id)
    .input('eid', sql.Int, user.empresaId)
    .input('data', sql.DateTime2, agora)
    .input('total', sql.Decimal(12, 2), total)
    .input('lid', sql.Int, lista?.id ?? null)
    .input('lpct', sql.Decimal(7, 2), lista ? lista.percentual : null)
    .query(`INSERT INTO dbo.Pedido (NumeroPedido, UsuarioId, EmpresaId, DataPedido, Status, Total,
                                    ListaPrecoId, ListaPrecoPercentual, FaturaNaRemessa)
            OUTPUT inserted.PedidoId
            VALUES (@num, @uid, @eid, @data, 'Pendente', @total, @lid, @lpct, 1)`);
  const pedidoId = insPed.recordset[0].PedidoId;

  for (const it of itens) {
    await new sql.Request(tx)
      .input('pid', sql.Int, pedidoId)
      .input('prod', sql.Int, it.produtoId)
      .input('sku', sql.VarChar(40), it.sku)
      .input('nome', sql.NVarChar(200), it.nome)
      .input('preco', sql.Decimal(12, 2), it.preco)
      .input('qtd', sql.Int, it.qtd)
      .query(`INSERT INTO dbo.PedidoItem (PedidoId, ProdutoId, Sku, NomeProduto, PrecoUnitario, Quantidade, EmBackorder)
              VALUES (@pid, @prod, @sku, @nome, @preco, @qtd, 0)`);
  }

  return { pedidoId, total };
}

// POST /api/pedidos — cria a partir da cesta: { itens: [{ sku, quantidade }] }.
// Cada peça leva o que houver em estoque (pedido + fatura); o que faltar vira black order
// (sem fatura, sem Tiny), ligada ao mesmo número. Nada tem estoque = só black order, sem pedido.
router.post('/pedidos', requireAuth, requireAreaAny(['loja', 'pedidos']), async (req, res, next) => {
  const itensReq = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itensReq.length) return res.status(400).json({ erro: 'A cesta está vazia.' });

  // Mescla SKUs repetidos e valida quantidades inteiras positivas.
  const merged = new Map();
  for (const it of itensReq) {
    const skuItem = String(it?.sku || '').trim();
    const qtd = Number(it?.quantidade);
    if (!skuItem || !Number.isInteger(qtd) || qtd <= 0 || qtd > QTD_MAX)
      return res.status(400).json({ erro: 'Item inválido na cesta.' });
    merged.set(skuItem, (merged.get(skuItem) || 0) + qtd);
  }

  // Confere o saldo real no Tiny antes (estoque compartilhado com o Magento). Tiny fora não trava.
  try { await atualizarEstoqueCesta([...merged.keys()]); }
  catch (e) { console.warn('⚠ Checagem de estoque no Tiny indisponível:', e.message); }

  // Preço da lista da empresa, calculado aqui (nunca vem da cesta).
  let lista = null;
  try { lista = req.user.papel === 'admin' ? null : await listaDaEmpresa(req.user.empresaId); }
  catch (e) { return next(e); }
  const pct = lista?.percentual || 0;

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const itensSnap = [];   // vão no pedido (tinham estoque)
    const faltas = [];      // viram black order
    for (const [skuItem, qtd] of merged) {
      // Baixa atômica do que houver, até a quantidade pedida.
      const upd = await new sql.Request(tx)
        .input('sku', sql.VarChar(40), skuItem)
        .input('qtd', sql.Int, qtd)
        .query(`UPDATE dbo.Produto
                   SET Estoque = Estoque - CASE WHEN Estoque >= @qtd THEN @qtd
                                                WHEN Estoque > 0 THEN Estoque ELSE 0 END,
                       AtualizadoEm = SYSUTCDATETIME()
                OUTPUT inserted.ProdutoId, inserted.Nome, inserted.Preco, deleted.Estoque AS EstoqueAntes
                 WHERE Sku = @sku`);
      if (!upd.recordset.length) {
        await tx.rollback();
        return res.status(400).json({ erro: 'Produto não encontrado: ' + skuItem });
      }
      const row = upd.recordset[0];
      const sai = Math.min(qtd, Math.max(0, Number(row.EstoqueAntes) || 0));
      if (sai > 0) {
        itensSnap.push({ produtoId: row.ProdutoId, sku: skuItem, nome: row.Nome, preco: aplicarPercentual(row.Preco, pct), qtd: sai });
      }
      if (qtd > sai) faltas.push({ produtoId: row.ProdutoId, sku: skuItem, nome: row.Nome, qtd: qtd - sai });
    }

    const { NumeroPedido, Agora } = await novoNumeroPedido(tx);
    let pedidoId = null, total = 0;
    if (itensSnap.length) {
      ({ pedidoId, total } = await gravarPedido(tx, { numero: NumeroPedido, agora: Agora, user: req.user, lista, itens: itensSnap }));
    }
    const blackOrders = faltas.length
      ? await criarBlackOrders(tx, {
        numeroPedido: NumeroPedido, pedidoId, empresaId: req.user.empresaId, usuarioId: req.user.id, itens: faltas
      })
      : [];

    // Não exporta ao Tiny aqui: só na remessa. Até lá valem as reservas (pedidos e fila).
    await tx.commit();

    const emp = await query('SELECT RazaoSocial FROM dbo.Empresa WHERE EmpresaId = @id', { id: req.user.empresaId });
    if (pedidoId) {
      await registrarEventoPedido({
        pedidoId, tipo: 'criado', titulo: 'Pedido criado', user: req.user,
        detalhe: resumoPecas(itensSnap) +
          (blackOrders.length ? ` · ${blackOrders.length} peça(s) em black order (sem cobrança)` : '')
      });
    }

    res.status(201).json({
      id: NumeroPedido,
      pedidoCriado: !!pedidoId,
      data: toIso(Agora),
      usuario: req.user.email,
      empresa: emp[0]?.RazaoSocial || '',
      itens: itensSnap.map(i => ({ artigo: i.sku, nome: i.nome, preco: i.preco, qtd: i.qtd })),
      blackOrders: blackOrders.map(b => ({ id: b.id, sku: b.sku, nome: b.nome, quantidade: b.quantidade })),
      total,
      status: pedidoId ? 'Pendente' : null
    });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/pedidos/:numero/status (admin) — { status?, escopo? }
//   Aprovado  ← só de Pendente; não vai ao Tiny.
//   Pendente  ← só se nada foi ao Tiny.
//   Cancelado → devolve ao estoque o que não saiu e anula a fatura.
//   Entregue  ← só de Enviado.
//   escopo ou 'Enviado' → envio segmentado; peças em estoque já fecham a remessa.
router.put('/pedidos/:numero/status', requireAuth, requireAdmin, async (req, res, next) => {
  const status = String(req.body?.status || '').trim();
  let escopo = String(req.body?.escopo || '').trim().toLowerCase();

  if (escopo && !ESCOPOS.includes(escopo))
    return res.status(400).json({ erro: 'Escopo inválido.' });
  if (status && !STATUS_VALIDOS.includes(status))
    return res.status(400).json({ erro: 'Status inválido.' });
  if (!status && !escopo)
    return res.status(400).json({ erro: 'Informe um status ou um escopo de envio.' });

  const isShip = !!escopo || status === 'Enviado';
  if (isShip && !escopo) escopo = 'tudo';

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  const recusar = async (http, erro) => { await tx.rollback(); return res.status(http).json({ erro }); };
  try {
    await tx.begin();

    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .query('SELECT PedidoId, Status, EmpresaId, Total FROM dbo.Pedido WHERE NumeroPedido = @num');
    if (!cur.recordset.length) return recusar(404, 'Pedido não encontrado.');
    const ped = cur.recordset[0];
    if (STATUS_FINAIS.includes(ped.Status))
      return recusar(409, `Pedido ${ped.Status.toLowerCase()} não pode mudar de status.`);

    // ---- Cancelamento ----
    if (status === 'Cancelado') {
      // Peça enviada sem "Confirmar envio": o admin resolve antes de cancelar.
      const semConfirmar = await enviadasSemConfirmar(tx, ped.PedidoId);
      if (semConfirmar)
        return recusar(409, `${semConfirmar} peça(s) marcadas como enviadas ainda não foram confirmadas. ` +
          'Clique em "Confirmar envio" (se saíram) ou zere a quantidade enviada (se não saíram) antes de cancelar.');

      // Cancelar aqui cancela tudo no Tiny, inclusive remessas exportadas (regra de 27/10/2026).
      const env = await new sql.Request(tx).input('pid', sql.Int, ped.PedidoId)
        .query('SELECT ISNULL(SUM(QuantidadeEnviada), 0) AS n FROM dbo.PedidoItem WHERE PedidoId = @pid');
      const pecasEnviadas = env.recordset[0].n || 0;

      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`UPDATE p
                   SET p.Estoque = p.Estoque + (pi.Quantidade - pi.QuantidadeEnviada),
                       p.AtualizadoEm = SYSUTCDATETIME()
                  FROM dbo.Produto p
                  JOIN dbo.PedidoItem pi ON pi.ProdutoId = p.ProdutoId
                 WHERE pi.PedidoId = @pid AND pi.EmBackorder = 0
                   AND pi.Quantidade > pi.QuantidadeEnviada`);

      // Tudo é cancelado no Tiny: todas as faturas do pedido (cheia ou de remessa) são anuladas.
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`UPDATE f SET f.Status = 'Anulada'
                  FROM dbo.Fatura f
                  JOIN dbo.PedidoFatura pf ON pf.FaturaId = f.FaturaId
                 WHERE pf.PedidoId = @pid`);
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`UPDATE e SET e.Status = 'Anulada'
                  FROM dbo.Entrega e
                  JOIN dbo.EntregaPedido ep ON ep.EntregaId = e.EntregaId
                 WHERE ep.PedidoId = @pid`);

      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query("UPDATE dbo.Pedido SET Status = 'Cancelado', AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid");

      await tx.commit();

      // Cancela no Tiny (sem esperar a resposta) e, depois, recalcula o estoque pelo Tiny:
      // o que voltou passa pela fila da black order antes da loja.
      const skusDevolvidos = (await query(
        'SELECT DISTINCT Sku FROM dbo.PedidoItem WHERE PedidoId = @pid', { pid: ped.PedidoId })).map(r => r.Sku);
      Promise.resolve(cancelarExportacoesDoPedido(ped.PedidoId))
        .then(() => atualizarEstoqueCesta(skusDevolvidos))
        .catch(e => console.warn('⚠ Cancelar no Tiny / recalcular estoque falhou:', e.message));

      // Reivindicações abertas ficam para o admin decidir.
      const abertas = (await query(
        `SELECT Numero FROM dbo.Reivindicacao WHERE PedidoId = @pid AND Status = 'Em processo'`,
        { pid: ped.PedidoId })).map(r => r.Numero);
      await registrarEventoPedido({
        pedidoId: ped.PedidoId, tipo: 'cancelado', titulo: 'Pedido cancelado', user: req.user,
        detalhe: [
          'Cancelado também no Tiny (o estoque volta lá) e faturas anuladas.',
          pecasEnviadas ? `${pecasEnviadas} peça(s) já tinham sido enviadas: confira se voltaram fisicamente.` : '',
          abertas.length ? `Reivindicação(ões) ainda aberta(s): ${abertas.join(', ')} — revise no painel.` : ''
        ].filter(Boolean).join(' ')
      });

      return res.json({
        ok: true, status: 'Cancelado', pecasEnviadas,
        aviso: pecasEnviadas ? `${pecasEnviadas} peça(s) já tinham sido enviadas: o Tiny devolve o estoque delas; confira se voltaram fisicamente.` : null
      });
    }

    // ---- Voltar para Pendente: só se nada foi ao Tiny ----
    if (status === 'Pendente') {
      if (ped.Status === 'Pendente') return recusar(409, 'O pedido já está Pendente.');
      if (await jaFoiAoTiny(tx, ped.PedidoId))
        return recusar(409, 'Este pedido já tem peças no Tiny e não volta para Pendente. Para desistir, cancele.');
    }

    // ---- Aprovar: só o status; o Tiny recebe as peças na remessa ----
    if (status === 'Aprovado') {
      if (ped.Status !== 'Pendente')
        return recusar(409, ped.Status === 'Aprovado'
          ? 'O pedido já está aprovado.'
          : `Pedido ${ped.Status.toLowerCase()}: o status agora acompanha o envio das peças.`);
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query("UPDATE dbo.Pedido SET Status = N'Aprovado', AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid");
      await tx.commit();
      await registrarEventoPedido({
        pedidoId: ped.PedidoId, tipo: 'aprovado', user: req.user, titulo: 'Pedido aprovado',
        detalhe: 'As peças são conferidas no estoque e enviadas conforme forem encontradas.'
      });
      return res.json({ ok: true, status: 'Aprovado' });
    }

    // ---- Entregue: só depois de tudo enviado ----
    if (status === 'Entregue' && ped.Status !== 'Enviado')
      return recusar(409, 'Só um pedido Enviado pode ser marcado como Entregue — registre o envio das peças antes.');

    // ---- Envio segmentado ----
    // 'normal'/'tudo' envia peças em estoque; 'backorder' libera pré-venda com estoque (pedido próprio no Tiny).
    if (isShip) {
      const alvoBackorder = escopo === 'backorder' ? 1 : 0;
      const cand = await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .input('alvo', sql.Bit, alvoBackorder)
        .query(`SELECT pi.PedidoItemId, pi.ProdutoId, pi.Quantidade,
                       pi.QuantidadeEnviada, pi.EmBackorder,
                       pi.Sku, pi.NomeProduto, pi.PrecoUnitario
                  FROM dbo.PedidoItem pi
                 WHERE pi.PedidoId = @pid AND pi.Quantidade > pi.QuantidadeEnviada
                   AND pi.EmBackorder = @alvo`);

      let enviados = 0;
      const liberados = [];    // snapshot da pré-venda liberada agora (p/ Tiny)
      const idsLiberados = []; // itens de pré-venda que de fato saíram
      for (const it of cand.recordset) {
        const restante = it.Quantidade - it.QuantidadeEnviada;
        if (it.EmBackorder) {
          // Pré-venda só sai se houver estoque agora; baixa atômica.
          const dec = await new sql.Request(tx)
            .input('prod', sql.Int, it.ProdutoId)
            .input('rem', sql.Int, restante)
            .query(`UPDATE dbo.Produto SET Estoque = Estoque - @rem, AtualizadoEm = SYSUTCDATETIME()
                     WHERE ProdutoId = @prod AND Estoque >= @rem`);
          if (!dec.rowsAffected[0]) continue; // sem estoque: fica pendente
          liberados.push({ sku: it.Sku, nome: it.NomeProduto, preco: Number(it.PrecoUnitario), qtd: restante });
          idsLiberados.push(it.PedidoItemId);
        }
        await new sql.Request(tx)
          .input('iid', sql.Int, it.PedidoItemId)
          .query('UPDATE dbo.PedidoItem SET QuantidadeEnviada = Quantidade WHERE PedidoItemId = @iid');
        enviados++;
      }

      // Envio de pré-venda exige estoque; sem nada disponível é erro.
      if (alvoBackorder && !enviados)
        return recusar(409, 'Nenhuma peça de pré-venda disponível para envio (sem estoque).');

      const comp = await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`SELECT
                  SUM(CASE WHEN EmBackorder = 0 THEN 1 ELSE 0 END) AS totNormais,
                  SUM(CASE WHEN EmBackorder = 0 AND Quantidade > QuantidadeEnviada THEN 1 ELSE 0 END) AS pendNormais,
                  SUM(CASE WHEN Quantidade > QuantidadeEnviada THEN 1 ELSE 0 END) AS pendTotal
                FROM dbo.PedidoItem WHERE PedidoId = @pid`);
      const { totNormais, pendNormais, pendTotal } = comp.recordset[0];

      // Pedido só de pré-venda não vai a 'Enviado' por aqui.
      if (!enviados && totNormais === 0 && pendTotal > 0)
        return recusar(409, 'Pedido só com itens em pré-venda: aguarde o estoque para enviar essas peças.');

      // Pré-venda liberada vira pedido próprio no Tiny.
      if (liberados.length) {
        await marcarExportados(tx, idsLiberados);
        if (exportacaoLigada()) await inserirExportacao(tx, ped.PedidoId, 'backorder', liberados);
      }
      // As peças em estoque que acabaram de sair viram a remessa deste envio.
      const remessa = alvoBackorder ? [] : await confirmarRemessa(tx, ped.PedidoId);

      // Liberar pré-venda nunca marca 'Enviado'; Pendente passa a Aprovado.
      const faltam = totNormais > 0 ? pendNormais > 0 : pendTotal > 0;
      const novoStatus = alvoBackorder
        ? (ped.Status === 'Pendente' ? 'Aprovado' : ped.Status)
        : await statusPorEnvio(tx, ped.PedidoId, ped.Status);
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .input('st', sql.NVarChar(14), novoStatus)
        .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');

      await tx.commit();
      if (liberados.length || remessa.length) processarExportacoes(); // fire-and-forget
      await registrarEventoPedido({
        pedidoId: ped.PedidoId, tipo: 'envio', user: req.user,
        ...(alvoBackorder
          ? { titulo: 'Pré-venda liberada para envio', detalhe: resumoPecas(liberados) }
          : remessa.length
            ? { titulo: 'Remessa confirmada — todas as peças em estoque', detalhe: `${resumoPecas(remessa)} · Status: ${novoStatus}${textoFatura(remessa)}` }
            : { titulo: 'Todas as peças em estoque marcadas como enviadas', detalhe: `Status: ${novoStatus}` })
      });
      return res.json({ ok: true, status: novoStatus, parcial: faltam, remessa: remessa.length });
    }

    // ---- Mudança simples de status (Pendente / Entregue) ----
    await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('st', sql.NVarChar(14), status)
      .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE NumeroPedido = @num');
    await tx.commit();
    await registrarEventoPedido({
      pedidoId: ped.PedidoId, user: req.user,
      ...(status === 'Entregue'
        ? { tipo: 'entregue', titulo: 'Pedido entregue' }
        : { tipo: 'aviso', titulo: `Status alterado para ${status}` })
    });
    res.json({ ok: true, status });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// POST /api/pedidos/:numero/remessa (admin) — "Confirmar envio": remessa ÚNICA (regra de 27/10/2026).
// Tudo o que restou no pedido sai agora e vai ao Tiny (com a fatura); o que não estava na
// prateleira o admin retira antes (/retirar). Itens de garantia sem estoque (EmBackorder) ficam de fora.
router.post('/pedidos/:numero/remessa', requireAuth, requireAdmin, async (req, res, next) => {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  const recusar = async (http, erro) => { await tx.rollback(); return res.status(http).json({ erro }); };
  try {
    await tx.begin();
    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .query('SELECT PedidoId, Status FROM dbo.Pedido WHERE NumeroPedido = @num');
    if (!cur.recordset.length) return recusar(404, 'Pedido não encontrado.');
    const ped = cur.recordset[0];
    if (STATUS_FINAIS.includes(ped.Status))
      return recusar(409, `Pedido ${ped.Status.toLowerCase()} não aceita novas remessas.`);

    await new sql.Request(tx).input('pid', sql.Int, ped.PedidoId)
      .query(`UPDATE dbo.PedidoItem SET QuantidadeEnviada = Quantidade
               WHERE PedidoId = @pid AND EmBackorder = 0 AND Quantidade > QuantidadeEnviada`);
    const itens = await confirmarRemessa(tx, ped.PedidoId);
    if (!itens.length)
      return recusar(409, 'Nada para enviar: todas as peças deste pedido já saíram ou foram retiradas.');
    const novoStatus = await statusPorEnvio(tx, ped.PedidoId, ped.Status);
    await new sql.Request(tx)
      .input('pid', sql.Int, ped.PedidoId)
      .input('st', sql.NVarChar(14), novoStatus)
      .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');

    await tx.commit();
    processarExportacoes();   // fire-and-forget
    await registrarEventoPedido({
      pedidoId: ped.PedidoId, tipo: 'envio', user: req.user,
      titulo: novoStatus === 'Parcial' ? 'Remessa confirmada — envio parcial' : 'Remessa confirmada — envio concluído',
      detalhe: `${resumoPecas(itens)} · status do pedido: ${novoStatus}${textoFatura(itens)}`
    });
    res.json({
      ok: true, status: novoStatus, itens, parcial: novoStatus === 'Parcial',
      fatura: itens.fatura ? { numero: itens.fatura.numeroFatura, total: itens.fatura.total } : null
    });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/pedidos/:numero/itens/:itemId/enviado (admin) — { qtd } enviada de um item.
// Peça em estoque entra na próxima remessa; pré-venda consome estoque e vira liberação no Tiny.
router.put('/pedidos/:numero/itens/:itemId/enviado', requireAuth, requireAdmin, async (req, res, next) => {
  const qtd = Number(req.body?.qtd);
  if (!Number.isInteger(qtd) || qtd < 0)
    return res.status(400).json({ erro: 'Quantidade inválida.' });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  const recusar = async (http, erro) => { await tx.rollback(); return res.status(http).json({ erro }); };
  try {
    await tx.begin();

    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('iid', sql.Int, Number(req.params.itemId))
      .query(`SELECT pi.PedidoId, pi.PedidoItemId, pi.ProdutoId, pi.Quantidade, pi.QuantidadeEnviada,
                     pi.EmBackorder, pi.Sku, pi.NomeProduto, pi.PrecoUnitario, p.Status
                FROM dbo.PedidoItem pi
                JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
               WHERE p.NumeroPedido = @num AND pi.PedidoItemId = @iid`);
    if (!cur.recordset.length) return recusar(404, 'Item não encontrado neste pedido.');
    const it = cur.recordset[0];
    // Pedido entregue ou cancelado está fechado — nem o painel admin mexe.
    if (STATUS_FINAIS.includes(it.Status))
      return recusar(409, `Pedido ${it.Status.toLowerCase()} — as peças não podem mais ser alteradas.`);
    if (qtd > it.Quantidade)
      return recusar(400, 'Quantidade enviada não pode exceder a pedida.');

    const delta = qtd - it.QuantidadeEnviada;
    if (it.EmBackorder && delta !== 0) {
      // Aumentar consome estoque; diminuir devolve. Baixa atômica no aumento.
      const dec = await new sql.Request(tx)
        .input('prod', sql.Int, it.ProdutoId)
        .input('d', sql.Int, delta)
        .query(`UPDATE dbo.Produto SET Estoque = Estoque - @d, AtualizadoEm = SYSUTCDATETIME()
                 WHERE ProdutoId = @prod AND (@d <= 0 OR Estoque >= @d)`);
      if (!dec.rowsAffected[0]) return recusar(409, 'Estoque insuficiente para enviar essa quantidade.');
    }

    await new sql.Request(tx)
      .input('iid', sql.Int, it.PedidoItemId)
      .input('q', sql.Int, qtd)
      .query('UPDATE dbo.PedidoItem SET QuantidadeEnviada = @q WHERE PedidoItemId = @iid');

    // Aumento em pré-venda vira liberação no Tiny. Redução não é desfeita lá.
    if (it.EmBackorder && delta > 0) {
      await marcarExportados(tx, [it.PedidoItemId]);
      if (exportacaoLigada()) {
        await inserirExportacao(tx, it.PedidoId, 'backorder',
          [{ sku: it.Sku, nome: it.NomeProduto, preco: Number(it.PrecoUnitario), qtd: delta }]);
      }
    } else if (it.EmBackorder && delta < 0) {
      console.warn(`⚠ Quantidade enviada reduzida no item ${it.Sku} (pedido ${req.params.numero}): ` +
        'se a liberação já foi exportada ao Tiny, ajuste o pedido lá manualmente.');
    }

    // O status só muda com o que já está no Tiny.
    const novoStatus = await statusPorEnvio(tx, it.PedidoId, it.Status);
    await new sql.Request(tx)
      .input('pid', sql.Int, it.PedidoId)
      .input('st', sql.NVarChar(14), novoStatus)
      .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');

    await tx.commit();
    if (exportacaoLigada() && it.EmBackorder && delta > 0) processarExportacoes();
    if (delta !== 0) {
      await registrarEventoPedido({
        pedidoId: it.PedidoId, tipo: 'envio', user: req.user,
        titulo: delta > 0 ? `Envio registrado: ${it.Sku}` : `Envio corrigido: ${it.Sku}`,
        detalhe: `${it.NomeProduto} — enviadas ${qtd} de ${it.Quantidade}` +
          (delta < 0 ? ` (antes: ${it.QuantidadeEnviada})` : '') + ` · status do pedido: ${novoStatus}`
      });
    }
    res.json({ ok: true, itemId: it.PedidoItemId, qtdEnviada: qtd, status: novoStatus });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// Motivos prontos para retirar peças (o admin completa com a descrição, ou escolhe 'Outro').
export const MOTIVOS_RETIRADA = ['Não foi encontrado', 'Estoque incorreto', 'Peça danificada'];

// POST /api/pedidos/:numero/itens/:itemId/retirar (admin) — { quantidade, motivo, descricao?, destino }.
// Retira peças do pedido antes do envio (não serão faturadas), com o que aconteceu. destino:
//   'remover'    → saem do pedido;   'blackorder' → vão para o fim da fila de black order do cliente.
// Só pedidos com fatura por remessa (os antigos já têm fatura cheia) e só o que ainda não saiu.
// Retirou tudo = pedido cancelado (nada foi ao Tiny). '/nao-encontrada' é o nome antigo da rota.
router.post(['/pedidos/:numero/itens/:itemId/retirar', '/pedidos/:numero/itens/:itemId/nao-encontrada'],
  requireAuth, requireAdmin, async (req, res, next) => {
  const q = Number(req.body?.quantidade);
  const base = String(req.body?.motivo || '').trim();
  const descricao = String(req.body?.descricao || '').trim();
  const motivo = (base && base !== 'Outro' ? base + (descricao ? ' — ' + descricao : '') : descricao).slice(0, 200);
  const destino = req.body?.destino === 'blackorder' ? 'blackorder' : (req.body?.destino === 'remover' ? 'remover' : null);
  if (!Number.isInteger(q) || q <= 0) return res.status(400).json({ erro: 'Informe quantas peças não foram encontradas.' });
  if (!motivo) return res.status(400).json({ erro: 'Informe o motivo ou descreva o que aconteceu.' });
  if (!destino) return res.status(400).json({ erro: 'Escolha: retirar do pedido ou mandar para a black order.' });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  const recusar = async (http, erro) => { await tx.rollback(); return res.status(http).json({ erro }); };
  try {
    await tx.begin();
    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('iid', sql.Int, Number(req.params.itemId))
      .query(`SELECT pi.PedidoId, pi.PedidoItemId, pi.ProdutoId, pi.Sku, pi.NomeProduto, pi.PrecoUnitario,
                     pi.Quantidade, pi.QuantidadeEnviada, pi.EmBackorder,
                     p.NumeroPedido, p.Status, p.EmpresaId, p.UsuarioId, p.FaturaNaRemessa
                FROM dbo.PedidoItem pi
                JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
               WHERE p.NumeroPedido = @num AND pi.PedidoItemId = @iid`);
    if (!cur.recordset.length) return recusar(404, 'Item não encontrado neste pedido.');
    const it = cur.recordset[0];
    if (STATUS_FINAIS.includes(it.Status))
      return recusar(409, `Pedido ${it.Status.toLowerCase()} — as peças não podem mais ser alteradas.`);
    if (!it.FaturaNaRemessa || it.EmBackorder)
      return recusar(409, 'Pedido anterior à fatura por remessa: a fatura dele já foi emitida cheia. Ajuste pelo cancelamento ou à mão.');
    const naoSaiu = it.Quantidade - it.QuantidadeEnviada;
    if (q > naoSaiu)
      return recusar(409, `Só ${naoSaiu} un. deste item ainda não saíram (as enviadas já estão na remessa).`);

    await new sql.Request(tx)
      .input('iid', sql.Int, it.PedidoItemId)
      .input('q', sql.Int, q)
      .input('mot', sql.NVarChar(200), motivo)
      .query(`UPDATE dbo.PedidoItem
                 SET Quantidade = Quantidade - @q,
                     QuantidadeNaoEncontrada = QuantidadeNaoEncontrada + @q,
                     MotivoNaoEncontrada = @mot
               WHERE PedidoItemId = @iid`);
    const valor = Math.round(Number(it.PrecoUnitario) * q * 100) / 100;
    await new sql.Request(tx)
      .input('pid', sql.Int, it.PedidoId)
      .input('v', sql.Decimal(12, 2), valor)
      .query('UPDATE dbo.Pedido SET Total = Total - @v, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');

    let blackOrder = null;
    if (destino === 'blackorder') {
      [blackOrder] = await criarBlackOrders(tx, {
        numeroPedido: it.NumeroPedido, pedidoId: it.PedidoId, empresaId: it.EmpresaId, usuarioId: it.UsuarioId,
        itens: [{ produtoId: it.ProdutoId, sku: it.Sku, nome: it.NomeProduto, qtd: q }]
      });
    }

    // Sobrou alguma peça? Se não, o pedido acaba aqui (nada foi ao Tiny: não há o que desfazer lá).
    const resto = (await new sql.Request(tx).input('pid', sql.Int, it.PedidoId)
      .query('SELECT ISNULL(SUM(Quantidade), 0) AS n FROM dbo.PedidoItem WHERE PedidoId = @pid')).recordset[0].n;
    const novoStatus = resto > 0 ? await statusPorEnvio(tx, it.PedidoId, it.Status) : 'Cancelado';
    await new sql.Request(tx)
      .input('pid', sql.Int, it.PedidoId)
      .input('st', sql.NVarChar(14), novoStatus)
      .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');
    await tx.commit();

    const rumo = destino === 'blackorder'
      ? 'foram para a sua black order (você é avisado quando chegarem)'
      : 'foram retiradas do pedido';
    await registrarEventoPedido({
      pedidoId: it.PedidoId, tipo: resto > 0 ? 'aviso' : 'cancelado', user: req.user,
      titulo: `Peças retiradas: ${it.Sku}`,
      detalhe: `${q}× ${it.NomeProduto} — ${motivo}. ${destino === 'blackorder' ? 'Foram para a black order.' : 'Saíram do pedido.'} Não serão faturadas.` +
        (resto > 0 ? '' : ' Todas as peças foram retiradas: pedido cancelado.')
    });
    await criarNotificacao({
      empresaId: it.EmpresaId, publico: 'cliente', origem: 'blackorder', criadoPor: req.user.id,
      link: '#pedido/' + it.NumeroPedido,
      titulo: `Pedido ${it.NumeroPedido}: peças retiradas`,
      texto: `${q} un. de ${it.NomeProduto} (${it.Sku}) foram retiradas do pedido.\nO que aconteceu: ${motivo}.\n` +
        `Estas peças ${rumo} e não serão cobradas.` + (resto > 0 ? '' : '\nComo não sobrou nenhuma peça, o pedido foi cancelado.')
    });
    // O reservado do pedido caiu: recalcula estoque e fila pelo Tiny.
    atualizarEstoqueCesta([it.Sku]).catch(e => console.warn('⚠ Recalcular estoque falhou:', e.message));

    res.json({ ok: true, status: novoStatus, blackOrder, aviso: 'Confira o estoque desta peça no Tiny: se ele estiver errado, a peça volta a aparecer na loja.' });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

export default router;
