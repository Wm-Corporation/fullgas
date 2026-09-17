// ============================================================
// Rotas de pedidos (e itens).
// Cria pedido a partir da cesta (aceitando itens em pré-venda/backorder
// quando não há estoque), lista, detalha e controla o envio — que pode ser
// segmentado por escopo (itens normais vs. itens em pré-venda). O pedido tem
// UM código (NumeroPedido) e UMA fatura; entregas/rastreios saíram do fluxo.
// ============================================================
import { Router } from 'express';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin, requireAreaAny } from '../auth.js';
import {
  exportacaoLigada, atualizarEstoqueCesta, inserirExportacao,
  processarExportacoes, cancelarExportacoesDoPedido
} from '../tiny-pedidos.js';

const router = Router();

// Status válidos (espelham o CHECK constraint da tabela Pedido).
// 'Parcial' NÃO entra aqui de propósito: ele é consequência do envio (ver
// statusPorEnvio), não uma escolha do admin no seletor de status.
const STATUS_VALIDOS = ['Pendente', 'Em separação', 'Enviado', 'Entregue', 'Cancelado'];
// Status terminais: uma vez aqui, o pedido não muda mais.
const STATUS_FINAIS = ['Entregue', 'Cancelado'];
// Escopos de envio aceitos.
const ESCOPOS = ['normal', 'backorder', 'tudo'];

function toIso(d) {
  return d instanceof Date ? d.toISOString() : (d || null);
}

// Snapshot de um item no formato que o front espera, enriquecido com os campos
// de envio parcial e pré-venda.
function montarItem(r) {
  return {
    itemId: r.PedidoItemId,
    artigo: r.Sku,
    nome: r.NomeProduto,
    preco: Number(r.PrecoUnitario),
    qtd: r.Quantidade,
    qtdEnviada: r.QuantidadeEnviada,
    // Quanto deste item já foi ao Tiny. A diferença para qtdEnviada é o que
    // entra na próxima remessa — é o que acende o "Confirmar envio" no painel.
    qtdExportada: r.QuantidadeExportada,
    backorder: !!r.EmBackorder,
    // Nº da reivindicação de varejo aprovada que atingiu este item (ou null).
    garantiaNumero: r.GarantiaNumero || null
  };
}

/* ------------------------------------------------------------
   Quem pode ver DINHEIRO
   ------------------------------------------------------------
   "Pedidos" e "Financeiro" são áreas SEPARADAS na tela de contas internas: o
   gestor pode dar a uma conta o acompanhamento dos pedidos sem lhe abrir os
   valores. Só que preço, total e as faturas ligadas viajam dentro da própria
   resposta de pedido — quem tem a área 'pedidos' recebia o financeiro junto,
   de graça, e a separação existia só no desenho da tela.

   Admin, gestor e token sem lista de permissões continuam vendo tudo.
   ------------------------------------------------------------ */
function podeVerFinanceiro(u) {
  return u.papel === 'admin' || u.gestor || !Array.isArray(u.perm) || u.perm.includes('financeiro');
}

// Remove os valores monetários de um pedido já montado. Os campos somem em
// vez de virem zerados: zero é um valor, e a tela o exibiria como "R$ 0,00"
// — pior do que não mostrar o campo.
function semValores(pedido) {
  const { total, faturas, ...resto } = pedido;
  return {
    ...resto,
    itens: (resto.itens || []).map(({ preco, ...i }) => i)
  };
}

// Lista de pedidos no formato do store.js + progresso de envio por pedido.
function montarPedidos(pedidoRows, itemRows) {
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
      temBackorder: itens.some(i => i.backorder)
    };
  });
}

const SELECT_PEDIDO =
  `SELECT p.PedidoId, p.NumeroPedido, p.DataPedido, p.Status, p.Total, p.Tipo,
          u.Email AS UsuarioEmail, e.RazaoSocial AS Empresa
     FROM dbo.Pedido p
     JOIN dbo.Usuario u ON u.UsuarioId = p.UsuarioId
     JOIN dbo.Empresa e ON e.EmpresaId = p.EmpresaId`;

