/* =========================================================
   FULLGAS B2B — Endereço da API (carregue antes do api-adapter.js)
   localhost ou IP de rede local → mesmo host na porta 3000; domínio público → /api.
   ========================================================= */
(function () {
  'use strict';

  var host = location.hostname;
  // IPs de rede privada (LAN): 192.168.x, 10.x, 172.16–31.x.
  var ehLanIp = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  var ehLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || ehLanIp;

  // Produção: o Nginx faz proxy de /api no mesmo domínio.
  var API_PRODUCAO = '/api';
  // Mesmo host da página, porta 3000.
  var API_LOCAL = 'http://' + (host || 'localhost') + ':3000/api';

  window.FULLGAS_API_BASE = ehLocal ? API_LOCAL : API_PRODUCAO;

  // Pequeno log pra você confirmar no console qual API está em uso.
  console.log('[Fullgas] Ambiente:', ehLocal ? 'local' : 'produção', '→', window.FULLGAS_API_BASE);
})();
