// ============================================================
// Controller de Produto — traduz HTTP ↔ serviço.
// Aqui mora a FORMA da resposta (o DTO que o front espera) e a URL absoluta
// da imagem, que depende do host da requisição.
// ============================================================
import * as service from '../services/produto.service.js';
import { miniaturaDe, prepararMiniaturas } from '../miniaturas.js';
import { percentualDoUsuario, aplicarPercentual } from '../lista-preco.js';

// URL relativa do banco (/uploads/...) → absoluta, usando o host da requisição.
// URLs já absolutas (ex.: imagem hospedada no Tiny) passam intactas.
function urlAbs(req, rel) {
  if (!rel) return rel || null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

// Linha do banco → formato que o front (store.js) já espera.
// `pct` = % da lista de preço de quem pede (0 para admin: preço base).
function toProduto(req, r, pct = 0) {
  return {
    artigo: r.Sku,
    nome: r.Nome,
    cat: r.CategoriaCodigo,
    preco: aplicarPercentual(r.Preco, pct),
    estoque: r.Estoque,
    descricao: r.Descricao || '',
    previsao: r.PrevisaoChegada || null,
    imagem: urlAbs(req, r.ImagemUrl),
    // Cópia pequena para listas e miniaturas; null enquanto não foi gerada.
    miniatura: urlAbs(req, miniaturaDe(r.ImagemUrl)),
    tinyAtivo: !!r.TinyAtivo,
    tinySincronizadoEm: r.TinySincronizadoEm || null
  };
}

export async function listar(req, res, next) {
  try {
    const [rows, pct] = await Promise.all([service.listar(req.query.categoria), percentualDoUsuario(req.user)]);
    res.json(rows.map(r => toProduto(req, r, pct)));
  } catch (e) { next(e); }
}

export async function obter(req, res, next) {
  try {
    const [row, pct] = await Promise.all([service.obter(req.params.sku), percentualDoUsuario(req.user)]);
    res.json(toProduto(req, row, pct));
  } catch (e) { next(e); }
}

export async function criar(req, res, next) {
  try {
    await service.criar(req.body || {});
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
}

export async function atualizar(req, res, next) {
  try {
    const r = await service.atualizar(req.params.sku, req.body || {});
    res.json(r.tiny ? { ok: true, tiny: true } : { ok: true });
  } catch (e) { next(e); }
}

export async function excluir(req, res, next) {
  try {
    await service.excluir(req.params.sku);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function enviarImagem(req, res, next) {
  try {
    const rel = await service.definirImagem(req.params.sku, req.file.filename);
    prepararMiniaturas();   // em segundo plano
    res.status(201).json({ ok: true, imagem: urlAbs(req, rel) });
  } catch (e) { next(e); }
}

export async function removerImagem(req, res, next) {
  try {
    await service.removerImagem(req.params.sku);
    res.json({ ok: true });
  } catch (e) { next(e); }
}
