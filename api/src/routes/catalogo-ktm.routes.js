// Catálogo de peças KTM / Husqvarna / GASGAS (em teste: só administradores).
// Lê o SparePartsFinder oficial (catalogo-ktm.js) e cruza cada peça com o Produto do portal pelo SKU:
// existe e tem estoque → carrinho normal; sem estoque ou fora do Tiny → vira black order no checkout.
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import * as catalogo from '../catalogo-ktm.js';
import { CATEGORIA_CATALOGO, categoriaDoCatalogo } from '../catalogo-produto.js';
import { miniaturaDe } from '../miniaturas.js';

const router = Router();
const soAdmin = [requireAuth, requireAdmin];

function marcaOu404(req, res) {
  const marca = String(req.params.marca || '').toLowerCase();
  if (!catalogo.marcaValida(marca)) { res.status(404).json({ erro: 'Marca fora do catálogo.' }); return null; }
  return marca;
}
const ladoDe = (v) => (v === 'engine' ? 'engine' : 'chassi');
const idValido = (v) => /^\d{1,12}$/.test(String(v || ''));
const fresco = (req) => req.query.atualizar === '1';

// Erro do site da KTM vira mensagem clara; o resto segue o tratador central.
function falha(res, next) {
  return (e) => (e instanceof catalogo.ErroCatalogo ? res.status(e.status).json({ erro: e.message }) : next(e));
}

// Produtos do portal por SKU (estoque e preço já são o espelho do Tiny).
async function produtosPorSku(skus) {
  const unicos = [...new Set(skus.filter(Boolean))];
  if (!unicos.length) return new Map();
  const params = {};
  const marks = unicos.map((s, i) => { params['s' + i] = s; return '@s' + i; });
  const rows = await query(
    `SELECT p.Sku, p.Nome, p.Preco, p.Estoque, p.TinyId, p.ImagemUrl, c.Codigo AS Categoria
       FROM dbo.Produto p JOIN dbo.Categoria c ON c.CategoriaId = p.CategoriaId
      WHERE p.Sku IN (${marks.join(',')})`, params);
  return new Map(rows.map(r => [r.Sku.toUpperCase(), r]));
}

// URL relativa (/uploads/...) → absoluta, como no catálogo da loja. URL já absoluta passa intacta.
function urlAbs(req, rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

// Foto da peça = foto do nosso produto (vinda do Tiny). O finder da KTM não tem foto por peça.
function situacaoNaLoja(req, p) {
  if (!p) return { existe: false, foraDoTiny: true, estoque: 0, preco: null, foto: null, miniatura: null };
  return {
    existe: true,
    foraDoTiny: !p.TinyId,
    estoque: Math.max(0, Number(p.Estoque) || 0),
    preco: Number(p.Preco) > 0 ? Number(p.Preco) : null,
    artigo: p.Sku,
    foto: urlAbs(req, p.ImagemUrl),
    miniatura: urlAbs(req, miniaturaDe(p.ImagemUrl))
  };
}

router.get('/catalogo-ktm/marcas', ...soAdmin, (_req, res) => {
  res.json(Object.entries(catalogo.MARCAS).map(([id, m]) => ({ id, nome: m.nome })));
});

router.get('/catalogo-ktm/:marca/modelos', ...soAdmin, (req, res, next) => {
  const marca = marcaOu404(req, res); if (!marca) return;
  catalogo.modelos(marca, { fresco: fresco(req) }).then(l => res.json(l), falha(res, next));
});

router.get('/catalogo-ktm/:marca/vin/:vin', ...soAdmin, async (req, res, next) => {
  const marca = marcaOu404(req, res); if (!marca) return;
  const vin = String(req.params.vin || '').trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) return res.status(400).json({ erro: 'Chassi (VIN) inválido.' });
  try {
    const id = await catalogo.buscarVin(marca, vin);
    const m = id && await catalogo.modelo(marca, id);
    if (!m) return res.status(404).json({ erro: `Chassi não encontrado no catálogo da ${catalogo.MARCAS[marca].nome}.` });
    res.json(m);
  } catch (e) { falha(res, next)(e); }
});

router.get('/catalogo-ktm/:marca/modelos/:id/:lado', ...soAdmin, async (req, res, next) => {
  const marca = marcaOu404(req, res); if (!marca) return;
  if (!idValido(req.params.id)) return res.status(400).json({ erro: 'Modelo inválido.' });
  const lado = ladoDe(req.params.lado);
  try {
    const m = await catalogo.modelo(marca, req.params.id);
    if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });
    const { foto, grupos } = await catalogo.grupos(marca, m.id, lado, { fresco: fresco(req) });
    res.json({ modelo: m, lado, temFoto: !!foto, grupos });
  } catch (e) { falha(res, next)(e); }
});

