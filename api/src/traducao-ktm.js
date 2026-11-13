// Nomes do catálogo KTM em português. A KTM só publica em inglês (testado com Accept-Language e culture).
// Peça cadastrada no Tiny usa o nome do Tiny (já em português, o que a equipe conhece); as demais passam
// por este dicionário. O original da KTM continua na tela para conferir com a prancha.
//
// A KTM escreve nas duas ordens: "CLUTCH COVER" e "COVER CLUTCH" (modelos feitos na Índia). Por isso, num
// bloco de substantivos, o principal é o de maior peso (tampa > embreagem) e os outros viram complemento:
// os dois casos dão "TAMPA DA EMBREAGEM". Adjetivos (lado, cor, completo) concordam com o principal e vão
// depois; medidas e códigos ficam no fim, na ordem original. Palavra desconhecida fica como está.
import { NOMES, ADJETIVOS, LIGACOES, PALAVRAS, GRUPOS } from './traducao-ktm-dicionario.js';

const limpar = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Chave de comparação: sem pontuação nas pontas ("CPL." = "CPL", "(BLACK)" = "BLACK").
const nu = (t) => t.replace(/^[("'[]+|[)"'\],.;:]+$/g, '');

const maior = (dic) => Math.max(1, ...Object.keys(dic).map(k => k.split(' ').length));
const MAX = Math.max(maior(NOMES), maior(ADJETIVOS), maior(LIGACOES), maior(PALAVRAS));
const tem = (dic, k) => Object.prototype.hasOwnProperty.call(dic, k);

// Nome: [texto, gênero 'm'|'f', peso 1–4, artigo]. 4 = fixação/vedação (parafuso, junta), sempre o principal;
// 3 = peça "de" algo (tampa, suporte); 2 = componente; 1 = sistema ou material (ar, óleo, freio). artigo=false → "de" em vez de "do/da" ("FILTRO DE AR").
function nome(v) {
  const [texto, genero = 'm', peso = 2, artigo = true] = Array.isArray(v) ? v : [v];
  return { texto, genero, peso, artigo };
}

// Quebra em itens: { tipo: 'nome'|'adj'|'lig'|'pal'|'outro', ... }, sempre a expressão mais longa primeiro.
function analisar(texto) {
  const ts = limpar(texto).toUpperCase().split(' ').filter(Boolean);
  const itens = [];
  for (let i = 0; i < ts.length;) {
    let achou = null;
    for (let n = Math.min(MAX, ts.length - i); n >= 1 && !achou; n--) {
      const k = ts.slice(i, i + n).map(nu).join(' ');
      if (!k) continue;
      if (tem(NOMES, k)) achou = { n, tipo: 'nome', v: nome(NOMES[k]) };
      else if (tem(ADJETIVOS, k)) achou = { n, tipo: 'adj', v: ADJETIVOS[k] };
      else if (tem(LIGACOES, k)) achou = { n, tipo: 'lig', v: LIGACOES[k] };
      else if (tem(PALAVRAS, k)) achou = { n, tipo: 'pal', v: PALAVRAS[k] };
    }
    if (achou) { itens.push(achou); i += achou.n; } else { itens.push({ n: 1, tipo: 'outro', v: ts[i] }); i++; }
  }
  return itens;
}

const contracao = (n) => (n.artigo ? (n.genero === 'f' ? 'DA' : 'DO') : 'DE');

// Bloco de substantivos → "PRINCIPAL DO COMPLEMENTO DO …". Empate de peso: o último (ordem do inglês).
function frase(nomes) {
  if (!nomes.length) return null;
  if (nomes.length === 1) return { texto: nomes[0].texto, genero: nomes[0].genero };
  const h = principalDe(nomes);
  const principal = nomes[h];
  const partes = [principal.texto];
  // o que vem depois do principal ("COVER CLUTCH") e depois o que vinha antes ("CLUTCH COVER")
  for (const resto of [nomes.slice(h + 1), nomes.slice(0, h)]) {
    const f = frase(resto);
    if (f) partes.push(contracao(resto[principalDe(resto)]), f.texto);
  }
  return { texto: partes.join(' '), genero: principal.genero };
}
// Maior peso; no empate, o último (inglês: "FORK PROTECTION RING" = anel). Se o primeiro já tem o maior
// peso, a ordem é a invertida ("BRACKET COVER SIDE" = suporte da tampa lateral) e vale o primeiro.
function principalDe(nomes) {
  const max = Math.max(...nomes.map(n => n.peso));
  if (nomes[0].peso === max) return 0;
  let h = 0;
  nomes.forEach((n, i) => { if (n.peso === max) h = i; });
  return h;
}
const flex = (adj, genero) => (typeof adj === 'string' ? adj : adj[genero === 'f' ? 1 : 0]);

// Trecho sem vírgula. "PARA"/"COM" separam: cada lado é traduzido por si.
function traduzirTrecho(texto) {
  const itens = analisar(texto);
  const blocos = [[]];
  const ligas = [];
  for (const it of itens) {
    if (it.tipo === 'lig') { ligas.push(it.v); blocos.push([]); } else blocos[blocos.length - 1].push(it);
  }
  return blocos.map((b, i) => {
    const nomes = b.filter(x => x.tipo === 'nome').map(x => x.v);
    const f = frase(nomes);
    const g = f ? f.genero : 'm';
    const adjs = b.filter(x => x.tipo === 'adj').map(x => flex(x.v, g));
    const resto = b.filter(x => x.tipo === 'pal' || x.tipo === 'outro').map(x => x.v);
    const t = [f && f.texto, ...adjs, ...resto].filter(Boolean).join(' ');
    return (i ? ligas[i - 1] + ' ' : '') + t;
  }).filter(Boolean).join(' ');
}

// Nome de peça da KTM em português (quando o Tiny não tem a peça). Vírgula separa partes: "SCREW, M8X20".
export function traduzirPeca(nomeKtm) {
  const orig = limpar(nomeKtm);
  if (!orig) return '';
  return orig.split(/(?<!\d),|,(?!\d)/).map(p => p.trim()).filter(Boolean).map(traduzirTrecho).filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
}

// Nome de grupo ("FRONT FORK, TRIPLE CLAMP"): tabela fixa; se não houver, cada parte pelo dicionário.
export function traduzirGrupo(nomeKtm) {
  const orig = limpar(nomeKtm).toUpperCase();
  if (!orig) return '';
  if (tem(GRUPOS, orig)) return GRUPOS[orig];
  return orig.split(/\s*,\s*/).map(p => (tem(GRUPOS, p) ? GRUPOS[p]
    : p.split(/\s+\/\s+/).map(q => (tem(GRUPOS, q) ? GRUPOS[q] : traduzirPeca(q))).join(' / '))).join(', ');
}

// Nome do Tiny para a peça, quando ela existe lá (uma opção, ou todas com o mesmo nome).
export function nomeDoTiny(nomes) {
  const l = [...new Set((nomes || []).map(limpar).filter(Boolean))];
  return l.length === 1 ? l[0] : null;
}
