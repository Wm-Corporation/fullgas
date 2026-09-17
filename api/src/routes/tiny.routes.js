// ============================================================
// Rotas da integração Tiny ERP
// ------------------------------------------------------------
//   GET  /api/tiny/produtos    lista do Tiny p/ importação (admin)
//   POST /api/tiny/importar    importa/vincula selecionados (admin)
//   POST /api/tiny/sync-lote   sincroniza produtos importados (admin)
//   GET  /api/tiny/log         histórico de sincronizações (admin)
//   GET  /api/tiny/pedidos     exportações de pedido ao Tiny (admin)
//   POST /api/tiny/pedidos/:id/reexportar   força nova tentativa (admin)
//
// A atualização automática não passa por rota: é o agendamento
// node-cron (tiny-cron.js), que roda o mesmo lote do sync-lote.
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  listarProdutos, obterProdutoCompleto, aplicarAtualizacao,
  sincronizarLote, registrarLog
} from '../tiny.js';
import { exportarPedido } from '../tiny-pedidos.js';
import { prepararMiniaturas } from '../miniaturas.js';
import { erroSku } from '../validacao.js';

const router = Router();

// Falha da integração (token faltando, Tiny fora do ar, limite da API) vira
// resposta clara para o admin em vez de "erro interno" genérico.
function tratarErro(e, res, next) {
  if (e && e.name === 'TinyError') return res.status(502).json({ erro: e.message });
  next(e);
}

// "sucesso" (e não "ok") porque o adapter do front usa "ok" como flag do HTTP.
function resumo(resultados) {
  return {
    total: resultados.length,
    sucesso: resultados.filter(r => r.status === 'ok').length,
    erros: resultados.filter(r => r.status === 'erro').length,
    ignorados: resultados.filter(r => r.status === 'ignorado').length
  };
}

// GET /api/tiny/produtos?pagina=1&pesquisa=  (admin)
// Lista do Tiny anotada com a situação local de cada item:
//   'importado'  já vinculado (TinyId no banco)
//   'sku-existe' o SKU existe no Fullgas sem vínculo — importar vincula
//   'novo'       não existe no Fullgas
router.get('/tiny/produtos', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const lista = await listarProdutos(pagina, String(req.query.pesquisa || '').trim());

    let locais = [];
    if (lista.produtos.length) {
      const params = {};
      const porTiny = [], porSku = [];
      lista.produtos.forEach((p, i) => {
        params[`t${i}`] = p.tinyId; porTiny.push(`@t${i}`);
        if (p.sku) { params[`s${i}`] = p.sku; porSku.push(`@s${i}`); }
      });
      locais = await query(
        `SELECT Sku, TinyId FROM dbo.Produto
          WHERE TinyId IN (${porTiny.join(',')})` +
        (porSku.length ? ` OR Sku IN (${porSku.join(',')})` : ''),
        params
      );
    }
    const tinyIdsLocais = new Set(locais.filter(l => l.TinyId).map(l => l.TinyId));
    const skusLocais = new Set(locais.map(l => l.Sku));

    res.json({
      pagina: lista.pagina,
      totalPaginas: lista.totalPaginas,
      produtos: lista.produtos.map(p => ({
        ...p,
        statusLocal: tinyIdsLocais.has(p.tinyId) ? 'importado'
          : (p.sku && skusLocais.has(p.sku)) ? 'sku-existe'
          : 'novo'
      }))
    });
  } catch (e) { tratarErro(e, res, next); }
});