router.get('/catalogo-ktm/:marca/modelos/:id/:lado/grupos/:grupo', ...soAdmin, async (req, res, next) => {
  const marca = marcaOu404(req, res); if (!marca) return;
  if (!idValido(req.params.id) || !idValido(req.params.grupo)) return res.status(400).json({ erro: 'Grupo inválido.' });
  const lado = ladoDe(req.params.lado);
  const grupoId = Number(req.params.grupo);
  try {
    const m = await catalogo.modelo(marca, req.params.id);
    if (!m) return res.status(404).json({ erro: 'Modelo não encontrado.' });
    const lista = (await catalogo.grupos(marca, m.id, lado)).grupos;
    const pos = lista.findIndex(g => g.id === grupoId);
    if (pos < 0) return res.status(404).json({ erro: 'Este grupo não pertence ao modelo.' });

    const g = await catalogo.grupo(marca, grupoId, m.id, lado, { fresco: fresco(req) });
    const naLoja = await produtosPorSku(g.pecas.filter(p => p.pedivel).map(p => p.sku));
    res.json({
      modelo: m,
      lado,
      grupo: lista[pos],
      vizinhos: { anterior: lista[pos - 1]?.id ?? null, proxima: lista[pos + 1]?.id ?? null },
      mapa: g.mapa ? { arquivo: g.mapa, largura: g.largura, altura: g.altura } : null,
      pontos: g.pontos,
      pecas: g.pecas.map(p => ({ ...p, loja: p.pedivel ? situacaoNaLoja(req, naLoja.get(p.sku.toUpperCase())) : null }))
    });
  } catch (e) { falha(res, next)(e); }
});

// Prancha: baixada uma vez e servida daqui (só para quem está logado como admin).
router.get('/catalogo-ktm/:marca/mapas/:arquivo', ...soAdmin, async (req, res, next) => {
  const marca = marcaOu404(req, res); if (!marca) return;
  try {
    const abs = await catalogo.mapa(marca, req.params.arquivo);
    res.set('Cache-Control', 'private, max-age=604800');
    res.sendFile(abs);
  } catch (e) { falha(res, next)(e); }
});

// Foto da moto (a mesma do "Show Image" da KTM), baixada uma vez.
router.get('/catalogo-ktm/:marca/fotos/:id', ...soAdmin, async (req, res, next) => {
  const marca = marcaOu404(req, res); if (!marca) return;
  if (!idValido(req.params.id)) return res.status(400).json({ erro: 'Modelo inválido.' });
  try {
    if (!(await catalogo.modelo(marca, req.params.id))) return res.status(404).json({ erro: 'Modelo não encontrado.' });
    const abs = await catalogo.fotoModelo(marca, req.params.id);
    res.set('Cache-Control', 'private, max-age=604800');
    res.sendFile(abs);
  } catch (e) { falha(res, next)(e); }
});

// Garante no portal as peças que ainda não existem (categoria do catálogo, preço 0, estoque 0):
// assim entram na cesta e o checkout as manda para a black order. { marca, itens: [{ sku, nome }] }
router.post('/catalogo-ktm/pecas', ...soAdmin, async (req, res, next) => {
  const marca = String(req.body?.marca || '').toLowerCase();
  if (!catalogo.marcaValida(marca)) return res.status(400).json({ erro: 'Marca fora do catálogo.' });
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itens.length || itens.length > 200) return res.status(400).json({ erro: 'Informe de 1 a 200 peças.' });
  const pedidos = [];
  for (const it of itens) {
    const sku = String(it?.sku || '').trim().toUpperCase();
    if (!/^[A-Z0-9._/-]{1,40}$/.test(sku) || sku === 'SPNO') return res.status(400).json({ erro: `Código de peça inválido: ${sku || '(vazio)'}` });
    pedidos.push({ sku, nome: String(it?.nome || '').trim().slice(0, 160) || sku });
  }
  try {
    const existentes = await produtosPorSku(pedidos.map(p => p.sku));
    const novos = pedidos.filter(p => !existentes.has(p.sku));
    let criados = 0;
    if (novos.length) {
      const catId = await categoriaDoCatalogo();
      const origem = catalogo.MARCAS[marca].nome;
      for (const p of novos) {
        // Outro admin pode ter criado no meio do caminho: o NOT EXISTS evita a violação de UQ_Produto_Sku.
        const r = await query(
          `INSERT INTO dbo.Produto (Sku, Nome, CategoriaId, Descricao, Preco, Estoque)
           OUTPUT inserted.ProdutoId
           SELECT @sku, @nome, @cat, @desc, 0, 0
            WHERE NOT EXISTS (SELECT 1 FROM dbo.Produto WHERE Sku = @sku)`,
          { sku: p.sku, nome: p.nome, cat: catId,
            desc: `Peça do catálogo ${origem}, ainda fora do Tiny. Preço definido na chegada.` });
        criados += r.length;
      }
    }
    const final = await produtosPorSku(pedidos.map(p => p.sku));
    res.json({
      criados,
      categoria: CATEGORIA_CATALOGO,
      pecas: pedidos.map(p => ({ sku: p.sku, ...situacaoNaLoja(req, final.get(p.sku)) }))
    });
  } catch (e) { next(e); }
});

export default router;
