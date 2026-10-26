// ---- Black order ----
// Fila do que faltou no checkout (ver black-order.js). Cliente vê as da empresa; admin vê todas
// e atualiza à mão a situação do envio da Europa. Quando a peça chega (reserva), o cliente
// compra pelo carrinho da black order: vira pedido normal, com fatura, no preço do dia.
import { Router } from 'express';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin, requireAreaAny } from '../auth.js';
import { atualizarEstoqueCesta } from '../tiny-pedidos.js';
import { registrarEventoPedido, resumoPecas } from '../historico-pedido.js';
import { listaDaEmpresa, aplicarPercentual } from '../lista-preco.js';
import { miniaturaDe } from '../miniaturas.js';
import { criarNotificacao } from '../notificacoes.js';
import { statusDe, pendente } from '../black-order.js';
import { novoNumeroPedido, gravarPedido, podeVerFinanceiro } from './pedidos.routes.js';

const router = Router();

// Situações do envio que o admin escolhe (texto que o cliente vê).
export const SITUACOES = [
  'Aguardando pedido à fábrica', 'Pedida à Europa', 'Em produção na fábrica',
  'Em trânsito', 'Em desembaraço aduaneiro', 'Chegou — em conferência'
];

const toIso = (d) => (d instanceof Date ? d.toISOString() : (d || null));

