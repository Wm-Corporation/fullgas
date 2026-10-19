// Serviço de Categoria: regras do catálogo (lança AppError).
import * as repo from '../repositories/categoria.repository.js';
import { CAT_URL_BASE } from '../middlewares/upload-categoria.js';
import { apagarUpload } from '../routes/finder.routes.js';
import { erroValidacao, naoEncontrado, conflito } from '../lib/errors.js';

// Slug (Codigo) a partir do nome: minúsculo, sem acento, só a-z0-9 e hífen.
function slug(nome) {
  const base = String(nome || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38);
  return base || 'cat';
}

export async function listar() {
  const rows = await repo.listar();
  return rows.map(r => ({
    id: r.id, nome: r.nome, icone: r.icone || null,
    imagem: r.imagem || null, pai: r.pai || null
  }));
}

// Cria categoria ou subcategoria (máx. 2 níveis). Devolve o Codigo gerado.
export async function criar({ nome, icone, pai }) {
  const nomeLimpo = String(nome || '').trim();
  const iconeLimpo = String(icone || '').trim() || null;
  const paiCodigo = String(pai || '').trim();
  if (!nomeLimpo) throw erroValidacao('Informe o nome da categoria.');

  let parentId = null;
  if (paiCodigo) {
    const paiCat = await repo.buscarPorCodigo(paiCodigo);
    if (!paiCat) throw erroValidacao('Categoria pai inválida.');
    if (paiCat.ParentId) throw erroValidacao('Uma subcategoria não pode ter subcategorias (máx. 2 níveis).');
    parentId = paiCat.CategoriaId;
  }

  // Garante um Codigo (slug) único.
  const base = slug(nomeLimpo);
  let codigo = base, i = 2;
  while (await repo.codigoExiste(codigo)) {
    codigo = base.slice(0, 36) + '-' + i++;
  }

  const ordem = await repo.proximaOrdem();
  await repo.inserir({ codigo, nome: nomeLimpo, icone: iconeLimpo, ordem, parentId });
  return codigo;
}

export async function renomear(codigo, nome) {
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) throw erroValidacao('Informe o nome da categoria.');
  const ok = await repo.renomear(codigo, nomeLimpo);
  if (!ok) throw naoEncontrado('Categoria não encontrada.');
}

// Só exclui se a categoria estiver vazia (sem produtos e sem subcategorias).
export async function excluir(codigo) {
  const id = await repo.idPorCodigo(codigo);
  if (id == null) throw naoEncontrado('Categoria não encontrada.');

  const nProdutos = await repo.contarProdutos(id);
  if (nProdutos > 0) throw conflito('Há ' + nProdutos + ' produto(s) nesta categoria. Mova-os antes de excluir.');

  const nFilhas = await repo.contarFilhas(id);
  if (nFilhas > 0) throw conflito('Esta categoria tem subcategorias. Exclua-as primeiro.');

  await repo.apagar(id);
}

// Troca a foto. Categoria inexistente: apaga o arquivo enviado e falha.
export async function definirImagem(codigo, filename) {
  const rel = CAT_URL_BASE + filename;
  const r = await repo.definirImagem(codigo, rel);
  if (!r.ok) {
    apagarUpload(rel);
    throw naoEncontrado('Categoria não encontrada.');
  }
  apagarUpload(r.anterior);   // remove a foto trocada (tolera null)
  return rel;
}

export async function removerImagem(codigo) {
  const r = await repo.removerImagem(codigo);
  if (!r.ok) throw naoEncontrado('Categoria não encontrada.');
  apagarUpload(r.anterior);
}
