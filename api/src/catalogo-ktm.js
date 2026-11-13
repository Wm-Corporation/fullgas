// Catálogo de peças do grupo KTM (KTM, Husqvarna, GASGAS), lido do SparePartsFinder oficial de cada marca.
// Nada é copiado em massa: a árvore de modelos vem numa leitura só; grupos, peças e pranchas são buscados
// quando alguém abre e ficam no disco (uploads/catalogo-ktm, fora das pastas públicas).
// Uma requisição por vez por site, com intervalo, para não pesar no servidor deles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { erroSku } from './validacao.js';

export const MARCAS = {
  ktm: { nome: 'KTM', host: 'https://sparepartsfinder.ktm.com' },
  husqvarna: { nome: 'Husqvarna', host: 'https://sparepartsfinder.husqvarna-motorcycles.com' },
  gasgas: { nome: 'GASGAS', host: 'https://sparepartsfinder.gasgas.com' }
};
export const LADOS = ['chassi', 'engine'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PASTA = path.join(__dirname, '..', 'uploads', 'catalogo-ktm');

const DIA = 24 * 60 * 60 * 1000;
const VALIDADE = { arvore: 7 * DIA, grupos: 30 * DIA, grupo: 30 * DIA };
const INTERVALO_MS = 400;
const TEMPO_LIMITE_MS = 30000;
const AGENTE = 'Mozilla/5.0 (compatible; FullgasB2B-Catalogo/1.0)';

// Ponto clicável da KTM: 22 px no total (padding 10 + borda 1), ancorado pelo canto inferior esquerdo.
// Medido na página da própria KTM em 13/11/2026; com 28 o círculo ficava 6 px acima do número desenhado.
const PONTO = 22;
const PONTO_ANTIGO = 28;

// Grupos guardados antes da correção (cache de 30 dias): o mesmo canto inferior, com o tamanho certo.
export function corrigirPontos(pontos) {
  return (pontos || []).map(p => (p.w === PONTO_ANTIGO
    ? { ...p, y: p.y + PONTO_ANTIGO - PONTO, w: PONTO, h: PONTO }
    : p));
}

export class ErroCatalogo extends Error {
  constructor(msg, status = 502) { super(msg); this.status = status; }
}

export function marcaValida(marca) {
  return Object.prototype.hasOwnProperty.call(MARCAS, marca);
}

// ---------------------------------------------------------------------------
// Leitura do HTML (funções puras, testadas em tests/catalogo-ktm.test.js)
// ---------------------------------------------------------------------------

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
export function semEntidades(s) {
  return String(s || '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENTIDADES[e]);
}
const espacos = (s) => semEntidades(s).replace(/[\s ]+/g, ' ').trim();

// "450 SX-F FACTORY EDITION   2025 <2025><US><F8475Y1>" → { ano: 2025, mercado: 'US', codigo: 'F8475Y1' }
export function etiquetasDaFolha(texto) {
  const tags = [...String(texto).matchAll(/<([^<>]+)>/g)].map(m => m[1].trim());
  const ano = tags.find(t => /^\d{4}$/.test(t));
  const resto = tags.filter(t => t !== ano);
  const codigo = resto.length ? resto[resto.length - 1] : null;
  const mercado = resto.length > 1 ? resto[0] : null;
  return { ano: ano ? Number(ano) : null, mercado, codigo };
}

// A página inicial traz a árvore inteira em `var treeSettings = {...}`. Devolve só as folhas (as motos).
export function lerArvore(html) {
  const marcador = 'var treeSettings = ';
  const i = html.indexOf(marcador);
  if (i < 0) throw new ErroCatalogo('A página da KTM mudou: árvore de modelos não encontrada.');
  let arvore;
  try { arvore = new JSONParcial(html, i + marcador.length).ler(); }
  catch { throw new ErroCatalogo('A página da KTM mudou: árvore de modelos ilegível.'); }

  const modelos = [];
  const andar = (no, caminho) => {
    const texto = espacos(no.text);
    const filhos = no.children || [];
    if (!filhos.length) {
      if (no.state?.disabled) return;        // ano anunciado sem catálogo ainda
      const { ano, mercado, codigo } = etiquetasDaFolha(no.text);
      modelos.push({
        id: String(no.id),
        nome: caminho[caminho.length - 1] || texto.replace(/<.*$/, '').trim(),
        caminho: caminho.slice(0, -1),
        ano, mercado, codigo
      });
      return;
    }
    for (const f of filhos) andar(f, [...caminho, texto]);
  };
  for (const raiz of arvore.TreeElements || []) andar(raiz, []);
  return modelos;
}

// JSON.parse não aceita lixo depois do objeto; acha o fim contando chaves fora de strings.
class JSONParcial {
  constructor(texto, inicio) { this.t = texto; this.i = inicio; }
  ler() {
    const t = this.t;
    let prof = 0, emStr = false, esc = false;
    for (let k = this.i; k < t.length; k++) {
      const c = t[k];
      if (emStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') emStr = false;
      } else if (c === '"') emStr = true;
      else if (c === '{') prof++;
      else if (c === '}' && --prof === 0) return JSON.parse(t.slice(this.i, k + 1));
    }
    throw new Error('JSON sem fim');
  }
}

// Tela de resultado de um modelo: tabela com número, nome, link do grupo e prancha.
export function lerGrupos(html) {
  const grupos = [];
  const linha = /<tr[^>]*>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>[\s\S]*?ComponentGroupTemplate\/Index\/(\d+)\?[\s\S]*?<\/td>\s*<td[^>]*>\s*(?:<img[^>]*src="\/Images\/maps\/([^"]+)")?/g;
  const vistos = new Set();
  for (const m of html.matchAll(linha)) {
    const id = Number(m[3]);
    if (vistos.has(id)) continue;
    vistos.add(id);
    grupos.push({ id, numero: espacos(m[1]), nome: espacos(m[2]), mapa: m[4] ? arquivoMapa(m[4]) : null });
  }
  return grupos;
}

// Foto da moto ("Show Image"): fica num armazenamento Azure da KTM, fora do site do finder.
export function lerFotoModelo(html) {
  const i = html.indexOf('id="ResultsVehicleModelModal"');
  if (i < 0) return null;
  const m = html.slice(i, i + 2000).match(/<img[^>]*src="([^"]+)"/);
  return m && origemFotoPermitida(semEntidades(m[1])) ? semEntidades(m[1]) : null;
}