function urlAbs(req, rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

// Recalcula estoque e fila das peças com o saldo do Tiny (depois de desistência ou compra).
function recalcular(skus) {
  if (!skus.length) return;
  atualizarEstoqueCesta(skus).catch(e => console.warn('⚠ Recalcular black order no Tiny falhou:', e.message));
}

// GET /api/blackorders — cliente: as da empresa; admin: todas.
router.get('/blackorders', requireAuth, requireAreaAny(['loja', 'pedidos']), async (req, res, next) => {
  try {
    const admin = req.user.papel === 'admin';
    const eid = admin ? null : req.user.empresaId;
    const rows = await query(
      `WITH fila AS (
         SELECT BlackOrderId,
                ISNULL(SUM(Quantidade - QuantidadeAtendida - QuantidadeDescartada - QuantidadeReservada)
                  OVER (PARTITION BY ProdutoId ORDER BY BlackOrderId
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS AFrente
           FROM dbo.BlackOrder WHERE Status IN ('Fila', 'Disponivel'))
       SELECT bo.BlackOrderId, bo.NumeroPedido, bo.PedidoId, bo.EmpresaId, bo.Sku, bo.NomeProduto,
              bo.Quantidade, bo.QuantidadeReservada, bo.QuantidadeAtendida, bo.QuantidadeDescartada,
              bo.Status, bo.SituacaoEnvio, bo.PrevisaoChegada, bo.Observacao, bo.AvisadoEm,
              bo.CriadoEm, bo.AtualizadoEm, f.AFrente,
              e.RazaoSocial AS Empresa, u.Nome AS UsuarioNome, u.Email AS UsuarioEmail,
              pr.Descricao, pr.ImagemUrl, pr.Preco, pr.PrevisaoChegada AS PrevisaoProduto,
              c.Codigo AS CategoriaCodigo, c.Nome AS CategoriaNome
         FROM dbo.BlackOrder bo
         JOIN dbo.Empresa e ON e.EmpresaId = bo.EmpresaId
         JOIN dbo.Usuario u ON u.UsuarioId = bo.UsuarioId
         LEFT JOIN fila f ON f.BlackOrderId = bo.BlackOrderId
         LEFT JOIN dbo.Produto pr ON pr.ProdutoId = bo.ProdutoId
         LEFT JOIN dbo.Categoria c ON c.CategoriaId = pr.CategoriaId
        WHERE (@eid IS NULL OR bo.EmpresaId = @eid)
        ORDER BY bo.BlackOrderId DESC`,
      { eid }
    );
    const atend = await query(
      `SELECT a.BlackOrderId, p.NumeroPedido, a.Quantidade, a.CriadoEm
         FROM dbo.BlackOrderAtendimento a
         JOIN dbo.BlackOrder bo ON bo.BlackOrderId = a.BlackOrderId
         JOIN dbo.Pedido p ON p.PedidoId = a.PedidoId
        WHERE (@eid IS NULL OR bo.EmpresaId = @eid)
        ORDER BY a.CriadoEm`,
      { eid }
    );
    const porBo = new Map();
    for (const a of atend) {
      if (!porBo.has(a.BlackOrderId)) porBo.set(a.BlackOrderId, []);
      porBo.get(a.BlackOrderId).push({ pedido: a.NumeroPedido, qtd: a.Quantidade, data: toIso(a.CriadoEm) });
    }

    // Preço de hoje (o que se paga na compra), pela lista da empresa; some sem a área 'financeiro'.
    const verValores = podeVerFinanceiro(req.user);
    const pct = admin ? 0 : ((await listaDaEmpresa(req.user.empresaId))?.percentual || 0);

    res.json(rows.map(r => ({
      id: r.BlackOrderId,
      compra: r.NumeroPedido,
      pedidoExiste: !!r.PedidoId,
      empresa: r.Empresa,
      empresaId: r.EmpresaId,
      usuario: r.UsuarioNome,
      usuarioEmail: r.UsuarioEmail,
      artigo: r.Sku,
      nome: r.NomeProduto,
      descricao: r.Descricao || '',
      cat: r.CategoriaCodigo || null,
      categoria: r.CategoriaNome || '',
      imagem: urlAbs(req, r.ImagemUrl),
      miniatura: urlAbs(req, miniaturaDe(r.ImagemUrl)),
      preco: verValores && r.Preco != null ? aplicarPercentual(r.Preco, pct) : undefined,
      qtd: r.Quantidade,
      reservada: r.QuantidadeReservada,
      atendida: r.QuantidadeAtendida,
      descartada: r.QuantidadeDescartada,
      pendente: pendente(r),
      aFrente: r.AFrente == null ? null : Number(r.AFrente),
      status: r.Status,
      situacao: r.SituacaoEnvio || null,
      previsao: r.PrevisaoChegada || r.PrevisaoProduto || null,
      observacao: r.Observacao || null,
      avisadoEm: toIso(r.AvisadoEm),
      data: toIso(r.CriadoEm),
      atualizadoEm: toIso(r.AtualizadoEm),
      atendimentos: porBo.get(r.BlackOrderId) || []
    })));
  } catch (e) { next(e); }
});

// PATCH /api/blackorders (admin) — { ids, situacao?, previsao?, observacao?, avisar? }.
// Campo ausente não muda; '' apaga. avisar: notifica os clientes da mudança de situação/previsão.
router.patch('/blackorders', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number))].filter(n => Number.isInteger(n) && n > 0) : [];
    if (!ids.length || ids.length > 500) return res.status(400).json({ erro: 'Escolha de 1 a 500 black orders.' });

    const campos = {};
    if (b.situacao !== undefined) {
      const s = String(b.situacao || '').trim();
      if (s && !SITUACOES.includes(s)) return res.status(400).json({ erro: 'Situação do envio inválida.' });
      campos.SituacaoEnvio = s || null;
    }
    if (b.previsao !== undefined) {
      const s = String(b.previsao || '').trim();
      if (s.length > 20) return res.status(400).json({ erro: 'Previsão de chegada muito longa (máximo de 20 caracteres).' });
      campos.PrevisaoChegada = s || null;
    }
    if (b.observacao !== undefined) {
      const s = String(b.observacao || '').trim();
      if (s.length > 500) return res.status(400).json({ erro: 'Observação muito longa (máximo de 500 caracteres).' });
      campos.Observacao = s || null;
    }
    if (!Object.keys(campos).length) return res.status(400).json({ erro: 'Nada para atualizar.' });

    const params = {};
    const marks = ids.map((id, i) => { params['i' + i] = id; return '@i' + i; });
    const sets = Object.keys(campos).map(c => { params[c] = campos[c]; return `${c} = @${c}`; });
    const alteradas = await query(
      `UPDATE dbo.BlackOrder SET ${sets.join(', ')}, AtualizadoEm = SYSUTCDATETIME()
       OUTPUT inserted.BlackOrderId, inserted.EmpresaId, inserted.Sku, inserted.NomeProduto,
              inserted.NumeroPedido, inserted.SituacaoEnvio, inserted.PrevisaoChegada
        WHERE BlackOrderId IN (${marks.join(',')}) AND Status IN ('Fila', 'Disponivel')`,
      params
    );

    if (b.avisar && ('SituacaoEnvio' in campos || 'PrevisaoChegada' in campos)) {
      const porEmpresa = new Map();
      for (const a of alteradas) {
        if (!porEmpresa.has(a.EmpresaId)) porEmpresa.set(a.EmpresaId, []);
        porEmpresa.get(a.EmpresaId).push(a);
      }
      for (const [empresaId, lista] of porEmpresa) {
        await criarNotificacao({
          empresaId, publico: 'cliente', origem: 'blackorder', link: '#blackorder', criadoPor: req.user.id,
          titulo: 'Atualização da sua black order',
          texto: lista.map(a => `• ${a.NomeProduto} (${a.Sku}) — compra ${a.NumeroPedido}: ` +
            [a.SituacaoEnvio, a.PrevisaoChegada ? 'previsão ' + a.PrevisaoChegada : null].filter(Boolean).join(' · ')
          ).join('\n')
        });
      }
    }
    res.json({ ok: true, alteradas: alteradas.length });
  } catch (e) { next(e); }
});

