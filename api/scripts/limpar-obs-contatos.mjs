/* ============================================================
   Tira do Tiny o texto "Sincronizado pelo portal Fullgas B2B." da
   observação dos contatos das concessionárias.
   ------------------------------------------------------------
   Por que existe: até 05/10/2026 o portal gravava esse texto na observação
   do contato quando ela estava vazia. O contato é o MESMO para o Magento e o
   Fullgas, e o Tiny leva a observação do contato para os pedidos — então
   pedidos do Magento apareciam como sincronizados pelo Fullgas. O código não
   grava mais o texto (tiny-contatos.js → MARCA_ANTIGA), mas os contatos que
   já o têm só perdem quando forem enviados de novo. Este script faz isso de
   uma vez, só nos contatos que têm o texto.

   Uso, dentro de api/, como o usuário fullgas (usa o .env da API):

     node scripts/limpar-obs-contatos.mjs            # só LISTA, não altera nada
     node scripts/limpar-obs-contatos.mjs --aplicar  # corrige e confere

   A correção usa o mesmo envio do dia a dia (atualizarContatoTiny): preserva
   a observação que alguém tenha escrito no Tiny e a lista de preço do
   contato, e tira só o nosso texto. Depois relê o contato para conferir.
   ============================================================ */
import 'dotenv/config';
import { query } from '../src/db.js';
import { obterContato } from '../src/tiny.js';
import { atualizarContatoTiny, clientesLigado, temMarcaFullgas } from '../src/tiny-contatos.js';

const aplicar = process.argv.includes('--aplicar');
if (aplicar && !clientesLigado()) {
  console.error('ERRO: a sincronização de clientes com o Tiny está desligada neste .env.');
  process.exit(1);
}

const empresas = await query(
  `SELECT EmpresaId, RazaoSocial, TinyContatoId FROM dbo.Empresa
    WHERE TinyContatoId IS NOT NULL ORDER BY EmpresaId`);
console.log(`${empresas.length} empresa(s) vinculadas a um contato do Tiny.`);

let comMarca = 0, limpos = 0, falhas = 0;
for (const e of empresas) {
  let c;
  try { c = await obterContato(e.TinyContatoId); }
  catch (err) { console.log(`  ?  ${e.RazaoSocial} (contato ${e.TinyContatoId}): não lido — ${err.message}`); falhas++; continue; }
  if (!temMarcaFullgas(c?.obs)) { console.log(`  ok ${e.RazaoSocial}: sem o texto`); continue; }
  comMarca++;
  if (!aplicar) { console.log(`  !! ${e.RazaoSocial} (contato ${e.TinyContatoId}): TEM o texto — obs: ${JSON.stringify(c.obs)}`); continue; }

  await atualizarContatoTiny(e.EmpresaId);
  // atualizarContatoTiny pode ter movido o vínculo para o contato que detém o CNPJ.
  const id = (await query('SELECT TinyContatoId FROM dbo.Empresa WHERE EmpresaId = @eid', { eid: e.EmpresaId }))[0]?.TinyContatoId;
  const depois = await obterContato(id).catch(() => null);
  if (depois && !temMarcaFullgas(depois.obs)) {
    limpos++;
    console.log(`  ✓  ${e.RazaoSocial} (contato ${id}): texto removido` + (depois.obs ? ` — obs mantida: ${JSON.stringify(depois.obs)}` : ''));
  } else {
    falhas++;
    console.log(`  ✗  ${e.RazaoSocial} (contato ${id}): o texto CONTINUA — veja o log de contatos na aba Tiny ERP.`);
  }
}

console.log(aplicar
  ? `\nFeito: ${limpos} limpo(s), ${falhas} com problema, ${empresas.length - comMarca - falhas} já estavam sem o texto.`
  : `\n${comMarca} contato(s) com o texto. Rode com --aplicar para corrigir.`);
process.exit(falhas ? 2 : 0);
