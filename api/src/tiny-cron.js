// Sincronização agendada com o Tiny (node-cron): roda o mesmo lote do botão "Sincronizar todos".
// .env: TINY_TOKEN e TINY_SYNC_INTERVALO_MIN (1-59 ou múltiplos de 60; 0 desliga).
// Rodada que ainda não terminou faz a próxima ser pulada.
import cron from 'node-cron';
import 'dotenv/config';
import { sincronizarLote, podarLogCron } from './tiny.js';
import { processarExportacoes, sincronizarSituacaoPedidos } from './tiny-pedidos.js';
import { processarContatosPendentes, sincronizarContatosDoTiny } from './tiny-contatos.js';
import { sincronizarListasPreco } from './lista-preco.js';
import { produtosComFila } from './black-order.js';

// Trava de sobreposição: true enquanto uma rodada está em andamento.
let rodando = false;

// Minutos → expressão cron: 1..59 = "*/N * * * *"; 60, 120… = "0 */H * * *"; outros = null.
function expressaoCron(minutos) {
  if (minutos >= 1 && minutos <= 59) return `*/${minutos} * * * *`;
  if (minutos >= 60 && minutos % 60 === 0) return `0 */${minutos / 60} * * *`;
  return null;
}

// Uma rodada completa. Detalhes por produto no TinySyncLog (evento 'cron').
async function rodada() {
  if (rodando) {
    console.warn('⏭ Sync Tiny (cron): rodada anterior ainda em andamento — esta foi pulada. ' +
      'Se isso se repetir, aumente TINY_SYNC_INTERVALO_MIN.');
    return;
  }
  rodando = true;
  const inicio = Date.now();
  try {
    // Exportações pendentes primeiro (o espelho de estoque depende delas).
    await processarExportacoes();

    // Enviado/entregue no Tiny → status local.
    await sincronizarSituacaoPedidos();

    // Cadastros ainda sem contato no Tiny.
    await processarContatosPendentes();

    // Listas de preço antes dos contatos. Falha aqui não para a rodada.
    try { await sincronizarListasPreco(); }
    catch (e) { console.warn('⚠ Sync Tiny (cron): listas de preço não atualizadas:', e.message); }

    // Contatos do Tiny → cadastro local.
    await sincronizarContatosDoTiny();

    const resultados = await sincronizarLote(null, 'cron');
    // Mantém só os 3 últimos logs de cron por produto.
    await podarLogCron(3);
    const ok = resultados.filter(r => r.status === 'ok').length;
    const erros = resultados.filter(r => r.status === 'erro').length;
    const seg = Math.round((Date.now() - inicio) / 1000);
    console.log(`✓ Sync Tiny (cron): ${ok}/${resultados.length} atualizados` +
      (erros ? `, ${erros} com erro (ver TinySyncLog)` : '') + ` em ${seg}s.`);
  } catch (e) {
    console.error('✗ Sync Tiny (cron) falhou:', e.message);
  } finally {
    rodando = false;
  }
}

// Vigia da black order: a cada 2 min lê no Tiny só as peças com fila aberta, para reservar e
// avisar o primeiro da fila assim que a quantidade dele chegar. Pula se a rodada grande estiver no meio.
let vigiando = false;
export async function vigiarBlackOrders() {
  if (vigiando || rodando) return;
  vigiando = true;
  try {
    const ids = await produtosComFila();
    if (ids.length) await sincronizarLote(ids, 'cron');
  } catch (e) {
    console.warn('⚠ Vigia da black order falhou:', e.message);
  } finally {
    vigiando = false;
  }
}

// Liga o agendamento (chamada pelo server.js). Configuração inválida só avisa.
export function iniciarSincronizacaoAgendada() {
  if (!process.env.TINY_TOKEN) {
    console.log('• Sync Tiny (cron): desligado — TINY_TOKEN não configurado.');
    return;
  }

  const minutos = Number(process.env.TINY_SYNC_INTERVALO_MIN || 0);
  if (!minutos) {
    console.log('• Sync Tiny (cron): desligado — defina TINY_SYNC_INTERVALO_MIN no .env para ligar.');
    return;
  }

  const expressao = expressaoCron(minutos);
  if (!expressao) {
    console.error(`✗ Sync Tiny (cron): intervalo inválido (${minutos} min). ` +
      'Use de 1 a 59 minutos, ou múltiplos de 60 (60 = 1h, 120 = 2h...).');
    return;
  }

  cron.schedule(expressao, rodada);
  console.log(`✓ Sync Tiny (cron): agendado a cada ${minutos} min (expressão "${expressao}").`);
  cron.schedule('*/2 * * * *', vigiarBlackOrders);
  console.log('✓ Vigia da black order: a cada 2 min (só peças com fila aberta).');
}