// POST /api/tiny/importar  (admin) — { tinyIds: [...], categoria: 'pecas' }
// Para cada id: busca o detalhe no Tiny e cria o produto no Fullgas com
// TinyAtivo = 1. Se o SKU já existe, vincula em vez de duplicar (e a
// categoria local é mantida — a do body só vale para produtos novos).
router.post('/tiny/importar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const tinyIds = [...new Set((req.body.tinyIds || []).map(String).filter(Boolean))];
    if (!tinyIds.length) return res.status(400).json({ erro: 'Informe os produtos do Tiny a importar.' });

    const cat = await query('SELECT CategoriaId FROM dbo.Categoria WHERE Codigo = @cat', { cat: req.body.categoria });
    if (!cat.length) return res.status(400).json({ erro: 'Categoria inválida.' });
    const categoriaId = cat[0].CategoriaId;

    const resultados = [];
    for (const tinyId of tinyIds) {
      try {
        const jaVinculado = await query('SELECT Sku FROM dbo.Produto WHERE TinyId = @tid', { tid: tinyId });
        if (jaVinculado.length) {
          resultados.push({ tinyId, sku: jaVinculado[0].Sku, status: 'ignorado', msg: 'Já importado.' });
          continue;
        }

        const dados = await obterProdutoCompleto(tinyId);
        if (!dados.sku) {
          await registrarLog(tinyId, null, 'importacao', 'erro', 'Produto sem código (SKU) no Tiny.');
          resultados.push({ tinyId, status: 'erro', msg: 'Produto sem código (SKU) no Tiny.' });
          continue;
        }

        // O SKU do Tiny passa pela MESMA allowlist do cadastro manual. O ERP é
        // de terceiros e o campo lá é texto livre: sem esta checagem, um código
        // com aspas ou marcação entraria no catálogo por um caminho que ninguém
        // revisa, e o front o usa como atributo de HTML. Recusar o produto é
        // preferível a importar um SKU que a loja não sabe renderizar.
        const errSku = erroSku(dados.sku);
        if (errSku) {
          await registrarLog(tinyId, dados.sku, 'importacao', 'erro', errSku);
          resultados.push({ tinyId, sku: dados.sku, status: 'erro', msg: errSku });
          continue;
        }

        const existente = await query('SELECT ProdutoId FROM dbo.Produto WHERE Sku = @sku', { sku: dados.sku });
        if (existente.length) {
          await query(
            'UPDATE dbo.Produto SET TinyId = @tid, TinyAtivo = 1 WHERE ProdutoId = @pid',
            { tid: tinyId, pid: existente[0].ProdutoId }
          );
        } else {
          await query(
            `INSERT INTO dbo.Produto
               (Sku, Nome, CategoriaId, Descricao, Preco, Estoque, ImagemUrl,
                TinyId, TinyAtivo, TinySincronizadoEm)
             VALUES (@sku, @nome, @catId, @desc, @preco, @est, @foto,
                     @tid, 1, SYSUTCDATETIME())`,
            {
              sku: dados.sku, nome: dados.nome || dados.sku, catId: categoriaId,
              desc: dados.descricao, preco: dados.preco, est: dados.estoque,
              foto: dados.foto, tid: tinyId
            }
          );
        }
        // Vincular também espelha os campos na hora (e carimba a sincronização).
        const r = await aplicarAtualizacao(tinyId, dados, 'importacao');
        resultados.push({
          tinyId, sku: dados.sku,
          status: r.status === 'ok' ? 'ok' : r.status,
          msg: existente.length ? 'SKU já existia — vinculado ao Tiny.' : 'Importado.'
        });
      } catch (e) {
        await registrarLog(tinyId, null, 'importacao', 'erro', e.message);
        resultados.push({ tinyId, status: 'erro', msg: e.message });
      }
    }
    prepararMiniaturas();   // fotos dos importados (segundo plano)
    res.status(201).json({ ...resumo(resultados), resultados });
  } catch (e) { tratarErro(e, res, next); }
});

// POST /api/tiny/sync-lote  (admin)
// Body: { produtoIds: [...] } ou { skus: [...] } ou { todos: true }.
// Sequencial contra a API do Tiny — lotes grandes demoram (≈2 s por produto);
// o front envia em blocos e mostra o progresso.
router.post('/tiny/sync-lote', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    let produtoIds = null; // null = todos com TinyAtivo = 1
    if (!req.body.todos) {
      if (Array.isArray(req.body.produtoIds) && req.body.produtoIds.length) {
        produtoIds = req.body.produtoIds.map(Number).filter(Number.isFinite);
      } else if (Array.isArray(req.body.skus) && req.body.skus.length) {
        const params = {};
        req.body.skus.forEach((s, i) => { params[`s${i}`] = String(s); });
        const rows = await query(
          `SELECT ProdutoId FROM dbo.Produto WHERE Sku IN (${Object.keys(params).map(k => '@' + k).join(',')})`,
          params
        );
        produtoIds = rows.map(r => r.ProdutoId);
      } else {
        return res.status(400).json({ erro: 'Informe produtoIds, skus ou todos: true.' });
      }
      if (!produtoIds.length) return res.status(400).json({ erro: 'Nenhum produto encontrado para sincronizar.' });
    }

    const resultados = await sincronizarLote(produtoIds);
    res.json({ ...resumo(resultados), resultados });
  } catch (e) { tratarErro(e, res, next); }
});

