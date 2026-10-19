// Miniaturas (320 px, WebP) das fotos de produto e de modelo de moto, com cache longo.
// O nome é o hash da URL de origem. Roda em segundo plano e nunca derruba nada.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { query } from './db.js';

// Só JPEG, PNG e WebP são lidos; os outros decodificadores ficam desligados (segurança).
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({ operation: ['VipsForeignLoadJpeg', 'VipsForeignLoadPng', 'VipsForeignLoadWebp'] });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, '..', 'uploads');
// Pasta configurável para os testes (a limpeza de órfãs apaga o que não está no catálogo).
export const PASTA_MINIATURAS = process.env.FULLGAS_MINIATURAS_DIR || path.join(UPLOADS, 'miniaturas');
const URL_BASE = '/uploads/miniaturas/';
fs.mkdirSync(PASTA_MINIATURAS, { recursive: true });

const LADO_MAX = 320;
const LIMITE_ORIGEM = 15 * 1024 * 1024;   // foto de origem maior que isto é ignorada
const TEMPO_MAX_MS = 20000;

// Origens permitidas (evita SSRF).
const ORIGENS_OK = [
  (u) => u.protocol === 'https:' && u.hostname === 'anexos.tiny.com.br',
  (u) => u.protocol === 'https:' && u.hostname === 's3.amazonaws.com' && u.pathname.startsWith('/tiny-anexos-us/')
];

// Arquivos que já existem no disco (evita um stat por produto a cada GET).
const prontas = new Set(fs.readdirSync(PASTA_MINIATURAS).filter(f => f.endsWith('.webp')));

function nomeDe(origem) {
  return crypto.createHash('sha256').update(origem).digest('hex').slice(0, 32) + '.webp';
}

// URL da miniatura, ou null se ainda não existe (o front usa a original).
export function miniaturaDe(origem) {
  if (!origem) return null;
  const nome = nomeDe(origem);
  return prontas.has(nome) ? URL_BASE + nome : null;
}

// Lê a foto de origem: upload local ou origem permitida.
async function lerOrigem(origem) {
  const local = /^\/uploads\/(produtos|finder)\/([A-Za-z0-9._-]+)$/.exec(origem);
  if (local) return fs.promises.readFile(path.join(UPLOADS, local[1], local[2]));

  let u;
  try { u = new URL(origem); } catch { throw new Error('URL inválida'); }
  if (!ORIGENS_OK.some(ok => ok(u))) throw new Error('origem não permitida: ' + u.hostname);

  const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(TEMPO_MAX_MS) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (Number(r.headers.get('content-length') || 0) > LIMITE_ORIGEM) throw new Error('foto grande demais');
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > LIMITE_ORIGEM) throw new Error('foto grande demais');
  return b;
}

export async function gerarMiniatura(origem) {
  const nome = nomeDe(origem);
  if (prontas.has(nome)) return URL_BASE + nome;
  const bytes = await lerOrigem(origem);
  const saida = await sharp(bytes, { limitInputPixels: 40e6 })
    .rotate()   // respeita a orientação EXIF de foto de celular
    .resize({ width: LADO_MAX, height: LADO_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  // Grava num temporário e renomeia: quem pedir o arquivo nunca pega metade.
  const tmp = path.join(PASTA_MINIATURAS, nome + '.' + process.pid + '.tmp');
  await fs.promises.writeFile(tmp, saida);
  await fs.promises.rename(tmp, path.join(PASTA_MINIATURAS, nome));
  prontas.add(nome);
  return URL_BASE + nome;
}

// Apaga miniaturas que saíram do catálogo e temporários.
async function limparOrfas(emUso) {
  for (const f of await fs.promises.readdir(PASTA_MINIATURAS)) {
    const orfa = f.endsWith('.tmp') || (f.endsWith('.webp') && !emUso.has(f));
    if (!orfa) continue;
    try { await fs.promises.unlink(path.join(PASTA_MINIATURAS, f)); prontas.delete(f); } catch { /* já foi */ }
  }
}

// Gera o que falta. Uma rodada por vez; chamada durante a rodada pede repetição.
let rodando = null;
let repetir = false;
export function prepararMiniaturas() {
  if (rodando) { repetir = true; return rodando; }
  rodando = (async () => {
    do {
      repetir = false;
      // Fotos de produto e de modelo (diagramas do Localizador ficam de fora).
      const rows = await query(
        `SELECT DISTINCT ImagemUrl FROM (
           SELECT ImagemUrl FROM dbo.Produto
           UNION ALL
           SELECT ImagemUrl FROM dbo.ModeloMoto
         ) f WHERE ImagemUrl IS NOT NULL AND ImagemUrl <> ''`
      );
      const faltam = rows.map(r => r.ImagemUrl).filter(u => !prontas.has(nomeDe(u)));
      let ok = 0, erros = 0;
      for (const u of faltam) {   // uma por vez: a VPS é pequena e o Tiny agradece
        try { await gerarMiniatura(u); ok++; } catch (e) {
          erros++;
          console.warn('⚠ Miniatura não gerada (' + u.slice(0, 80) + '): ' + e.message);
        }
      }
      if (faltam.length) console.log(`✓ Miniaturas: ${ok} geradas` + (erros ? `, ${erros} com erro` : '') + '.');
      await limparOrfas(new Set(rows.map(r => nomeDe(r.ImagemUrl))));
    } while (repetir);
  })()
    .catch(e => console.warn('⚠ Miniaturas: rodada interrompida: ' + e.message))
    .finally(() => { rodando = null; });
  return rodando;
}
