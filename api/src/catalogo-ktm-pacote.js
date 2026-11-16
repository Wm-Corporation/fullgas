// Pacote de um modelo para o cliente pôr no site dele: dados (JSON), foto, pranchas e uma página pronta.
// Montado sob pedido, pela mesma fila educada do catálogo (uma requisição por vez por marca), e guardado
// no disco por 30 dias. Baixar o catálogo inteiro de uma vez seria dezenas de milhares de acessos à KTM.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as catalogo from './catalogo-ktm.js';
import { traduzirGrupo, traduzirPeca } from './traducao-ktm.js';
import { montarZip } from './zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VISUALIZADOR = path.join(__dirname, 'catalogo-ktm-visualizador.html');
const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SIMULTANEOS = 4;

const trabalhos = new Map();   // "marca/id" → { estado: 'montando'|'erro', feitos, total, erro }
const chave = (marca, id) => marca + '/' + id;

export function arquivoPacote(marca, id) {
  return path.join(catalogo.PASTA, marca, 'pacotes', String(id).replace(/\D/g, '') + '.zip');
}

function pronto(marca, id) {
  try {
    const st = fs.statSync(arquivoPacote(marca, id));
    return Date.now() - st.mtimeMs < VALIDADE_MS ? st : null;
  } catch { return null; }
}

export function nomeDoArquivo(marca, m) {
  const base = catalogo.MARCAS[marca].nome + ' ' + m.nome + (m.ano && !String(m.nome).includes(String(m.ano)) ? ' ' + m.ano : '');
  return base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'modelo';
}

export function situacaoPacote(marca, id) {
  const t = trabalhos.get(chave(marca, id));
  if (t?.estado === 'montando') return { estado: 'montando', feitos: t.feitos, total: t.total };
  const st = pronto(marca, id);
  if (st) return { estado: 'pronto', tamanho: st.size, geradoEm: st.mtime.toISOString() };
  if (t?.estado === 'erro') return { estado: 'erro', erro: t.erro };
  return { estado: 'nenhum' };
}

// nomear(pecas) → mesmas peças com `nome` em português (o mesmo nome que o finder mostra).
export function iniciarPacote(marca, modelo, nomear) {
  const k = chave(marca, modelo.id);
  if (trabalhos.get(k)?.estado === 'montando' || pronto(marca, modelo.id)) return situacaoPacote(marca, modelo.id);
  const ativos = [...trabalhos.values()].filter(t => t.estado === 'montando').length;
  if (ativos >= MAX_SIMULTANEOS) {
    throw new catalogo.ErroCatalogo('Há outros pacotes sendo montados agora. Tente de novo em alguns minutos.', 429);
  }
  const t = { estado: 'montando', feitos: 0, total: 0, erro: null };
  trabalhos.set(k, t);
  montar(marca, modelo, nomear, t).then(
    () => trabalhos.delete(k),
    (e) => {
      t.estado = 'erro';
      t.erro = e instanceof catalogo.ErroCatalogo ? e.message : 'Falha ao montar o pacote.';
      if (!(e instanceof catalogo.ErroCatalogo)) console.error('[catalogo-ktm] pacote', marca, modelo.id, e);
    });
  return situacaoPacote(marca, modelo.id);
}