// GET /api/tiny/log?limite=100&sku=  (admin) — últimos registros de
// sincronização (evento 'cron' = rodada automática, 'lote' = botão do admin,
// 'importacao'). Com ?sku=, só os registros daquele produto — é o que o
// editor de produto do catálogo exibe (o log saiu da tela Tiny ERP).
router.get('/tiny/log', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 100));
    const sku = String(req.query.sku || '').trim();
    const rows = await query(
      `SELECT TOP (@n) LogId, TinyId, Sku, Evento, Status, Mensagem, CriadoEm
         FROM dbo.TinySyncLog
        WHERE (@sku = '' OR Sku = @sku)
        ORDER BY LogId DESC`,
      { n: limite, sku }
    );
    res.json(rows.map(r => ({
      id: r.LogId, tinyId: r.TinyId, sku: r.Sku, evento: r.Evento,
      status: r.Status, mensagem: r.Mensagem, data: r.CriadoEm
    })));
  } catch (e) { tratarErro(e, res, next); }
});

// GET /api/tiny/pedidos?pedido=<numero>  (admin) — exportações de pedido ao
// Tiny, mais recentes primeiro. Com ?pedido=, só as daquele pedido — é o que
// o detalhe da venda no admin exibe. 'enviado' = criado E aprovado no Tiny;
// 'erro' fica em retry pelo cron (até o limite) ou pelo botão Reexportar.
router.get('/tiny/pedidos', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 100));
    const pedido = String(req.query.pedido || '').trim();
    const rows = await query(
      `SELECT TOP (@n) te.ExportId, te.Escopo, te.Status, te.TinyPedidoId, te.TinyNumero,
              te.Tentativas, te.UltimoErro, te.CriadoEm, te.ExportadoEm,
              p.NumeroPedido
         FROM dbo.TinyPedidoExport te
         JOIN dbo.Pedido p ON p.PedidoId = te.PedidoId
        WHERE (@ped = '' OR p.NumeroPedido = @ped)
        ORDER BY te.ExportId DESC`,
      { n: limite, ped: pedido }
    );
    res.json(rows.map(r => ({
      id: r.ExportId, pedido: r.NumeroPedido, escopo: r.Escopo, status: r.Status,
      tinyPedidoId: r.TinyPedidoId, tinyNumero: r.TinyNumero,
      tentativas: r.Tentativas, erro: r.UltimoErro,
      criadoEm: r.CriadoEm, exportadoEm: r.ExportadoEm
    })));
  } catch (e) { tratarErro(e, res, next); }
});

// POST /api/tiny/pedidos/:id/reexportar  (admin) — zera as tentativas e tenta
// na hora. Não recria pedido já incluído no Tiny (só reaprova, se faltou).
router.post('/tiny/pedidos/:id/reexportar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rows = await query(
      'SELECT ExportId, Status FROM dbo.TinyPedidoExport WHERE ExportId = @id', { id }
    );
    if (!rows.length) return res.status(404).json({ erro: 'Exportação não encontrada.' });
    if (rows[0].Status === 'enviado')
      return res.status(409).json({ erro: 'Este pedido já foi exportado ao Tiny.' });
    if (rows[0].Status === 'cancelado')
      return res.status(409).json({ erro: 'Exportação cancelada não pode ser reexportada.' });

    await query('UPDATE dbo.TinyPedidoExport SET Tentativas = 0 WHERE ExportId = @id', { id });
    const status = await exportarPedido(id);
    res.json({ ok: status === 'enviado', status });
  } catch (e) { tratarErro(e, res, next); }
});

export default router;
