// Serviço de Produto: regras do catálogo (SKUs).
import * as repo from '../repositories/produto.repository.js';
import * as catRepo from '../repositories/categoria.repository.js';
import { PROD_URL_BASE } from '../middlewares/upload-produto.js';
import { apagarUpload } from '../routes/finder.routes.js';
import { erroValidacao, naoEncontrado } from '../lib/errors.js';
import { erroSku, erroTextoProduto } from '../validacao.js';

export function listar(categoria) {
  return repo.listar(categoria);
}

export async function obter(sku) {
  const row = await repo.buscarPorSku(sku);
  if (!row) throw naoEncontrado('Produto não encontrado.');
  return row;
}

export async function criar({ artigo, nome, cat, preco, estoque, previsao, descricao }) {
  if (!artigo || !nome || !(preco >= 0)) throw erroValidacao('Dados incompletos.');

  // SKU vira atributo HTML no front: só caracteres seguros. Limites = tamanho das colunas.
  const errSku = erroSku(artigo);
  if (errSku) throw erroValidacao(errSku);
  const errTxt = erroTextoProduto({ nome, descricao, previsao });
  if (errTxt) throw erroValidacao(errTxt);

  const catId = await catRepo.idPorCodigo(cat);
  if (catId == null) throw erroValidacao('Categoria inválida.');
  await repo.inserir({ sku: artigo, nome, catId, descricao, preco, estoque, previsao });
}

// Edita. Produto do Tiny: só categoria e previsão mudam aqui. Devolve { tiny }.
export async function atualizar(sku, { nome, cat, preco, estoque, previsao, descricao }) {
  const errTxt = erroTextoProduto({ nome, descricao, previsao });
  if (errTxt) throw erroValidacao(errTxt);

  const catId = await catRepo.idPorCodigo(cat);
  if (catId == null) throw erroValidacao('Categoria inválida.');

  const est = await repo.estado(sku);
  if (!est.existe) throw naoEncontrado('Produto não encontrado.');

  if (est.tinyAtivo) {
    await repo.atualizarCamposTiny({ sku, catId, previsao });
    return { tiny: true };
  }
  await repo.atualizarCompleto({ sku, nome, catId, descricao, preco, estoque, previsao });
  return { tiny: false };
}

export async function excluir(sku) {
  const imagem = await repo.apagar(sku);
  if (imagem) apagarUpload(imagem);   // sem 404: apagar o que não existe é no-op
}

// Troca a foto. Produto do Tiny ou inexistente: apaga o arquivo enviado e falha.
export async function definirImagem(sku, filename) {
  const rel = PROD_URL_BASE + filename;
  const est = await repo.estado(sku);
  if (est.existe && est.tinyAtivo) {
    apagarUpload(rel);
    throw erroValidacao('A foto deste produto é gerenciada pelo Tiny ERP.');
  }
  const r = await repo.definirImagem(sku, rel);
  if (!r.ok) {
    apagarUpload(rel);
    throw naoEncontrado('Produto não encontrado.');
  }
  apagarUpload(r.anterior);   // remove a foto trocada (tolera null)
  return rel;
}

export async function removerImagem(sku) {
  const est = await repo.estado(sku);
  if (est.existe && est.tinyAtivo) {
    throw erroValidacao('A foto deste produto é gerenciada pelo Tiny ERP.');
  }
  const r = await repo.removerImagem(sku);
  if (!r.ok) throw naoEncontrado('Produto não encontrado.');
  apagarUpload(r.anterior);
}