const SELECT_ITENS =
  `SELECT pi.PedidoId, pi.PedidoItemId, pi.Sku, pi.NomeProduto, pi.PrecoUnitario,
          pi.Quantidade, pi.QuantidadeEnviada, pi.QuantidadeExportada,
          pi.EmBackorder, pi.GarantiaNumero`;

// Gera a Fatura "original" do pedido: valor cheio (total do pedido, todas as
// peças, inclusive as em pré-venda) + vínculo PedidoFatura. É o ÚNICO documento
// financeiro do pedido — o cliente paga essa. Envios não geram fatura nova.
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

/* Entregas e rastreios foram RETIRADOS do fluxo (não há módulo de entrega no
   projeto): o envio só atualiza itens e status. As tabelas Entrega/Rastreio
   continuam no banco por causa dos pedidos antigos, mas nada novo é gerado. */

/* Fecha a REMESSA do pedido: o que foi marcado como enviado e ainda não foi
   ao Tiny (QuantidadeEnviada - QuantidadeExportada) vira UM pedido no Tiny.
   É o gatilho da exportação desde 17/09/2026 — antes o pedido ia inteiro na
   aprovação, mesmo sem nada ter saído da prateleira.

   Só peças em estoque (EmBackorder = 0): a pré-venda tem fluxo próprio
   (escopo 'backorder', sufixo -PV) e já marca o que exportou.

   Roda na MESMA transação do envio: ou a remessa é registrada com o que saiu,
   ou nada muda. Devolve os itens da remessa (vazio = não havia o que exportar;
   o chamador dispara processarExportacoes após o commit). */
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

  // Marca o que está indo, mesmo com a exportação desligada: assim, ligando o
  // Tiny depois, remessas antigas não são reenviadas.
  await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`UPDATE dbo.PedidoItem SET QuantidadeExportada = QuantidadeEnviada
             WHERE PedidoId = @pid AND EmBackorder = 0
               AND QuantidadeEnviada > QuantidadeExportada`);
  if (exportacaoLigada()) await inserirExportacao(tx, pedidoId, 'remessa', itens);
  return itens;
}

/* Pré-venda liberada vai ao Tiny pelo escopo 'backorder' (sufixo -PV), fora da
   remessa. Marcar o item como exportado impede que a remessa mande a mesma
   peça de novo. */
async function marcarExportados(tx, pedidoItemIds) {
  for (const id of pedidoItemIds) {
    await new sql.Request(tx).input('iid', sql.Int, id)
      .query('UPDATE dbo.PedidoItem SET QuantidadeExportada = QuantidadeEnviada WHERE PedidoItemId = @iid');
  }
}

/* Status do pedido a partir do que já saiu (só peças em estoque; a pré-venda
   anda no rastreador à parte):
     nada enviado  -> mantém o status atual (Pendente / Em separação)
     parte enviada -> 'Parcial'  (a fatura segue em aberto)
     tudo enviado  -> 'Enviado'
   Pedido só de pré-venda nunca chega a 'Enviado' por aqui. */
