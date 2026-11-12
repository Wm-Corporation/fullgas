// Catálogo de peças KTM / Husqvarna / GASGAS (em teste: só administradores).
// Lê o SparePartsFinder oficial (catalogo-ktm.js) e cruza cada peça pelo código, nesta ordem:
//   1. produto do portal ligado ao Tiny → preço e estoque reais;
//   2. só no Tiny (índice tiny-indice.js) → é importado ao ir para a cesta;
//   3. em nenhum dos dois → cadastrado "fora do Tiny" (preço 0, estoque 0) e vira black order no checkout.
// Kit de pistão vem no Tiny por classe ("55430007000 I" / "II"): o admin escolhe a classe.
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import * as catalogo from '../catalogo-ktm.js';
import * as indiceTiny from '../tiny-indice.js';
import { listarProdutos, importarProduto } from '../tiny.js';
import { CATEGORIA_CATALOGO, categoriaDoCatalogo } from '../catalogo-produto.js';
import { miniaturaDe } from '../miniaturas.js';
import { erroSku } from '../validacao.js';

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
const maiusc = (s) => String(s || '').trim().toUpperCase();

// Erro do site da KTM vira mensagem clara; o resto segue o tratador central.
function falha(res, next) {
  return (e) => (e instanceof catalogo.ErroCatalogo ? res.status(e.status).json({ erro: e.message }) : next(e));
}

// Produtos do portal por SKU (estoque e preço já são o espelho do Tiny).
async function produtosPorSku(skus) {
  const unicos = [...new Set(skus.filter(Boolean).map(maiusc))];
  if (!unicos.length) return new Map();
  const params = {};
  const marks = unicos.map((s, i) => { params['s' + i] = s; return '@s' + i; });
  const rows = await query(
    `SELECT p.Sku, p.Nome, p.Preco, p.Estoque, p.TinyId, p.ImagemUrl, c.Codigo AS Categoria
       FROM dbo.Produto p JOIN dbo.Categoria c ON c.CategoriaId = p.CategoriaId
      WHERE p.Sku IN (${marks.join(',')})`, params);
  return new Map(rows.map(r => [maiusc(r.Sku), r]));
}