async function montar(marca, m, nomear, t) {
  const listas = {};
  for (const lado of catalogo.LADOS) listas[lado] = (await catalogo.grupos(marca, m.id, lado)).grupos;
  t.total = catalogo.LADOS.reduce((s, l) => s + listas[l].length, 0);

  const imagens = new Map();   // caminho no zip → arquivo no disco
  const lados = {};
  for (const lado of catalogo.LADOS) {
    lados[lado] = [];
    for (const g of listas[lado]) {
      const d = await catalogo.grupo(marca, g.id, m.id, lado);
      let prancha = null;
      if (d.mapa) {
        try {
          imagens.set('pranchas/' + d.mapa, await catalogo.mapa(marca, d.mapa));
          prancha = 'pranchas/' + d.mapa;
        } catch (e) { if (!(e instanceof catalogo.ErroCatalogo)) throw e; }
      }
      const pecas = await nomear(d.pecas.map(p => ({ ...p, pedivel: catalogo.pedivel(p.sku) })));
      lados[lado].push({
        numero: g.numero,
        nome: traduzirGrupo(g.nome),
        nomeOriginal: g.nome,
        prancha,
        largura: d.largura || 0,
        altura: d.altura || 0,
        pontos: catalogo.corrigirPontos(d.pontos).map(p => ({ codigo: p.sku, x: p.x, y: p.y, w: p.w, h: p.h })),
        pecas: pecas.map(p => ({
          seq: p.seq,
          codigo: p.sku,
          nome: p.nome,
          nomeOriginal: p.nomeKtm,
          quantidade: p.quantidade,
          opcional: !(p.quantidade > 0),
          avulsa: p.pedivel,
          adicional: p.adicional ? traduzirPeca(p.adicional) : '',
          adicionalOriginal: p.adicional || '',
          nova: !!p.novo
        }))
      });
      t.feitos++;
    }
  }

  let foto = null;
  try { imagens.set('foto.png', await catalogo.fotoModelo(marca, m.id)); foto = 'foto.png'; }
  catch (e) { if (!(e instanceof catalogo.ErroCatalogo)) throw e; }

  const nomeMarca = catalogo.MARCAS[marca].nome;
  const dados = {
    marca: nomeMarca,
    modelo: { nome: m.nome, ano: m.ano, mercado: m.mercado, codigo: m.codigo, caminho: m.caminho.slice(1) },
    foto,
    fonte: `Catálogo oficial de peças ${nomeMarca}, distribuído pela Fullgas`,
    geradoEm: new Date().toISOString(),
    lados
  };
  const pasta = nomeDoArquivo(marca, m) + '/';
  const json = JSON.stringify(dados, null, 1);
  const arquivos = [
    { nome: pasta + 'LEIA-ME.txt', dados: leiaMe(nomeMarca, m) },
    { nome: pasta + 'index.html', dados: fs.readFileSync(VISUALIZADOR) },
    { nome: pasta + 'dados.json', dados: json },
    { nome: pasta + 'dados.js', dados: 'window.CATALOGO_FULLGAS = ' + json + ';\n' },
    ...[...imagens].map(([nome, abs]) => ({ nome: pasta + nome, dados: fs.readFileSync(abs) }))
  ];

  const destino = arquivoPacote(marca, m.id);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = destino + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, montarZip(arquivos));
  fs.renameSync(tmp, destino);
}

function leiaMe(nomeMarca, m) {
  return [
    `Catálogo de peças ${nomeMarca} ${m.nome} — pacote Fullgas`,
    '',
    'COMO USAR NO SEU SITE',
    '- Envie esta pasta inteira para o servidor do seu site e crie um link para o index.html.',
    '- Ou abra o index.html direto no computador: funciona sem internet.',
    '- Para mostrar dentro de uma página que já existe, use um iframe apontando para o index.html.',
    '',
    'O QUE TEM AQUI',
    '- index.html: página pronta, com os grupos, os desenhos (pranchas) e a lista de peças.',
    '- dados.json: os mesmos dados para quem quiser montar a própria página.',
    '  lados.chassi / lados.engine (motor) → grupos → pecas e pontos da prancha.',
    '  Cada ponto (x, y, w, h) está em pixels da prancha original (largura x altura do grupo).',
    '  opcional = peça fora da montagem original (calço, mola alternativa, kit de reparo, acessório).',
    '  avulsa = false: a peça só vem dentro de um conjunto.',
    '- dados.js: igual ao dados.json, no formato que o index.html lê sem servidor.',
    '- foto.png e pranchas/: as imagens.',
    '',
    'Gerado pela Fullgas a partir do catálogo oficial do fabricante. Os códigos são os originais.',
    ''
  ].join('\r\n');
}
