// ============================================================
// Miniaturas das fotos de produto.
// ------------------------------------------------------------
// As fotos vêm do Tiny (≈665×500 px, ≈73 KB cada) e as telas as exibiam
// inteiras em caixinhas de 48 px (Catálogo do admin) ou 170 px (loja). Pior:
// as que ficam em anexos.tiny.com.br respondem com `Cache-Control: no-store`,
// então o navegador baixava tudo de novo a cada abertura da página — no
// Catálogo, 44 fotos e 3,2 MB, ~20 s numa internet de 1,5 Mbps (medido em
// 17/09/2026).
//
// Aqui cada foto ganha uma cópia pequena (até 320 px, WebP, ≈4 KB), servida
// por nós em /uploads/miniaturas/ com cache longo. O nome do arquivo é o hash
// da URL de origem: foto trocada = URL nova = arquivo novo, então o cache
// longo nunca mostra uma imagem velha.
//
// A geração roda em segundo plano (início da API, fim de cada sync do Tiny e
// depois de um upload no admin) e NUNCA derruba nada: se falhar, a tela
// continua usando a foto original.
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, '..', 'uploads');
// FULLGAS_MINIATURAS_DIR existe para os testes: a limpeza de órfãs apaga
// tudo que não está no catálogo, então teste nenhum pode apontar para a
// pasta de verdade.
export const PASTA_MINIATURAS = process.env.FULLGAS_MINIATURAS_DIR || path.join(UPLOADS, 'miniaturas');
const URL_BASE = '/uploads/miniaturas/';
fs.mkdirSync(PASTA_MINIATURAS, { recursive: true });

const LADO_MAX = 320;
const LIMITE_ORIGEM = 15 * 1024 * 1024;   // foto de origem maior que isto é ignorada
const TEMPO_MAX_MS = 20000;

// Só buscamos imagens de onde o catálogo realmente guarda fotos. Sem esta
// lista, uma ImagemUrl adulterada faria a API baixar qualquer endereço
// (inclusive da rede interna) — o clássico SSRF.
const ORIGENS_OK = [
  (u) => u.protocol === 'https:' && u.hostname === 'anexos.tiny.com.br',
  (u) => u.protocol === 'https:' && u.hostname === 's3.amazonaws.com' && u.pathname.startsWith('/tiny-anexos-us/')
];

// Arquivos que já existem no disco (evita um stat por produto a cada GET).
const prontas = new Set(fs.readdirSync(PASTA_MINIATURAS).filter(f => f.endsWith('.webp')));

function nomeDe(origem) {
  return crypto.createHash('sha256').update(origem).digest('hex').slice(0, 32) + '.webp';
}

// URL relativa da miniatura (/uploads/miniaturas/...), ou null se ainda não
// existe — aí o front usa a foto original.
export function miniaturaDe(origem) {
  if (!origem) return null;
  const nome = nomeDe(origem);
  return prontas.has(nome) ? URL_BASE + nome : null;
}

// Lê os bytes da foto de origem: upload local (/uploads/produtos/...) ou uma
// das origens permitidas. Qualquer outra coisa é recusada.
async function lerOrigem(origem) {
  const local = /^\/uploads\/produtos\/([A-Za-z0-9._-]+)$/.exec(origem);
  if (local) return fs.promises.readFile(path.join(UPLOADS, 'produtos', local[1]));

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

// Apaga miniaturas de fotos que saíram do catálogo (produto excluído, foto
// trocada) e temporários esquecidos por uma queda no meio da gravação.
async function limparOrfas(emUso) {
  for (const f of await fs.promises.readdir(PASTA_MINIATURAS)) {
    const orfa = f.endsWith('.tmp') || (f.endsWith('.webp') && !emUso.has(f));
    if (!orfa) continue;
    try { await fs.promises.unlink(path.join(PASTA_MINIATURAS, f)); prontas.delete(f); } catch { /* já foi */ }
  }
}

// Gera o que falta para o catálogo inteiro. Uma rodada por vez; chamadas
// durante uma rodada só pedem que ela seja repetida ao terminar.
let rodando = null;
let repetir = false;
export function prepararMiniaturas() {
  if (rodando) { repetir = true; return rodando; }
  rodando = (async () => {
    do {
      repetir = false;
      const rows = await query(
        "SELECT DISTINCT ImagemUrl FROM dbo.Produto WHERE ImagemUrl IS NOT NULL AND ImagemUrl <> ''"
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