async function statusPorEnvio(tx, pedidoId, statusAtual) {
  const c = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT
              SUM(CASE WHEN EmBackorder = 0 THEN 1 ELSE 0 END) AS totNormais,
              SUM(CASE WHEN EmBackorder = 0 AND Quantidade > QuantidadeEnviada THEN 1 ELSE 0 END) AS pendNormais,
              SUM(CASE WHEN QuantidadeEnviada > 0 THEN 1 ELSE 0 END) AS comEnvio,
              SUM(CASE WHEN Quantidade > QuantidadeEnviada THEN 1 ELSE 0 END) AS pendTotal
            FROM dbo.PedidoItem WHERE PedidoId = @pid`);
  const { totNormais, pendNormais, comEnvio, pendTotal } = c.recordset[0];
  if (!comEnvio) return statusAtual;
  const faltam = totNormais > 0 ? pendNormais > 0 : pendTotal > 0;
  return faltam ? 'Parcial' : 'Enviado';
}

// GET /api/pedidos — cliente vê os da sua empresa; admin vê todos.
// 'loja' OU 'pedidos': a loja tem a própria tela de histórico de compras, e a
// aba Pedidos do portal tem a visão completa. Barrar aqui só por 'pedidos'
// esvaziaria o histórico de quem compra pela loja. Os VALORES, esses sim,
// dependem da área 'financeiro' — ver podeVerFinanceiro/semValores.
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
    const pedidos = montarPedidos(pedidoRows, itemRows);
    res.json(podeVerFinanceiro(req.user) ? pedidos : pedidos.map(semValores));
  } catch (e) { next(e); }
});

// GET /api/pedidos/:numero — detalhe + itens (com estoque atual de cada item)
// + entregas/faturas ligadas + progresso de envio.
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
    // Era por AQUI que a área 'financeiro' vazava: o detalhe do pedido carrega
    // o total, o preço de cada item e a lista de faturas ligadas.
    res.json(podeVerFinanceiro(req.user) ? detalhe : semValores(detalhe));
  } catch (e) { next(e); }
});

// POST /api/pedidos — cria a partir da cesta: { itens: [{ sku, quantidade }] }.
// Itens com estoque suficiente baixam estoque normalmente (EmBackorder=0). Itens
// sem estoque entram em pré-venda (EmBackorder=1) SEM decrementar — o pedido
// inteiro é aceito, nunca rejeitado por falta de estoque. Tudo em transação.
// Aceita QUALQUER uma das duas áreas de propósito. O checkout é o botão
// "Enviar pedido" da LOJA, então uma conta marcada só como 'loja' precisa
// poder fechar a compra — gatear isto apenas em 'pedidos' tiraria dela a
// única coisa que ela deveria fazer. Quem não tem nenhuma das duas não passa.
router.post('/pedidos', requireAuth, requireAreaAny(['loja', 'pedidos']), async (req, res, next) => {
  const itensReq = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itensReq.length) return res.status(400).json({ erro: 'A cesta está vazia.' });

  // Mescla SKUs repetidos e valida quantidades inteiras positivas.
  const merged = new Map();
  for (const it of itensReq) {
    const skuItem = String(it?.sku || '').trim();
    const qtd = Number(it?.quantidade);
    if (!skuItem || !Number.isInteger(qtd) || qtd <= 0)
      return res.status(400).json({ erro: 'Item inválido na cesta.' });
    merged.set(skuItem, (merged.get(skuItem) || 0) + qtd);
  }

  // O estoque é compartilhado com outro e-commerce via Tiny: antes de baixar o
  // estoque local, consulta o saldo REAL no Tiny para cada item da cesta (se a
  // integração estiver ligada). Se o Magento acabou de vender a peça, o cliente
  // é barrado aqui — e não descobre depois. Tiny fora do ar não trava a venda.
  try { await atualizarEstoqueCesta([...merged.keys()]); }
  catch (e) { console.warn('⚠ Checagem de estoque no Tiny indisponível:', e.message); }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const itensSnap = [];
    let total = 0;
    for (const [skuItem, qtd] of merged) {
      // Tenta a baixa atômica. Se houver estoque, decrementa e o item é normal.
      const upd = await new sql.Request(tx)
        .input('sku', sql.VarChar(40), skuItem)
        .input('qtd', sql.Int, qtd)
        .query(`UPDATE dbo.Produto
                   SET Estoque = Estoque - @qtd, AtualizadoEm = SYSUTCDATETIME()
                OUTPUT inserted.ProdutoId, inserted.Nome, inserted.Preco
                 WHERE Sku = @sku AND Estoque >= @qtd`);

      let row, backorder;
      if (upd.recordset.length) {
        row = upd.recordset[0];
        backorder = false;
      } else {
        // A baixa falhou: produto inexistente OU estoque insuficiente.
        const prod = await new sql.Request(tx)
          .input('sku', sql.VarChar(40), skuItem)
          .query('SELECT ProdutoId, Nome, Preco, Estoque, PrevisaoChegada FROM dbo.Produto WHERE Sku = @sku');
        if (!prod.recordset.length) {
          await tx.rollback();
          return res.status(400).json({ erro: 'Produto não encontrado: ' + skuItem });
        }
        row = prod.recordset[0];
        // Produto "Em estoque" (Estoque > 0): o cliente só pode comprar até a
        // quantidade disponível — não vira pré-venda.
        if (row.Estoque > 0) {
          await tx.rollback();
          return res.status(409).json({
            erro: 'Estoque insuficiente para ' + row.Nome + ' (' + skuItem + '): ' +
              'disponível ' + row.Estoque + ' un.',
            sku: skuItem, disponivel: row.Estoque
          });
        }
        // Sem estoque e SEM previsão de chegada = "Indisponível": não pode ser
        // comprado. Sem estoque COM previsão = "Pré-venda": aceito em backorder.
        if (!row.PrevisaoChegada) {
          await tx.rollback();
          return res.status(409).json({
            erro: 'Produto indisponível para compra: ' + row.Nome + ' (' + skuItem + ').',
            sku: skuItem, indisponivel: true
          });
        }
        backorder = true;
      }

      const preco = Number(row.Preco);
      itensSnap.push({ produtoId: row.ProdutoId, sku: skuItem, nome: row.Nome, preco, qtd, backorder });
      total += preco * qtd;
    }

    // Numeração no banco: NumeroPedido por SEQUENCE global ('0005' + 6 dígitos)
    // — o ÚNICO código do pedido (o antigo CodigoCx "CX..." foi aposentado).
    const num = await new sql.Request(tx).query(`
      SELECT
        '0005' + RIGHT('000000' + CAST(NEXT VALUE FOR dbo.Seq_NumeroPedido AS VARCHAR(20)), 6) AS NumeroPedido,
        SYSUTCDATETIME() AS Agora;`);
    const { NumeroPedido, Agora } = num.recordset[0];

    const insPed = await new sql.Request(tx)
      .input('num', sql.VarChar(20), NumeroPedido)
      .input('uid', sql.Int, req.user.id)
      .input('eid', sql.Int, req.user.empresaId)
      .input('data', sql.DateTime2, Agora)
      .input('total', sql.Decimal(12, 2), total)
      .query(`INSERT INTO dbo.Pedido (NumeroPedido, UsuarioId, EmpresaId, DataPedido, Status, Total)
              OUTPUT inserted.PedidoId
              VALUES (@num, @uid, @eid, @data, 'Pendente', @total)`);
    const pedidoId = insPed.recordset[0].PedidoId;

    for (const it of itensSnap) {
      await new sql.Request(tx)
        .input('pid', sql.Int, pedidoId)
        .input('prod', sql.Int, it.produtoId)
        .input('sku', sql.VarChar(40), it.sku)
        .input('nome', sql.NVarChar(200), it.nome)
        .input('preco', sql.Decimal(12, 2), it.preco)
        .input('qtd', sql.Int, it.qtd)
        .input('back', sql.Bit, it.backorder ? 1 : 0)
        .query(`INSERT INTO dbo.PedidoItem (PedidoId, ProdutoId, Sku, NomeProduto, PrecoUnitario, Quantidade, EmBackorder)
                VALUES (@pid, @prod, @sku, @nome, @preco, @qtd, @back)`);
    }

    // Fatura "original" do pedido: valor cheio (todas as peças, inclusive as em
    // pré-venda). É o documento financeiro que o cliente paga. As peças em
    // pré-venda são acompanhadas pelo rastreador de envio (sem cobrança própria).
    await gerarFaturaPedido(tx, pedidoId, req.user.empresaId, total);

    // NÃO exporta ao Tiny no checkout: o pedido de venda nasce 'Pendente' e só é
    // lançado no Tiny quando o ADMIN aprovar (tirar de 'Pendente' em
    // PUT /pedidos/:numero/status). Aqui o estoque LOCAL já foi segurado; o Tiny
    // é notificado na aprovação. A checagem de saldo no Tiny (acima) continua.
    await tx.commit();

    const emp = await query('SELECT RazaoSocial FROM dbo.Empresa WHERE EmpresaId = @id', { id: req.user.empresaId });
    const itensEmBackorder = itensSnap.filter(i => i.backorder)
      .map(i => ({ sku: i.sku, nome: i.nome, quantidade: i.qtd }));

    res.status(201).json({
      id: NumeroPedido,
      data: toIso(Agora),
      usuario: req.user.email,
      empresa: emp[0]?.RazaoSocial || '',
      itens: itensSnap.map(i => ({ artigo: i.sku, nome: i.nome, preco: i.preco, qtd: i.qtd, backorder: i.backorder })),
      itensEmBackorder,
      total,
      status: 'Pendente'
    });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/pedidos/:numero/status (admin) — controla status e envio.
// Body: { status?, escopo? }.
//  - status 'Cancelado'  -> cancela: devolve ao estoque só o que foi baixado
//    (itens normais: Quantidade; pré-venda: só a parte já enviada) e anula a
//    fatura do pedido.
//  - escopo presente OU status 'Enviado' -> ENVIO segmentado: marca como
//    enviados os itens do escopo que ainda faltam (pré-venda só envia o que já
//    tem estoque, baixando-o agora). O status do pedido vira 'Enviado' se tudo
//    foi enviado, senão 'Em separação'.
//  - demais status (Pendente/Em separação/Entregue) -> apenas muda o status.
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
  try {
    await tx.begin();

    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .query('SELECT PedidoId, Status, EmpresaId, Total FROM dbo.Pedido WHERE NumeroPedido = @num');
    if (!cur.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    const ped = cur.recordset[0];
    if (STATUS_FINAIS.includes(ped.Status)) {
      await tx.rollback();
      return res.status(409).json({ erro: `Pedido ${ped.Status.toLowerCase()} não pode mudar de status.` });
    }
    // ---- Cancelamento ----
    if (status === 'Cancelado') {
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`UPDATE p
                   SET p.Estoque = p.Estoque +
                       CASE WHEN pi.EmBackorder = 0 THEN pi.Quantidade ELSE pi.QuantidadeEnviada END,
                       p.AtualizadoEm = SYSUTCDATETIME()
                  FROM dbo.Produto p
                  JOIN dbo.PedidoItem pi ON pi.ProdutoId = p.ProdutoId
                 WHERE pi.PedidoId = @pid`);

      // Anula a fatura do pedido (ligada via PedidoFatura) e as entregas.
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

      // Cancela também no Tiny (devolve o estoque lá). Fire-and-forget.
      cancelarExportacoesDoPedido(ped.PedidoId);

      return res.json({ ok: true, status: 'Cancelado' });
    }

    // ---- Envio segmentado ----
    // Peças em pré-venda (EmBackorder=1) vivem numa fatura separada e NÃO entram
    // no fluxo de envio normal do pedido. O status 'Enviado' (escopo 'normal'/
    // 'tudo') envia só as peças em estoque; o escopo 'backorder' envia as de
    // pré-venda que já voltaram ao estoque, reusando a fatura ativada.
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

      // Envio de pré-venda exige estoque; sem nada disponível é erro. Para o
      // envio normal, não enviar nada não é erro (ex.: marcar 'Enviado' com as
      // peças em estoque já enviadas e só pré-venda pendente) — apenas atualiza
      // o status do pedido.
      if (alvoBackorder && !enviados) {
        await tx.rollback();
        return res.status(409).json({ erro: 'Nenhuma peça de pré-venda disponível para envio (sem estoque).' });
      }

      // Composição do pedido: quantas peças em estoque (não-backorder) e quantas
      // peças (de qualquer tipo) ainda faltam enviar. Decide status e valida o
      // envio de pedidos que são só de pré-venda.
      const comp = await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`SELECT
                  SUM(CASE WHEN EmBackorder = 0 THEN 1 ELSE 0 END) AS totNormais,
                  SUM(CASE WHEN EmBackorder = 0 AND Quantidade > QuantidadeEnviada THEN 1 ELSE 0 END) AS pendNormais,
                  SUM(CASE WHEN Quantidade > QuantidadeEnviada THEN 1 ELSE 0 END) AS pendTotal
                FROM dbo.PedidoItem WHERE PedidoId = @pid`);
      const { totNormais, pendNormais, pendTotal } = comp.recordset[0];

      // Pedido SÓ de pré-venda (sem peças em estoque): não pode ir a 'Enviado'
      // por aqui. Suas peças só saem via escopo 'backorder', e somente quando
      // houver estoque. Sem nada enviado e ainda pendente => recusa.
      if (!enviados && totNormais === 0 && pendTotal > 0) {
        await tx.rollback();
        return res.status(409).json({
          erro: 'Pedido só com itens em pré-venda: aguarde o estoque para enviar essas peças.'
        });
      }

      // Pedido com peças em estoque: status considera só elas (a pré-venda segue
      // no rastreador, à parte). LIBERAR pré-venda (escopo 'backorder') nunca
      // marca o pedido como 'Enviado' — a peça só foi liberada para SEPARAÇÃO;
      // o envio de verdade é o admin quem confirma depois, mudando o status.
      const faltam = totNormais > 0 ? pendNormais > 0 : pendTotal > 0;
      const novoStatus = alvoBackorder
        ? 'Em separação'
        : await statusPorEnvio(tx, ped.PedidoId, ped.Status);
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .input('st', sql.NVarChar(14), novoStatus)  // NVarChar: preserva "Em separação" (o server converte p/ o varchar Latin1)
        .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');

      // Pré-venda liberada agora vira um pedido próprio no Tiny (baixa o
      // estoque lá): snapshot do que saiu NESTA liberação, na mesma transação.
      if (liberados.length) {
        await marcarExportados(tx, idsLiberados);
        if (exportacaoLigada()) await inserirExportacao(tx, ped.PedidoId, 'backorder', liberados);
      }
      // As peças em estoque que acabaram de sair viram a remessa deste envio.
      const remessa = alvoBackorder ? [] : await confirmarRemessa(tx, ped.PedidoId);

      await tx.commit();
      if (liberados.length || remessa.length) processarExportacoes(); // fire-and-forget
      return res.json({ ok: true, status: novoStatus, parcial: faltam, remessa: remessa.length });
    }

    // ---- Mudança simples de status (Pendente/Em separação/Entregue) ----
    await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('st', sql.NVarChar(14), status)  // NVarChar: preserva "Em separação"
      .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE NumeroPedido = @num');

    // Aprovar (sair de 'Pendente') NÃO exporta nada: o pedido só vai ao Tiny
    // quando peças de verdade saem — ver confirmarRemessa.
    await tx.commit();
    res.json({ ok: true, status });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// POST /api/pedidos/:numero/remessa (admin) — fecha a remessa: o que está
// marcado como enviado e ainda não foi ao Tiny vira UM pedido lá.
//
// É o "Confirmar envio" do painel: o admin ajusta a quantidade enviada de cada
// peça à vontade (PUT .../enviado, que não exporta nada) e, quando estiver
// certo, fecha a remessa. Envio parcial deixa o pedido em 'Parcial' e a fatura
// segue em aberto; quando o restante sai, nova remessa e o pedido vai a
// 'Enviado'.
router.post('/pedidos/:numero/remessa', requireAuth, requireAdmin, async (req, res, next) => {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .query('SELECT PedidoId, Status FROM dbo.Pedido WHERE NumeroPedido = @num');
    if (!cur.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    const ped = cur.recordset[0];
    if (STATUS_FINAIS.includes(ped.Status)) {
      await tx.rollback();
      return res.status(409).json({ erro: `Pedido ${ped.Status.toLowerCase()} não aceita novas remessas.` });
    }

    const itens = await confirmarRemessa(tx, ped.PedidoId);
    if (!itens.length) {
      await tx.rollback();
      return res.status(409).json({
        erro: 'Nada novo para enviar: informe a quantidade enviada das peças desta remessa.'
      });
    }
    const novoStatus = await statusPorEnvio(tx, ped.PedidoId, ped.Status);
    await new sql.Request(tx)
      .input('pid', sql.Int, ped.PedidoId)
      .input('st', sql.NVarChar(14), novoStatus)
      .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');

    await tx.commit();
    processarExportacoes();   // fire-and-forget
    res.json({ ok: true, status: novoStatus, itens, parcial: novoStatus === 'Parcial' });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/pedidos/:numero/itens/:itemId/enviado (admin) — ajuste manual da
// quantidade enviada de um item. { qtd } entre 0 e Quantidade. Para itens em
// pré-venda, aumentar consome estoque (e exige tê-lo); diminuir devolve.
router.put('/pedidos/:numero/itens/:itemId/enviado', requireAuth, requireAdmin, async (req, res, next) => {
  const qtd = Number(req.body?.qtd);
  if (!Number.isInteger(qtd) || qtd < 0)
    return res.status(400).json({ erro: 'Quantidade inválida.' });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
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
    if (!cur.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ erro: 'Item não encontrado neste pedido.' });
    }
    const it = cur.recordset[0];
    // Pedido entregue ou cancelado está fechado — nem o painel admin mexe.
    if (STATUS_FINAIS.includes(it.Status)) {
      await tx.rollback();
      return res.status(409).json({
        erro: `Pedido ${it.Status.toLowerCase()} — as peças não podem mais ser alteradas.`
      });
    }
    if (qtd > it.Quantidade) {
      await tx.rollback();
      return res.status(400).json({ erro: 'Quantidade enviada não pode exceder a pedida.' });
    }

    const delta = qtd - it.QuantidadeEnviada;
    if (it.EmBackorder && delta !== 0) {
      // Aumentar consome estoque; diminuir devolve. Baixa atômica no aumento.
      const dec = await new sql.Request(tx)
        .input('prod', sql.Int, it.ProdutoId)
        .input('d', sql.Int, delta)
        .query(`UPDATE dbo.Produto SET Estoque = Estoque - @d, AtualizadoEm = SYSUTCDATETIME()
                 WHERE ProdutoId = @prod AND (@d <= 0 OR Estoque >= @d)`);
      if (!dec.rowsAffected[0]) {
        await tx.rollback();
        return res.status(409).json({ erro: 'Estoque insuficiente para enviar essa quantidade.' });
      }
    }

    await new sql.Request(tx)
      .input('iid', sql.Int, it.PedidoItemId)
      .input('q', sql.Int, qtd)
      .query('UPDATE dbo.PedidoItem SET QuantidadeEnviada = @q WHERE PedidoItemId = @iid');

    // Aumento em item de pré-venda consumiu estoque local: espelha no Tiny
    // como liberação (pedido próprio lá). Redução não é desfeita no Tiny —
    // ajuste manualmente por lá se a liberação já tiver sido exportada.
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

    await tx.commit();
    if (exportacaoLigada() && it.EmBackorder && delta > 0) processarExportacoes();
    res.json({ ok: true, itemId: it.PedidoItemId, qtdEnviada: qtd });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

export default router;
