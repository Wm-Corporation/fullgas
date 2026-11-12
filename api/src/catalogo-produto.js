// Peças criadas pelo catálogo KTM (ainda fora do Tiny) ficam numa categoria própria.
// Enquanto o catálogo está em teste, só administradores as veem e compram.
// Quando a peça é cadastrada no Tiny e importada, o vínculo é pelo SKU e ela vira um produto normal
// (o admin troca a categoria no Catálogo).
import { query } from './db.js';

export const CATEGORIA_CATALOGO = 'catalogo-ktm';
const NOME_CATEGORIA = 'Catálogo KTM (fora do Tiny)';

export const ehAdmin = (user) => user?.papel === 'admin';

// CategoriaId da categoria do catálogo; cria na primeira vez.
export async function categoriaDoCatalogo() {
  const r = await query(
    `IF NOT EXISTS (SELECT 1 FROM dbo.Categoria WHERE Codigo = @cod)
       INSERT INTO dbo.Categoria (Codigo, Nome, Ordem, Ativo)
       SELECT @cod, @nome, ISNULL(MAX(Ordem), 0) + 1, 1 FROM dbo.Categoria;
     SELECT CategoriaId FROM dbo.Categoria WHERE Codigo = @cod;`,
    { cod: CATEGORIA_CATALOGO, nome: NOME_CATEGORIA }
  );
  return r[0].CategoriaId;
}

// SKUs (da lista) que são peças do catálogo fora do Tiny.
export async function skusDoCatalogo(skus) {
  if (!skus.length) return new Set();
  const params = { cod: CATEGORIA_CATALOGO };
  const marks = skus.map((s, i) => { params['s' + i] = s; return '@s' + i; });
  const rows = await query(
    `SELECT p.Sku FROM dbo.Produto p JOIN dbo.Categoria c ON c.CategoriaId = p.CategoriaId
      WHERE c.Codigo = @cod AND p.Sku IN (${marks.join(',')})`, params);
  return new Set(rows.map(r => r.Sku.toUpperCase()));
}
