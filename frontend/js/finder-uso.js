/* =========================================================
   FULLGAS B2B — Usage list (finder-uso.html)
   ---------------------------------------------------------
   Busca reversa do Parts Finder: o cliente digita o número do
   artigo (SKU) e/ou a descrição e recebe TODAS as seções do
   finder que possuem aquela peça anexada, com link para abrir
   a seção. Alimentado por GET /api/finder/uso.
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  if (!FG.temArea(sess, 'finder')) {
    alert('Sua conta não tem acesso ao Parts Finder. Fale com o gestor da concessionária.');
    location.href = '/portal'; return;
  }

  FG.pronto.then(function () {

  var esc = FG.esc;
  document.getElementById('uso-who').innerHTML = FG.esc(sess.email) + ' - ' + FG.empresaDaSessao(sess);

  var elCartN = document.getElementById('uso-cart-n');
  if (elCartN) elCartN.textContent = FG.cartCount();

  var inpSku = document.getElementById('uso-sku');
  var inpDesc = document.getElementById('uso-desc');
  var inpQuick = document.getElementById('uso-quick');
  var titulo = document.getElementById('uso-titulo');
  var tabelaBox = document.getElementById('uso-tabela');

  var LADO_ROTULO = { chassi: 'Frame', engine: 'Engine' };
  var linhasAtuais = [];   // último resultado (para o filtro rápido)

  document.getElementById('uso-voltar').addEventListener('click', function () {
    location.href = '/finder';
  });

  // Monta a tabela de resultados (colunas inspiradas na tela de referência).
  function render(linhas) {
    if (!linhas.length) {
      tabelaBox.innerHTML = '<div class="usage-vazio">No items to display</div>';
      return;
    }
    var thead =
      '<thead><tr>' +
      '<th>Model Year</th><th>Model Name</th><th>Category</th>' +
      '<th>ComponentGroup</th><th>Model articlenumber</th>' +
      '<th>Article</th><th>Engine/Frame</th><th></th>' +
      '</tr></thead>';
    var tbody = '<tbody>' + linhas.map(function (l) {
      var hash = '#/secao/' + l.secaoId;
      var href = '/finder' + hash;
      return '<tr class="usage-row" data-href="' + esc(href) + '">' +
        '<td>' + esc(String(l.ano || '')) + '</td>' +
        '<td>' + esc(l.modeloLabel) + '</td>' +
        '<td>' + esc(l.categoria) + '</td>' +
        '<td>' + esc((l.secaoNumero ? l.secaoNumero + ' — ' : '') + l.secaoNome) + '</td>' +
        '<td>' + esc(l.sku) + '</td>' +
        '<td>' + esc(l.artigo) + '</td>' +
        '<td>' + esc(LADO_ROTULO[l.lado] || l.lado) + '</td>' +
        '<td class="usage-go"><a href="' + esc(href) + '" title="Abrir seção">›</a></td>' +
        '</tr>';
    }).join('') + '</tbody>';

    tabelaBox.innerHTML = '<div class="usage-table-wrap"><table class="usage-table">' +
      thead + tbody + '</table></div>' +
      '<div class="usage-count muted">' + linhas.length +
      (linhas.length === 500 ? '+ ' : ' ') + 'resultado(s)</div>';

    // Clicar em qualquer parte da linha abre a seção no finder.
    Array.prototype.forEach.call(tabelaBox.querySelectorAll('.usage-row'), function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') return; // o link já navega
        location.href = tr.getAttribute('data-href');
      });
    });
  }

  // Filtro rápido no cliente (sobre o resultado já carregado).
  function aplicarQuick() {
    var q = (inpQuick.value || '').trim().toLowerCase();
    if (!q) { render(linhasAtuais); return; }
    render(linhasAtuais.filter(function (l) {
      return (l.modeloLabel + ' ' + l.sku + ' ' + l.artigo + ' ' + l.secaoNome + ' ' +
        l.categoria + ' ' + l.ano).toLowerCase().indexOf(q) >= 0;
    }));
  }

  function buscar() {
    var sku = inpSku.value.trim();
    var desc = inpDesc.value.trim();
    if (!sku && !desc) {
      FG.toast('Digite o número do artigo (SKU) ou a descrição.');
      return;
    }
    titulo.textContent = 'Search Text: ' + (sku || desc);
    tabelaBox.innerHTML = '<div class="usage-vazio">Buscando…</div>';
    inpQuick.value = '';
    FG.finderUso(sku, desc).then(function (linhas) {
      linhasAtuais = linhas || [];
      render(linhasAtuais);
    }, function (e) {
      tabelaBox.innerHTML = '';
      FG.toast((e && e.message) || 'Falha na busca.', 'erro');
    });
  }

  document.getElementById('uso-search').addEventListener('click', buscar);
  [inpSku, inpDesc].forEach(function (inp) {
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') buscar(); });
  });
  inpQuick.addEventListener('input', aplicarQuick);

  // Estado inicial: tabela vazia (igual à referência antes de pesquisar).
  render([]);
  inpSku.focus();

  }); // fim FG.pronto.then
})();
