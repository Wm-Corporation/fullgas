// ---- Integração Tiny ERP (admin) ----
//   GET  /api/tiny/produtos                 lista do Tiny para importar
//   POST /api/tiny/importar                 importa/vincula
//   POST /api/tiny/sync-lote                sincroniza importados
//   GET  /api/tiny/contatos                 cadastro das concessionárias no Tiny
//   GET  /api/tiny/log                      histórico de sincronização
//   GET  /api/tiny/pedidos                  exportações de pedido
//   POST /api/tiny/pedidos/:id/reexportar   nova tentativa
// O sync automático é o tiny-cron.js.
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

// Erro da integração vira mensagem clara para o admin.
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

// GET /api/tiny/produtos?pagina=1&pesquisa=  — situacao: 'importado' | 'sku-existe' | 'novo'
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

// POST /api/tiny/importar — { tinyIds: [...], categoria }. SKU existente é vinculado (mantém a categoria).
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

        // SKU do Tiny passa pela mesma validação do cadastro manual.
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

// POST /api/tiny/sync-lote — { produtoIds } | { skus } | { todos: true }. ≈2 s por produto.
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

// GET /api/tiny/log?limite=100&sku=  — evento 'cron' | 'lote' | 'importacao'.
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

// GET /api/tiny/contatos — vínculo, edição pendente e último log de cada concessionária.
// Só conta erro recente (o cron re-tenta a cada 30 min).
const JANELA_ERRO_CONTATO_MS = 2 * 60 * 60 * 1000;
router.get('/tiny/contatos', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT e.EmpresaId, e.RazaoSocial, e.Cnpj, e.TinyContatoId,
              e.TinyContatoPendente, e.TinyContatoAlterado,
              ul.Status AS UltimoStatus, ul.Mensagem AS UltimaMensagem, ul.CriadoEm AS UltimaData
         FROM dbo.Empresa e
         OUTER APPLY (
           SELECT TOP 1 l.Status, l.Mensagem, l.CriadoEm
             FROM dbo.TinySyncLog l
            WHERE l.Evento = 'contato'
              AND (l.TinyId = CAST(e.TinyContatoId AS VARCHAR(40))
                   OR l.Mensagem LIKE '%"' + e.RazaoSocial + '"%')
            ORDER BY l.LogId DESC
         ) ul
        WHERE e.Ativo = 1
        ORDER BY e.RazaoSocial`
    );
    res.json(rows.map(r => {
      const pendente = !!r.TinyContatoPendente && !r.TinyContatoId;
      const alterado = !!r.TinyContatoAlterado;
      const erro = r.UltimoStatus === 'erro' && r.UltimaData &&
        Date.now() - new Date(r.UltimaData).getTime() < JANELA_ERRO_CONTATO_MS;
      return {
        empresaId: r.EmpresaId, empresa: r.RazaoSocial, cnpj: r.Cnpj || '',
        tinyContatoId: r.TinyContatoId || null,
        pendente, alterado,
        ultimoStatus: r.UltimoStatus || null,
        ultimaMensagem: r.UltimaMensagem || null,
        ultimaData: r.UltimaData || null,
        problema: pendente || alterado || erro
      };
    }));
  } catch (e) { tratarErro(e, res, next); }
});

// GET /api/tiny/pedidos?pedido=<numero> — 'enviado' = criado e aprovado no Tiny; 'erro' é re-tentado.
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

// POST /api/tiny/pedidos/:id/reexportar — zera tentativas e tenta já (não duplica pedido).
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
