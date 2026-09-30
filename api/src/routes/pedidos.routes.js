// ============================================================
// Rotas de pedidos (e itens).
// Cria pedido a partir da cesta (aceitando itens em pré-venda/backorder
// quando não há estoque), lista, detalha e controla o envio — que pode ser
// segmentado por escopo (itens normais vs. itens em pré-venda). O pedido tem
// UM código (NumeroPedido) e UMA fatura; entregas/rastreios saíram do fluxo.
//
// Ciclo de vida (regra de 30/09/2026):
//   Pendente ──aprovar──> Aprovado ──envio parcial──> Parcial ──> Enviado ──> Entregue
//      └───────────────── Cancelado (de qualquer status não final) ─────────┘
//   • APROVAR = ir ao Tiny: as peças em estoque viram um pedido 'aprovado'
//     lá (baixa o estoque do Tiny). Não há volta para Pendente depois disso.
//   • O envio (quantidade enviada de cada peça) é controle interno: o status
//     Parcial/Enviado acompanha sozinho, e nada é exportado por ele.
//   • Entregue só depois de Enviado.
// ============================================================
import { Router } from 'express';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin, requireAreaAny } from '../auth.js';
import {
  exportacaoLigada, atualizarEstoqueCesta, inserirExportacao,
  processarExportacoes, cancelarExportacoesDoPedido
} from '../tiny-pedidos.js';
import { registrarEventoPedido, historicoDoPedido, resumoPecas } from '../historico-pedido.js';

const router = Router();

// Status válidos (espelham o CHECK constraint da tabela Pedido).
// 'Parcial' NÃO entra aqui de propósito: ele é consequência do envio (ver
// statusPorEnvio), não uma escolha do admin no seletor de status.
// 'Aprovado' substituiu 'Em separação' (migration 044): é o mesmo nome que o
// estoquista vê no Tiny.
const STATUS_VALIDOS = ['Pendente', 'Aprovado', 'Enviado', 'Entregue', 'Cancelado'];
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

/* APROVA o pedido no Tiny: as peças em estoque que ainda não foram para lá
   (Quantidade - QuantidadeExportada) viram UM pedido no Tiny, já 'aprovado' —
   é a aprovação que baixa o estoque lá. Regra de 30/09/2026: aprovar no B2B
   significa que o estoque pode ser descontado no Tiny também. (De 17/09 a
   30/09 a exportação era por remessa, no "Confirmar envio".)

   Só peças em estoque (EmBackorder = 0): a pré-venda tem fluxo próprio
   (escopo 'backorder', sufixo -PV) e já marca o que exportou.

   Roda na MESMA transação da mudança de status: ou o pedido fica aprovado com
   a exportação agendada, ou nada muda. Devolve os itens exportados (vazio =
   pedido só de pré-venda; o chamador dispara processarExportacoes depois do
   commit). O snapshot vai em ItensJson: é dele que a reserva de estoque
   (tiny.js → reservaPendente) lê o que ainda não chegou ao Tiny. */
async function aprovarEExportar(tx, pedidoId) {
  const pend = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT PedidoItemId, Sku, NomeProduto, PrecoUnitario,
                   Quantidade - QuantidadeExportada AS Qtd
              FROM dbo.PedidoItem
             WHERE PedidoId = @pid AND EmBackorder = 0
               AND Quantidade > QuantidadeExportada`);
  const itens = pend.recordset.map(r => ({
    sku: r.Sku, nome: r.NomeProduto, preco: Number(r.PrecoUnitario), qtd: r.Qtd
  }));
  if (!itens.length) return [];

  // Marca como exportado mesmo com a exportação desligada: ligando o Tiny
  // depois, pedidos já aprovados não são reenviados.
  await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`UPDATE dbo.PedidoItem SET QuantidadeExportada = Quantidade
             WHERE PedidoId = @pid AND EmBackorder = 0
               AND Quantidade > QuantidadeExportada`);
  if (exportacaoLigada()) await inserirExportacao(tx, pedidoId, 'normal', itens);
  return itens;
}

// Algo deste pedido já foi (ou está indo) ao Tiny? Decide se ele ainda pode
// voltar para 'Pendente' — depois de ir ao Tiny, não pode.
async function jaFoiAoTiny(tx, pedidoId) {
  const r = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT
              (SELECT COUNT(*) FROM dbo.PedidoItem
                WHERE PedidoId = @pid AND QuantidadeExportada > 0) +
              (SELECT COUNT(*) FROM dbo.TinyPedidoExport
                WHERE PedidoId = @pid AND Status <> 'cancelado') AS n`);
  return (r.recordset[0]?.n || 0) > 0;
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

/* Status de um pedido JÁ APROVADO a partir do que já saiu (só peças em
   estoque; a pré-venda anda no rastreador à parte):
     nada enviado  -> 'Aprovado' (inclusive quando o admin desfaz um envio)
     parte enviada -> 'Parcial'  (a fatura segue em aberto)
     tudo enviado  -> 'Enviado' */