// Só baixamos foto de onde a KTM guarda as dela (nada de URL arbitrária vinda da página).
export function origemFotoPermitida(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' &&
      (/\.web\.core\.windows\.net$/i.test(u.hostname) || Object.values(MARCAS).some(m => m.host === u.origin));
  } catch { return false; }
}

// Busca por VIN cai na mesma tela de resultado; o modelo vem nos links "ExecuteSearch".
export function modeloDoResultado(html) {
  const m = html.match(/ExecuteSearch\?modelIdentification=(\d+)/);
  return m ? m[1] : null;
}

// Página de um grupo: prancha (com tamanho) e os pontos de cada peça.
export function lerPaginaGrupo(html) {
  const caixa = html.match(/id="componentGroupTemplateImage" style="width:\s*(\d+)px;\s*height:\s*(\d+)px;\s*background:\s*Url\(\/Images\/maps\/([^)]+)\)/i);
  if (!caixa) return { mapa: null, largura: 0, altura: 0, pontos: [] };
  const largura = Number(caixa[1]), altura = Number(caixa[2]);
  const pontos = [];
  const re = /data-article-number="([^"$]+)" class="point" style="bottom:\s*(-?\d+)px;\s*left:\s*(-?\d+)px;?"/g;
  for (const m of html.matchAll(re)) {
    pontos.push({ sku: semEntidades(m[1]).trim(), x: Number(m[3]), y: altura - Number(m[2]) - PONTO, w: PONTO, h: PONTO });
  }
  return { mapa: arquivoMapa(caixa[3]), largura, altura, pontos };
}

