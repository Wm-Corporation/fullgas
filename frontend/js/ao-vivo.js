/* =========================================================
   FULLGAS B2B — Batimento "ao vivo"
   A cada 10 s pergunta ao GET /api/pulso quatro números e, se algo mudou,
   dispara o evento `fg-pulso`. Não desenha nada: cada tela ouve e decide.
   Inclua DEPOIS de js/api-adapter.js.
   ========================================================= */
(function () {
  'use strict';

  if (!window.FG || !FG.pulso || !FG.session || !FG.session()) return;

  // Uma consulta e ~80 bytes por batida.
  var INTERVALO = 10 * 1000;

  var anterior = null;    // último pulso conhecido (null = ainda não bateu)
  var emVoo = false;      // já existe uma pergunta sem resposta?

  function bater() {
    // Aba escondida não pergunta; ao voltar, bate na hora.
    if (document.visibilityState !== 'visible') return;

    // Uma resposta lenta não pode virar uma fila de perguntas empilhadas.
    if (emVoo) return;
    emVoo = true;

    FG.pulso().then(function (p) {
      emVoo = false;
      if (!p) return;                       // falha de rede: tenta na próxima

      var antes = anterior;
      anterior = p;

      // Primeira batida só define a linha de base.
      if (!antes) return;

      var mudou = {
        notificacoes: p.notificacoes !== antes.notificacoes,
        // Conversa andou: contadores mudaram ou chegou mensagem nova.
        suporte: p.suporteNaoLidas !== antes.suporteNaoLidas ||
                 p.suporteAbertos !== antes.suporteAbertos ||
                 p.ultimaMensagem !== antes.ultimaMensagem,
        // Só "subiu" deve tocar som ou piscar.
        chegouNotificacao: p.notificacoes > antes.notificacoes,
        chegouMensagem: p.ultimaMensagem > antes.ultimaMensagem
      };

      if (!mudou.notificacoes && !mudou.suporte) return;

      window.dispatchEvent(new CustomEvent('fg-pulso', {
        detail: { pulso: p, antes: antes, mudou: mudou }
      }));
    }, function () {
      emVoo = false;                        // apiGet não rejeita, mas garantimos
    });
  }

  // Batida imediata, depois de uma ação que muda os números.
  function agora() {
    emVoo = false;
    bater();
  }

  /* O snapshot mais recente, para quem abre a tela no meio do caminho. */
  function ultimo() { return anterior; }

  FG.aoVivo = { agora: agora, ultimo: ultimo, intervalo: INTERVALO };

  // Linha de base.
  bater();
  setInterval(bater, INTERVALO);

  // Voltou para a aba: confere já.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') bater();
  });
})();