// POST /api/blackorders/:id/desistir — cliente desiste do que falta; admin cancela ({ motivo }).
// O que estava reservado volta para o próximo da fila (ou para a loja).
router.post('/blackorders/:id/desistir', requireAuth, requireAreaAny(['loja', 'pedidos']), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const admin = req.user.papel === 'admin';
    const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
    const bo = (await query(
      `SELECT BlackOrderId, EmpresaId, Sku, NomeProduto, NumeroPedido, Quantidade, QuantidadeReservada,
              QuantidadeAtendida, QuantidadeDescartada, Status
         FROM dbo.BlackOrder WHERE BlackOrderId = @id AND (@eid IS NULL OR EmpresaId = @eid)`,
      { id, eid: admin ? null : req.user.empresaId }
    ))[0];
    if (!bo) return res.status(404).json({ erro: 'Black order não encontrada.' });
    if (bo.Status !== 'Fila' && bo.Status !== 'Disponivel') return res.status(409).json({ erro: 'Esta black order já foi encerrada.' });

    const final = { ...bo, QuantidadeReservada: 0, QuantidadeDescartada: bo.Quantidade - bo.QuantidadeAtendida };
    const status = statusDe(final);
    const obs = admin ? ('Cancelada pela Fullgas' + (motivo ? ': ' + motivo : '.')) : null;
    const r = await query(
      `UPDATE dbo.BlackOrder
          SET QuantidadeReservada = 0, QuantidadeDescartada = @desc, Status = @st,
              Observacao = COALESCE(@obs, Observacao), AtualizadoEm = SYSUTCDATETIME()
       OUTPUT inserted.BlackOrderId
        WHERE BlackOrderId = @id AND QuantidadeAtendida = @atd AND Status IN ('Fila', 'Disponivel')`,
      { id, desc: final.QuantidadeDescartada, st: status, obs, atd: bo.QuantidadeAtendida }
    );
    if (!r.length) return res.status(409).json({ erro: 'A black order mudou enquanto você decidia. Recarregue a página.' });

    if (admin) {
      await criarNotificacao({
        empresaId: bo.EmpresaId, publico: 'cliente', origem: 'blackorder', link: '#blackorder', criadoPor: req.user.id,
        titulo: `Black order cancelada: ${bo.NomeProduto}`,
        texto: `A Fullgas cancelou ${pendente(bo)} un. de ${bo.NomeProduto} (${bo.Sku}) da compra ${bo.NumeroPedido}.` +
          (motivo ? `\nMotivo: ${motivo}` : '') + '\nNada foi cobrado por estas peças.'
      });
    }
    recalcular([bo.Sku]);
    res.json({ ok: true, status });
  } catch (e) { next(e); }
});