async function statusPorEnvio(tx, pedidoId) {
  const c = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT
              SUM(CASE WHEN EmBackorder = 0 THEN 1 ELSE 0 END) AS totNormais,
              SUM(CASE WHEN EmBackorder = 0 AND Quantidade > QuantidadeEnviada THEN 1 ELSE 0 END) AS pendNormais,
              SUM(CASE WHEN QuantidadeEnviada > 0 THEN 1 ELSE 0 END) AS comEnvio,
              SUM(CASE WHEN Quantidade > QuantidadeEnviada THEN 1 ELSE 0 END) AS pendTotal
            FROM dbo.PedidoItem WHERE PedidoId = @pid`);
  const { totNormais, pendNormais, comEnvio, pendTotal } = c.recordset[0];
  if (!comEnvio) return 'Aprovado';
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
    // Linha do tempo do pedido (migration 047). Sem a área 'financeiro', o
    // detalhe de evento que traz valor ("Total R$ ...") sai vazio.
    const verValores = podeVerFinanceiro(req.user);
    detalhe.historico = (await historicoDoPedido(p.PedidoId)).map(ev =>
      verValores || !/R\$/.test(ev.detalhe) ? ev : { ...ev, detalhe: '' });

    // Era por AQUI que a área 'financeiro' vazava: o detalhe do pedido carrega
    // o total, o preço de cada item e a lista de faturas ligadas.
    res.json(verValores ? detalhe : semValores(detalhe));
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

    // NÃO exporta ao Tiny no checkout: o pedido nasce 'Pendente' e só vai ao
    // Tiny quando o ADMIN aprovar (PUT /pedidos/:numero/status → 'Aprovado').
    // Até lá, o estoque local fica segurado pela reserva (tiny.js →
    // reservaPendente), que o cron e a checagem do checkout descontam.
    await tx.commit();

    const emp = await query('SELECT RazaoSocial FROM dbo.Empresa WHERE EmpresaId = @id', { id: req.user.empresaId });
    const itensEmBackorder = itensSnap.filter(i => i.backorder)
      .map(i => ({ sku: i.sku, nome: i.nome, quantidade: i.qtd }));

    await registrarEventoPedido({
      pedidoId, tipo: 'criado', titulo: 'Pedido criado', user: req.user,
      detalhe: resumoPecas(itensSnap) +
        (itensEmBackorder.length ? ` · ${itensEmBackorder.length} item(ns) em pré-venda` : '')
    });

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
//  - 'Aprovado'   -> só a partir de 'Pendente': exporta ao Tiny (aprovarEExportar).
//  - 'Pendente'   -> só enquanto nada foi ao Tiny.
//  - 'Cancelado'  -> devolve ao estoque só o que NÃO saiu (itens normais:
//    Quantidade - QuantidadeEnviada; pré-venda liberada já saiu) e anula a
//    fatura. Se alguma peça já saiu, o Tiny não é cancelado sozinho (aviso).
//  - 'Entregue'   -> só a partir de 'Enviado' (senão o pedido fecharia sem ter
//    saído nem ido ao Tiny).
//  - escopo presente OU status 'Enviado' -> ENVIO segmentado: marca como
//    enviados os itens do escopo que ainda faltam (pré-venda só envia o que já
//    tem estoque, baixando-o agora). Pedido ainda Pendente é aprovado antes.
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
      // Peças que já saíram da prateleira NÃO voltam ao estoque (decisão de
      // 30/09/2026). Antes voltava a quantidade inteira, e o cancelamento de um
      // pedido já enviado criava estoque que não existe.
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

      // Cancela também no Tiny (devolve o estoque lá) — ou, se alguma peça já
      // saiu, só deixa o aviso de ajuste manual. Fire-and-forget.
      cancelarExportacoesDoPedido(ped.PedidoId, { pecasEnviadas });

      // Reivindicações ainda abertas deste pedido: o admin decide o que fazer
      // com elas (decisão de 30/09/2026 — não são recusadas sozinhas).
      const abertas = (await query(
        `SELECT Numero FROM dbo.Reivindicacao WHERE PedidoId = @pid AND Status = 'Em processo'`,
        { pid: ped.PedidoId })).map(r => r.Numero);
      await registrarEventoPedido({
        pedidoId: ped.PedidoId, tipo: 'cancelado', titulo: 'Pedido cancelado', user: req.user,
        detalhe: [
          pecasEnviadas
            ? `${pecasEnviadas} peça(s) já tinham saído e não voltaram ao estoque; o pedido no Tiny precisa de ajuste manual.`
            : 'Nenhuma peça tinha saído: o estoque foi devolvido.',
          abertas.length ? `Reivindicação(ões) ainda aberta(s): ${abertas.join(', ')} — revise no painel.` : ''
        ].filter(Boolean).join(' ')
      });

      return res.json({
        ok: true, status: 'Cancelado', pecasEnviadas,
        aviso: pecasEnviadas
          ? `${pecasEnviadas} peça(s) já tinham saído: não voltaram ao estoque e o pedido no Tiny precisa de ajuste manual.`
          : null
      });
    }

    // ---- Voltar para Pendente: só se nada foi ao Tiny ----
    if (status === 'Pendente') {
      if (ped.Status === 'Pendente') return recusar(409, 'O pedido já está Pendente.');
      if (await jaFoiAoTiny(tx, ped.PedidoId))
        return recusar(409, 'Este pedido já foi aprovado no Tiny e não volta para Pendente. Para desistir, cancele.');
    }

    // ---- Aprovar: vai ao Tiny ----
    if (status === 'Aprovado') {
      if (ped.Status !== 'Pendente')
        return recusar(409, ped.Status === 'Aprovado'
          ? 'O pedido já está aprovado.'
          : `Pedido ${ped.Status.toLowerCase()}: o status agora acompanha o envio das peças.`);
      const exportados = await aprovarEExportar(tx, ped.PedidoId);
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query("UPDATE dbo.Pedido SET Status = N'Aprovado', AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid");
      await tx.commit();
      if (exportados.length) processarExportacoes(); // fire-and-forget
      await registrarEventoPedido({
        pedidoId: ped.PedidoId, tipo: 'aprovado', user: req.user,
        titulo: exportados.length ? 'Pedido aprovado — enviado ao Tiny' : 'Pedido aprovado',
        detalhe: exportados.length ? resumoPecas(exportados) : 'Só peças em pré-venda: vão ao Tiny quando forem liberadas.'
      });
      return res.json({ ok: true, status: 'Aprovado', exportados: exportados.length });
    }

    // ---- Entregue: só depois de tudo enviado ----
    if (status === 'Entregue' && ped.Status !== 'Enviado')
      return recusar(409, 'Só um pedido Enviado pode ser marcado como Entregue — registre o envio das peças antes.');

    // ---- Envio segmentado ----
    // Peças em pré-venda (EmBackorder=1) NÃO entram no fluxo de envio normal do
    // pedido. O status 'Enviado' (escopo 'normal'/'tudo') envia só as peças em
    // estoque; o escopo 'backorder' libera as de pré-venda que já voltaram ao
    // estoque (cada liberação vira um pedido próprio no Tiny).
    if (isShip) {
      // Enviar sem ter aprovado: aprova junto (as peças vão ao Tiny agora).
      const exportados = ped.Status === 'Pendente' ? await aprovarEExportar(tx, ped.PedidoId) : [];

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

      // Pedido SÓ de pré-venda (sem peças em estoque): não pode ir a 'Enviado'
      // por aqui. Suas peças só saem via escopo 'backorder', com estoque.
      if (!enviados && totNormais === 0 && pendTotal > 0)
        return recusar(409, 'Pedido só com itens em pré-venda: aguarde o estoque para enviar essas peças.');

      // LIBERAR pré-venda nunca marca o pedido como 'Enviado' — a peça foi
      // liberada para separação. Pedido que estava Pendente passa a Aprovado.
      const faltam = totNormais > 0 ? pendNormais > 0 : pendTotal > 0;
      const novoStatus = alvoBackorder
        ? (ped.Status === 'Pendente' ? 'Aprovado' : ped.Status)
        : await statusPorEnvio(tx, ped.PedidoId);
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .input('st', sql.NVarChar(14), novoStatus)
        .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');

      // Pré-venda liberada agora vira um pedido próprio no Tiny (baixa o
      // estoque lá): snapshot do que saiu NESTA liberação, na mesma transação.
      if (liberados.length) {
        await marcarExportados(tx, idsLiberados);
        if (exportacaoLigada()) await inserirExportacao(tx, ped.PedidoId, 'backorder', liberados);
      }

      await tx.commit();
      if (liberados.length || exportados.length) processarExportacoes(); // fire-and-forget
      if (exportados.length) {
        await registrarEventoPedido({
          pedidoId: ped.PedidoId, tipo: 'aprovado', user: req.user,
          titulo: 'Pedido aprovado — enviado ao Tiny', detalhe: resumoPecas(exportados)
        });
      }
      await registrarEventoPedido({
        pedidoId: ped.PedidoId, tipo: 'envio', user: req.user,
        ...(alvoBackorder
          ? { titulo: 'Pré-venda liberada para envio', detalhe: resumoPecas(liberados) }
          : { titulo: 'Todas as peças em estoque marcadas como enviadas', detalhe: `Status: ${novoStatus}` })
      });
      return res.json({ ok: true, status: novoStatus, parcial: faltam, exportados: exportados.length });
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

// PUT /api/pedidos/:numero/itens/:itemId/enviado (admin) — ajuste manual da
// quantidade enviada de um item. { qtd } entre 0 e Quantidade. É controle
// interno de envio: o status do pedido (Aprovado/Parcial/Enviado) acompanha, e
// nada vai ao Tiny por aqui — as peças em estoque já foram na aprovação. Para
// itens em pré-venda, aumentar consome estoque (e exige tê-lo) e vira uma
// liberação própria no Tiny; diminuir devolve.
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
    // Peça não sai antes da aprovação: é a aprovação que desconta o Tiny.
    if (it.Status === 'Pendente')
      return recusar(409, 'Aprove o pedido antes de registrar o envio das peças.');
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

    // O status acompanha o envio (Aprovado / Parcial / Enviado).
    const novoStatus = await statusPorEnvio(tx, it.PedidoId);
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

export default router;