// Lista JSON de peças do grupo (endpoint do grid da própria página).
export function lerPecas(json) {
  const linhas = Array.isArray(json?.Data) ? json.Data : [];
  return linhas.map(a => {
    const sku = String(a.ArticleNumber || '').trim();
    return {
      seq: Number(a.SequenceNumber) || null,
      sku,
      nome: espacos(a.ArticleDescription),
      quantidade: Number(a.Quantidade ?? a.Quantity) || 0,
      adicional: espacos(a.ArticleAdditionalText),
      novo: !!a.IsNew,
      pedivel: pedivel(sku)
    };
  });
}

// Peça que se pede avulsa. "SPNO" = só vem dentro de um conjunto. Kit de pistão traz a classe no código
// ("55430007000 I"), igual ao Tiny — por isso a regra é a mesma do SKU do portal.
export function pedivel(sku) {
  return !!sku && sku !== 'SPNO' && !erroSku(sku);
}

// Nome de arquivo de prancha: só o que a KTM usa (evita caminho estranho no disco).
export function arquivoMapa(nome) {
  const s = String(nome || '').trim();
  return /^[A-Za-z0-9_-]{1,80}\.(png|gif|jpe?g)$/i.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Acesso ao site (fila por marca + cookies da sessão ASP.NET)
// ---------------------------------------------------------------------------

const filas = new Map();       // marca → promessa da última requisição
const cookies = new Map();     // marca → Map(nome → valor)

function enfileirar(marca, tarefa) {
  const anterior = filas.get(marca) || Promise.resolve();
  const vez = anterior.catch(() => {}).then(async () => {
    try { return await tarefa(); }
    finally { await new Promise(r => setTimeout(r, INTERVALO_MS)); }
  });
  filas.set(marca, vez);
  return vez;
}

function guardarCookies(marca, res) {
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (!lista.length) return;
  const jar = cookies.get(marca) || new Map();
  for (const c of lista) {
    const [par] = c.split(';');
    const i = par.indexOf('=');
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
  cookies.set(marca, jar);
}

function cabecalhoCookies(marca) {
  const jar = cookies.get(marca);
  return jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : null;
}

// fetchImpl é trocável nos testes.
let fetchImpl = (...a) => fetch(...a);
export function _trocarFetch(f) { fetchImpl = f; }

// absoluto = URL completa fora do finder (foto da moto): vai sem os cookies da sessão.
async function pedir(marca, caminho, { metodo = 'GET', corpo = null, tipo = 'texto', ajax = false, absoluto = false } = {}) {
  return enfileirar(marca, async () => {
    const headers = { 'User-Agent': AGENTE, 'Accept-Language': 'en' };
    const ck = absoluto ? null : cabecalhoCookies(marca);
    if (ck) headers.Cookie = ck;
    if (ajax) headers['X-Requested-With'] = 'XMLHttpRequest';
    if (corpo) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    let res;
    try {
      res = await fetchImpl(absoluto ? caminho : MARCAS[marca].host + caminho, {
        method: metodo, headers, body: corpo, redirect: 'follow', signal: AbortSignal.timeout(TEMPO_LIMITE_MS)
      });
    } catch (e) {
      throw new ErroCatalogo(`O catálogo da ${MARCAS[marca].nome} não respondeu (${e.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de rede'}).`, 504);
    }
    if (!absoluto) guardarCookies(marca, res);
    if (!res.ok) throw new ErroCatalogo(`O catálogo da ${MARCAS[marca].nome} respondeu ${res.status}.`, res.status === 404 ? 404 : 502);
    if (tipo === 'json') return res.json();
    if (tipo === 'binario') return Buffer.from(await res.arrayBuffer());
    return res.text();
  });
}

// ---------------------------------------------------------------------------
// Cache em disco
// ---------------------------------------------------------------------------

function arquivoCache(...partes) {
  return path.join(PASTA, ...partes.map(p => String(p).replace(/[^A-Za-z0-9_.-]/g, '_')));
}

function lerCache(arquivo, validade) {
  try {
    const st = fs.statSync(arquivo);
    if (Date.now() - st.mtimeMs > validade) return null;
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch { return null; }
}

function gravarCache(arquivo, dados) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = arquivo + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dados));
  fs.renameSync(tmp, arquivo);
}

