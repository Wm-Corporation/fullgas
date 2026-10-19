// Repositório de Categoria: único lugar com SQL de categoria.
import { query } from '../db.js';

// Lista plana com o Codigo do pai (pai=null → categoria de topo).
export function listar() {
  return query(
    `SELECT c.Codigo AS id, c.Nome AS nome, c.Icone AS icone, c.Imagem AS imagem, p.Codigo AS pai
       FROM dbo.Categoria c
       LEFT JOIN dbo.Categoria p ON p.CategoriaId = c.ParentId
      WHERE c.Ativo = 1
      ORDER BY c.Ordem, c.Nome`
  );
}

// Categoria ativa por Codigo, com o ParentId (para validar a regra de 2 níveis).
export async function buscarPorCodigo(codigo) {
  const r = await query(
    'SELECT CategoriaId, ParentId FROM dbo.Categoria WHERE Codigo = @cod AND Ativo = 1',
    { cod: codigo }
  );
  return r[0] || null;
}

// CategoriaId por Codigo (inclui inativas). null se não existir.
export async function idPorCodigo(codigo) {
  const r = await query('SELECT CategoriaId FROM dbo.Categoria WHERE Codigo = @cod', { cod: codigo });
  return r.length ? r[0].CategoriaId : null;
}

export async function codigoExiste(codigo) {
  const r = await query('SELECT 1 FROM dbo.Categoria WHERE Codigo = @c', { c: codigo });
  return r.length > 0;
}

export async function proximaOrdem() {
  const r = await query('SELECT ISNULL(MAX(Ordem), 0) + 1 AS Ordem FROM dbo.Categoria');
  return r[0].Ordem;
}

export function inserir({ codigo, nome, icone, ordem, parentId }) {
  return query(
    `INSERT INTO dbo.Categoria (Codigo, Nome, Icone, Ordem, Ativo, ParentId)
     VALUES (@cod, @nome, @icone, @ord, 1, @pid)`,
    { cod: codigo, nome, icone, ord: ordem, pid: parentId }
  );
}

// Renomeia; devolve true se alguma linha foi afetada.
export async function renomear(codigo, nome) {
  const r = await query(
    'UPDATE dbo.Categoria SET Nome = @nome OUTPUT deleted.Codigo WHERE Codigo = @cod',
    { nome, cod: codigo }
  );
  return r.length > 0;
}

export async function contarProdutos(categoriaId) {
  const r = await query('SELECT COUNT(*) AS n FROM dbo.Produto WHERE CategoriaId = @id', { id: categoriaId });
  return r[0].n;
}

export async function contarFilhas(categoriaId) {
  const r = await query('SELECT COUNT(*) AS n FROM dbo.Categoria WHERE ParentId = @id', { id: categoriaId });
  return r[0].n;
}

export function apagar(categoriaId) {
  return query('DELETE FROM dbo.Categoria WHERE CategoriaId = @id', { id: categoriaId });
}

// Grava a URL da foto. Devolve a foto anterior, ou { ok:false } se a categoria não existe.
export async function definirImagem(codigo, rel) {
  const r = await query(
    `UPDATE dbo.Categoria SET Imagem = @img
       OUTPUT deleted.Imagem AS Anterior
      WHERE Codigo = @cod`,
    { img: rel, cod: codigo }
  );
  return r.length ? { ok: true, anterior: r[0].Anterior } : { ok: false };
}

export async function removerImagem(codigo) {
  const r = await query(
    `UPDATE dbo.Categoria SET Imagem = NULL
       OUTPUT deleted.Imagem AS Anterior
      WHERE Codigo = @cod`,
    { cod: codigo }
  );
  return r.length ? { ok: true, anterior: r[0].Anterior } : { ok: false };
}
