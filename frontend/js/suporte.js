/* =========================================================
   FULLGAS B2B — Pop-up do Suporte Técnico
   Abre chamado de qualquer tela e lista os recentes; a conversa fica no portal.
   Inclua DEPOIS de js/api-adapter.js.
   ========================================================= */
(function () {
  'use strict';

  if (!window.FG || !FG.session) return;

  var sess = FG.session();
  // Sem sessão ou admin (atende pelo painel): sem pop-up.
  if (!sess || sess.papel === 'admin') return;

  var esc = FG.esc;

  // Status → slug ASCII para a classe .sup-st-*.
  var STATUS_SLUG = {
    'Aberto': 'aberto',
    'Em atendimento': 'atendimento',
    'Aguardando cliente': 'aguardando',
    'Resolvido': 'resolvido',
    'Fechado': 'fechado'
  };
  function pillStatus(st) {
    return '<span class="sup-st sup-st-' + (STATUS_SLUG[st] || 'aberto') + '">' + esc(st) + '</span>';
  }

  // Detalhe fica no portal: navega ou troca o hash.
  function irParaChamado(id) {
    var alvo = '#suporte' + (id ? '/' + id : '');
    if (/\/portal(\.html)?$/.test(location.pathname)) {
      var antes = location.hash;
      location.hash = alvo;
      // Mesmo hash não dispara hashchange: força.
      if (location.hash === antes) window.dispatchEvent(new Event('hashchange'));
    } else {
      location.href = '/portal' + alvo;
    }
  }

  /* ---------- estrutura fixa (criada uma vez) ---------- */
  var raiz = document.createElement('div');
  // Na loja, sobe para não cobrir o carrinho.
  raiz.className = 'sup-widget' + (document.getElementById('cart-fab') ? ' sup-com-carrinho' : '');
  raiz.innerHTML =
    '<div class="sup-panel hidden" id="sup-panel" role="dialog" aria-label="Suporte Técnico" aria-modal="false">' +
    '  <header class="sup-head">' +
    '    <div><b>Suporte Técnico</b><span>Abra um chamado — respondemos por aqui.</span></div>' +
    '    <button type="button" class="sup-x" id="sup-fechar" aria-label="Fechar">×</button>' +
    '  </header>' +
    '  <div class="sup-body" id="sup-body"></div>' +
    '</div>' +
    '<button type="button" class="sup-fab" id="sup-fab" aria-label="Abrir o suporte técnico" aria-expanded="false">' +
    '  <span class="sup-fab-ico" aria-hidden="true">🎧</span>' +
    '  <span class="sup-fab-badge hidden" id="sup-badge">0</span>' +
    '</button>';
  document.body.appendChild(raiz);

  var painel = raiz.querySelector('#sup-panel');
  var corpo = raiz.querySelector('#sup-body');
  var fab = raiz.querySelector('#sup-fab');
  var badge = raiz.querySelector('#sup-badge');

  var aberto = false;
  var enviando = false;
  // 'lista' | 'form' | 'ok'. O batimento só redesenha a lista.
  var tela = 'lista';

  /* ---------- badge: pintar (número do batimento) e buscar ficam separados ---------- */
  function pintarBadge(n) {
    n = Number(n) || 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.toggle('hidden', !n);
    fab.classList.toggle('tem-novidade', !!n);
  }

  function atualizarBadge() {
    return FG.suporteResumo().then(function (r) {
      pintarBadge((r && r.naoLidas) || 0);
      return r;
    });
  }

  /* ---------- tela 1: lista de chamados ---------- */
  function renderLista() {
    tela = 'lista';
    corpo.innerHTML = '<p class="sup-vazio">Carregando…</p>';
    FG.suporteChamados().then(function (lista) {
      var recentes = lista.slice(0, 5);
      var html = '<button type="button" class="sup-novo" id="sup-abrir-form">' +
        '<span class="mais">＋</span> Abrir chamado</button>';

      if (!lista.length) {
        html += '<p class="sup-vazio">Você ainda não tem chamados. Conte o que está acontecendo ' +
          'e o suporte responde por aqui mesmo.</p>';
      } else {
        html += '<div class="sup-lista">' + recentes.map(function (c) {
          return '<button type="button" class="sup-item' + (c.naoLidas ? ' novo' : '') +
            '" data-id="' + c.id + '">' +
            '<span class="sup-item-top"><b>' + esc(c.numero) + '</b>' + pillStatus(c.status) + '</span>' +
            '<span class="sup-item-assunto">' + esc(c.assunto) + '</span>' +
            '<span class="sup-item-pe">' + esc(c.categoriaNome) + ' · ' + FG.fmtDate(c.atualizadoEm) +
            (c.naoLidas ? '<span class="sup-item-novo">' + c.naoLidas + ' nova' +
              (c.naoLidas > 1 ? 's' : '') + '</span>' : '') + '</span>' +
            '</button>';
        }).join('') + '</div>';
        if (lista.length > recentes.length) {
          html += '<button type="button" class="sup-todos" id="sup-ver-todos">Ver todos os ' +
            lista.length + ' chamados</button>';
        } else {
          html += '<button type="button" class="sup-todos" id="sup-ver-todos">Ver na aba Suporte Técnico</button>';
        }
      }

      corpo.innerHTML = html;
      corpo.querySelector('#sup-abrir-form').addEventListener('click', renderForm);
      var todos = corpo.querySelector('#sup-ver-todos');
      if (todos) todos.addEventListener('click', function () { fechar(); irParaChamado(null); });
      Array.prototype.forEach.call(corpo.querySelectorAll('.sup-item'), function (b) {
        b.addEventListener('click', function () {
          fechar();
          irParaChamado(b.getAttribute('data-id'));
        });
      });
    }, function () {
      corpo.innerHTML = '<p class="sup-vazio">Não foi possível carregar seus chamados agora. ' +
        'Tente de novo em instantes.</p>';
    });
  }

  /* ---------- tela 2: abrir chamado ---------- */
  function renderForm() {
    tela = 'form';
    corpo.innerHTML = '<p class="sup-vazio">Carregando…</p>';
    FG.suporteCategorias().then(function (cats) {
      corpo.innerHTML =
        '<div class="sup-form">' +
        '<div class="field"><label for="sup-cat">Como podemos ajudar? *</label>' +
        '<select id="sup-cat">' +
        '<option value="">Escolha a categoria…</option>' +
        cats.map(function (c) {
          return '<option value="' + esc(c.codigo) + '">' + esc(c.nome) + '</option>';
        }).join('') +
        '</select><small class="sup-dica" id="sup-dica"></small></div>' +

        '<div class="field"><label for="sup-assunto">Assunto *</label>' +
        '<input id="sup-assunto" type="text" maxlength="160" placeholder="Resuma em uma linha"></div>' +

        '<div class="field"><label for="sup-desc">O que está acontecendo? *</label>' +
        '<textarea id="sup-desc" rows="4" maxlength="4000" ' +
        'placeholder="Descreva com o máximo de detalhe: número do pedido, código da peça, NIV…"></textarea></div>' +

        '<div class="field"><label for="sup-prio">Urgência</label>' +
        '<select id="sup-prio">' +
        '<option value="baixa">Baixa — posso esperar</option>' +
        '<option value="normal" selected>Normal</option>' +
        '<option value="alta">Alta — está me travando</option>' +
        '</select></div>' +

        '<div class="field"><label for="sup-anexo">Anexo (print, foto ou PDF — opcional)</label>' +
        '<input id="sup-anexo" type="file" accept="image/*,video/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.csv,.txt"></div>' +

        '<div class="sup-acoes">' +
        '<button type="button" class="sup-cancelar" id="sup-cancelar">Voltar</button>' +
        '<button type="button" class="sup-enviar" id="sup-enviar">Enviar chamado</button>' +
        '</div></div>';

      var selCat = corpo.querySelector('#sup-cat');
      var dica = corpo.querySelector('#sup-dica');
      selCat.addEventListener('change', function () {
        var c = cats.find(function (x) { return x.codigo === selCat.value; });
        dica.textContent = c ? c.descricao : '';
      });
      corpo.querySelector('#sup-cancelar').addEventListener('click', renderLista);
      corpo.querySelector('#sup-enviar').addEventListener('click', enviar);
      corpo.querySelector('#sup-assunto').focus();
    }, function () {
      corpo.innerHTML = '<p class="sup-vazio">Não foi possível carregar o formulário. ' +
        'Tente de novo em instantes.</p>';
    });
  }

  function enviar() {
    if (enviando) return;
    var dados = {
      categoria: corpo.querySelector('#sup-cat').value,
      assunto: corpo.querySelector('#sup-assunto').value.trim(),
      descricao: corpo.querySelector('#sup-desc').value.trim(),
      prioridade: corpo.querySelector('#sup-prio').value,
      anexo: corpo.querySelector('#sup-anexo').files[0] || null
    };
    if (!dados.categoria) { FG.toast('Escolha a categoria da ajuda.', 'erro'); return; }
    if (!dados.assunto) { FG.toast('Escreva um assunto para o chamado.', 'erro'); return; }
    if (!dados.descricao) { FG.toast('Descreva o que está acontecendo.', 'erro'); return; }

    var b = corpo.querySelector('#sup-enviar');
    enviando = true; b.disabled = true; b.textContent = 'Enviando…';
    FG.suporteAbrir(dados).then(function (r) {
      enviando = false;
      if (!r.ok) {
        b.disabled = false; b.textContent = 'Enviar chamado';
        FG.toast(r.msg || 'Não foi possível abrir o chamado.', 'erro');
        return;
      }
      renderSucesso(r);
      atualizarBadge();
      // Avisa a aba Suporte para redesenhar ('fg-suporte-mudou' só mexe no badge).
      window.dispatchEvent(new Event('fg-suporte-novo'));
    });
  }

  function renderSucesso(c) {
    tela = 'ok';
    corpo.innerHTML =
      '<div class="sup-ok">' +
      '<div class="sup-ok-ico" aria-hidden="true">✓</div>' +
      '<b>Chamado ' + esc(c.numero) + ' aberto</b>' +
      '<p>Recebemos sua mensagem. A resposta aparece aqui no ícone de suporte e na aba ' +
      '<b>Suporte Técnico</b> do portal.</p>' +
      '<button type="button" class="sup-enviar" id="sup-ver">Acompanhar chamado</button>' +
      '<button type="button" class="sup-cancelar" id="sup-voltar">Voltar</button>' +
      '</div>';
    corpo.querySelector('#sup-ver').addEventListener('click', function () {
      fechar(); irParaChamado(c.id);
    });
    corpo.querySelector('#sup-voltar').addEventListener('click', renderLista);
  }

  /* ---------- abrir / fechar ---------- */
  function abrir() {
    aberto = true;
    painel.classList.remove('hidden');
    fab.setAttribute('aria-expanded', 'true');
    fab.classList.add('on');
    renderLista();
  }
  function fechar() {
    aberto = false;
    painel.classList.add('hidden');
    fab.setAttribute('aria-expanded', 'false');
    fab.classList.remove('on');
    // Atualiza o badge ao voltar.
    atualizarBadge();
  }

  fab.addEventListener('click', function () { if (aberto) fechar(); else abrir(); });
  raiz.querySelector('#sup-fechar').addEventListener('click', fechar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && aberto) fechar();
  });

  // Outras telas avisam quando algo muda.
  window.addEventListener('fg-suporte-mudou', function () { atualizarBadge(); });

  // Formulário único de abertura: a aba Suporte do portal usa este.
  FG.suporteWidget = {
    abrir: abrir,
    abrirFormulario: function () { abrir(); renderForm(); },
    fechar: fechar,
    atualizarBadge: atualizarBadge
  };

  /* ---------- badge: primeira carga e batimento (js/ao-vivo.js) ---------- */
  atualizarBadge();

  window.addEventListener('fg-pulso', function (e) {
    pintarBadge(e.detail.pulso.suporteNaoLidas);
    // Painel na lista: atualiza.
    if (aberto && tela === 'lista') renderLista();
  });

  // Sem o batimento, um laço próprio atualiza o badge.
  if (!FG.aoVivo) {
    setInterval(function () {
      if (document.visibilityState === 'visible' && !aberto) atualizarBadge();
    }, 3 * 60 * 1000);
  }
})();