// Mesma chave pedida duas vezes ao mesmo tempo = uma leitura só.
const emAndamento = new Map();
async function comCache(arquivo, validade, fresco, buscar) {
  if (!fresco) {
    const c = lerCache(arquivo, validade);
    if (c) return c;
  }
  if (emAndamento.has(arquivo)) return emAndamento.get(arquivo);
  const p = (async () => {
    try {
      const dados = await buscar();
      gravarCache(arquivo, dados);
      return dados;
    } catch (e) {
      // Site fora: serve a cópia vencida, se houver.
      const velho = lerCache(arquivo, Infinity);
      if (velho) return velho;
      throw e;
    } finally { emAndamento.delete(arquivo); }
  })();
  emAndamento.set(arquivo, p);
  return p;
}

// ---------------------------------------------------------------------------
// Operações usadas pelas rotas
// ---------------------------------------------------------------------------

// Árvore inteira da KTM (todos os mercados). O catálogo usa só modelosEU(); esta serve para o VIN.
export function todosModelos(marca, { fresco = false } = {}) {
  return comCache(arquivoCache(marca, 'modelos.json'), VALIDADE.arvore, fresco, async () =>
    lerArvore(await pedir(marca, '/')));
}

// Pedido de 13/11/2026: só a versão europeia de cada modelo e ano. "EU, US" e "EU/GB" contam como EU.
// Modelo e ano sem versão EU mas com uma versão sem mercado (motocross: MC, SX, TC… é a mesma no mundo
// todo) fica com essa; com só outros mercados (US, BR, CN…) sai do catálogo.
export const ehEU = (mercado) => String(mercado || '').split(/[\s,/]+/).includes('EU');
export function soEU(lista) {
  const porNome = new Map();
  for (const m of lista) {
    if (!porNome.has(m.nome)) porNome.set(m.nome, []);
    porNome.get(m.nome).push(m);
  }
  const fica = new Set();
  for (const l of porNome.values()) {
    const eu = l.filter(m => ehEU(m.mercado));
    for (const m of (eu.length ? eu : l.filter(x => !x.mercado))) fica.add(m);
  }
  return lista.filter(m => fica.has(m));
}

export async function modelos(marca, opcoes) {
  return soEU(await todosModelos(marca, opcoes));
}

export async function modelo(marca, id) {
  const lista = await modelos(marca);
  return lista.find(m => m.id === String(id)) || null;
}

// Chassi de uma moto de outro mercado (ex.: BR) → a versão do catálogo com o mesmo nome e ano.
export async function modeloDoVin(marca, id) {
  const achado = (await todosModelos(marca)).find(m => m.id === String(id));
  if (!achado) return null;
  return (await modelos(marca)).find(m => m.id === achado.id) ||
    (await modelos(marca)).find(m => m.nome === achado.nome) || null;
}

const isEngine = (lado) => (lado === 'engine' ? 'True' : 'False');

// { foto, grupos }: a foto da moto vem na mesma página da lista de grupos.
export function grupos(marca, modeloId, lado, { fresco = false } = {}) {
  return comCache(arquivoCache(marca, 'grupos', `${modeloId}-${lado}.json`), VALIDADE.grupos, fresco, async () => {
    const html = await pedir(marca, `/Result/ExecuteSearch?modelIdentification=${encodeURIComponent(modeloId)}&isEngine=${isEngine(lado)}`);
    return { foto: lerFotoModelo(html), grupos: lerGrupos(html) };
  });
}