// URL relativa (/uploads/...) → absoluta, como no catálogo da loja. URL já absoluta passa intacta.
function urlAbs(req, rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

// Uma opção de compra da peça. Estoque só é conhecido para o que já está no portal (o resto: ao importar).
function opcao(req, { artigo, classe = null, tinyId = null, precoTiny = null }, p) {
  const noPortal = !!p?.TinyId;
  return {
    artigo: p?.Sku || artigo,
    classe,
    tinyId: p?.TinyId || tinyId,
    noPortal,
    estoque: noPortal ? Math.max(0, Number(p.Estoque) || 0) : null,
    preco: noPortal ? (Number(p.Preco) > 0 ? Number(p.Preco) : null) : (precoTiny > 0 ? precoTiny : null),
    foto: urlAbs(req, p?.ImagemUrl),
    miniatura: urlAbs(req, miniaturaDe(p?.ImagemUrl))
  };
}

// Situação de uma peça do catálogo. origem: 'portal' | 'tiny' | 'fora' | 'verificar' (índice ainda montando).
export function situacaoDaPeca(req, sku, portal, doTiny) {
  const k = maiusc(sku);
  const local = portal.get(k);
  if (doTiny && doTiny.length) {
    const opcoes = doTiny.map(t => opcao(req, { artigo: t.sku, classe: t.classe, tinyId: t.tinyId, precoTiny: t.preco }, portal.get(maiusc(t.sku))));
    return { origem: opcoes.every(o => o.noPortal) ? 'portal' : 'tiny', opcoes };
  }
  if (local?.TinyId) return { origem: 'portal', opcoes: [opcao(req, { artigo: k }, local)] };
  return { origem: doTiny ? 'fora' : 'verificar', opcoes: [opcao(req, { artigo: k }, local)] };
}

router.get('/catalogo-ktm/marcas', ...soAdmin, (_req, res) => {
  res.json(Object.entries(catalogo.MARCAS).map(([id, m]) => ({ id, nome: m.nome })));
});

// Estado do índice de códigos do Tiny; POST força uma nova leitura (em segundo plano, ~2 min).
router.get('/catalogo-ktm/tiny-indice', ...soAdmin, (_req, res) => res.json(indiceTiny.situacao()));
router.post('/catalogo-ktm/tiny-indice', ...soAdmin, (_req, res) => {
  indiceTiny.atualizar({ forcar: true });
  res.status(202).json(indiceTiny.situacao());
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
    // Recalculado na leitura: o cache de grupos lidos antes da regra do kit de pistão ainda vale.
    const pecas = g.pecas.map(p => ({ ...p, pedivel: catalogo.pedivel(p.sku) }));
    const ix = indiceTiny.atual();
    const pediveis = pecas.filter(p => p.pedivel);
    const doTiny = new Map(pediveis.map(p => [p.sku, indiceTiny.buscar(p.sku, ix)]));
    const portal = await produtosPorSku([
      ...pediveis.map(p => p.sku),
      ...[...doTiny.values()].flatMap(l => (l || []).map(t => t.sku))
    ]);
    res.json({
      modelo: m,
      lado,
      grupo: lista[pos],
      vizinhos: { anterior: lista[pos - 1]?.id ?? null, proxima: lista[pos + 1]?.id ?? null },
      mapa: g.mapa ? { arquivo: g.mapa, largura: g.largura, altura: g.altura } : null,
      pontos: g.pontos,
      indiceTiny: indiceTiny.situacao(),
      pecas: pecas.map(p => ({ ...p, loja: p.pedivel ? situacaoDaPeca(req, p.sku, portal, doTiny.get(p.sku)) : null }))
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

// Produtos do Tiny para um código: pelo índice ou, enquanto ele monta, pesquisando direto (1 chamada).
async function noTiny(sku) {
  const doIndice = indiceTiny.buscar(sku);
  if (doIndice) return doIndice;
  const { base } = indiceTiny.separarClasse(sku);
  const r = await listarProdutos(1, base, { prioritario: true });
  return indiceTiny.filtrarClasse(sku, r.produtos
    .filter(p => (!p.situacao || p.situacao === 'A') && indiceTiny.chaveBase(p.sku) === indiceTiny.chaveBase(base))
    .map(p => ({ tinyId: p.tinyId, sku: p.sku, nome: p.nome, preco: p.preco, classe: indiceTiny.separarClasse(p.sku).classe })));
}

// Prepara as peças para a cesta. { marca, itens: [{ sku, nome, artigo? }] } — artigo = classe escolhida (kit de pistão).
// No portal: nada a fazer. Só no Tiny: importa (preço e estoque reais). Em nenhum: cadastra fora do Tiny.
router.post('/catalogo-ktm/pecas', ...soAdmin, async (req, res, next) => {
  const marca = String(req.body?.marca || '').toLowerCase();
  if (!catalogo.marcaValida(marca)) return res.status(400).json({ erro: 'Marca fora do catálogo.' });
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itens.length || itens.length > 200) return res.status(400).json({ erro: 'Informe de 1 a 200 peças.' });
  const pedidos = [];
  for (const it of itens) {
    const sku = maiusc(it?.sku);
    if (!catalogo.pedivel(sku)) return res.status(400).json({ erro: `Código de peça inválido: ${sku || '(vazio)'}` });
    const artigo = it?.artigo ? maiusc(it.artigo) : null;
    if (artigo && erroSku(artigo)) return res.status(400).json({ erro: `Código de peça inválido: ${artigo}` });
    pedidos.push({ sku, artigo, nome: String(it?.nome || '').trim().slice(0, 160) || sku });
  }

  try {
    const portal = await produtosPorSku(pedidos.flatMap(p => [p.sku, p.artigo]));
    const erros = [];
    let catId = null;
    let importados = 0, criados = 0;
    for (const p of pedidos) {
      const local = portal.get(p.artigo || p.sku);
      if (local?.TinyId) { p.final = local.Sku; continue; }

      const doTiny = await noTiny(p.sku);
      let alvo = null;
      if (doTiny.length) {
        alvo = p.artigo ? doTiny.find(t => maiusc(t.sku) === p.artigo)
          : doTiny.length === 1 ? doTiny[0]
          : doTiny.find(t => !t.classe && maiusc(t.sku) === p.sku);
        if (!alvo) {
          erros.push({ sku: p.sku, erro: `${p.nome} (${p.sku}): escolha a classe (${doTiny.map(t => t.classe || 'sem classe').join(' ou ')}).` });
          continue;
        }
        const ja = portal.get(maiusc(alvo.sku));
        if (ja?.TinyId) { p.final = ja.Sku; continue; }
        catId ??= await categoriaDoCatalogo();
        const r = await importarProduto(alvo.tinyId, catId, { prioritario: true });
        if (r.status === 'erro') { erros.push({ sku: p.sku, erro: `${p.nome} (${alvo.sku}): o Tiny não importou — ${r.msg}` }); continue; }
        importados += r.status === 'ok' ? 1 : 0;
        p.final = r.sku || alvo.sku;
        continue;
      }

      // Em nenhum lugar: fora do Tiny. O NOT EXISTS evita a violação de UQ_Produto_Sku se outro admin criou junto.
      if (!local) {
        catId ??= await categoriaDoCatalogo();
        const r = await query(
          `INSERT INTO dbo.Produto (Sku, Nome, CategoriaId, Descricao, Preco, Estoque)
           OUTPUT inserted.ProdutoId
           SELECT @sku, @nome, @cat, @desc, 0, 0
            WHERE NOT EXISTS (SELECT 1 FROM dbo.Produto WHERE Sku = @sku)`,
          { sku: p.sku, nome: p.nome, cat: catId,
            desc: `Peça do catálogo ${catalogo.MARCAS[marca].nome}, ainda fora do Tiny. Preço definido na chegada.` });
        criados += r.length;
      }
      p.final = p.sku;
    }

    const final = await produtosPorSku(pedidos.map(p => p.final));
    res.status(erros.length && erros.length === pedidos.length ? 409 : 200).json({
      importados,
      criados,
      categoria: CATEGORIA_CATALOGO,
      erros,
      erro: erros.length === pedidos.length ? erros.map(e => e.erro).join(' ') : undefined,
      pecas: pedidos.filter(p => p.final).map(p => {
        const row = final.get(maiusc(p.final));
        return { sku: p.sku, ...opcao(req, { artigo: p.final }, row), foraDoTiny: !row?.TinyId };
      })
    });
  } catch (e) {
    if (e?.name === 'TinyError') return res.status(502).json({ erro: e.message });
    next(e);
  }
});

export default router;
