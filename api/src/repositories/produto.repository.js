// Repositório de Produto: único lugar com SQL de produto.
import { query } from '../db.js';

const SELECT_PROD =
  `SELECT p.ProdutoId, p.Sku, p.Nome, p.Descricao, p.Preco, p.Estoque,
          p.PrevisaoChegada, p.ImagemUrl, p.TinyAtivo, p.TinySincronizadoEm,
          c.Codigo AS CategoriaCodigo
     FROM dbo.Produto p
     JOIN dbo.Categoria c ON c.CategoriaId = p.CategoriaId`;

// Lista todos ou, se `categoria` (Codigo) vier, só os daquela categoria.
export function listar(categoria) {
  if (categoria) {
    return query(SELECT_PROD + ' WHERE c.Codigo = @cat ORDER BY p.Nome', { cat: categoria });
  }
  return query(SELECT_PROD + ' ORDER BY p.Nome');
}

export async function buscarPorSku(sku) {
  const r = await query(SELECT_PROD + ' WHERE p.Sku = @sku', { sku });
  return r[0] || null;
}

// Estado mínimo para decidir a edição: se existe e se é espelho do Tiny.
export async function estado(sku) {
  const r = await query('SELECT TinyAtivo FROM dbo.Produto WHERE Sku = @sku', { sku });
  return { existe: r.length > 0, tinyAtivo: r.length ? !!r[0].TinyAtivo : false };
}

export function inserir({ sku, nome, catId, descricao, preco, estoque, previsao }) {
  return query(
    `INSERT INTO dbo.Produto (Sku, Nome, CategoriaId, Descricao, Preco, Estoque, PrevisaoChegada)
     VALUES (@sku, @nome, @catId, @desc, @preco, @est, @prev)`,
    { sku, nome, catId, desc: descricao || null, preco, est: estoque || 0, prev: previsao || null }
  );
}

// Produto do Tiny: só categoria e previsão de chegada mudam por aqui.
export function atualizarCamposTiny({ sku, catId, previsao }) {
  return query(
    `UPDATE dbo.Produto
        SET CategoriaId=@catId, PrevisaoChegada=@prev, AtualizadoEm=SYSUTCDATETIME()
      WHERE Sku=@sku`,
    { sku, catId, prev: previsao || null }
  );
}

export function atualizarCompleto({ sku, nome, catId, descricao, preco, estoque, previsao }) {
  return query(
    `UPDATE dbo.Produto
        SET Nome=@nome, CategoriaId=@catId, Descricao=@desc,
            Preco=@preco, Estoque=@est, PrevisaoChegada=@prev, AtualizadoEm=SYSUTCDATETIME()
      WHERE Sku=@sku`,
    { sku, nome, catId, desc: descricao || null, preco, est: estoque || 0, prev: previsao || null }
  );
}

// Apaga e devolve a ImagemUrl anterior (undefined se o produto não existia).
export async function apagar(sku) {
  const r = await query('DELETE FROM dbo.Produto OUTPUT deleted.ImagemUrl WHERE Sku=@sku', { sku });
  return r.length ? r[0].ImagemUrl : undefined;
}

// Grava a URL da imagem; devolve { ok, anterior } (anterior = foto trocada).
export async function definirImagem(sku, rel) {
  const r = await query(
    `UPDATE dbo.Produto SET ImagemUrl = @img, AtualizadoEm = SYSUTCDATETIME()
     OUTPUT deleted.ImagemUrl AS Anterior
     WHERE Sku = @sku`,
    { img: rel, sku }
  );
  return r.length ? { ok: true, anterior: r[0].Anterior } : { ok: false };
}

export async function removerImagem(sku) {
  const r = await query(
    `UPDATE dbo.Produto SET ImagemUrl = NULL, AtualizadoEm = SYSUTCDATETIME()
     OUTPUT deleted.ImagemUrl AS Anterior
     WHERE Sku = @sku`,
    { sku }
  );
  return r.length ? { ok: true, anterior: r[0].Anterior } : { ok: false };
}