export function grupo(marca, grupoId, modeloId, lado, { fresco = false } = {}) {
  return comCache(arquivoCache(marca, 'pecas', `${grupoId}-${modeloId}.json`), VALIDADE.grupo, fresco, async () => {
    const qs = `modelidentifier=${encodeURIComponent(modeloId)}&isEngine=${isEngine(lado)}`;
    const pagina = lerPaginaGrupo(await pedir(marca, `/ComponentGroupTemplate/Index/${grupoId}?${qs}`));
    const json = await pedir(marca,
      `/ComponentGroupTemplate/ComponentGroupTemplateArticles_Read/${grupoId}?partType=Parts&idModel=${encodeURIComponent(modeloId)}`,
      { metodo: 'POST', corpo: 'sort=SequenceNumber-asc&page=1&pageSize=1000&group=&filter=', tipo: 'json', ajax: true });
    return { ...pagina, pecas: lerPecas(json) };
  });
}

// VIN → id do modelo na árvore (null se a KTM não reconhecer).
export async function buscarVin(marca, vin) {
  const corpo = new URLSearchParams({
    ModelIdentification: '', 'ModelIdentification.treeSearch': '',
    VehicleIdentificationNumber: vin, VehicleMotorNumber: '', IsEngine: 'false'
  }).toString();
  return modeloDoResultado(await pedir(marca, '/Result', { metodo: 'POST', corpo }));
}

// Imagem no disco; baixa uma vez (pedidos simultâneos esperam o mesmo download). Devolve o caminho absoluto.
function imagemEmDisco(destino, baixar) {
  if (fs.existsSync(destino)) return Promise.resolve(destino);
  if (!emAndamento.has(destino)) {
    emAndamento.set(destino, (async () => {
      try {
        const buf = await baixar();
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        const tmp = destino + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, destino);
        return destino;
      } finally { emAndamento.delete(destino); }
    })());
  }
  return emAndamento.get(destino);
}

// Prancha (desenho explodido do grupo).
export function mapa(marca, arquivo) {
  const nome = arquivoMapa(arquivo);
  if (!nome) return Promise.reject(new ErroCatalogo('Prancha inválida.', 400));
  return imagemEmDisco(arquivoCache(marca, 'mapas', nome),
    () => pedir(marca, `/Images/maps/${nome}`, { tipo: 'binario' }));
}

// Foto da moto. A URL vem do cache da lista de grupos (lado chassi ou motor, o que já existir).
export async function fotoModelo(marca, modeloId) {
  const destino = arquivoCache(marca, 'fotos', `${modeloId}.png`);
  if (fs.existsSync(destino)) return destino;
  const lista = lerCache(arquivoCache(marca, 'grupos', `${modeloId}-chassi.json`), Infinity) ||
    lerCache(arquivoCache(marca, 'grupos', `${modeloId}-engine.json`), Infinity) ||
    await grupos(marca, modeloId, 'chassi');
  const semFoto = new ErroCatalogo('Este modelo não tem foto no catálogo.', 404);
  // Muitas motos apontam para uma foto que não existe (a KTM mostra uma genérica); lembra disso por 7 dias.
  const marcaSemFoto = destino + '.sem';
  if (lerCache(marcaSemFoto, VALIDADE.arvore)) throw semFoto;
  if (!lista?.foto || !origemFotoPermitida(lista.foto)) throw semFoto;
  try {
    return await imagemEmDisco(destino, () => pedir(marca, lista.foto, { tipo: 'binario', absoluto: true }));
  } catch (e) {
    if (e instanceof ErroCatalogo && e.status === 404) { gravarCache(marcaSemFoto, true); throw semFoto; }
    throw e;
  }
}