// POST /api/blackorders/comprar — { itens: [{ id, quantidade }] } (carrinho da black order).
// Compra até o reservado de cada linha, no preço de hoje; vira pedido normal com fatura.
// Comprar TUDO o que chegou mantém na fila o que ainda não chegou. Comprar MENOS do que chegou
// é a necessidade final: a linha se encerra e o que sobrou vai para o próximo da fila (ou para a loja).
// (Sem isso, a peça recusada voltaria para o próprio cliente, que seria o primeiro da fila.)
router.post('/blackorders/comprar', requireAuth, requireAreaAny(['loja', 'pedidos']), async (req, res, next) => {
  if (req.user.papel === 'admin') return res.status(403).json({ erro: 'Black order é compra de cliente.' });
  const itensReq = Array.isArray(req.body?.itens) ? req.body.itens : [];
  const pedido = new Map();
  for (const it of itensReq) {
    const id = Number(it?.id);
    const q = Number(it?.quantidade);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(q) || q < 0)
      return res.status(400).json({ erro: 'Item inválido no carrinho da black order.' });
    pedido.set(id, q);
  }
  if (!pedido.size || pedido.size > 200) return res.status(400).json({ erro: 'O carrinho da black order está vazio.' });

  const ids = [...pedido.keys()];
  const params = { eid: req.user.empresaId };
  const marks = ids.map((id, i) => { params['i' + i] = id; return '@i' + i; });
  const selecionar = () => query(
    `SELECT BlackOrderId, ProdutoId, Sku, NomeProduto, NumeroPedido, Quantidade, QuantidadeReservada,
            QuantidadeAtendida, QuantidadeDescartada, Status
       FROM dbo.BlackOrder
      WHERE EmpresaId = @eid AND BlackOrderId IN (${marks.join(',')})`,
    params
  );

  try {
    // Saldo real no Tiny antes de vender (redistribui a fila). Tiny fora não trava.
    let linhas = await selecionar();
    try { await atualizarEstoqueCesta([...new Set(linhas.map(l => l.Sku))]); }
    catch (e) { console.warn('⚠ Checagem de estoque no Tiny indisponível:', e.message); }
    linhas = await selecionar();

    for (const id of ids) {
      const l = linhas.find(x => x.BlackOrderId === id);
      if (!l) return res.status(404).json({ erro: 'Black order não encontrada.' });
      if (l.Status !== 'Disponivel' || l.QuantidadeReservada <= 0)
        return res.status(409).json({ erro: `${l.NomeProduto} (${l.Sku}) não tem peças disponíveis agora.`, id });
      if (pedido.get(id) > l.QuantidadeReservada)
        return res.status(409).json({
          erro: `${l.NomeProduto} (${l.Sku}): só ${l.QuantidadeReservada} un. disponíveis agora.`,
          id, disponivel: l.QuantidadeReservada
        });
    }

    const lista = await listaDaEmpresa(req.user.empresaId);
    const pct = lista?.percentual || 0;
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const itens = [];
      const descartes = [];
      for (const id of ids) {
        const l = linhas.find(x => x.BlackOrderId === id);
        const q = pedido.get(id);
        const solta = l.QuantidadeReservada - q;
        const atendida = l.QuantidadeAtendida + q;
        const final = {
          ...l, QuantidadeReservada: 0,
          QuantidadeAtendida: atendida,
          QuantidadeDescartada: solta > 0 ? l.Quantidade - atendida : l.QuantidadeDescartada
        };
        const upd = await new sql.Request(tx)
          .input('id', sql.Int, id)
          .input('atd', sql.Int, final.QuantidadeAtendida)
          .input('desc', sql.Int, final.QuantidadeDescartada)
          .input('st', sql.VarChar(12), statusDe(final))
          .input('res', sql.Int, l.QuantidadeReservada)
          .query(`UPDATE dbo.BlackOrder
                     SET QuantidadeReservada = 0, QuantidadeAtendida = @atd, QuantidadeDescartada = @desc,
                         Status = @st, AtualizadoEm = SYSUTCDATETIME()
                  OUTPUT inserted.BlackOrderId
                   WHERE BlackOrderId = @id AND QuantidadeReservada = @res AND Status = 'Disponivel'`);
        if (!upd.recordset.length) {
          await tx.rollback();
          return res.status(409).json({ erro: 'A black order mudou enquanto você decidia. Recarregue a página.' });
        }
        if (solta > 0) {
          descartes.push({
            sku: l.Sku, nome: l.NomeProduto, quantidade: solta,
            encerrada: l.Quantidade - atendida - solta    // ainda não tinha chegado e saiu da fila junto
          });
        }
        if (q > 0) {
          const prod = (await new sql.Request(tx).input('pid', sql.Int, l.ProdutoId)
            .query('SELECT Preco FROM dbo.Produto WHERE ProdutoId = @pid')).recordset[0];
          itens.push({
            boId: id, produtoId: l.ProdutoId, sku: l.Sku, nome: l.NomeProduto,
            preco: aplicarPercentual(prod?.Preco ?? 0, pct), qtd: q, compra: l.NumeroPedido
          });
        }
      }

      let numero = null, pedidoId = null, total = 0;
      if (itens.length) {
        const n = await novoNumeroPedido(tx);
        numero = n.NumeroPedido;
        ({ pedidoId, total } = await gravarPedido(tx, { numero, agora: n.Agora, user: req.user, lista, itens }));
        for (const it of itens) {
          await new sql.Request(tx)
            .input('bo', sql.Int, it.boId).input('pid', sql.Int, pedidoId).input('q', sql.Int, it.qtd)
            .query('INSERT INTO dbo.BlackOrderAtendimento (BlackOrderId, PedidoId, Quantidade) VALUES (@bo, @pid, @q)');
        }
      }
      await tx.commit();

      if (pedidoId) {
        await registrarEventoPedido({
          pedidoId, tipo: 'criado', titulo: 'Pedido criado pelo carrinho da black order', user: req.user,
          detalhe: resumoPecas(itens) + ' · compra(s) de origem: ' + [...new Set(itens.map(i => i.compra))].join(', ')
        });
      }
      if (descartes.length) recalcular(descartes.map(d => d.sku));

      res.status(201).json({
        id: numero,
        total,
        itens: itens.map(i => ({ artigo: i.sku, nome: i.nome, preco: i.preco, qtd: i.qtd })),
        liberadas: descartes
      });
    } catch (e) {
      try { await tx.rollback(); } catch { /* já desfeita */ }
      throw e;
    }
  } catch (e) { next(e); }
});

export default router;
