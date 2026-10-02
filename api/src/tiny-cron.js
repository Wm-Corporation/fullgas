// ============================================================
// Sincronização AGENDADA com o Tiny ERP (node-cron)
// ------------------------------------------------------------
// Este arquivo substitui o antigo webhook. A parte de notificação
// dos webhooks do Tiny se mostrou pouco confiável, então a
// atualização automática passou a ser por agendamento: a cada
// N MINUTOS (não milissegundos — quem agenda é o node-cron, com
// expressão de cron, e não um setInterval), a API roda o MESMO
// lote do botão "Sincronizar todos" do painel admin:
//
//     sincronizarLote(null, 'cron')
//         └─ null  = todos os produtos com TinyAtivo = 1
//         └─ 'cron'= origem gravada no TinySyncLog (o botão do
//                    admin grava 'lote'; assim o log diferencia
//                    a rodada automática da manual)
//
// Configuração (api/.env):
//   TINY_TOKEN               token da API v2 — sem ele o
//                            agendamento nem inicia.
//   TINY_SYNC_INTERVALO_MIN  intervalo em MINUTOS entre as
//                            rodadas (1 a 59, ou múltiplos de 60
//                            para virar horas). 0 ou vazio
//                            desliga o agendamento.
//
// Ritmo: cada produto custa até 2 requisições ao Tiny, e a fila
// do tiny.js espaça as chamadas (~1,1 s cada) para respeitar o
// limite de ~60 req/min do Tiny. Um catálogo de 100 produtos
// leva ~4 min por rodada — escolha um intervalo maior que isso.
// Se uma rodada ainda estiver em andamento quando a próxima
// disparar, a nova é PULADA (trava de sobreposição abaixo) —
// nunca rodam duas ao mesmo tempo.
// ============================================================
import cron from 'node-cron';
import 'dotenv/config';
import { sincronizarLote, podarLogCron } from './tiny.js';
import { processarExportacoes, sincronizarSituacaoPedidos } from './tiny-pedidos.js';
import { processarContatosPendentes, sincronizarContatosDoTiny } from './tiny-contatos.js';
import { sincronizarListasPreco } from './lista-preco.js';

// Trava de sobreposição: true enquanto uma rodada está em andamento.
let rodando = false;

// Converte o intervalo em minutos para uma expressão de cron.
//   1..59  → "*/N * * * *"   (a cada N minutos)
//   60,120…→ "0 */H * * *"   (a cada H horas, em ponto)
// Devolve null para valores que o cron não representa (ex.: 90).
function expressaoCron(minutos) {
  if (minutos >= 1 && minutos <= 59) return `*/${minutos} * * * *`;
  if (minutos >= 60 && minutos % 60 === 0) return `0 */${minutos / 60} * * *`;
  return null;
}

// Uma rodada completa: sincroniza todos os produtos Tiny e resume no console.
// Os detalhes por produto ficam no TinySyncLog (evento 'cron'), visível na
// tela "Tiny ERP" do admin.
async function rodada() {
  if (rodando) {
    console.warn('⏭ Sync Tiny (cron): rodada anterior ainda em andamento — esta foi pulada. ' +
      'Se isso se repetir, aumente TINY_SYNC_INTERVALO_MIN.');
    return;
  }
  rodando = true;
  const inicio = Date.now();
  try {
    // Antes de espelhar produtos, re-tenta exportações de pedido que ficaram
    // pendentes/com erro (Tiny fora do ar na hora da compra, etc.). Barato
    // quando não há nada na fila; e precisa vir ANTES: enquanto a exportação
    // não chega ao Tiny, o espelho desconta a reserva pendente do saldo.
    await processarExportacoes();

    // Reflete no status local os pedidos que o Tiny marcou como enviados/
    // entregues (ignora faturado e demais situações). Sentido Tiny → Fullgas.
    await sincronizarSituacaoPedidos();

    // Cadastros que ainda não foram atrelados a um contato no Tiny (o Tiny
    // estava fora na hora do registro, etc.) — barato quando não há pendência.
    await processarContatosPendentes();

    // Reflete no cadastro local o que mudou nos contatos vinculados do Tiny
    // (razão social, IE, e-mail, telefone, endereço). Sentido Tiny → Fullgas.
    await sincronizarContatosDoTiny();

    // Listas de preço (nome e %): mudar o % de uma lista no Tiny vale para
    // todos os clientes dela a partir desta rodada. Uma chamada por página
    // de 100 listas. Falha aqui não pode impedir o espelho de produtos.
    try { await sincronizarListasPreco(); }
    catch (e) { console.warn('⚠ Sync Tiny (cron): listas de preço não atualizadas:', e.message); }

    const resultados = await sincronizarLote(null, 'cron');
    // O log do cron só guarda os 3 últimos registros de cada produto — o
    // histórico completo dos eventos manuais (lote/importação) permanece.
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

// Inicia o agendamento. Chamada uma única vez pelo server.js, depois que a
// conexão com o banco está de pé. Não derruba a API em caso de configuração
// ausente/ inválida — só avisa no console e segue sem agendar (a sincronização
// manual pelo botão do admin continua funcionando normalmente).
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
}
