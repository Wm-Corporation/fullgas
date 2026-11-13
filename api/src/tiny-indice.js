// Índice dos códigos do Tiny (todos os produtos ativos, não só os importados no portal).
// O catálogo de peças KTM usa para saber se uma peça existe no Tiny antes de importá-la.
// Montado listando o Tiny inteiro (~80 páginas de 100, na fila normal do tiny.js); vale 24 h e fica em disco.
// Enquanto não fica pronto, quem pergunta recebe null e o catálogo pesquisa a peça direto no Tiny.
import fs from 'node:fs';
import path from 'node:path';
import { listarProdutos } from './tiny.js';
import { PASTA } from './catalogo-ktm.js';

const ARQUIVO = path.join(PASTA, 'tiny-indice.json');
const VALIDADE_MS = 24 * 60 * 60 * 1000;
const MAX_PAGINAS = 400;

// "55430007000 I" → base "55430007000", classe "I". Sem sufixo, classe null.
export function separarClasse(sku) {
  const s = String(sku || '').trim().toUpperCase();
  const m = s.match(/^(.*\S)\s+(I|II|III|IV)$/);
  return m ? { base: m[1], classe: m[2] } : { base: s, classe: null };
}
const chave = (base) => String(base).toUpperCase().replace(/[^A-Z0-9]/g, '');

let indice = null;          // { geradoEm, porBase: Map(chave → [{ tinyId, sku, nome, preco, classe }]) }
let montando = null;        // Promise da montagem em andamento

function carregar(itens, geradoEm) {
  const porBase = new Map();
  for (const it of itens) {
    const { base, classe } = separarClasse(it.sku);
    const k = chave(base);
    if (!k) continue;
    if (!porBase.has(k)) porBase.set(k, []);
    porBase.get(k).push({ ...it, classe });
  }
  // Sem sufixo primeiro; depois I, II...
  for (const lista of porBase.values()) lista.sort((a, b) => (a.classe || '').localeCompare(b.classe || ''));
  indice = { geradoEm, porBase, total: itens.length };
  return indice;
}

function lerDoDisco() {
  try {
    const d = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    return carregar(d.itens || [], d.geradoEm);
  } catch { return null; }
}

// listar = (pagina) => { totalPaginas, produtos } — trocável nos testes.
export async function montar(listar = (p) => listarProdutos(p, '')) {
  const itens = [];
  let total = 1;
  for (let pagina = 1; pagina <= total && pagina <= MAX_PAGINAS; pagina++) {
    const r = await listar(pagina);
    total = r.totalPaginas || 0;
    for (const p of r.produtos) {
      if (p.situacao && p.situacao !== 'A') continue;
      if (p.sku) itens.push({ tinyId: p.tinyId, sku: p.sku, nome: p.nome, preco: p.preco });
    }
  }
  const geradoEm = new Date().toISOString();
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const tmp = ARQUIVO + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ geradoEm, itens }));
  fs.renameSync(tmp, ARQUIVO);
  return carregar(itens, geradoEm);
}

const vencido = (ix) => !ix || Date.now() - Date.parse(ix.geradoEm) > VALIDADE_MS;

// Começa a montar em segundo plano (uma montagem por vez). forcar = mesmo se ainda estiver valendo.
export function atualizar({ forcar = false, listar } = {}) {
  if (montando) return montando;
  if (!forcar && !vencido(indice || lerDoDisco())) return Promise.resolve(indice);
  montando = montar(listar)
    .catch(e => { console.warn('⚠ Índice de códigos do Tiny não montado:', e.message); return indice; })
    .finally(() => { montando = null; });
  return montando;
}

// Índice atual (mesmo vencido, enquanto o novo é montado) ou null. Nunca espera o Tiny.
export function atual() {
  if (!indice) lerDoDisco();
  if (vencido(indice)) atualizar();
  return indice;
}

export function situacao() {
  const ix = atual();
  return { pronto: !!ix, geradoEm: ix?.geradoEm || null, produtos: ix?.total || 0, montando: !!montando };
}

// Produtos do Tiny para um código da KTM. [] = não está no Tiny.
// Código sem classe traz todas as classes (o admin escolhe); com classe ("… II"), só aquela.
export function buscar(sku, ix = atual()) {
  if (!ix) return null;
  return filtrarClasse(sku, ix.porBase.get(chave(separarClasse(sku).base)) || []);
}
export function filtrarClasse(sku, lista) {
  const { classe } = separarClasse(sku);
  return classe ? lista.filter(t => t.classe === classe) : lista;
}
export const chaveBase = (sku) => chave(separarClasse(sku).base);

// Só para os testes.
export function _limpar() { indice = null; montando = null; try { fs.unlinkSync(ARQUIVO); } catch { /* não havia */ } }
