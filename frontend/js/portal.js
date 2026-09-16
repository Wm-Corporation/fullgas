/* =========================================================
   FULLGAS B2B — Portal do concessionário (portal.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  // Espera o cache (carregado de forma assíncrona via fetch) antes de montar a
  // tela — nada de renderizar com dados vazios.
  FG.pronto.then(function () {

  var view = document.getElementById('view');
  var crumb = document.getElementById('crumb');
  var esc = FG.esc;

  /* ---------- cabeçalho ---------- */
  // Administrador aparece como Fábrica, não com o nome da empresa em que a
  // conta está pendurada (ver api/src/fabrica.js).
  function desenharQuem() {
    var who = document.getElementById('user-who');
    if (!who) return;
    who.innerHTML = esc(sess.nome) + ' (' + esc(sess.email) + ') - ' + FG.empresaDaSessao(sess) +
      (sess.papel === 'admin' ? ' Administrador' : ', Concessionário');
  }
  desenharQuem();

  document.getElementById('btn-sair').addEventListener('click', function (e) { e.preventDefault(); FG.logout(); });
  document.getElementById('btn-notif').addEventListener('click', function () { location.hash = '#notificacoes'; });

  if (sess.papel === 'admin') document.getElementById('tab-admin').classList.remove('hidden');

  // Aba "Subdealers": só a conta GESTORA (ou admin) gerencia as contas
  // internas. Uma conta interna (sub-dealer) não vê a aba nem cria outras
  // contas — o roteador (abaixo) também barra o acesso direto por hash.
  var ehGestor = !!(sess.gestor || sess.papel === 'admin');
  if (ehGestor) document.getElementById('tab-subdealers').classList.remove('hidden');

  /* ---------- permissões por área (contas internas / sub-dealers) ----------
     O gestor restringe as áreas de cada conta interna no painel "Minha
     conta". Aqui as abas bloqueadas somem; o roteador (abaixo) também barra
     acesso direto pelo hash. Admin/gestor têm sempre acesso total. */
  var GATE_TABS = [
    ['loja', '.tabs a[href="/loja"]'],
    ['finder', '.tabs a[href="/finder"]'],
    ['finder', '.topbar .pf-link'],
    ['pedidos', '.tabs a[data-rota="pedidos"]'],
    ['financeiro', '#tab-fin'],
    ['reivindicacoes', '.tabs a[data-rota="reivindicacoes"]'],
    ['estoque', '.tabs a[data-rota="estoque"]'],
    ['acoes', '.tabs a[data-rota="acoes"]']
  ];
  GATE_TABS.forEach(function (par) {
    if (FG.temArea(sess, par[0])) return;
    var el = document.querySelector(par[1]);
    if (el) el.classList.add('hidden');
  });
  // Rotas do portal barradas para quem não tem a área (acesso direto por hash).
  var GATE_ROTAS = { pedidos: 'pedidos', pedido: 'pedidos', financeiro: 'financeiro',
    reivindicacoes: 'reivindicacoes', estoque: 'estoque', acoes: 'acoes' };

  function refreshPill() {
    var n = FG.unreadCount();
    var pill = document.getElementById('notif-pill');
    pill.textContent = n;
    pill.style.display = n ? '' : 'none';
  }

  /* O destaque da carta ✉️ quando algo chega COM A PÁGINA ABERTA.
     Um número que troca de 2 para 3 num canto da tela passa despercebido por
     quem está olhando outra coisa. A classe .novo (ver css/styles.css) faz o
     badge pulsar por alguns segundos e depois some — anuncia a novidade sem
     virar um alerta permanente piscando na cara do revendedor. */
  function piscarPill() {
    var pill = document.getElementById('notif-pill');
    if (!pill) return;
    pill.classList.remove('novo');
    // Reinicia a animação mesmo se ela já estava rodando (duas mensagens
    // seguidas): sem ler offsetWidth o navegador não repara na troca.
    void pill.offsetWidth;
    pill.classList.add('novo');
    setTimeout(function () { pill.classList.remove('novo'); }, 6500);
  }

  /* dropdowns das abas */
  Array.prototype.forEach.call(document.querySelectorAll('.tabs .drop > button'), function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var d = btn.parentElement;
      var aberto = d.classList.contains('open');
      Array.prototype.forEach.call(document.querySelectorAll('.tabs .drop.open'), function (x) { x.classList.remove('open'); });
      if (!aberto) d.classList.add('open');
    });
  });
  document.addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs .drop.open'), function (x) { x.classList.remove('open'); });
  });

  /* busca do topo */
  document.getElementById('search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('search-input').value.trim();
    if (q) location.hash = '#busca/' + encodeURIComponent(q);
  });

  /* ---------- telas que carregam dados na hora ----------
     Suporte, Minha conta, detalhe do pedido... desenham quando a resposta
     chega. Se nesse meio-tempo o usuário já trocou de aba, a resposta
     atrasada NÃO pode desenhar por cima da tela nova: a aba acesa deixaria de
     bater com o conteúdo, e clicar de novo na aba não faria nada (o endereço
     já é aquele) — a página parecia travada até recarregar. Cada troca de
     tela ganha um número; quem busca guarda o seu e confere na volta. */
  var telaSeq = 0;
  function telaVigente() {
    var minha = telaSeq;
    return function () { return minha === telaSeq; };
  }

  /* ---------- util ---------- */
  function setCrumb(partes) {
    // Fora da home, o botão VOLTAR abre a trilha (bem visível — volta um
    // passo na navegação; sem histórico, cai na página inicial).
    var html = (partes || []).length
      ? '<button class="btn-voltar" id="crumb-voltar" type="button">Voltar</button>'
      : '';
    html += '<a href="#home">Página inicial</a>';
    (partes || []).forEach(function (p) { html += ' &rsaquo; <span>' + esc(p) + '</span>'; });
    crumb.innerHTML = html;
    var bv = document.getElementById('crumb-voltar');
    if (bv) bv.addEventListener('click', function () {
      if (history.length > 1) history.back(); else location.hash = '#home';
    });
  }
  function setTabOn(rota) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs a[data-rota]'), function (a) {
      a.classList.toggle('on', a.getAttribute('data-rota') === rota);
    });
    document.querySelector('#tab-fin > button').classList.toggle('on', rota === 'financeiro');
  }
  function statusBadge(st) {
    var cls = { 'Em processo': 'proc', 'Aprovada': 'ok', 'Recusada': 'bad', 'Esboço': 'draft' }[st] || 'proc';
    return '<span class="badge ' + cls + '">' + esc(st) + '</span>';
  }
  function modelName(modeloId) {
    var m = FG.model(modeloId);
    return m ? (m.nome + ' ' + m.ano) : modeloId;
  }

  /* =========================================================
     HOME
     ========================================================= */
  function renderHome() {
    setCrumb([]); setTabOn('');
    var crit = FG.unreadCritical();
    var disp = FG.all('vehicles').filter(function (v) { return v.status === 'Disponível'; }).length;
    var claims = FG.all('claims');

    // agrupa reivindicações por criador para a mini tabela
    var grupos = {};
    claims.forEach(function (c) {
      var g = grupos[c.criador] || (grupos[c.criador] = { total: 0, dar: 0, imp: 0, hq: 0, novas: 0 });
      g.total++;
      if (c.tipo === 'Implícito') g.imp++;
      if (c.status === 'Em processo') g.hq++;
      if (c.status === 'Esboço') g.novas++;
    });
    var nomes = Object.keys(grupos).sort();

    var html = '';
    if (crit > 0) {
      html += '<div class="banner-crit" id="banner-crit">' +
        '<span>Você tem ' + crit + ' notificaç' + (crit === 1 ? 'ão crítica' : 'ões críticas') + ' na sua caixa de entrada</span>' +
        '<span class="arrow">&rsaquo;</span></div>';
    }

    html += '<div class="home-cards">';
    html += '<div><div class="card-title">Estoque de veículos (' + disp + ')</div>' +
      '<div class="stock-card"><span class="lbl">Standard</span><span class="fab">🏭</span>' +
      '<span class="num">' + disp + '</span><span class="sub">em estoque</span></div></div>';

    html += '<div><div class="card-title">Reivindicações (' + claims.length + ')</div>' +
      '<table class="claims-mini"><thead><tr><th></th><th>Claims</th><th>DAR</th><th>IMP</th><th>HQ</th><th>New</th></tr></thead><tbody>';
    nomes.forEach(function (n) {
      var g = grupos[n];
      html += '<tr><td>' + esc(n) + '</td><td class="num"><b>' + g.total + '</b></td>' +
        '<td class="num">' + g.dar + '</td><td class="num">' + g.imp + '</td>' +
        '<td class="hq">' + g.hq + '</td><td class="num">' + g.novas + '</td></tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div class="home-heroes">' +
      '<div class="hero-panel">' + FG.bikeSVG('plastics', 230, { cls: 'lite' }) + '<span class="cap">Linha Enduro 2026</span></div>' +
      '<div class="hero-panel">' + FG.bikeSVG('engine', 230, { cls: 'lite' }) + '<span class="cap">Peças originais Fullgas</span></div>' +
      '</div>';

    view.innerHTML = html;
    var banner = document.getElementById('banner-crit');
    if (banner) banner.addEventListener('click', function () { location.hash = '#notificacoes'; });
  }

  /* =========================================================
     NOTIFICAÇÕES
     ========================================================= */
  function renderNotifs() {
    setCrumb(['Notificações']); setTabOn('notificacoes');
    var list = FG.all('notifications').slice().sort(function (a, b) { return a.data < b.data ? 1 : -1; });
    var html = '<h2>Notificações</h2>';
    if (!list.length) html += '<p class="muted">Nenhuma notificação.</p>';
    list.forEach(function (n) {
      // Anexo enviado pelo admin: imagem inline, vídeo com player ou link.
      // data-arquivo em vez de src/href — o anexo é privado e vem por fetch
      // autenticado (FG.carregarArquivos, chamado depois de montar a lista).
      var anexo = '';
      if (n.anexo) {
        if (n.anexoTipo === 'imagem') anexo = '<img class="nt-img" data-arquivo="' + esc(n.anexo) + '" alt="Anexo" loading="lazy">';
        else if (n.anexoTipo === 'video') anexo = '<video class="nt-video" data-arquivo="' + esc(n.anexo) + '" controls preload="metadata"></video>';
        else anexo = '<a class="link-action" data-arquivo="' + esc(n.anexo) + '" target="_blank" rel="noopener">📎 Abrir anexo</a>';
      }
      // Aviso vindo de um chamado: leva direto para a conversa. O administrador
      // atende pelo painel, o revendedor pela aba do portal — o link muda de
      // destino conforme quem está lendo.
      var linkChamado = n.chamadoId
        ? '<a class="link-action nt-chamado" href="' +
          (sess.papel === 'admin' ? '/admin#suporte/' : '#suporte/') + esc(n.chamadoId) +
          '">Abrir chamado &rsaquo;</a>'
        : '';

      html += '<div class="notif ' + n.tipo + (n.lida ? '' : ' unread') + '">' +
        '<div class="nt-body"><div class="nt-title">' + (n.tipo === 'critica' ? '⚠ ' : '') + esc(n.titulo) + '</div>' +
        (n.texto ? '<div style="white-space:pre-line;">' + esc(n.texto) + '</div>' : '') +
        anexo + linkChamado +
        '<div class="nt-date">' + FG.fmtDateTime(n.data) + '</div></div>' +
        (n.lida ? '' : '<button class="link-action" data-id="' + n.id + '" data-lida="true">Marcar como lida</button>') +
        '</div>';
    });
    view.innerHTML = html;
    FG.carregarArquivos(view);       // busca os anexos protegidos
    Array.prototype.forEach.call(view.querySelectorAll('[data-id]'), function (b) {
      b.addEventListener('click', function () {
        FG.markNotif(b.getAttribute('data-id'), b.getAttribute('data-lida') === 'true');
        refreshPill(); renderNotifs();
      });
    });
  }

  /* =========================================================
     REIVINDICAÇÕES
     ========================================================= */
  var claimFiltro = 'Em processo';
  // Sub-aba da seção Reivindicações: 'veiculo' (garantia por NIV) | 'varejo'
  // (garantia de peça de um pedido). Define a lista mostrada e o "Nova".
  var claimAba = 'veiculo';

  // Rascunhos ("Esboço") vivem no navegador do cliente (localStorage), NÃO no
  // banco. Só viram reivindicação de verdade ao "Enviar".
  var RASC_KEY = 'fullgas_reiv_rascunhos_v1';
  function lerRascunhos() {
    try { return JSON.parse(localStorage.getItem(RASC_KEY) || '[]'); } catch (e) { return []; }
  }
  function salvarRascunhos(l) { localStorage.setItem(RASC_KEY, JSON.stringify(l)); }
  function gravarRascunho(d) {
    var l = lerRascunhos();
    if (d.localId) {
      var i = l.findIndex(function (x) { return x.localId === d.localId; });
      if (i >= 0) l[i] = d; else l.push(d);
    } else {
      d.localId = 'r' + Date.now() + Math.random().toString(36).slice(2, 7);
      l.push(d);
    }
    salvarRascunhos(l);
    return d;
  }
  function excluirRascunho(localId) {
    salvarRascunhos(lerRascunhos().filter(function (x) { return x.localId !== localId; }));
  }

  // Rótulo curto da origem, usado na lista e no detalhe.
  function rotuloOrigem(c) {
    if (c.origem === 'varejo') return 'Varejo';
    if (c.origem === 'preentrega') return 'Pré-entrega';
    return c.tipo;
  }

  function claimsDoFiltro() {
    // Só as da sub-aba ativa (origem). Reivindicações antigas, sem origem, são
    // tratadas como 'veiculo'. A pré-entrega é garantia DE CHASSI — mora na
    // mesma sub-aba do veículo; fosse comparada direto com claimAba, ela
    // sumiria das duas listas.
    var all = FG.all('claims').filter(function (c) {
      var o = c.origem || 'veiculo';
      return claimAba === 'veiculo' ? (o === 'veiculo' || o === 'preentrega') : o === claimAba;
    });
    if (claimFiltro === 'Arquivo') return all.filter(function (c) { return c.status === 'Aprovada' || c.status === 'Recusada'; });
    return all.filter(function (c) { return c.status === claimFiltro; });
  }

  function renderClaims() {
    setCrumb(['Reivindicações']); setTabOn('reivindicacoes');
    var lista = claimFiltro === 'Esboço' ? [] : claimsDoFiltro();
    function distintos(key) { var s = {}; lista.forEach(function (c) { if (c[key]) s[c[key]] = 1; }); return Object.keys(s).sort(); }
    function selFiltro(col, labels, values) {
      return '<select class="cl-filter" data-col="' + col + '"><option value="">Todos</option>' +
        labels.map(function (lab, i) { var v = values ? values[i] : lab; return '<option value="' + esc(v) + '">' + esc(lab) + '</option>'; }).join('') + '</select>';
    }
    var fPaises = distintos('pais'), fTipos = distintos('tipo'), fStatus = distintos('status');

    var ehVarejo = claimAba === 'varejo';
    var html =
      '<div class="claim-subtabs">' +
      '<button class="claim-subtab' + (!ehVarejo ? ' on' : '') + '" data-aba="veiculo">Garantia de Veículo</button>' +
      '<button class="claim-subtab' + (ehVarejo ? ' on' : '') + '" data-aba="varejo">Reivindicação de Varejo</button>' +
      '</div>' +
      '<button class="btn-nova-reiv" id="cl-nova"><span class="plus">＋</span><b>' +
      (ehVarejo ? 'Nova reivindicação de varejo' : 'Nova reivindicação') + '</b></button>' +
      '<div class="side-layout">' +
      '<aside class="side-nav"><h2>Reivindicações</h2>' +
      // Rascunhos ("Esboço") só existem no fluxo de veículo (guardados no
      // navegador); a aba de varejo não os mostra.
      btnNav('Em processo') + (ehVarejo ? '' : btnNav('Esboço')) + btnNav('Arquivo') +
      '</aside>' +
      '<section>' +
      '<div class="toolbar">' +
      '<button class="tool" id="cl-csv">📄 Exportar p/ Excel</button>' +
      '<label class="cl-selall"><input type="checkbox" id="cl-all"> Selecionar todas</label>' +
      '<span class="grow"></span>' +
      '<button class="tool" id="cl-limpar">✖ Limpar filtros</button>' +
      '</div>' +
      '<div class="claim-head"><span>N° da reivindicação</span><span>Data da reivindicação</span>' +
      '<span>Creator Country</span><span>Criador da reivindicação</span><span>Tipo</span><span>Status</span><span></span></div>' +
      '<div class="claim-filters">' +
      '<input class="cl-filter" data-col="numero" placeholder="Filtrar...">' +
      '<input class="cl-filter" data-col="data" placeholder="Filtrar...">' +
      selFiltro('pais', fPaises) +
      '<input class="cl-filter" data-col="criador" placeholder="Filtrar...">' +
      selFiltro('tipo', fTipos) +
      selFiltro('status', fStatus) +
      '<span></span>' +
      '</div>' +
      '<div id="cl-rows"></div>' +
      '</section></div>';

    view.innerHTML = html;

    function btnNav(nome) {
      return '<button class="' + (claimFiltro === nome ? 'on' : '') + '" data-f="' + nome + '">' + nome + '</button>';
    }

    Array.prototype.forEach.call(view.querySelectorAll('.side-nav [data-f]'), function (b) {
      b.addEventListener('click', function () { claimFiltro = b.getAttribute('data-f'); renderClaims(); });
    });

    // Troca de sub-aba (Veículo / Varejo).
    Array.prototype.forEach.call(view.querySelectorAll('.claim-subtab'), function (b) {
      b.addEventListener('click', function () {
        claimAba = b.getAttribute('data-aba');
        if (claimAba === 'varejo' && claimFiltro === 'Esboço') claimFiltro = 'Em processo';
        renderClaims();
      });
    });

    // Aba "Esboço": lista os rascunhos do navegador (não vão ao banco).
    function renderRascunhos(box, q) {
      var l = lerRascunhos().filter(function (d) {
        return !q || ((d.niv || '') + (d.descricao || '') + (d.tipo || '')).toLowerCase().indexOf(q) >= 0;
      });
      if (!l.length) { box.innerHTML = '<p class="muted" style="padding:20px 10px;">Nenhum rascunho salvo. Use "Salvar como esboço" ao criar uma reivindicação.</p>'; return; }
      box.innerHTML = l.map(function (d) {
        var pecasTxt = (d.pecas || []).map(function (p) { return esc(p.sku) + ' ×' + p.quantidade; }).join(', ');
        return '<div class="row-claim rascunho">' +
          '<div><span class="cell-label">Rascunho</span><span class="cell-value">' + esc(d.tipo || '—') + '</span><br>' +
          '<span class="cell-label">Descrição</span><span class="cell-value">' + esc(d.descricao || '(sem descrição)') + '</span>' +
          (pecasTxt ? '<br><span class="cell-label">Peças</span><span class="cell-value">' + pecasTxt + '</span>' : '') + '</div>' +
          '<div><span class="cell-label">NIV</span><span class="cell-value">' + esc(d.niv || '—') + '</span></div>' +
          '<div><span class="cell-label">Data ocorrido</span><span class="cell-value">' + (d.dataDefeito ? FG.fmtDate(d.dataDefeito) : '—') + '</span></div>' +
          '<div class="rasc-acoes"><button class="btn red rasc-edit" data-id="' + esc(d.localId) + '">Editar</button> ' +
          '<button class="btn rasc-del" data-id="' + esc(d.localId) + '">Excluir</button></div></div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.rasc-edit'), function (b) {
        b.addEventListener('click', function () {
          var d = lerRascunhos().find(function (x) { return x.localId === b.getAttribute('data-id'); });
          if (d) modalClaim(d.tipo || 'IT', { modo: 'rascunho', rasc: d });
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('.rasc-del'), function (b) {
        b.addEventListener('click', function () { excluirRascunho(b.getAttribute('data-id')); renderClaims(); });
      });
    }

    // Filtro por coluna (lê os controles do cabeçalho).
    function passaFiltros(c) {
      function g(col) { var el = view.querySelector('.cl-filter[data-col="' + col + '"]'); return el ? el.value.trim().toLowerCase() : ''; }
      var fNum = g('numero'), fData = g('data'), fPais = g('pais'), fCriador = g('criador'),
        fTipo = g('tipo'), fSt = g('status');
      if (fNum && String(c.id || '').toLowerCase().indexOf(fNum) < 0) return false;
      if (fData && FG.fmtDate(c.data).toLowerCase().indexOf(fData) < 0) return false;
      if (fPais && (c.pais || '').toLowerCase() !== fPais) return false;
      if (fCriador && (c.criador || '').toLowerCase().indexOf(fCriador) < 0) return false;
      if (fTipo && (c.tipo || '').toLowerCase() !== fTipo) return false;
      if (fSt && (c.status || '').toLowerCase() !== fSt) return false;
      return true;
    }

    function rows() {
      var box = document.getElementById('cl-rows');
      if (claimFiltro === 'Esboço') { renderRascunhos(box, ''); return; }
      var l = lista.filter(passaFiltros);
      if (!l.length) { box.innerHTML = '<p class="muted" style="padding:20px 10px;">Nenhuma reivindicação neste filtro.</p>'; return; }
      box.innerHTML = l.map(function (c) {
        var devolvida = c.sentBack
          ? '<div class="devolvida-aviso">↩ Devolvida — falta: ' + esc(c.faltaInformacao || 'informações') + '</div>'
          : '';
        return '<div class="row-claim" data-cid="' + esc(c.id) + '">' +
          '<div><label class="cl-check"><input type="checkbox" class="cl-sel" data-cid="' + esc(c.id) + '"></label> ' +
          '<span class="cell-label">N° da reivindicação</span><span class="cell-value cl-num">' + c.id + '</span></div>' +
          '<div><span class="cell-label">Data</span><span class="cell-value">' + FG.fmtDate(c.data) + '</span></div>' +
          '<div><span class="cell-label">Creator Country</span><span class="cell-value">' + esc(c.pais) + '</span></div>' +
          '<div><span class="cell-label">Criado por</span><span class="cell-value">' + esc(c.criador) + '</span>' +
          (c.pecas && c.pecas.length ? '<br><span class="cell-label">Peças</span><span class="cell-value">' + c.pecas.map(function (p) { return esc(p.sku) + ' ×' + p.quantidade; }).join(', ') + '</span>' : '') +
          (c.anexos && c.anexos.length ? ' <span class="muted">📎 ' + c.anexos.length + '</span>' : '') +
          devolvida +
          (c.sentBack ? '<div style="margin-top:6px;"><button class="btn red cl-editar" data-id="' + esc(c.id) + '">Editar e reenviar</button></div>' : '') +
          '</div>' +
          '<div><span class="cell-label">Tipo</span><span class="cell-value">' + esc(rotuloOrigem(c)) + '</span></div>' +
          '<div>' + statusBadge(c.status) + '<br>' +
          (c.origem === 'varejo'
            ? '<span class="cell-label">Pedido</span><a href="#pedido/' + esc(c.numeroPedido) + '">' + esc(c.numeroPedido) + '</a>'
            : '<span class="cell-label">NIV</span><a href="#acoes/' + c.niv + '">' + c.niv + '</a>') +
          '</div>' +
          '<span class="chev">&rsaquo;</span></div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.cl-editar'), function (b) {
        b.addEventListener('click', function () {
          var c = FG.all('claims').find(function (x) { return x.id === b.getAttribute('data-id'); });
          if (c) modalClaim(c.tipo, { modo: 'editar', claim: c });
        });
      });
      // Clique na linha (ou na seta) abre o detalhe — ignora botões/links/checkbox.
      Array.prototype.forEach.call(box.querySelectorAll('.row-claim[data-cid]'), function (row) {
        row.addEventListener('click', function (e) {
          if (e.target.closest('button') || e.target.closest('a') || e.target.closest('label') || e.target.closest('input')) return;
          var c = FG.all('claims').find(function (x) { return x.id === row.getAttribute('data-cid'); });
          if (c) modalClaimDetalhe(c);
        });
      });
    }
    rows();

    // Filtros por coluna: re-renderizam ao digitar/selecionar.
    Array.prototype.forEach.call(view.querySelectorAll('.cl-filter'), function (el) {
      el.addEventListener('input', rows);
      el.addEventListener('change', rows);
    });
    document.getElementById('cl-limpar').addEventListener('click', function () {
      Array.prototype.forEach.call(view.querySelectorAll('.cl-filter'), function (el) { el.value = ''; });
      rows();
    });
    // Exporta as selecionadas (checkbox); sem seleção, exporta as visíveis (filtradas).
    document.getElementById('cl-csv').addEventListener('click', function () {
      var selIds = Array.prototype.map.call(view.querySelectorAll('.cl-sel:checked'), function (x) { return x.getAttribute('data-cid'); });
      var alvo = selIds.length ? lista.filter(function (c) { return selIds.indexOf(c.id) >= 0; }) : lista.filter(passaFiltros);
      if (!alvo.length) { FG.toast('Nada para exportar.'); return; }
      var linhas = [['N°', 'Data', 'Criador', 'País', 'Tipo', 'NIV', 'Status', 'Descrição']];
      alvo.forEach(function (c) { linhas.push([c.id, FG.fmtDate(c.data), c.criador, c.pais, c.tipo, c.niv, c.status, c.descricao]); });
      FG.exportCSV('reivindicacoes', linhas);
    });
    var chkAll = document.getElementById('cl-all');
    if (chkAll) chkAll.addEventListener('change', function () {
      Array.prototype.forEach.call(view.querySelectorAll('.cl-sel'), function (x) { x.checked = chkAll.checked; });
    });
    document.getElementById('cl-nova').addEventListener('click', function () {
      if (claimAba === 'varejo') modalClaimVarejo();
      else modalClaim('Manufacturer');
    });
  }

  /* ---------------------------------------------------------
     FOTOS E VÍDEOS DA REIVINDICAÇÃO
     ---------------------------------------------------------
     Um seletor para os dois formulários (veículo e varejo). O <input
     type="file"> sozinho tinha três defeitos: cada nova escolha APAGAVA a
     anterior, não havia como tirar um arquivo escolhido por engano e a
     miniatura não abria. Aqui a lista é nossa: cada escolha soma à lista (até
     MAX_MIDIA), cada miniatura tem um X e abre em tela cheia. A API confere o
     mesmo limite (api/src/routes/reivindicacoes.routes.js).
     --------------------------------------------------------- */
  var MAX_MIDIA = 5;
  var RE_VIDEO = /\.(mp4|webm|mov|avi|mkv|m4v|3gp|ogv|mpe?g)$/i;
  function ehVideo(f) { return (f.type || '').indexOf('video/') === 0 || RE_VIDEO.test(f.name || ''); }

  // Foto/vídeo em tela cheia, por cima do formulário (que continua aberto e
  // intacto embaixo). Fecha só no X, como os demais pop-ups do portal.
  function abrirVisualizador(url, video, nome) {
    var tela = document.createElement('div');
    tela.className = 'midia-viewer';
    tela.setAttribute('role', 'dialog');
    tela.setAttribute('aria-label', nome || 'Visualizar arquivo');
    var caixa = document.createElement('div');
    caixa.className = 'midia-viewer-box';
    var midia = document.createElement(video ? 'video' : 'img');
    if (video) { midia.controls = true; midia.autoplay = true; } else midia.alt = nome || '';
    midia.src = url;
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'midia-viewer-x';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Fechar');
    x.addEventListener('click', function () {
      if (video) midia.pause();
      tela.remove();
    });
    caixa.appendChild(midia);
    caixa.appendChild(x);
    tela.appendChild(caixa);
    document.body.appendChild(tela);
    x.focus();
  }

  // Liga o seletor aos elementos do formulário. Devolve arquivos() para o
  // envio e liberar() para soltar as URLs de blob quando o formulário fecha.
  function montarSeletorMidia(input, galeria, contador, dica) {
    var itens = [];   // { arquivo: File, url: URL de blob da prévia }
    function chave(f) { return f.name + '|' + f.size + '|' + f.lastModified; }

    function desenhar() {
      galeria.innerHTML = '';
      itens.forEach(function (it, i) {
        var video = ehVideo(it.arquivo);
        var abrir = function () { abrirVisualizador(it.url, video, it.arquivo.name); };
        var cel = document.createElement('div');
        cel.className = 'media-item' + (video ? ' is-video' : '');
        cel.title = it.arquivo.name + ' — clique para ampliar';
        cel.tabIndex = 0;
        cel.setAttribute('role', 'button');
        var m = document.createElement(video ? 'video' : 'img');
        if (video) { m.muted = true; m.preload = 'metadata'; } else m.alt = it.arquivo.name;
        m.src = it.url;
        cel.appendChild(m);
        if (video) {
          var pl = document.createElement('span');
          pl.className = 'play';
          pl.textContent = '▶';
          cel.appendChild(pl);
        }
        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'midia-x';
        x.textContent = '×';
        x.title = 'Remover este arquivo';
        x.setAttribute('aria-label', 'Remover ' + it.arquivo.name);
        x.addEventListener('click', function (e) {
          e.stopPropagation();          // não abre o visualizador
          URL.revokeObjectURL(it.url);
          itens.splice(i, 1);
          desenhar();
        });
        cel.appendChild(x);
        cel.addEventListener('click', abrir);
        cel.addEventListener('keydown', function (e) {
          if (e.target === cel && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir(); }
        });
        galeria.appendChild(cel);
      });
      contador.textContent = '(' + itens.length + ' de ' + MAX_MIDIA + ')';
      var cheio = itens.length >= MAX_MIDIA;
      input.disabled = cheio;
      dica.textContent = cheio
        ? 'Limite atingido. Para trocar um arquivo, remova-o no ×.'
        : 'Até ' + MAX_MIDIA + ' fotos ou vídeos. Clique na miniatura para ampliar.';
    }

    input.addEventListener('change', function () {
      var novos = Array.prototype.slice.call(input.files || []);
      // Zera o campo: a lista de verdade é `itens`, e assim dá para escolher
      // de novo um arquivo que acabou de ser removido.
      input.value = '';
      var vistos = {};
      itens.forEach(function (it) { vistos[chave(it.arquivo)] = true; });
      var foraDoLimite = 0;
      novos.forEach(function (f) {
        if (vistos[chave(f)]) return;   // o mesmo arquivo escolhido duas vezes
        if (itens.length >= MAX_MIDIA) { foraDoLimite++; return; }
        vistos[chave(f)] = true;
        itens.push({ arquivo: f, url: URL.createObjectURL(f) });
      });
      if (foraDoLimite) {
        FG.toast('Limite de ' + MAX_MIDIA + ' fotos ou vídeos por envio — ' +
          foraDoLimite + ' arquivo(s) ficaram de fora.', 'erro');
      }
      desenhar();
    });
    desenhar();

    return {
      arquivos: function () { return itens.map(function (it) { return it.arquivo; }); },
      liberar: function () {
        itens.forEach(function (it) { URL.revokeObjectURL(it.url); });
        itens = [];
      }
    };
  }

  // Campo de fotos/vídeos dos dois formulários. `p` é o prefixo dos ids.
  function campoMidiaHtml(p) {
    return '<div class="field"><label for="' + p + '-fotos">Fotos e vídeos da peça defeituosa ' +
      '<span class="midia-cont" id="' + p + '-fotos-cont"></span></label>' +
      '<input id="' + p + '-fotos" type="file" accept="image/*,video/*" multiple>' +
      '<div class="muted midia-dica" id="' + p + '-fotos-dica"></div>' +
      '<div id="' + p + '-fotos-prev" class="media-gallery"></div></div>';
  }
  function seletorMidiaDe(p) {
    return montarSeletorMidia(document.getElementById(p + '-fotos'), document.getElementById(p + '-fotos-prev'),
      document.getElementById(p + '-fotos-cont'), document.getElementById(p + '-fotos-dica'));
  }

  function modalClaim(tipoPadrao, ctx) {
    var vehs = FG.all('vehicles');
    var pre = ctx && (ctx.rasc || ctx.claim);
    var modo = (ctx && ctx.modo) || 'novo';
    var titulo = ctx && ctx.claim ? 'Editar reivindicação ' + ctx.claim.id
      : (ctx && ctx.rasc ? 'Editar rascunho' : 'Nova reivindicação');
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + esc(titulo) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field" id="nc-tipo-campo"><label>Tipo</label><select id="nc-tipo">' +
      ['Manufacturer', 'Implícito'].map(function (t) {
        return '<option' + (t === tipoPadrao ? ' selected' : '') + '>' + t + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>NIV do veículo *</label><select id="nc-niv">' +
      vehs.map(function (v) {
        return '<option value="' + v.niv + '">' + v.niv + ' — ' + esc(modelName(v.modeloId)) +
          (v.venda ? '' : ' (em estoque)') + '</option>';
      }).join('') +
      '</select></div>' +
      // Aviso do modo pré-entrega. Nasce escondido e só aparece quando o chassi
      // escolhido ainda não tem venda registrada — o cliente não escolhe este
      // modo, ele decorre do estado da moto.
      '<div class="pre-entrega-aviso hidden" id="nc-pe-aviso">' +
      '<b class="pe-titulo">🛠 Garantia de pré-entrega</b>' +
      '<span>Este chassi ainda não tem venda registrada, então a reivindicação será aberta como ' +
      '<b>pré-entrega</b>: o defeito foi constatado na inspeção, com a moto ainda no seu estoque. ' +
      'O prazo de garantia do comprador não começa a contar por causa disso — ele só passa a correr ' +
      'quando você registrar a venda.</span></div>' +
      '<div class="field"><label>Peça(s) defeituosa(s) *</label>' +
      '<div class="peca-add">' +
      // Autocomplete PRÓPRIO (dropdown estilizado) — o datalist nativo herdava
      // o visual do sistema operacional e destoava do resto do portal.
      '<div class="ac-wrap"><input id="nc-peca" autocomplete="off" placeholder="Digite o código ou o nome da peça">' +
      '<div class="ac-list hidden" id="nc-peca-ac"></div></div>' +
      '<input id="nc-peca-qtd" type="number" min="1" step="1" value="1" title="Quantidade">' +
      '<button type="button" class="btn" id="nc-peca-add">Adicionar</button>' +
      '</div>' +
      '<div id="nc-peca-info" class="muted" style="font-size:11px;margin-top:4px;"></div>' +
      '<div id="nc-pecas-list" class="pecas-list"></div></div>' +
      '<div class="form-grid">' +
      '<div class="field"><label id="nc-data-lbl">Data do ocorrido *</label><input id="nc-data" type="date"></div>' +
      '<div class="field" id="nc-horas-campo"><label>Horas de operação</label><input id="nc-horas" type="number" min="0" step="1" placeholder="ex.: 120"></div>' +
      '<div class="field" id="nc-km-campo"><label>Quilometragem (km)</label><input id="nc-km" type="number" min="0" step="1" placeholder="ex.: 3500"></div>' +
      '</div>' +
      '<div class="field"><label>Descrição do problema *</label><textarea id="nc-desc" rows="4" placeholder="Descreva o defeito constatado..."></textarea></div>' +
      campoMidiaHtml('nc') +
      '</div>' +
      '<div class="modal-foot"><button class="btn" id="nc-rasc">Salvar como esboço</button>' +
      '<button class="btn red" id="nc-env">Enviar reivindicação</button></div></div>';
    document.body.appendChild(back);
    var midia = seletorMidiaDe('nc');

    function fechar() { midia.liberar(); back.remove(); }
    // Só o X fecha o formulário — clicar no fundo escuro NÃO fecha, para o
    // cliente não perder o que preencheu por um clique fora sem querer.
    back.querySelector('.x').addEventListener('click', fechar);

    /* ---------------------------------------------------------
       MODO PRÉ-ENTREGA
       ---------------------------------------------------------
       Não é uma opção na tela: é o estado da moto que decide. Chassi sem venda
       registrada = a inspeção que antecede a entrega, então o formulário se
       ajusta sozinho — tira o Tipo (defeito de moto zero é de fábrica, não há
       o que classificar), tira horas e quilometragem (não rodou) e troca o
       rótulo da data. Registrada a venda, o mesmo formulário volta ao normal.
       --------------------------------------------------------- */
    var selNiv = document.getElementById('nc-niv');
    var avisoPE = document.getElementById('nc-pe-aviso');
    var campoTipo = document.getElementById('nc-tipo-campo');
    var campoHoras = document.getElementById('nc-horas-campo');
    var campoKm = document.getElementById('nc-km-campo');
    var lblData = document.getElementById('nc-data-lbl');

    function ehPreEntrega() {
      var v = vehs.find(function (x) { return x.niv === selNiv.value; });
      return !!v && !v.venda;
    }
    function aplicarModo() {
      var pe = ehPreEntrega();
      avisoPE.classList.toggle('hidden', !pe);
      campoTipo.classList.toggle('hidden', pe);
      campoHoras.classList.toggle('hidden', pe);
      campoKm.classList.toggle('hidden', pe);
      lblData.textContent = pe ? 'Data da inspeção *' : 'Data do ocorrido *';
    }
    selNiv.addEventListener('change', aplicarModo);

    // Consultor de peças: resolve o que foi digitado para um SKU do catálogo.
    // Retorna '' (vazio), o SKU (válido) ou null (digitado mas não encontrado).
    function resolverPeca() {
      var v = document.getElementById('nc-peca').value.trim();
      if (!v) return '';
      var sku = v.split(' — ')[0].trim().toLowerCase();
      var p = FG.all('products').find(function (x) {
        return x.artigo.toLowerCase() === sku || (x.artigo + ' — ' + x.nome) === v;
      });
      return p ? p.artigo : null;
    }
    // Feedback ao vivo: mostra a peça cadastrada conforme o cliente digita.
    var pecaInfo = document.getElementById('nc-peca-info');
    var inpPeca = document.getElementById('nc-peca');
    function atualizarInfo() {
      var v = inpPeca.value.trim();
      if (!v) { pecaInfo.textContent = ''; pecaInfo.style.color = ''; return; }
      var sku = resolverPeca();
      if (sku) {
        var p = FG.product(sku);
        pecaInfo.style.color = 'var(--green)';
        pecaInfo.textContent = '✔ ' + p.artigo + ' — ' + p.nome + ' · ' + FG.fmtMoney(p.preco);
      } else {
        pecaInfo.style.color = '';
        pecaInfo.textContent = 'Selecione uma peça da lista (código cadastrado).';
      }
    }

    // --- Autocomplete próprio: dropdown com até 8 sugestões (código OU nome).
    // Setas navegam, Enter escolhe, Esc fecha; clicar também escolhe.
    var ac = document.getElementById('nc-peca-ac');
    var acItens = [], acIdx = -1;
    function acFechar() { ac.classList.add('hidden'); ac.innerHTML = ''; acItens = []; acIdx = -1; }
    function acMarcar(n) {
      acIdx = n;
      Array.prototype.forEach.call(ac.querySelectorAll('.ac-item'), function (el, i) {
        el.classList.toggle('on', i === acIdx);
        if (i === acIdx) el.scrollIntoView({ block: 'nearest' });
      });
    }
    function acEscolher(i) {
      var p = acItens[i]; if (!p) return;
      inpPeca.value = p.artigo + ' — ' + p.nome;
      acFechar(); atualizarInfo();
      document.getElementById('nc-peca-qtd').focus();
    }
    function acAbrir() {
      var t = inpPeca.value.trim().toLowerCase();
      if (t.length < 2) { acFechar(); return; }
      acItens = FG.all('products').filter(function (p) {
        return p.artigo.toLowerCase().indexOf(t) >= 0 || p.nome.toLowerCase().indexOf(t) >= 0;
      }).slice(0, 8);
      if (!acItens.length) { acFechar(); return; }
      acIdx = -1;
      ac.innerHTML = acItens.map(function (p, i) {
        return '<div class="ac-item" data-i="' + i + '"><b>' + esc(p.artigo) + '</b><span class="ac-nome">' +
          esc(p.nome) + '</span><span class="ac-preco">' + FG.fmtMoney(p.preco) + '</span></div>';
      }).join('');
      ac.classList.remove('hidden');
      Array.prototype.forEach.call(ac.querySelectorAll('.ac-item'), function (el) {
        // mousedown (não click): dispara antes do blur do input fechar a lista.
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          acEscolher(Number(el.getAttribute('data-i')));
        });
      });
    }
    inpPeca.addEventListener('input', function () { acAbrir(); atualizarInfo(); });
    inpPeca.addEventListener('keydown', function (e) {
      if (ac.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); acMarcar(Math.min(acItens.length - 1, acIdx + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); acMarcar(Math.max(0, acIdx - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); acEscolher(acIdx >= 0 ? acIdx : 0); }
      else if (e.key === 'Escape') acFechar();
    });
    inpPeca.addEventListener('blur', function () { setTimeout(acFechar, 150); });

    // --- Peças defeituosas: lista dinâmica (código + quantidade) ---
    var pecas = [];
    var pecasBox = document.getElementById('nc-pecas-list');
    function renderPecas() {
      if (!pecas.length) {
        pecasBox.innerHTML = '<span class="muted" style="font-size:12px;">Nenhuma peça adicionada.</span>';
        return;
      }
      pecasBox.innerHTML = pecas.map(function (p) {
        return '<div class="peca-row"><span>' + esc(p.sku) + ' — ' + esc(p.nome) +
          ' <b>×' + p.quantidade + '</b></span>' +
          '<button type="button" class="peca-del" data-sku="' + esc(p.sku) + '" title="Remover">×</button></div>';
      }).join('');
      Array.prototype.forEach.call(pecasBox.querySelectorAll('.peca-del'), function (b) {
        b.addEventListener('click', function () {
          var sku = b.getAttribute('data-sku');
          pecas = pecas.filter(function (x) { return x.sku !== sku; });
          renderPecas();
        });
      });
    }
    // Prefill quando editando um rascunho ou uma reivindicação devolvida.
    if (pre) {
      var selTipo = document.getElementById('nc-tipo');
      if (pre.tipo) {
        // Garante que o tipo original apareça (inclusive legados, ex.: IT).
        if (!Array.prototype.some.call(selTipo.options, function (o) { return o.value === pre.tipo; })) {
          var op = document.createElement('option'); op.value = pre.tipo; op.textContent = pre.tipo; selTipo.appendChild(op);
        }
        selTipo.value = pre.tipo;
      }
      // Tipo é imutável a partir do 1º envio — trava ao editar reivindicação.
      if (modo === 'editar') selTipo.disabled = true;
      if (pre.niv) document.getElementById('nc-niv').value = pre.niv;
      document.getElementById('nc-data').value = pre.dataDefeito || '';
      document.getElementById('nc-horas').value = (pre.horimetro != null ? pre.horimetro : '');
      document.getElementById('nc-km').value = (pre.quilometragem != null ? pre.quilometragem : '');
      document.getElementById('nc-desc').value = pre.descricao || '';
      pecas = (pre.pecas || []).map(function (p) {
        var prod = FG.product(p.sku);
        return { sku: p.sku, nome: p.nome || (prod ? prod.nome : ''), quantidade: p.quantidade };
      });
    }
    // Depois do prefill: o modo é recalculado a partir do chassi selecionado,
    // valendo tanto para o formulário em branco quanto para rascunho e reenvio.
    aplicarModo();
    renderPecas();
    document.getElementById('nc-peca-add').addEventListener('click', function () {
      var sku = resolverPeca();
      if (!sku) { FG.toast('Selecione uma peça válida da lista.', 'erro'); return; }
      var q = Math.max(1, parseInt(document.getElementById('nc-peca-qtd').value, 10) || 1);
      var p = FG.product(sku);
      var ex = pecas.find(function (x) { return x.sku === sku; });
      if (ex) ex.quantidade = q; else pecas.push({ sku: sku, nome: p.nome, quantidade: q });
      document.getElementById('nc-peca').value = '';
      document.getElementById('nc-peca-qtd').value = '1';
      pecaInfo.textContent = '';
      renderPecas();
    });

    // Coleta os campos do formulário no formato da API. No modo pré-entrega,
    // horas e quilometragem vão vazias (a moto não rodou) e a origem acompanha
    // — quem confere a regra "sem venda registrada" é a API, não esta tela.
    function coletar() {
      var pe = ehPreEntrega();
      return {
        origem: pe ? 'preentrega' : undefined,
        tipo: document.getElementById('nc-tipo').value,
        niv: selNiv.value,
        descricao: document.getElementById('nc-desc').value.trim(),
        dataDefeito: document.getElementById('nc-data').value || null,
        horimetro: pe ? null : (document.getElementById('nc-horas').value || null),
        quilometragem: pe ? null : (document.getElementById('nc-km').value || null),
        pecas: pecas.map(function (p) { return { sku: p.sku, quantidade: p.quantidade }; })
      };
    }
    // Validação obrigatória ao ENVIAR (NIV, peças, data e descrição).
    function validarEnvio(d) {
      if (!d.niv) { FG.toast('Selecione o NIV do veículo.', 'erro'); return false; }
      if (!pecas.length) { FG.toast('Adicione ao menos uma peça defeituosa.', 'erro'); return false; }
      if (!d.dataDefeito) {
        FG.toast(ehPreEntrega() ? 'Informe a data da inspeção.' : 'Informe a data do ocorrido.', 'erro');
        return false;
      }
      if (!d.descricao) { FG.toast('Descreva o problema.', 'erro'); return false; }
      return true;
    }

    // ENVIAR: cria (novo/rascunho) ou atualiza+reenvia (editar). Sobe as fotos.
    // Durante o envio, uma cortina cobre o modal com um carregamento breve e,
    // no sucesso, a confirmação de que a garantia será avaliada pela equipe.
    document.getElementById('nc-env').addEventListener('click', async function () {
      var d = coletar();
      if (!validarEnvio(d)) return;

      // A cortina cobre o overlay INTEIRO (não o .modal, que rola): assim a
      // mensagem fica sempre centralizada na tela, mesmo com o formulário longo
      // rolado. Um card branco no centro dá destaque à confirmação.
      var cortina = document.createElement('div');
      cortina.className = 'claim-envio';
      cortina.innerHTML = '<div class="claim-envio-card"><div class="fg-spinner"></div>' +
        '<p><b>Enviando sua garantia…</b></p></div>';
      back.appendChild(cortina);

      // Espera mínima de ~1,1s: sem ela a cortina "pisca" e o cliente não
      // percebe que o envio aconteceu.
      var minimo = new Promise(function (r) { setTimeout(r, 1100); });
      var c;
      if (modo === 'editar') {
        c = await FG.updateClaim(ctx.claim.id, d);
      } else {
        d.status = 'Em processo';
        d.criador = sess.empresa;
        c = await FG.createClaim(d);
      }
      if (!c) { cortina.remove(); return; }   // a API já avisou o erro; o form fica intacto
      var arquivos = midia.arquivos();
      if (arquivos.length) {
        var up = await FG.uploadClaimFotos(c.id, arquivos);
        if (!up.ok) FG.toast(up.msg || 'Salvo, mas falhou o envio das fotos.', 'erro');
      }
      await minimo;
      if (modo === 'rascunho' && ctx.rasc) excluirRascunho(ctx.rasc.localId);

      cortina.innerHTML =
        '<div class="claim-envio-card ok">' +
        '<div class="claim-ok">✔</div>' +
        '<h3>Garantia enviada!</h3>' +
        '<p>Sua reivindicação <b>' + esc(c.id) + '</b> foi registrada e será avaliada por ' +
        'nossos representantes. Acompanhe o andamento na aba Reivindicações.</p>' +
        '<button class="btn red" id="nc-ok-fechar">Entendi</button>' +
        '</div>';
      // Fica visível por ~5s (tempo de sobra p/ ler) ou até clicar em "Entendi".
      function concluir() {
        if (!back.parentNode) return;
        fechar();
        claimFiltro = 'Em processo';
        renderClaims();
      }
      document.getElementById('nc-ok-fechar').addEventListener('click', concluir);
      setTimeout(concluir, 5000);
    });

    // SALVAR COMO ESBOÇO: grava no navegador (não vai ao banco). Some ao editar
    // uma reivindicação já enviada.
    var rascBtn = document.getElementById('nc-rasc');
    if (modo === 'editar') { rascBtn.style.display = 'none'; }
    else rascBtn.addEventListener('click', function () {
      var d = coletar();
      if (!d.descricao && !pecas.length && !d.niv) { FG.toast('Nada para salvar no rascunho.'); return; }
      gravarRascunho({
        localId: (ctx && ctx.rasc && ctx.rasc.localId) || null,
        tipo: d.tipo, niv: d.niv, descricao: d.descricao,
        dataDefeito: d.dataDefeito, horimetro: d.horimetro, quilometragem: d.quilometragem,
        pecas: pecas.map(function (p) { return { sku: p.sku, nome: p.nome, quantidade: p.quantidade }; }),
        criadoEm: new Date().toISOString()
      });
      fechar();
      claimFiltro = 'Esboço';
      FG.toast('Rascunho salvo.');
      renderClaims();
    });
  }

  // Modal de NOVA reivindicação de VAREJO: garantia de peça de um PEDIDO. O
  // revendedor escolhe um pedido seu; a lista de peças oferece SOMENTE os itens
  // daquele pedido. Sem NIV/prazo. Mesma estrutura (descrição + fotos/vídeos).
  function modalClaimVarejo() {
    // Só pedidos de venda (exclui reposições de garantia). Cliente já vê apenas
    // os seus; admin vê todos.
    var orders = FG.all('orders').filter(function (o) { return !o.garantia; });
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Nova reivindicação de varejo</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Pedido *</label><select id="vj-pedido">' +
      '<option value="">Selecione um pedido…</option>' +
      orders.map(function (o) {
        return '<option value="' + esc(o.id) + '">' + esc(o.id) + ' — ' + FG.fmtDate(o.data) + '</option>';
      }).join('') +
      '</select>' +
      (orders.length ? '' : '<div class="muted" style="font-size:11px;margin-top:4px;">Você ainda não tem pedidos de venda.</div>') +
      '</div>' +
      '<div class="field"><label>Peça(s) do pedido *</label>' +
      '<div class="peca-add">' +
      '<select id="vj-item" disabled><option value="">Escolha o pedido primeiro</option></select>' +
      '<input id="vj-qtd" type="number" min="1" step="1" value="1" title="Quantidade">' +
      '<button type="button" class="btn" id="vj-add" disabled>Adicionar</button>' +
      '</div>' +
      '<div id="vj-qtd-max" class="muted" style="font-size:11px;margin-top:4px;"></div>' +
      '<div id="vj-pecas-list" class="pecas-list"></div></div>' +
      '<div class="field"><label>Descrição do problema *</label><textarea id="vj-desc" rows="4" placeholder="Descreva o defeito constatado..."></textarea></div>' +
      campoMidiaHtml('vj') +
      '</div>' +
      '<div class="modal-foot"><button class="btn red" id="vj-env">Enviar reivindicação</button></div></div>';
    document.body.appendChild(back);
    var midia = seletorMidiaDe('vj');

    function fechar() { midia.liberar(); back.remove(); }
    // Só o X fecha (não perde o preenchimento por clique fora) — igual ao veículo.
    back.querySelector('.x').addEventListener('click', fechar);

    var selPedido = document.getElementById('vj-pedido');
    var selItem = document.getElementById('vj-item');
    var btnAdd = document.getElementById('vj-add');
    var inpQtd = document.getElementById('vj-qtd');
    var hintQtd = document.getElementById('vj-qtd-max');
    var pecasBox = document.getElementById('vj-pecas-list');
    var pecas = [];

    // Itens do pedido escolhido (SKUs disponíveis para reivindicar).
    function itensDoPedido() {
      var o = orders.find(function (x) { return x.id === selPedido.value; });
      return (o && o.itens) || [];
    }

    // Item atualmente selecionado no seletor de peça (ou null).
    function itemSelecionado() {
      var sku = selItem.value;
      if (!sku) return null;
      return itensDoPedido().find(function (x) { return x.artigo === sku; }) || null;
    }

    // Teto = a quantidade comprada daquele item no pedido. Não se pode
    // reivindicar mais peças do que se comprou. Ajusta o max do campo, o texto
    // de ajuda e reduz o valor digitado se ele passar do teto.
    function atualizarMaxQtd() {
      var it = itemSelecionado();
      var max = it ? (it.qtd || 1) : 1;
      inpQtd.max = max;
      if ((parseInt(inpQtd.value, 10) || 0) > max) inpQtd.value = max;
      hintQtd.textContent = it
        ? 'Máximo para esta peça: ' + max + ' un. (quantidade do pedido).'
        : '';
    }
    function renderPecas() {
      if (!pecas.length) {
        pecasBox.innerHTML = '<span class="muted" style="font-size:12px;">Nenhuma peça adicionada.</span>';
        return;
      }
      pecasBox.innerHTML = pecas.map(function (p) {
        return '<div class="peca-row"><span>' + esc(p.sku) + ' — ' + esc(p.nome) +
          ' <b>×' + p.quantidade + '</b></span>' +
          '<button type="button" class="peca-del" data-sku="' + esc(p.sku) + '" title="Remover">×</button></div>';
      }).join('');
      Array.prototype.forEach.call(pecasBox.querySelectorAll('.peca-del'), function (b) {
        b.addEventListener('click', function () {
          var sku = b.getAttribute('data-sku');
          pecas = pecas.filter(function (x) { return x.sku !== sku; });
          renderPecas();
        });
      });
    }
    renderPecas();

    // Trocar o pedido: recarrega os itens no seletor e zera as peças escolhidas.
    selPedido.addEventListener('change', function () {
      pecas = []; renderPecas();
      var itens = itensDoPedido();
      if (!selPedido.value || !itens.length) {
        selItem.innerHTML = '<option value="">' + (selPedido.value ? 'Pedido sem itens' : 'Escolha o pedido primeiro') + '</option>';
        selItem.disabled = true; btnAdd.disabled = true;
        return;
      }
      selItem.innerHTML = itens.map(function (it) {
        return '<option value="' + esc(it.artigo) + '">' + esc(it.artigo) + ' — ' + esc(it.nome) + '</option>';
      }).join('');
      selItem.disabled = false; btnAdd.disabled = false;
      atualizarMaxQtd();
    });

    // Trocar a peça atualiza o teto da quantidade; digitar acima do teto corta.
    selItem.addEventListener('change', atualizarMaxQtd);
    inpQtd.addEventListener('input', function () {
      var it = itemSelecionado();
      var max = it ? (it.qtd || 1) : 1;
      if ((parseInt(inpQtd.value, 10) || 0) > max) {
        inpQtd.value = max;
        FG.toast('Máximo para esta peça: ' + max + ' un. (quantidade do pedido).', 'erro');
      }
    });

    document.getElementById('vj-add').addEventListener('click', function () {
      var sku = selItem.value;
      if (!sku) { FG.toast('Selecione uma peça do pedido.', 'erro'); return; }
      var it = itensDoPedido().find(function (x) { return x.artigo === sku; });
      if (!it) { FG.toast('Peça não pertence ao pedido.', 'erro'); return; }
      var max = it.qtd || 1;
      var q = Math.max(1, parseInt(inpQtd.value, 10) || 1);
      if (q > max) { q = max; FG.toast('Máximo para esta peça: ' + max + ' un. (quantidade do pedido).', 'erro'); }
      var ex = pecas.find(function (x) { return x.sku === sku; });
      if (ex) ex.quantidade = q; else pecas.push({ sku: sku, nome: it.nome, quantidade: q });
      inpQtd.value = '1';
      renderPecas();
    });

    document.getElementById('vj-env').addEventListener('click', async function () {
      var numeroPedido = selPedido.value;
      var descricao = document.getElementById('vj-desc').value.trim();
      if (!numeroPedido) { FG.toast('Selecione o pedido.', 'erro'); return; }
      if (!pecas.length) { FG.toast('Adicione ao menos uma peça do pedido.', 'erro'); return; }
      if (!descricao) { FG.toast('Descreva o problema.', 'erro'); return; }

      var cortina = document.createElement('div');
      cortina.className = 'claim-envio';
      cortina.innerHTML = '<div class="claim-envio-card"><div class="fg-spinner"></div>' +
        '<p><b>Enviando sua garantia…</b></p></div>';
      back.appendChild(cortina);
      var minimo = new Promise(function (r) { setTimeout(r, 1100); });

      var c = await FG.createClaim({
        origem: 'varejo', numeroPedido: numeroPedido, descricao: descricao,
        pecas: pecas.map(function (p) { return { sku: p.sku, quantidade: p.quantidade }; }),
        status: 'Em processo'
      });
      if (!c) { cortina.remove(); return; }   // a API já avisou o erro; o form fica intacto
      var arquivos = midia.arquivos();
      if (arquivos.length) {
        var up = await FG.uploadClaimFotos(c.id, arquivos);
        if (!up.ok) FG.toast(up.msg || 'Salvo, mas falhou o envio das fotos.', 'erro');
      }
      await minimo;

      cortina.innerHTML =
        '<div class="claim-envio-card ok">' +
        '<div class="claim-ok">✔</div>' +
        '<h3>Garantia enviada!</h3>' +
        '<p>Sua reivindicação <b>' + esc(c.id) + '</b> foi registrada e será avaliada por ' +
        'nossos representantes. Acompanhe o andamento na aba Reivindicações.</p>' +
        '<button class="btn red" id="vj-ok-fechar">Entendi</button>' +
        '</div>';
      function concluir() {
        if (!back.parentNode) return;
        fechar();
        claimAba = 'varejo'; claimFiltro = 'Em processo';
        renderClaims();
      }
      document.getElementById('vj-ok-fechar').addEventListener('click', concluir);
      setTimeout(concluir, 5000);
    });
  }

  // Modal de VISUALIZAÇÃO (somente leitura) de uma reivindicação.
  function modalClaimDetalhe(c) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    var uso = [];
    if (c.horimetro != null) uso.push(c.horimetro + ' h');
    if (c.quilometragem != null) uso.push(c.quilometragem + ' km');
    var pecas = (c.pecas || []).map(function (p) {
      return '<div class="peca-row"><span>' + esc(p.sku) + ' — ' + esc(p.nome) + ' <b>×' + p.quantidade + '</b></span></div>';
    }).join('') || '<span class="muted">—</span>';
    // data-arquivo (em vez de src/href): o arquivo é privado e vem por fetch
    // autenticado. FG.carregarArquivos() preenche depois de montar o HTML.
    function anexoThumb(a) {
      var video = (a.tipo && a.tipo.indexOf('video/') === 0) || /\.(mp4|webm|mov|avi|mkv|m4v|3gp|ogv|mpe?g)$/i.test(a.url || a.nome || '');
      var inner = video
        ? '<video data-arquivo="' + esc(a.url) + '" muted preload="metadata"></video><span class="play">▶</span>'
        : '<img data-arquivo="' + esc(a.url) + '" alt="' + esc(a.nome || 'foto') + '">';
      return '<a class="media-item' + (video ? ' is-video' : '') + '" data-arquivo="' + esc(a.url) + '" target="_blank" rel="noopener">' + inner + '</a>';
    }
    var fotos = (c.anexos && c.anexos.length)
      ? '<div class="media-gallery">' + c.anexos.map(anexoThumb).join('') + '</div>'
      : '<span class="muted">Sem fotos ou vídeos</span>';
    function linha(rot, val) { return '<div><span class="cell-label">' + rot + '</span><span class="cell-value">' + val + '</span></div>'; }
    back.innerHTML =
      '<div class="modal"><header><h3>Reivindicação ' + esc(c.id) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      (c.sentBack ? '<div class="devolvida-aviso">↩ Devolvida — falta: ' + esc(c.faltaInformacao || 'informações') + '</div>' : '') +
      (c.status === 'Aprovada' ? '<div class="det-credito">✔ Garantia aprovada — as peças serão repostas sem cobrança ' +
        'por um pedido de garantia. Acompanhe na área de pedidos.</div>' : '') +
      '<div class="det-grid">' +
      linha('N° da reivindicação', '<b class="cl-num">' + esc(c.id) + '</b>') +
      linha('Status', esc(c.status)) +
      (c.origem === 'varejo'
        ? linha('Origem', 'Varejo (peça de pedido)') +
          linha('Pedido', '<a href="#pedido/' + esc(c.numeroPedido) + '">' + esc(c.numeroPedido) + '</a>') +
          linha('Criador', esc(c.criador || '—')) +
          linha('Data da reivindicação', FG.fmtDateTime(c.data))
        : c.origem === 'preentrega'
          // Pré-entrega: a moto não rodou, então "Uso" (horas/km) não diz nada
          // e sai da ficha; a data é a da inspeção, não a de um defeito em uso.
          ? linha('Origem', 'Pré-entrega (moto ainda no estoque)') +
            linha('NIV', esc(c.niv || '—')) +
            linha('Criador', esc(c.criador || '—')) +
            linha('Data da reivindicação', FG.fmtDateTime(c.data)) +
            linha('Data da inspeção', c.dataDefeito ? FG.fmtDate(c.dataDefeito) : '—')
          : linha('Tipo', esc(c.tipo)) +
            linha('NIV', esc(c.niv || '—')) +
            linha('Criador', esc(c.criador || '—')) +
            linha('Data da reivindicação', FG.fmtDateTime(c.data)) +
            linha('Data do ocorrido', c.dataDefeito ? FG.fmtDate(c.dataDefeito) : '—') +
            linha('Uso', uso.length ? uso.join(' / ') : '—')) +
      '</div>' +
      '<div class="field"><label>Peça(s) defeituosa(s)</label><div class="pecas-list">' + pecas + '</div></div>' +
      '<div class="field"><label>Descrição</label><div class="cell-value">' + esc(c.descricao || '—') + '</div></div>' +
      '<div class="field"><label>Fotos e vídeos</label>' + fotos + '</div>' +
      '</div>' +
      '<div class="modal-foot">' +
      (c.sentBack ? '<button class="btn red" id="det-editar">Editar e reenviar</button>' : '') +
      '<button class="btn-line" id="det-fechar">Fechar</button></div></div>';
    document.body.appendChild(back);
    FG.carregarArquivos(back);       // busca as fotos/vídeos protegidos
    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('det-fechar').addEventListener('click', fechar);
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).
    var ed = document.getElementById('det-editar');
    if (ed) ed.addEventListener('click', function () { fechar(); modalClaim(c.tipo, { modo: 'editar', claim: c }); });
  }

  /* =========================================================
     PEDIDOS
     ========================================================= */
  var pedFiltro = 'Ordens pendentes';

  function renderPedidos() {
    setCrumb(['Pedidos']); setTabOn('pedidos');
    var html =
      '<div class="side-layout">' +
      '<aside class="side-nav"><h2>Gestão de pedidos</h2>' +
      '<div class="group-title">Cestas</div>' + nav('Cesta atual') +
      '<div class="group-title">Pedidos</div>' + nav('Ordens pendentes') + nav('Arquivado') +
      '</aside>' +
      '<section id="ped-body"></section></div>';
    view.innerHTML = html;

    function nav(n) { return '<button class="' + (pedFiltro === n ? 'on' : '') + '" data-f="' + n + '">' + n + '</button>'; }

    Array.prototype.forEach.call(view.querySelectorAll('.side-nav [data-f]'), function (b) {
      b.addEventListener('click', function () { pedFiltro = b.getAttribute('data-f'); renderPedidos(); });
    });

    var body = document.getElementById('ped-body');

    if (pedFiltro === 'Cesta atual') {
      var n = FG.cartCount();
      body.innerHTML = '<div class="empty-box">' +
        (n ? 'Sua cesta atual tem <b>' + n + '</b> item(ns) aguardando envio.' : 'Sua cesta está vazia.') +
        '<br><a class="btn red" href="/loja#/carrinho">Abrir cesta na loja</a></div>';
      return;
    }

    var arquivado = pedFiltro === 'Arquivado';
    var meus = FG.all('orders').filter(function (o) {
      var fim = o.status === 'Entregue' || o.status === 'Cancelado';
      var meu = sess.papel === 'admin' || o.usuario === sess.email || o.empresa === sess.empresa;
      return meu && (arquivado ? fim : !fim);
    });

    body.innerHTML =
      '<div class="toolbar">' +
      '<button class="tool" id="pd-exp">↗ Expandir todos</button>' +
      '<button class="tool" id="pd-csv">📄 Exportar</button>' +
      '<span class="grow"></span></div>' +
      '<table class="table"><thead><tr><th class="filt">Título</th><th class="filt">Classe de pedido</th>' +
      '<th class="filt">Criado</th><th>Status</th><th class="right">Total</th></tr></thead><tbody id="pd-rows">' +
      (meus.length ? meus.map(function (o, i) {
        var statusCol = '<span class="pill-status ' + esc(o.status) + '">' + esc(o.status) + '</span>' +
          (o.garantia ? ' <span class="pill-status Garantia">Garantia</span>' : '') +
          (o.progresso && o.progresso.parcial ? ' <span class="pill-status Parcial">Parcial</span>' : '') +
          (o.temBackorder ? '<br><span class="muted" style="font-size:11px;">contém pré-venda</span>' : '');
        return '<tr><td><a href="#pedido/' + esc(o.id) + '">' + esc(o.id) + '</a>' +
          ' <button class="link-action pd-open" data-i="' + i + '" title="Ver itens">⤢</button>' +
          '<div class="pd-itens hidden" data-i="' + i + '">' +
          o.itens.map(function (it) { return '<div class="muted">' + it.qtd + '× ' + esc(it.nome) + ' (' + it.artigo + ')</div>'; }).join('') +
          '</div></td>' +
          '<td>Peças de reposição</td><td>' + FG.fmtDateTime(o.data) + '</td>' +
          '<td>' + statusCol + '</td><td class="right">' + FG.fmtMoney(o.total) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">Vazio</td></tr>') +
      '</tbody></table>';

    Array.prototype.forEach.call(body.querySelectorAll('.pd-open'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        body.querySelector('.pd-itens[data-i="' + a.getAttribute('data-i') + '"]').classList.toggle('hidden');
      });
    });
    document.getElementById('pd-exp').addEventListener('click', function () {
      Array.prototype.forEach.call(body.querySelectorAll('.pd-itens'), function (d) { d.classList.remove('hidden'); });
    });
    document.getElementById('pd-csv').addEventListener('click', function () {
      var linhas = [['Pedido', 'Data', 'Status', 'Total']];
      meus.forEach(function (o) { linhas.push([o.id, FG.fmtDateTime(o.data), o.status, o.total.toFixed(2)]); });
      FG.exportCSV('pedidos', linhas);
    });
  }

  /* =========================================================
     DETALHE DO PEDIDO (#pedido/:numero)
     ========================================================= */
  // Indicador circular por item: verde=enviado, amarelo=parcial, cinza=pendente,
  // vermelho=cancelado (o pedido inteiro foi cancelado — nada será enviado).
  function dotItem(it, cancelado) {
    if (cancelado) return '<span class="item-dot dot-cancelado" title="Cancelado"></span>';
    var cls = it.qtdEnviada >= it.qtd ? 'dot-ok' : (it.qtdEnviada > 0 ? 'dot-parcial' : 'dot-pendente');
    var t = it.qtdEnviada >= it.qtd ? 'Enviado' : (it.qtdEnviada > 0 ? 'Parcial' : 'Não enviado');
    return '<span class="item-dot ' + cls + '" title="' + t + '"></span>';
  }

  // Legenda das bolinhas — vai uma única vez, logo abaixo das tabelas de itens.
  var LEGENDA_DOTS =
    '<div class="dot-legenda"><strong>Legenda do status:</strong>' +
    '<span><span class="item-dot dot-ok"></span>Enviado — quantidade completa já despachada</span>' +
    '<span><span class="item-dot dot-parcial"></span>Parcial — parte da quantidade já saiu</span>' +
    '<span><span class="item-dot dot-pendente"></span>Não enviado — aguardando separação/estoque</span>' +
    '<span><span class="item-dot dot-cancelado"></span>Cancelado — o pedido foi cancelado</span>' +
    '</div>';

  function tabelaItens(itens, cancelado) {
    return '<table class="table"><thead><tr><th title="Status de envio do item">Status</th>' +
      '<th>SKU</th><th>Produto</th>' +
      '<th class="right">Qtd. pedida</th><th class="right">Qtd. enviada</th>' +
      '<th class="right">Preço un.</th><th class="right">Subtotal</th></tr></thead><tbody>' +
      itens.map(function (it) {
        return '<tr><td>' + dotItem(it, cancelado) + '</td><td>' + esc(it.artigo) + '</td><td>' + esc(it.nome) +
          (it.garantiaNumero ? ' <span class="pill-status Garantia" title="Peça com garantia de varejo aprovada">Garantia Nº ' + esc(it.garantiaNumero) + '</span>' : '') +
          '</td>' +
          '<td class="right">' + it.qtd + '</td><td class="right">' + it.qtdEnviada + '</td>' +
          '<td class="right">' + FG.fmtMoney(it.preco) + '</td>' +
          '<td class="right">' + FG.fmtMoney(it.preco * it.qtd) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderPedidoDetalhe(numero) {
    setCrumb(['Pedidos', numero]); setTabOn('pedidos');
    var vigente = telaVigente();
    FG.pedidoDetalhe(numero).then(function (d) {
    if (!vigente()) return;
    if (!d || !d.id) {
      // Sem botão de voltar aqui: o VOLTAR padrão da trilha já cobre.
      view.innerHTML = '<div class="empty-box">Pedido não encontrado.</div>';
      return;
    }
    var normais = d.itens.filter(function (i) { return !i.backorder; });
    var preVenda = d.itens.filter(function (i) { return i.backorder; });
    var pg = d.progresso;

    // O VOLTAR fica só na trilha (botão padrão) — não se repete aqui dentro.
    var html =
      '<div class="ped-det-head"><h2 style="margin:0;">Pedido ' + esc(d.id) + '</h2>' +
      '<span class="pill-status ' + esc(d.status) + '">' + esc(d.status) + '</span>' +
      (d.garantia ? ' <span class="pill-status Garantia">Garantia — reposição sem cobrança</span>' : '') +
      (pg.parcial ? ' <span class="pill-status Parcial">Parcial</span>' : '') + '</div>' +
      '<p class="muted">' + FG.fmtDateTime(d.data) + ' · ' + esc(d.empresa) + ' · Total ' + FG.fmtMoney(d.total) + '</p>' +
      '<div class="prog-wrap"><div class="prog-bar"><div class="prog-fill" style="width:' + pg.pct + '%;"></div></div>' +
      '<span class="prog-label">' + pg.pct + '% (' + pg.enviada + ' de ' + pg.qtd + ' enviadas)</span></div>';

    var cancelado = String(d.status || '').toLowerCase() === 'cancelado';

    if (normais.length)
      html += '<h3 class="sec-title">Itens em envio normal</h3>' + tabelaItens(normais, cancelado);

    if (preVenda.length)
      html += '<h3 class="sec-title">Itens em pré-venda</h3>' +
        '<div class="backorder-aviso">Estes itens serão enviados quando o estoque for reposto.</div>' +
        tabelaItens(preVenda, cancelado);

    // Legenda uma única vez, logo abaixo da(s) tabela(s) de itens.
    if (normais.length || preVenda.length) html += LEGENDA_DOTS;

    if (d.faturas && d.faturas.length)
      html += '<h3 class="sec-title">Faturas</h3>' +
        '<table class="table"><thead><tr><th>Fatura</th><th>Data</th><th>Status</th>' +
        '<th class="right">Valor</th></tr></thead><tbody>' +
        d.faturas.map(function (f) {
          return '<tr><td>' + esc(f.numero) + '</td><td>' + (f.data ? FG.fmtDate(f.data) : '—') + '</td>' +
            '<td>' + (f.status ? '<span class="pill-status ' + esc(f.status) + '">' + esc(f.status) + '</span>' : '—') + '</td>' +
            '<td class="right">' + (f.valor != null ? FG.fmtMoney(f.valor) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';

    view.innerHTML = html;
    });
  }

  /* =========================================================
     AÇÕES DO VEÍCULO
     ========================================================= */
  // Modal estilizado para registrar a venda com os dados do comprador final.
  // onDone() é chamado após sucesso (re-renderiza a busca do veículo).
  function modalVenda(v, onDone) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Registrar venda — ' + esc(v.niv) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">Dados do comprador final. A garantia é ativada automaticamente na venda. Campos marcados com * são obrigatórios.</p>' +
      '<div class="form-grid">' +
      '<div class="field full"><label>Nome do cliente *</label><input id="vd-nome" type="text" placeholder="Nome completo" autocomplete="off"></div>' +
      '<div class="field"><label>CPF</label><input id="vd-cpf" type="text" inputmode="numeric" placeholder="000.000.000-00" maxlength="14"></div>' +
      '<div class="field"><label>Telefone</label><input id="vd-tel" type="tel" placeholder="(00) 00000-0000"></div>' +
      '<div class="field full"><label>E-mail pessoal</label><input id="vd-email" type="email" placeholder="cliente@email.com"></div>' +
      '<div class="field full"><label>Endereço</label><input id="vd-end" type="text" placeholder="Rua, número, bairro, cidade/UF, CEP"></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn-line" id="vd-canc">Cancelar</button>' +
      '<button class="btn red" id="vd-ok">Confirmar venda</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.querySelector('#vd-canc').addEventListener('click', fechar);
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).
    document.getElementById('vd-nome').focus();

    // Máscara leve de CPF enquanto digita (000.000.000-00).
    var cpf = document.getElementById('vd-cpf');
    cpf.addEventListener('input', function () {
      var d = cpf.value.replace(/\D/g, '').slice(0, 11), out = d;
      if (d.length > 9) out = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
      else if (d.length > 6) out = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
      else if (d.length > 3) out = d.slice(0, 3) + '.' + d.slice(3);
      cpf.value = out;
    });

    document.getElementById('vd-ok').addEventListener('click', async function () {
      var nome = document.getElementById('vd-nome').value.trim();
      if (!nome) { FG.toast('Informe o nome do cliente.'); return; }
      var r = await FG.registrarVenda(v.niv, {
        cliente: nome,
        cpf: document.getElementById('vd-cpf').value.trim(),
        telefone: document.getElementById('vd-tel').value.trim(),
        email: document.getElementById('vd-email').value.trim(),
        endereco: document.getElementById('vd-end').value.trim()
      });
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível registrar a venda.'); return; }
      fechar();
      FG.toast('Venda registrada e garantia ativada.');
      if (onDone) onDone();
    });
  }

  // Modal (SÓ ADMIN) para transferir o chassi para outra concessionária,
  // digitando o nome dela (razão social ou nome fantasia) — ou devolvê-lo à
  // Fábrica, quando ele já está numa concessionária.
  function modalTransferir(v, onDone) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Transferir revendedor — ' + esc(v.niv) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">Hoje está ' + (v.fabrica ? 'na ' + FG.seloFabrica() : 'em <b>' + esc(v.empresa) + '</b>') +
      '. O chassi passa a pertencer à concessionária informada. Comece a digitar e escolha na lista.</p>' +
      '<div class="field"><label>Concessionária de destino *</label>' +
      '<div class="ac-wrap"><input id="tf-emp" type="text" placeholder="Digite o nome da concessionária" autocomplete="off">' +
      '<div class="ac-list hidden" id="tf-emp-ac"></div></div></div>' +
      '</div>' +
      '<div class="modal-foot">' +
      (v.fabrica ? '' : '<button class="btn-line" id="tf-fab" style="margin-right:auto;">Devolver à Fábrica</button>') +
      '<button class="btn-line" id="tf-canc">Cancelar</button>' +
      '<button class="btn red" id="tf-ok">Transferir</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.querySelector('#tf-canc').addEventListener('click', fechar);
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).
    document.getElementById('tf-emp').focus();

    var bFab = document.getElementById('tf-fab');
    if (bFab) bFab.addEventListener('click', async function () {
      if (!confirm('Devolver o chassi ' + v.niv + ' à Fábrica?\n' + v.empresa + ' deixa de vê-lo.')) return;
      bFab.disabled = true;
      var r = await FG.transferirVeiculo(v.niv, { fabrica: true });
      if (!r.ok) { bFab.disabled = false; FG.toast(r.msg || 'Não foi possível devolver.', 'erro'); return; }
      fechar();
      FG.toast('Chassi devolvido à Fábrica.');
      if (onDone) onDone();
    });

    // Sugestões enquanto digita (front próprio — nada de datalist nativo).
    FG.bindAutocomplete('tf-emp', function (termo) {
      return FG.empresas().then(function (emps) {
        var t = termo.toLowerCase();
        return emps.filter(function (e2) {
          return e2.nome.toLowerCase().indexOf(t) !== -1 ||
            (e2.fantasia && e2.fantasia.toLowerCase().indexOf(t) !== -1);
        }).map(function (e2) {
          return { id: e2.id, label: e2.nome, sub: e2.fantasia || '' };
        });
      });
    });

    document.getElementById('tf-ok').addEventListener('click', async function () {
      var el = document.getElementById('tf-emp');
      var nome = el.value.trim();
      var idSel = el.getAttribute('data-ac-id');
      if (!nome) { FG.toast('Informe o nome da concessionária.'); return; }
      var r = await FG.transferirVeiculo(v.niv, idSel ? { empresaId: Number(idSel) } : nome);
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível transferir.', 'erro'); return; }
      fechar();
      FG.toast('Veículo transferido para ' + esc(r.empresa || nome) + '.');
      if (onDone) onDone();
    });
  }

  /* =========================================================
     HISTÓRICO DO VEÍCULO
     ---------------------------------------------------------
     A linha do tempo do chassi dentro de "Ações do veículo": cadastro,
     atribuição e transferências, venda, garantia, reivindicações e o que o
     administrador lançar à mão (recall, revisão, anotação).

     Quase tudo aqui chega pronto da API — a tela só desenha. O que ela decide
     é a aparência de cada tipo de evento e quem pode apagar o quê: registro
     automático não tem botão de excluir, porque ele é o que de fato aconteceu.
     ========================================================= */
  var HIST_ICONE = {
    cadastro: '🏷', atribuicao: '🏢', transferencia: '🔁', venda: '🤝',
    garantia: '🛡', reivindicacao: '🔧', recall: '⚠', revisao: '🛠', nota: '📝'
  };
  var HIST_ROTULO = {
    cadastro: 'Cadastro', atribuicao: 'Atribuição', transferencia: 'Transferência',
    venda: 'Venda', garantia: 'Garantia', reivindicacao: 'Reivindicação',
    recall: 'Recall', revisao: 'Revisão', nota: 'Anotação'
  };
  // Tipos que o administrador lança à mão (espelham TIPOS_MANUAIS na API).
  var HIST_MANUAIS = [
    ['recall', 'Recall / campanha técnica'],
    ['revisao', 'Revisão / manutenção'],
    ['nota', 'Anotação']
  ];

  function desenharHistorico(niv, lista) {
    var box = document.getElementById('av-hist');
    if (!box) return;   // a tela mudou enquanto a busca voltava

    if (!lista.length) {
      box.innerHTML = '<p class="muted">Nenhum registro ainda. As ações feitas neste chassi ' +
        'aparecem aqui automaticamente.</p>';
      return;
    }

    var admin = sess.papel === 'admin';
    box.innerHTML = lista.map(function (h) {
      var rodape = [h.fabrica ? FG.seloFabrica() : esc(h.empresa), esc(h.usuario)]
        .filter(Boolean).join(' · ');
      return '<div class="hist-item hist-' + esc(h.tipo) + '">' +
        '<div class="hist-ico" title="' + esc(HIST_ROTULO[h.tipo] || h.tipo) + '">' +
        (HIST_ICONE[h.tipo] || '•') + '</div>' +
        '<div class="hist-corpo">' +
        '<div class="hist-linha1"><b>' + esc(h.titulo) + '</b>' +
        (h.referencia ? ' <span class="hist-ref">' + esc(h.referencia) + '</span>' : '') +
        '<span class="hist-data">' + FG.fmtDateTime(h.data) + '</span></div>' +
        (h.detalhe ? '<div class="hist-detalhe">' + esc(h.detalhe) + '</div>' : '') +
        (rodape ? '<div class="hist-rodape">' + rodape + '</div>' : '') +
        '</div>' +
        (admin && h.manual
          ? '<button class="hist-x" data-hx="' + h.id + '" title="Apagar este registro">×</button>'
          : '') +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-hx]'), function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Apagar este registro do histórico?')) return;
        b.disabled = true;
        var r = await FG.excluirHistorico(niv, b.getAttribute('data-hx'));
        if (!r.ok) { FG.toast(r.msg || 'Não foi possível apagar.', 'erro'); b.disabled = false; return; }
        FG.toast('Registro apagado.');
        desenharHistorico(niv, r.lista);
      });
    });
  }

  // Modal (SÓ ADMIN) para lançar recall, revisão ou anotação no chassi.
  function modalHistorico(niv, onDone) {
    var hoje = new Date().toISOString().slice(0, 10);
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Registrar no histórico — ' + esc(niv) + '</h3>' +
      '<button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">Para o que o sistema não registra sozinho: uma campanha ' +
      'de recall, uma revisão feita na oficina, uma observação sobre este chassi.</p>' +
      '<div class="field"><label for="hi-tipo">Tipo *</label><select id="hi-tipo">' +
      HIST_MANUAIS.map(function (t) {
        return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label for="hi-titulo">Título *</label>' +
      '<input id="hi-titulo" type="text" maxlength="160" placeholder="Ex.: Recall do parafuso da mesa superior"></div>' +
      '<div class="field"><label for="hi-detalhe">Detalhe</label>' +
      '<textarea id="hi-detalhe" rows="3" maxlength="1000" placeholder="O que foi feito, o que falta, quem executou..."></textarea></div>' +
      '<div class="field"><label for="hi-ref">Referência</label>' +
      '<input id="hi-ref" type="text" maxlength="40" placeholder="Nº da campanha, da OS, da nota (opcional)"></div>' +
      '<div class="field"><label for="hi-data">Data do evento</label>' +
      '<input id="hi-data" type="date" max="' + hoje + '" value="' + hoje + '"></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="hi-canc">Cancelar</button>' +
      '<button class="btn red" id="hi-ok">Registrar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.querySelector('#hi-canc').addEventListener('click', fechar);
    document.getElementById('hi-titulo').focus();

    var btn = document.getElementById('hi-ok');
    btn.addEventListener('click', async function () {
      var titulo = document.getElementById('hi-titulo').value.trim();
      if (!titulo) { FG.toast('Informe o título do registro.'); return; }
      var dataTxt = document.getElementById('hi-data').value;
      btn.disabled = true; btn.textContent = 'Registrando…';
      var r = await FG.registrarHistorico(niv, {
        tipo: document.getElementById('hi-tipo').value,
        titulo: titulo,
        detalhe: document.getElementById('hi-detalhe').value.trim(),
        referencia: document.getElementById('hi-ref').value.trim(),
        // Data sem hora vira meia-noite UTC; mandamos o meio-dia para o evento
        // não "voltar um dia" ao ser exibido no fuso do Brasil.
        data: dataTxt ? dataTxt + 'T12:00:00' : undefined
      });
      if (!r.ok) {
        FG.toast(r.msg || 'Não foi possível registrar.', 'erro');
        btn.disabled = false; btn.textContent = 'Registrar';
        return;
      }
      fechar();
      FG.toast('Registrado no histórico do veículo.');
      if (onDone) onDone(r.lista);
    });
  }

  function renderAcoes(nivBusca) {
    setCrumb(['Ações do veículo']); setTabOn('acoes');
    view.innerHTML =
      '<h2>Ações do veículo</h2>' +
      '<div class="field" style="max-width:480px;"><label>NIV (chassi)</label>' +
      '<div class="searchbox" style="display:flex;"><input id="av-niv" type="text" placeholder="Ex.: VBFGA125XSM160872" value="' + esc(nivBusca || '') + '">' +
      '<button class="btn red" id="av-go" type="button" style="border-radius:0;">Buscar</button></div></div>' +
      '<div id="av-result"></div>';

    function buscar() {
      var q = document.getElementById('av-niv').value.trim().toUpperCase();
      var box = document.getElementById('av-result');
      if (!q) { box.innerHTML = ''; return; }
      var v = FG.all('vehicles').find(function (x) { return x.niv.toUpperCase() === q; });
      FG.logSearch(q, v ? 1 : 0);
      if (!v) { box.innerHTML = '<p class="muted">Nenhum veículo encontrado com este NIV.</p>'; return; }
      var m = FG.model(v.modeloId);
      box.innerHTML =
        '<div class="veh-card"><h3 style="color:var(--red);">' + esc(m ? m.label : v.modeloId) + '</h3>' +
        '<div class="veh-grid">' +
        '<div><b>NIV</b>' + v.niv + '</div>' +
        '<div><b>Modelo</b>' + esc(modelName(v.modeloId)) + '</div>' +
        '<div><b>Status</b>' + esc(v.status) + '</div>' +
        '<div><b>Localização</b>' + (v.fabrica ? FG.seloFabrica() : esc(v.empresa || '—')) + '</div>' +
        '<div><b>Entrada no estoque</b>' + FG.fmtDate(v.entrada) + '</div>' +
        (v.venda ? '<div><b>Venda</b>' + FG.fmtDate(v.venda.data) + ' — ' + esc(v.venda.cliente) + '</div>' +
          (v.venda.cpf ? '<div><b>CPF</b>' + esc(v.venda.cpf) + '</div>' : '') +
          (v.venda.telefone ? '<div><b>Telefone</b>' + esc(v.venda.telefone) + '</div>' : '') +
          (v.venda.email ? '<div><b>E-mail</b>' + esc(v.venda.email) + '</div>' : '') +
          (v.venda.endereco ? '<div><b>Endereço</b>' + esc(v.venda.endereco) + '</div>' : '') : '') +
        (v.garantia ? '<div><b>Garantia ativada em</b>' + FG.fmtDate(v.garantia) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
        (v.status === 'Disponível' ? '<button class="btn red" id="av-venda">Registrar venda</button>' : '') +
        (!v.garantia ? '<button class="btn" id="av-gar">Ativar garantia</button>' : '') +
        (sess.papel === 'admin' ? '<button class="btn" id="av-transf">Transferir revendedor</button>' : '') +
        '<a class="btn" href="#reivindicacoes">Criar reivindicação</a>' +
        '<a class="btn" href="/finder">Abrir no Parts Finder</a>' +
        '</div>' +
        /* ---- histórico do chassi ---- */
        '<div class="hist-bloco">' +
        '<div class="hist-head"><h4>Histórico do veículo</h4>' +
        (sess.papel === 'admin'
          ? '<button class="btn small" id="av-hist-novo">+ Registrar no histórico</button>' : '') +
        '</div>' +
        '<div id="av-hist" class="hist-lista"><p class="muted">Carregando…</p></div>' +
        '</div></div>';

      var bv = document.getElementById('av-venda');
      if (bv) bv.addEventListener('click', function () { modalVenda(v, buscar); });
      var bt = document.getElementById('av-transf');
      if (bt) bt.addEventListener('click', function () { modalTransferir(v, buscar); });
      var bg = document.getElementById('av-gar');
      if (bg) bg.addEventListener('click', async function () {
        var r = await FG.ativarGarantia(v.niv);
        if (!r.ok) { FG.toast(r.msg || 'Não foi possível ativar a garantia.'); return; }
        FG.toast('Garantia ativada.');
        buscar();
      });

      var bh = document.getElementById('av-hist-novo');
      if (bh) bh.addEventListener('click', function () {
        modalHistorico(v.niv, function (lista) { desenharHistorico(v.niv, lista); });
      });

      var vigente = telaVigente();
      FG.veiculoHistorico(v.niv).then(function (lista) {
        if (vigente()) desenharHistorico(v.niv, lista);
      });
    }

    document.getElementById('av-go').addEventListener('click', buscar);
    document.getElementById('av-niv').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscar(); });
    if (nivBusca) buscar();
  }

  /* =========================================================
     ESTOQUE DO REVENDEDOR
     ========================================================= */
  function renderEstoque() {
    setCrumb(['Estoque do revendedor']); setTabOn('estoque');
    var vehs = FG.all('vehicles');
    // O admin vê os chassis de todas as concessionárias e os da Fábrica: para
    // ele a tabela ganha a coluna de localização. A concessionária só vê os
    // próprios, então a coluna não diria nada.
    var admin = sess.papel === 'admin';
    function local(v) { return v.fabrica ? 'Fábrica' : (v.empresa || ''); }
    view.innerHTML =
      '<h2>Estoque do revendedor</h2>' +
      '<div class="toolbar"><button class="tool" id="es-csv">📄 Export. p/ Excel</button></div>' +
      '<table class="table"><thead><tr><th class="filt">NIV</th><th class="filt">Modelo</th>' +
      (admin ? '<th>Localização</th>' : '') +
      '<th class="filt">Status</th><th>Entrada</th><th></th></tr></thead><tbody>' +
      vehs.map(function (v) {
        return '<tr><td>' + v.niv + '</td><td>' + esc(modelName(v.modeloId)) + '</td>' +
          (admin ? '<td>' + (v.fabrica ? FG.seloFabrica() : esc(v.empresa || '—')) + '</td>' : '') +
          '<td>' + (v.status === 'Disponível' ? '<span class="stock-ok">Disponível</span>' : esc(v.status)) + '</td>' +
          '<td>' + FG.fmtDate(v.entrada) + '</td>' +
          '<td><a href="#acoes/' + v.niv + '">Ações &rsaquo;</a></td></tr>';
      }).join('') +
      '</tbody></table>';
    document.getElementById('es-csv').addEventListener('click', function () {
      var linhas = [['NIV', 'Modelo'].concat(admin ? ['Localização'] : [], ['Status', 'Entrada'])];
      vehs.forEach(function (v) {
        linhas.push([v.niv, modelName(v.modeloId)].concat(admin ? [local(v)] : [], [v.status, FG.fmtDate(v.entrada)]));
      });
      FG.exportCSV('estoque', linhas);
    });
  }

  /* =========================================================
     CONTA FINANCEIRA
     ========================================================= */
  function renderFinanceiro() {
    setCrumb(['Conta financeira', 'Faturas']); setTabOn('financeiro');
    var inv = FG.all('invoices'); // faturas reais (cobrança)
    // Total faturado: soma só o que ainda cobra. Faturas ANULADAS (pedido
    // cancelado) permanecem na lista com a tarja, mas NÃO entram no cálculo.
    var faturado = 0;
    inv.forEach(function (i) { if (i.status !== 'Anulada') faturado += i.valor; });

    // Garantias aprovadas (substituem as antigas "notas de crédito"): as
    // reivindicações do revendedor que o admin já aprovou.
    var garantias = FG.all('claims').filter(function (c) { return c.status === 'Aprovada'; })
      .slice().sort(function (a, b) {
        return (b.dataAprovacao || b.data || '') < (a.dataAprovacao || a.data || '') ? -1 : 1;
      });
    var totalGarantias = garantias.reduce(function (s, c) { return s + (c.valorGarantia || 0); }, 0);

    // Pré-venda: peças já compradas (incluídas na fatura do pedido, sem cobrança
    // à parte) que AINDA aguardam envio. Derivado dos pedidos; status pelo
    // estoque atual. Só entra o que tem saldo pendente (qtdEnviada < qtd) e de
    // pedidos vivos — item já enviado por completo ou pedido cancelado não é
    // "peça a enviar" e não deve poluir o rastreador.
    var preParts = [];
    FG.all('orders').forEach(function (o) {
      if (o.status === 'Cancelado') return;
      (o.itens || []).forEach(function (it) {
        if (!it.backorder) return;
        if (it.qtdEnviada >= it.qtd) return; // nada pendente — já enviado
        var p = FG.product(it.artigo);
        var st = (p && p.estoque >= (it.qtd - it.qtdEnviada)) ? 'Disponivel' : 'Aguardando';
        preParts.push({ it: it, o: o, st: st, prev: p && p.previsao });
      });
    });

    var preVendaHTML = '';
    if (preParts.length) {
      preVendaHTML =
        '<h3 class="sec-title">Pré-venda — peças a enviar</h3>' +
        '<div class="backorder-aviso">Estas peças já estão incluídas na fatura do pedido (sem cobrança ' +
        'à parte). São enviadas assim que voltam ao estoque — acompanhe o status abaixo.</div>' +
        '<table class="table"><thead><tr><th>Artigo</th><th>Peça</th><th class="right">Qtd.</th>' +
        '<th>Data do pedido</th><th>Pedido</th><th>Status do envio</th></tr></thead><tbody>' +
        preParts.map(function (x) {
          var pendente = x.it.qtd - x.it.qtdEnviada;
          var pill = x.st === 'Disponivel'
            ? '<span class="pill-status Disponivel">Disponível — envio em breve</span>'
            : '<span class="pill-status Aguardando">Aguardando reposição' + (x.prev ? ' · ' + esc(x.prev) : '') + '</span>';
          return '<tr><td>' + esc(x.it.artigo) + '</td><td>' + esc(x.it.nome) + '</td>' +
            '<td class="right">' + pendente + '</td>' +
            '<td>' + (x.o.data ? FG.fmtDate(x.o.data) : '—') + '</td>' +
            '<td><a href="#pedido/' + esc(x.o.id) + '">' + esc(x.o.id) + '</a></td>' +
            '<td>' + pill + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    // Bloco "Garantias" — reivindicações aprovadas do revendedor.
    var garantiasHTML =
      '<h3 class="sec-title">Garantias aprovadas</h3>' +
      (garantias.length
        ? '<table class="table"><thead><tr><th>Reivindicação</th><th>Data da aprovação</th>' +
          '<th>Chassi (NIV)</th><th>Peças</th><th class="right">Valor da garantia</th></tr></thead><tbody>' +
          garantias.map(function (c) {
            var pecas = (c.pecas || []).map(function (p) {
              return esc((p.nome || p.sku) + (p.quantidade > 1 ? ' ×' + p.quantidade : ''));
            }).join(', ');
            return '<tr><td><b>' + esc(c.id) + '</b></td>' +
              '<td>' + (c.dataAprovacao ? FG.fmtDate(c.dataAprovacao) : '—') + '</td>' +
              '<td>' + esc(c.niv || '—') + '</td>' +
              '<td style="font-size:12px;max-width:320px;">' + (pecas || '<span class="muted">—</span>') + '</td>' +
              '<td class="right">' + (c.valorGarantia != null ? FG.fmtMoney(c.valorGarantia) : '—') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="muted">Nenhuma garantia aprovada.</p>');

    view.innerHTML =
      '<h2>Conta financeira</h2>' +
      '<div class="fin-cards">' +
      '<div class="fin-card"><div class="muted">Total faturado</div><div class="v">' + FG.fmtMoney(faturado) + '</div></div>' +
      '<div class="fin-card"><div class="muted">Garantias aprovadas</div><div class="v">' + FG.fmtMoney(totalGarantias) + '</div></div>' +
      '<div class="fin-card"><div class="muted">Documentos</div><div class="v">' + inv.length + '</div></div>' +
      '</div>' +
      '<div class="toolbar"><button class="tool" id="fi-csv">📄 Export. p/ Excel</button></div>' +
      '<table class="table"><thead><tr><th class="filt">Tipo</th><th class="filt">N° da fatura</th>' +
      '<th class="filt">Data da fatura ↓</th><th class="right filt">Quantia cobrada</th><th></th></tr></thead><tbody>' +
      (inv.length ? inv.map(function (i, idx) {
        return '<tr><td>' + esc(i.tipo) +
          (i.status && i.status !== 'Emitida' ? ' <span class="pill-status ' + esc(i.status) + '">' + esc(i.status) + '</span>' : '') +
          '</td><td>' + i.numero + '</td><td>' + FG.fmtDate(i.data) + '</td>' +
          '<td class="right">' + i.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '</td>' +
          '<td class="nowrap"><button class="pdf-ico pdf-baixar" data-i="' + idx + '">⬇ Baixar PDF</button> ' +
          '<button class="pdf-ico pdf-imprimir" data-i="' + idx + '">🖨 Imprimir</button></td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">Nenhuma fatura.</td></tr>') +
      '</tbody></table>' + garantiasHTML + preVendaHTML;

    document.getElementById('fi-csv').addEventListener('click', function () {
      var linhas = [['Tipo', 'N°', 'Data', 'Valor']];
      inv.forEach(function (i) { linhas.push([i.tipo, i.numero, FG.fmtDate(i.data), i.valor.toFixed(2)]); });
      FG.exportCSV('faturas', linhas);
    });
    Array.prototype.forEach.call(view.querySelectorAll('.pdf-baixar'), function (b) {
      b.addEventListener('click', function () { baixarFaturaPDF(inv[Number(b.getAttribute('data-i'))], b); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.pdf-imprimir'), function (b) {
      b.addEventListener('click', function () { imprimirFatura(inv[Number(b.getAttribute('data-i'))]); });
    });
  }

  // Monta o endereço do destinatário em linhas (uma por <br>), no estilo da
  // fatura de referência (logradouro/nº, complemento, bairro, cidade-UF/CEP, país).
  function linhasEndereco(end) {
    if (!end) return [];
    var linhas = [];
    var l1 = [end.logradouro, end.numero].filter(Boolean).join(', ');
    if (l1) linhas.push(l1);
    if (end.complemento) linhas.push(end.complemento);
    if (end.bairro) linhas.push(end.bairro);
    var cidadeUf = [end.cidade, end.uf].filter(Boolean).join(' - ');
    var l4 = [end.cep, cidadeUf].filter(Boolean).join('  ');
    if (l4) linhas.push(l4);
    if (end.pais) linhas.push(end.pais);
    return linhas;
  }

  // Fatura detalhada — replica o layout da fatura de referência (docs/
  // referencias/fatura_referencia.png): cabeçalho com o logo FULLGAS + dados
  // do documento, bloco do destinatário (empresa + endereço + país + CNPJ) e a
  // tabela de itens com os produtos vendidos, quantidades e valores.
  // Devolve só o HTML (usado tanto para imprimir quanto para baixar em PDF).
  function faturaHTML(i) {
    var itens = i.itens || [];
    var somaItens = itens.reduce(function (s, it) { return s + (it.subtotal || 0); }, 0);
    var total = itens.length ? somaItens : i.valor;
    var endLinhas = linhasEndereco(i.endereco).map(esc).join('<br>');
    var nomeEmpresa = esc(i.empresa || sess.empresa || '');
    // Crus de propósito: os dois só alimentam campo(), que escapa por conta
    // própria. O separador ', ' não é dado de usuário, então juntar antes de
    // escapar é seguro.
    var paisCru = i.pais || (i.endereco && i.endereco.pais) || '';
    var pedidos = (i.pedidos || []).length ? (i.pedidos || []).join(', ') : '';

    // Estilos inline (o print-area é isolado; nada de classes externas).
    // Corpos maiores para leitura confortável no A4 — mesma estrutura, letras
    // proporcionais ao papel (antes saíam pequenas demais).
    var thBase = 'text-align:left;padding:9px 8px;border-bottom:2px solid #e5b100;font-size:14px;';
    var tdBase = 'padding:9px 8px;border-bottom:1px solid #e5e5e5;font-size:14px;vertical-align:top;';
    var lbl = 'font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.4px;';
    var val = 'font-size:15px;font-weight:700;color:#222;';

    // O escape acontece AQUI DENTRO, não em cada chamada. Antes o helper
    // interpolava o valor cru e cabia a quem chamasse lembrar do esc() — os
    // seis call sites lembravam, mas é o tipo de contrato que se perde no
    // sétimo. Com o escape no helper, esquecer deixa de ser possível.
    function campo(rotulo, valor) {
      return '<div style="margin-bottom:10px;"><div style="' + lbl + '">' + esc(rotulo) + '</div>' +
        '<div style="' + val + '">' + (valor ? esc(valor) : '—') + '</div></div>';
    }

    // Logo da marca (data URI carregado por js/logo-data.js). Se por algum
    // motivo não estiver disponível, cai no nome em texto.
    // Largura e altura explícitas (110x70 = proporção original 600x382): evita
    // o reflow do `width:auto` durante a captura do PDF.
    var logo = window.FG_LOGO
      ? '<img src="' + window.FG_LOGO + '" alt="FULLGAS" width="110" height="70" ' +
        'style="width:110px;height:70px;display:block;flex:0 0 110px;">'
      : '<div style="font-size:26px;font-weight:800;font-style:italic;color:#e5b100;">FULLGAS</div>';

    // O PADDING LATERAL PRECISA ESTAR AQUI, na raiz do documento.
    // O html2pdf recebe ESTE elemento e o clona para dentro de um container
    // próprio, do tamanho da página — a margem do container que o segura na
    // tela é jogada fora. Sem este padding o conteúdo encostava na borda da
    // folha e o "S" de FULLGAS saía cortado (a logo fica colada à direita por
    // causa do space-between). Medido: 34 linhas de pixel pintadas na última
    // coluna do canvas antes da correção, zero depois.
    return '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;' +
      'max-width:760px;box-sizing:border-box;padding:0 18px;">' +

      /* ---- cabeçalho: título + logo ---- */
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">' +
      '<h1 style="margin:0;font-size:36px;letter-spacing:.5px;">Fatura</h1>' +
      logo +
      '</div>' +

      /* ---- grade de dados do documento ---- */
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 24px;margin-top:22px;">' +
      // Valores CRUS: quem escapa é o campo() (ver o helper acima). Passar
      // esc() aqui escaparia duas vezes e um "&" viraria "&amp;" na tela.
      campo('Fatura n°', i.numero) +
      campo('Data da fatura', FG.fmtDate(i.data)) +
      campo('Pedido(s)', pedidos) +
      campo('CNPJ', i.cnpj) +
      campo('País', paisCru) +
      campo('Documento', i.tipo) +
      '</div>' +

      /* ---- destinatário ---- */
      '<div style="margin-top:8px;border-top:1px solid #e5e5e5;padding-top:14px;">' +
      '<div style="' + lbl + '">Destinatário da fatura</div>' +
      '<div style="font-size:17px;font-weight:700;margin-top:3px;">' + nomeEmpresa + '</div>' +
      (endLinhas ? '<div style="font-size:14px;line-height:1.5;margin-top:2px;">' + endLinhas + '</div>' : '') +
      (i.cnpj ? '<div style="font-size:14px;margin-top:4px;">CNPJ: ' + esc(i.cnpj) + '</div>' : '') +
      '</div>' +

      /* ---- itens ---- */
      '<table style="width:100%;border-collapse:collapse;margin-top:22px;">' +
      '<thead><tr>' +
      '<th style="' + thBase + 'width:36px;">Item</th>' +
      '<th style="' + thBase + '">Código</th>' +
      '<th style="' + thBase + '">Descrição</th>' +
      '<th style="' + thBase + 'text-align:center;">Qtd.</th>' +
      '<th style="' + thBase + 'text-align:right;">Preço unit.</th>' +
      '<th style="' + thBase + 'text-align:right;">Total</th>' +
      '</tr></thead><tbody>' +
      (itens.length
        ? itens.map(function (it, ix) {
          return '<tr>' +
            '<td style="' + tdBase + '">' + ((ix + 1) * 10) + '</td>' +
            '<td style="' + tdBase + '">' + esc(it.sku || '') + '</td>' +
            '<td style="' + tdBase + '">' + esc(it.nome || '') + '</td>' +
            '<td style="' + tdBase + 'text-align:center;">' + it.qtd + '</td>' +
            '<td style="' + tdBase + 'text-align:right;">' + FG.fmtMoney(it.preco) + '</td>' +
            '<td style="' + tdBase + 'text-align:right;">' + FG.fmtMoney(it.subtotal) + '</td>' +
            '</tr>';
        }).join('')
        : '<tr><td style="' + tdBase + '" colspan="6">Movimentação de peças e acessórios</td></tr>') +
      '</tbody></table>' +

      /* ---- total ---- */
      '<div style="display:flex;justify-content:flex-end;margin-top:16px;">' +
      '<table style="border-collapse:collapse;min-width:300px;">' +
      '<tr><td style="padding:8px 12px;font-size:15px;">Total de itens</td>' +
      '<td style="padding:8px 12px;text-align:right;font-size:15px;">' + itens.length + '</td></tr>' +
      '<tr><td style="padding:12px;font-size:19px;font-weight:800;border-top:2px solid #e5b100;">Total</td>' +
      '<td style="padding:12px;text-align:right;font-size:19px;font-weight:800;border-top:2px solid #e5b100;">' + FG.fmtMoney(total) + '</td></tr>' +
      '</table></div>' +

      // Sem rodapé: a nota de "documento demonstrativo gerado em <data>" saiu a
      // pedido do dono — não acrescenta nada ao documento que o cliente recebe.
      '</div>';
  }

  // Imprimir: joga o HTML no #print-area (isolado por @media print) e chama a
  // impressão do navegador (o usuário pode escolher "Salvar como PDF").
  function imprimirFatura(i) {
    var area = document.getElementById('print-area');
    area.innerHTML = faturaHTML(i);
    area.classList.remove('hidden');
    window.print();
    setTimeout(function () { area.classList.add('hidden'); }, 300);
  }

  // Baixar: gera um arquivo PDF de verdade (html2pdf) e dispara o download,
  // sem passar pela caixa de impressão. Nome: fatura-<numero>.pdf.
  function baixarFaturaPDF(i, btn) {
    if (typeof html2pdf === 'undefined') { // biblioteca não carregou → imprime
      FG.toast('Gerador de PDF indisponível — abrindo a impressão.', 'erro');
      return imprimirFatura(i);
    }
    var rotulo = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }

    // Container temporário fora da tela (o html2pdf renderiza o elemento real).
    // Fica preso ao <html> (não ao <body>) para escapar do `zoom` global da
    // interface — assim o PDF sai sempre no tamanho projetado.
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:760px;background:#fff;padding:24px;zoom:1;';
    holder.innerHTML = faturaHTML(i);
    document.documentElement.appendChild(holder);

    html2pdf().set({
      margin: [10, 10, 10, 10],
      filename: 'fatura-' + i.numero + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(holder.firstChild).save()
      .then(function () { FG.toast('PDF da fatura ' + i.numero + ' baixado.'); })
      .catch(function () { FG.toast('Não foi possível gerar o PDF.', 'erro'); })
      .then(function () {
        holder.remove();
        if (btn) { btn.disabled = false; btn.textContent = rotulo; }
      });
  }

  /* =========================================================
     MINHA CONTA — cadastro da empresa + contas internas
     ---------------------------------------------------------
     O GESTOR (conta que se cadastrou) edita os dados da empresa
     e gerencia as contas internas (sub-dealers): cria contas
     para funcionários da concessionária e restringe as áreas
     que cada uma acessa (loja, finder, pedidos, financeiro...).
     Conta interna vê tudo somente-leitura.
     ========================================================= */
  var AREA_LABELS = {
    loja: 'Loja', finder: 'Parts Finder', pedidos: 'Pedidos',
    financeiro: 'Conta financeira', reivindicacoes: 'Reivindicações',
    estoque: 'Estoque do revendedor', acoes: 'Ações do veículo'
  };

  function permTexto(permissoes) {
    if (!Array.isArray(permissoes)) return '<span class="stock-ok">Acesso total</span>';
    if (!permissoes.length) return '<span class="muted">Só o portal básico</span>';
    return esc(permissoes.map(function (a) { return AREA_LABELS[a] || a; }).join(', '));
  }

  function renderConta() {
    setCrumb(['Minha conta']); setTabOn('conta');
    view.innerHTML = '<h2>Minha conta</h2><p class="muted">Carregando…</p>';

    var vigente = telaVigente();
    FG.conta().then(function (c) {
      if (!vigente()) return;
      if (!c) { view.innerHTML = '<h2>Minha conta</h2><p class="muted">Não foi possível carregar os dados. Tente de novo.</p>'; return; }
      var gestor = !!(sess.gestor || sess.papel === 'admin');
      var e = c.endereco || {};
      var ro = gestor ? '' : ' readonly disabled';

      var html =
        '<h2>Minha conta</h2>' +
        (gestor ? '' : '<p class="muted">Somente o gestor da concessionária pode alterar o cadastro.</p>') +

        /* ---- dados da empresa ---- */
        '<h3 class="sec-title">Dados da empresa</h3>' +
        '<div class="conta-grid">' +
        '<div class="field"><label>Razão social</label><input type="text" value="' + esc(c.empresa.razaoSocial) + '" readonly disabled></div>' +
        '<div class="field"><label for="ct-cnpj">CNPJ</label><input id="ct-cnpj" type="text" maxlength="18" value="' + esc(c.empresa.cnpj) + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-ie">Inscrição estadual (opcional)</label><input id="ct-ie" type="text" maxlength="20" value="' + esc(c.empresa.inscricaoEstadual || '') + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-tel">Telefone</label><input id="ct-tel" type="text" maxlength="15" value="' + esc(c.empresa.telefone) + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-email">E-mail (empresa e acesso)</label><input id="ct-email" type="email" value="' + esc(c.empresa.email) + '"' + ro + '>' +
        (gestor ? '<span class="muted" style="font-size:11px;">É também o seu e-mail de login. Ao alterar, entre com o novo.</span>' : '') + '</div>' +
        '</div>' +

        '<h3 class="sec-title">Endereço</h3>' +
        '<div class="conta-grid">' +
        '<div class="field"><label for="ct-cep">CEP</label><input id="ct-cep" type="text" maxlength="9" value="' + esc(e.cep || '') + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-log">Logradouro</label><input id="ct-log" type="text" value="' + esc(e.logradouro || '') + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-num">Número</label><input id="ct-num" type="text" value="' + esc(e.numero || '') + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-comp">Complemento</label><input id="ct-comp" type="text" value="' + esc(e.complemento || '') + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-bairro">Bairro</label><input id="ct-bairro" type="text" value="' + esc(e.bairro || '') + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-cidade">Cidade</label><input id="ct-cidade" type="text" value="' + esc(e.cidade || '') + '"' + ro + '></div>' +
        '<div class="field"><label for="ct-uf">UF</label><input id="ct-uf" type="text" maxlength="2" value="' + esc(e.uf || '') + '"' + ro + ' style="text-transform:uppercase;"></div>' +
        '</div>' +
        (gestor ? '<button class="btn red" id="ct-salvar" type="button">Salvar dados da empresa</button>' : '') +
        // A gestão de sub-dealers vive na aba "Subdealers" (só o gestor a vê).
        (gestor ? '<p class="muted" style="font-size:12px;margin-top:18px;">As contas internas (sub-dealers) são gerenciadas na aba <a href="#subdealers">Subdealers</a>.</p>' : '');

      view.innerHTML = html;
      if (!gestor) return;

      /* máscaras + ViaCEP no cadastro da empresa */
      FG.bindMask('ct-cnpj', FG.maskCnpj);
      FG.bindMask('ct-ie', FG.maskIe);
      FG.bindMask('ct-tel', FG.maskTelefone);
      FG.bindMask('ct-num', FG.maskNumero);
      FG.bindMask('ct-cidade', FG.maskCidade);
      var cepBuscado = (e.cep || '').replace(/\D/g, '');
      FG.bindMask('ct-cep', FG.maskCep, function (valor, el) {
        var dig = valor.replace(/\D/g, '');
        if (dig.length !== 8 || dig === cepBuscado) return;
        cepBuscado = dig;
        el.classList.add('buscando');
        fetch('https://viacep.com.br/ws/' + dig + '/json/')
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.erro) { FG.toast('CEP não encontrado — preencha o endereço manualmente.', 'erro'); return; }
            if (d.logradouro) document.getElementById('ct-log').value = d.logradouro;
            if (d.bairro) document.getElementById('ct-bairro').value = d.bairro;
            if (d.localidade) document.getElementById('ct-cidade').value = d.localidade;
            if (d.uf) document.getElementById('ct-uf').value = d.uf;
            document.getElementById('ct-num').focus();
          })
          .catch(function () { })
          .then(function () { el.classList.remove('buscando'); });
      });

      /* salvar dados da empresa */
      document.getElementById('ct-salvar').addEventListener('click', function () {
        var v = function (id) { return document.getElementById(id).value.trim(); };
        var dados = {
          cnpj: v('ct-cnpj'), inscricaoEstadual: v('ct-ie'), telefone: v('ct-tel'), email: v('ct-email'),
          endereco: { cep: v('ct-cep'), logradouro: v('ct-log'), numero: v('ct-num'),
            complemento: v('ct-comp'), bairro: v('ct-bairro'), cidade: v('ct-cidade'),
            uf: v('ct-uf').toUpperCase() }
        };
        if (dados.cnpj.replace(/\D/g, '').length !== 14) { FG.toast('CNPJ incompleto — use os 14 dígitos.', 'erro'); return; }
        if (dados.endereco.cep.replace(/\D/g, '').length !== 8) { FG.toast('CEP incompleto.', 'erro'); return; }
        if (!/^\d+$/.test(dados.endereco.numero)) { FG.toast('Número do endereço deve conter apenas dígitos.', 'erro'); return; }
        if (/[^A-Za-zÀ-ÖØ-öø-ÿ'. -]/.test(dados.endereco.cidade)) { FG.toast('Cidade não pode conter números ou caracteres especiais.', 'erro'); return; }
        FG.contaSalvarEmpresa(dados).then(function (r) {
          if (!r.ok) { FG.toast(r.msg || 'Não foi possível salvar.', 'erro'); return; }
          // E-mail é também o login: se mudou, atualiza a sessão em memória e no
          // localStorage e o cabeçalho, para o portal refletir na hora (o próximo
          // login usa o novo e-mail).
          if (r.email && r.email !== sess.email) {
            sess.email = r.email;
            try {
              var s = JSON.parse(localStorage.getItem('fullgas_session_v1') || '{}');
              s.email = r.email;
              localStorage.setItem('fullgas_session_v1', JSON.stringify(s));
            } catch (e) { /* sessão intacta se falhar */ }
            desenharQuem();
            FG.toast('Dados salvos. Seu e-mail de acesso agora é ' + r.email + '.');
          } else {
            FG.toast('Dados da empresa salvos.');
          }
        });
      });
    });
  }

  /* =========================================================
     SUBDEALERS — gestão das contas internas (só o gestor)
     ---------------------------------------------------------
     Aba exclusiva da conta gestora: cria contas para os usuários
     internos da concessionária, restringe as áreas que cada uma
     acessa, bloqueia/desbloqueia, redefine senha e exclui. As
     contas nascem PENDENTES — só entram depois que o administrador
     Fullgas aprova (mesma fila de qualquer concessionário). Um
     sub-dealer não vê esta aba nem cria outras contas.
     ========================================================= */
  function renderSubdealers() {
    setCrumb(['Subdealers']); setTabOn('subdealers');
    view.innerHTML = '<h2>Subdealers</h2><p class="muted">Carregando…</p>';

    var vigente = telaVigente();
    FG.conta().then(function (c) {
      if (!vigente()) return;
      if (!c) { view.innerHTML = '<h2>Subdealers</h2><p class="muted">Não foi possível carregar os dados. Tente de novo.</p>'; return; }

      var internas = (c.usuarios || []).filter(function (u) { return !u.gestor; });
      var html =
        '<h2>Subdealers</h2>' +
        '<p class="muted" style="font-size:13px;">Contas para os usuários internos da concessionária. ' +
        'Você escolhe as áreas do site que cada uma acessa. As contas novas ficam ' +
        '<b>pendentes até o administrador Fullgas aprovar</b> — o mesmo trâmite de qualquer cadastro.</p>' +

        '<h3 class="sec-title">Contas internas</h3>' +
        '<table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Acesso</th><th>Status</th>' +
        '<th>Ações</th></tr></thead><tbody>' +
        (internas.length ? internas.map(function (u) {
          return '<tr><td>' + esc(u.nome) + '</td><td>' + esc(u.email) + '</td>' +
            '<td style="font-size:12px;">' + permTexto(u.permissoes) + '</td>' +
            '<td><span class="pill-status ' + esc(u.status) + '">' + esc(u.status) + '</span></td>' +
            '<td class="nowrap">' +
              '<button class="tool" data-ed="' + u.id + '">Permissões</button> ' +
              (u.status === 'pendente'
                ? '<span class="muted" style="font-size:11px;">aguardando aprovação</span> '
                : '<button class="tool" data-bl="' + u.id + '" data-st="' + u.status + '">' + (u.status === 'bloqueado' ? 'Desbloquear' : 'Bloquear') + '</button> ') +
              '<button class="tool" data-sn="' + u.id + '">Redefinir senha</button> ' +
              '<button class="tool danger" data-del="' + u.id + '" data-nome="' + esc(u.nome) + '">Excluir</button></td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted">Nenhuma conta interna ainda.</td></tr>') +
        '</tbody></table>' +

        /* form de nova conta interna */
        '<div class="conta-nova" id="ct-nova">' +
        '<h3 class="sec-title">Nova conta interna</h3>' +
        '<div class="conta-grid">' +
        '<div class="field"><label for="sd-nome">Nome</label><input id="sd-nome" type="text" placeholder="Nome do funcionário"></div>' +
        '<div class="field"><label for="sd-email">E-mail</label><input id="sd-email" type="email" placeholder="email@suaempresa.com.br"></div>' +
        '<div class="field"><label for="sd-senha">Senha</label><input id="sd-senha" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>' +
        '</div>' +
        '<div class="field"><label>Áreas permitidas</label><div class="perm-list" id="sd-perms">' +
        c.areas.map(function (a) {
          return '<label class="perm-chk"><input type="checkbox" value="' + a + '" checked> ' + (AREA_LABELS[a] || a) + '</label>';
        }).join('') +
        '</div></div>' +
        '<button class="btn red" id="sd-criar" type="button">Criar conta interna</button>' +
        '</div>';

      view.innerHTML = html;

      /* criar conta interna */
      document.getElementById('sd-criar').addEventListener('click', function () {
        var perms = [];
        Array.prototype.forEach.call(document.querySelectorAll('#sd-perms input:checked'), function (i) { perms.push(i.value); });
        var dados = {
          nome: document.getElementById('sd-nome').value.trim(),
          email: document.getElementById('sd-email').value.trim(),
          senha: document.getElementById('sd-senha').value,
          permissoes: perms
        };
        if (!dados.nome || !dados.email || !dados.senha) { FG.toast('Preencha nome, e-mail e senha.', 'erro'); return; }
        if (dados.senha.length < 8) { FG.toast('A senha precisa de ao menos 8 caracteres.', 'erro'); return; }
        FG.subdealerCriar(dados).then(function (r) {
          if (!r.ok) { FG.toast(r.msg || 'Não foi possível criar a conta.', 'erro'); return; }
          FG.toast(r.msg || 'Conta interna criada. Aguarde a aprovação do administrador.');
          renderSubdealers();
        });
      });

      /* ações das contas internas */
      Array.prototype.forEach.call(view.querySelectorAll('[data-bl]'), function (b) {
        b.addEventListener('click', function () {
          var novo = b.getAttribute('data-st') === 'bloqueado' ? 'aprovado' : 'bloqueado';
          FG.subdealerEditar(b.getAttribute('data-bl'), { status: novo }).then(function (r) {
            if (!r.ok) { FG.toast(r.msg || 'Falhou.', 'erro'); return; }
            FG.toast(novo === 'bloqueado' ? 'Conta bloqueada.' : 'Conta desbloqueada.');
            renderSubdealers();
          });
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-sn]'), function (b) {
        b.addEventListener('click', function () {
          var senha = prompt('Nova senha para esta conta (mínimo 8 caracteres):');
          if (senha == null) return;
          if (senha.length < 8) { FG.toast('A senha precisa de ao menos 8 caracteres.', 'erro'); return; }
          FG.subdealerEditar(b.getAttribute('data-sn'), { senha: senha }).then(function (r) {
            if (!r.ok) { FG.toast(r.msg || 'Falhou.', 'erro'); return; }
            FG.toast('Senha redefinida.');
          });
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ed]'), function (b) {
        b.addEventListener('click', function () {
          var id = Number(b.getAttribute('data-ed'));
          var u = internas.find(function (x) { return x.id === id; });
          if (!u) return;
          abrirPermissoes(u, c.areas);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var nome = b.getAttribute('data-nome') || 'esta conta';
          if (!confirm('Excluir a conta interna de ' + nome + '? Esta ação não pode ser desfeita.')) return;
          FG.subdealerExcluir(b.getAttribute('data-del')).then(function (r) {
            if (!r.ok) { FG.toast(r.msg || 'Não foi possível excluir.', 'erro'); return; }
            FG.toast('Conta interna excluída.');
            renderSubdealers();
          });
        });
      });

      /* modal simples p/ editar permissões de uma conta interna */
      function abrirPermissoes(u, areas) {
        var atual = Array.isArray(u.permissoes) ? u.permissoes : areas.slice();
        var back = document.createElement('div');
        back.className = 'modal-back';
        back.innerHTML = '<div class="modal" style="max-width:440px;">' +
          '<header><h3>Permissões — ' + esc(u.nome) + '</h3><button class="x" type="button" aria-label="Fechar">×</button></header>' +
          '<div class="modal-body">' +
          '<p class="muted" style="font-size:12px;margin-top:0;">Marque as áreas que esta conta pode acessar. ' +
          'A mudança vale a partir do próximo login da conta.</p>' +
          '<div class="perm-list" id="pm-list">' +
          areas.map(function (a) {
            return '<label class="perm-chk"><input type="checkbox" value="' + a + '"' +
              (atual.indexOf(a) !== -1 ? ' checked' : '') + '> ' + (AREA_LABELS[a] || a) + '</label>';
          }).join('') +
          '</div>' +
          '<button class="btn red" id="pm-salvar" type="button" style="margin-top:14px;">Salvar permissões</button>' +
          '</div></div>';
        document.body.appendChild(back);
        function fechar() { back.remove(); }
        back.querySelector('.x').addEventListener('click', fechar);
        document.getElementById('pm-salvar').addEventListener('click', function () {
          var perms = [];
          Array.prototype.forEach.call(back.querySelectorAll('#pm-list input:checked'), function (i) { perms.push(i.value); });
          FG.subdealerEditar(u.id, { permissoes: perms }).then(function (r) {
            if (!r.ok) { FG.toast(r.msg || 'Falhou.', 'erro'); return; }
            FG.toast('Permissões salvas — valem a partir do próximo login.');
            fechar(); renderSubdealers();
          });
        });
      }
    });
  }

  /* =========================================================
     SUPORTE TÉCNICO (helpdesk)
     ---------------------------------------------------------
     A tela cheia do mesmo helpdesk que o pop-up flutuante do canto da tela
     (js/suporte.js) oferece. A divisão de trabalho entre os dois:

       pop-up  abre chamado de qualquer tela e avisa quando há resposta;
       esta    lista tudo e é onde a conversa acontece.

     Os chamados NÃO vêm do cache do FG: são buscados a cada render. Conversa
     envelhece rápido, e uma resposta do suporte guardada em cache seria uma
     resposta que o revendedor não vê até recarregar a página.
     ========================================================= */
  // 'andamento' (o que ainda espera alguém) | 'encerrados' | 'todos'
  var supFiltro = 'andamento';

  /* Qual chamado está desenhado na tela AGORA, e qual foi a última mensagem
     que já apareceu nele. É o que permite ao batimento (js/ao-vivo.js) colar
     só as mensagens novas no fim da conversa em vez de redesenhar a tela —
     redesenhar apagaria o que o revendedor está digitando na caixa de
     resposta. null = não estamos dentro de um chamado. */
  var supAberto = null;   // { id, ultimoId, status }

  function supMaiorId(conversa) {
    return (conversa || []).reduce(function (mx, m) {
      return Number(m.id) > mx ? Number(m.id) : mx;
    }, 0);
  }

  var SUP_SLUG = {
    'Aberto': 'aberto',
    'Em atendimento': 'atendimento',
    'Aguardando cliente': 'aguardando',
    'Resolvido': 'resolvido',
    'Fechado': 'fechado'
  };
  function supPill(st) {
    return '<span class="sup-st sup-st-' + (SUP_SLUG[st] || 'aberto') + '">' + esc(st) + '</span>';
  }
  function supEncerrado(st) { return st === 'Resolvido' || st === 'Fechado'; }
  // O banco guarda a urgência em minúscula ('alta'); a tela mostra o rótulo.
  var SUP_PRIO = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta' };
  function supPrio(p) { return SUP_PRIO[p] || p || 'Normal'; }

  // Abrir chamado é sempre pelo pop-up — ver o comentário em js/suporte.js.
  function supAbrirFormulario() {
    if (FG.suporteWidget) { FG.suporteWidget.abrirFormulario(); return; }
    FG.toast('Chamados são abertos pelas concessionárias; o administrador responde pelo painel.', 'erro');
  }

  // Algo mudou no suporte: os DOIS contadores precisam saber.
  //
  // O badge 🎧 do pop-up conta mensagens não lidas; a carta ✉️ do topo conta
  // notificações. Abrir um chamado zera os dois no servidor (a API marca as
  // mensagens E as notificações daquele chamado como lidas), então deixar de
  // recarregar aqui deixaria a carta acesa apontando para uma conversa que o
  // usuário acabou de ler.
  function supMudou() {
    window.dispatchEvent(new Event('fg-suporte-mudou'));
    FG.recarregarNotifs().then(refreshPill);
    // Realinha o batimento com o que ACABOU de acontecer. Sem isto, o próximo
    // ciclo compararia os números novos com um retrato anterior à ação do
    // usuário e anunciaria como "novidade" a resposta que ele mesmo enviou.
    if (FG.aoVivo) FG.aoVivo.agora();
  }

  function renderSuporte() {
    setCrumb(['Suporte Técnico']); setTabOn('suporte');
    view.innerHTML = '<h2>Suporte Técnico</h2><p class="muted">Carregando chamados…</p>';

    var vigente = telaVigente();
    FG.suporteChamados().then(function (todos) {
      if (!vigente()) return;
      var lista = todos.filter(function (c) {
        if (supFiltro === 'todos') return true;
        return supFiltro === 'encerrados' ? supEncerrado(c.status) : !supEncerrado(c.status);
      });

      function btnF(chave, rotulo) {
        return '<button type="button" class="' + (supFiltro === chave ? 'on' : '') +
          '" data-sup-f="' + chave + '">' + rotulo + '</button>';
      }

      var html =
        '<div class="sup-page-head"><h2>Suporte Técnico</h2><span class="grow"></span>' +
        '<button class="btn red" id="sup-page-novo" type="button">＋ Abrir chamado</button></div>' +
        '<p class="muted" style="margin-top:-6px;">Dúvida, problema no portal ou pedido travado? Abra um chamado — ' +
        'a resposta do suporte aparece aqui e no ícone 🎧 do canto da tela.</p>' +
        '<div class="sup-filtros">' + btnF('andamento', 'Em andamento') +
        btnF('encerrados', 'Encerrados') + btnF('todos', 'Todos') + '</div>';

      if (!lista.length) {
        html += '<p class="muted">' + (todos.length
          ? 'Nenhum chamado neste filtro.'
          : 'Você ainda não abriu nenhum chamado.') + '</p>';
      } else {
        html += '<table class="table sup-tabela"><thead><tr>' +
          '<th>Chamado</th><th>Assunto</th><th>Categoria</th><th>Status</th>' +
          '<th>Última movimentação</th></tr></thead><tbody>' +
          lista.map(function (c) {
            return '<tr class="' + (c.naoLidas ? 'tem-novo' : '') + '">' +
              '<td class="num nowrap"><a href="#suporte/' + c.id + '">' + esc(c.numero) + '</a></td>' +
              '<td>' + esc(c.assunto) +
              (c.naoLidas ? '<span class="sup-badge-novo">' + c.naoLidas + ' nova' +
                (c.naoLidas > 1 ? 's' : '') + '</span>' : '') + '</td>' +
              '<td>' + esc(c.categoriaNome) + '</td>' +
              '<td>' + supPill(c.status) + '</td>' +
              '<td class="nowrap">' + FG.fmtDateTime(c.atualizadoEm) + '</td></tr>';
          }).join('') +
          '</tbody></table>';
      }

      view.innerHTML = html;
      document.getElementById('sup-page-novo').addEventListener('click', supAbrirFormulario);
      Array.prototype.forEach.call(view.querySelectorAll('[data-sup-f]'), function (b) {
        b.addEventListener('click', function () {
          supFiltro = b.getAttribute('data-sup-f');
          renderSuporte();
        });
      });
    }, function () {
      if (!vigente()) return;
      view.innerHTML = '<h2>Suporte Técnico</h2>' +
        '<p class="muted">Não foi possível carregar seus chamados agora. Tente de novo em instantes.</p>';
    });
  }

  function renderSuporteChamado(id) {
    setCrumb(['Suporte Técnico', 'Chamado']); setTabOn('suporte');
    view.innerHTML = '<p class="muted">Carregando chamado…</p>';

    var vigente = telaVigente();
    FG.suporteChamado(id).then(function (c) {
      // Saiu antes de abrir: não desenha e não se registra como chamado aberto
      // (o batimento colaria mensagens numa tela que não é a dele).
      if (!vigente()) return;
      if (!c) {
        view.innerHTML = '<h2>Chamado</h2><p class="muted">Chamado não encontrado.</p>' +
          '<p><a href="#suporte">Voltar para os chamados</a></p>';
        return;
      }
      setCrumb(['Suporte Técnico', c.numero]);
      // Abrir o detalhe marcou as respostas como lidas no servidor: o badge do
      // pop-up precisa saber, senão continua contando o que já foi lido.
      supMudou();

      var encerrado = supEncerrado(c.status);
      var html =
        '<div class="sup-det-head">' +
        '<h3>' + esc(c.numero) + ' — ' + esc(c.assunto) + ' ' + supPill(c.status) + '</h3>' +
        '<div class="sup-det-meta">' +
        '<div><span class="lbl">Categoria</span>' + esc(c.categoriaNome) + '</div>' +
        '<div><span class="lbl">Urgência</span>' + esc(supPrio(c.prioridade)) + '</div>' +
        '<div><span class="lbl">Aberto por</span>' + esc(c.autor) + '</div>' +
        '<div><span class="lbl">Abertura</span>' + FG.fmtDateTime(c.criadoEm) + '</div>' +
        (c.atendente ? '<div><span class="lbl">Atendimento</span>' + esc(c.atendente) + '</div>' : '') +
        '</div>' +
        '<div class="sup-det-acoes">' +
        '<a href="#suporte" class="link-action">‹ Todos os chamados</a><span style="flex:1;"></span>' +
        (c.status === 'Fechado'
          ? '<button class="btn" id="sup-reabrir" type="button">Reabrir chamado</button>'
          : '<button class="btn" id="sup-encerrar" type="button">Encerrar chamado</button>') +
        '</div></div>';

      html += '<div class="sup-conversa">' + (c.conversa || []).map(supMensagemHtml).join('') + '</div>';

      if (c.status === 'Fechado') {
        html += '<div class="sup-fechado-aviso">Este chamado está fechado. Reabra-o acima para voltar a ' +
          'conversar, ou abra um novo chamado.</div>';
      } else {
        html += '<div class="sup-responder">' +
          '<div class="field"><label for="sup-resp-txt">' +
          (encerrado ? 'Ainda não resolveu? Responda e o chamado volta para a fila.' : 'Sua resposta') +
          '</label>' +
          '<textarea id="sup-resp-txt" rows="4" maxlength="4000" placeholder="Escreva sua resposta…"></textarea></div>' +
          '<div class="sup-resp-foot">' +
          '<input type="file" id="sup-resp-anexo" accept="image/*,video/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.csv,.txt">' +
          '<span class="grow"></span>' +
          '<button class="btn red" id="sup-resp-enviar" type="button">Enviar resposta</button>' +
          '</div></div>';
      }

      view.innerHTML = html;
      FG.carregarArquivos(view);      // anexos são privados: vêm por fetch autenticado

      // A partir daqui o batimento sabe o que está na tela e até onde a
      // conversa já foi desenhada.
      supAberto = { id: c.id, ultimoId: supMaiorId(c.conversa), status: c.status };

      var bEnc = document.getElementById('sup-encerrar');
      if (bEnc) bEnc.addEventListener('click', function () {
        if (!confirm('Encerrar o chamado ' + c.numero + '?')) return;
        bEnc.disabled = true;
        FG.suporteStatus(c.id, 'Fechado').then(function (r) {
          if (!r.ok) { FG.toast(r.msg || 'Não foi possível encerrar.', 'erro'); bEnc.disabled = false; return; }
          FG.toast('Chamado encerrado.');
          supMudou(); renderSuporteChamado(c.id);
        });
      });

      var bReab = document.getElementById('sup-reabrir');
      if (bReab) bReab.addEventListener('click', function () {
        bReab.disabled = true;
        FG.suporteStatus(c.id, 'Aberto').then(function (r) {
          if (!r.ok) { FG.toast(r.msg || 'Não foi possível reabrir.', 'erro'); bReab.disabled = false; return; }
          FG.toast('Chamado reaberto.');
          supMudou(); renderSuporteChamado(c.id);
        });
      });

      var bEnv = document.getElementById('sup-resp-enviar');
      if (bEnv) bEnv.addEventListener('click', function () {
        var txt = document.getElementById('sup-resp-txt').value.trim();
        var arq = document.getElementById('sup-resp-anexo').files[0] || null;
        if (!txt && !arq) { FG.toast('Escreva a mensagem (ou anexe um arquivo).', 'erro'); return; }
        bEnv.disabled = true; bEnv.textContent = 'Enviando…';
        FG.suporteResponder(c.id, { texto: txt, anexo: arq }).then(function (r) {
          if (!r.ok) {
            bEnv.disabled = false; bEnv.textContent = 'Enviar resposta';
            FG.toast(r.msg || 'Não foi possível enviar.', 'erro');
            return;
          }
          FG.toast('Resposta enviada.');
          supMudou(); renderSuporteChamado(c.id);
        });
      });
    }, function () {
      if (!vigente()) return;
      view.innerHTML = '<h2>Chamado</h2>' +
        '<p class="muted">Não foi possível carregar o chamado agora. Tente de novo em instantes.</p>' +
        '<p><a href="#suporte">Voltar para os chamados</a></p>';
    });
  }

  // Uma mensagem da conversa. 'sistema' é a mudança de status: entra como uma
  // linha discreta no meio do fio, sem balão nem autor.
  function supMensagemHtml(m) {
    if (m.autor === 'sistema') {
      return '<div class="sup-msg de-sistema">' + esc(m.texto) + ' · ' + FG.fmtDateTime(m.criadoEm) + '</div>';
    }
    var anexo = '';
    if (m.anexo) {
      // data-arquivo (e não src/href): o anexo é privado e sai por
      // /api/arquivos, que confere de quem é. FG.carregarArquivos resolve.
      if (m.anexoTipo === 'imagem') anexo = '<img class="sup-anexo-img" data-arquivo="' + esc(m.anexo) + '" alt="Anexo" loading="lazy">';
      else if (m.anexoTipo === 'video') anexo = '<video class="sup-anexo-video" data-arquivo="' + esc(m.anexo) + '" controls preload="metadata"></video>';
      else anexo = '<a class="link-action" data-arquivo="' + esc(m.anexo) + '" target="_blank" rel="noopener">📎 Abrir anexo</a>';
    }
    // Aqui quem lê é o revendedor: o lado dele (autor 'cliente' — dele ou de um
    // colega da concessionária) vai para a direita, como em qualquer conversa.
    return '<div class="sup-msg de-' + (m.autor === 'admin' ? 'outro' : 'mim') + '">' +
      '<span class="sup-msg-quem">' + esc(m.autor === 'admin' ? ('Suporte Fullgas' + (m.autorNome ? ' · ' + m.autorNome : '')) : (m.autorNome || 'Você')) + '</span>' +
      (m.texto ? '<span class="sup-msg-txt">' + esc(m.texto) + '</span>' : '') +
      anexo +
      '<span class="sup-msg-hora">' + FG.fmtDateTime(m.criadoEm) + '</span>' +
      '</div>';
  }

  /* =========================================================
     AO VIVO — o que fazer quando o batimento diz que mudou
     ---------------------------------------------------------
     js/ao-vivo.js pergunta ao servidor de 10 em 10 segundos e dispara
     `fg-pulso` só quando algum número se mexeu. Aqui decidimos o efeito na
     tela, e a regra que organiza tudo é uma só:

       NUNCA REDESENHAR O QUE O USUÁRIO ESTÁ USANDO.

     Dentro de um chamado, as mensagens novas são COLADAS no fim da conversa.
     Redesenhar a tela inteira apagaria o texto meio digitado na caixa de
     resposta e o arquivo já escolhido no anexo — e faria isso no meio de uma
     frase, a cada 10 segundos.
     ========================================================= */

  // Cola no fim da conversa as mensagens que ainda não estão na tela.
  function supAnexarNovas() {
    var alvo = supAberto;
    if (!alvo) return;

    FG.suporteChamado(alvo.id).then(function (c) {
      // A resposta demorou e o usuário já saiu (ou trocou de chamado):
      // despejar as mensagens agora as colaria na tela errada.
      if (!c || !supAberto || supAberto.id !== alvo.id) return;

      var novas = (c.conversa || []).filter(function (m) {
        return Number(m.id) > alvo.ultimoId;
      });

      // O status muda sem mensagem nova? O rótulo do topo é trocado no lugar,
      // sem tocar no resto da tela.
      if (c.status !== supAberto.status) {
        var pill = view.querySelector('.sup-det-head .sup-st');
        if (pill) pill.outerHTML = supPill(c.status);
        supAberto.status = c.status;
      }

      if (!novas.length) return;

      var fio = view.querySelector('.sup-conversa');
      if (!fio) return;

      // innerHTML num elemento solto e depois append: o innerHTML += no
      // próprio fio recriaria os balões antigos, e os anexos já resolvidos
      // (URLs de blob) morreriam junto.
      var caixa = document.createElement('div');
      caixa.innerHTML = novas.map(supMensagemHtml).join('');
      var ultimo = null;
      while (caixa.firstChild) { ultimo = fio.appendChild(caixa.firstChild); }

      FG.carregarArquivos(fio);       // anexos das mensagens recém-coladas
      supAberto.ultimoId = supMaiorId(c.conversa);

      // Buscar o chamado marcou as mensagens como lidas no servidor: a carta
      // ✉️ e o badge 🎧 precisam saber, senão ficariam acesos apontando para
      // uma conversa que o usuário está lendo neste instante.
      supMudou();

      // Só avisa se veio alguém do outro lado. Mensagem do próprio revendedor
      // (enviada de outra aba) e linha de sistema não merecem interromper.
      if (novas.some(function (m) { return m.autor === 'admin'; })) {
        FG.toast('O suporte respondeu no chamado ' + c.numero + '.');
      }
      if (ultimo && ultimo.scrollIntoView) {
        ultimo.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  window.addEventListener('fg-pulso', function (e) {
    var mudou = e.detail.mudou;

    // A carta ✉️ do topo. É o pedido central: o número acende sozinho, sem
    // recarregar a página. `refreshPill` já existia — só nunca era chamado
    // por iniciativa do servidor.
    if (mudou.notificacoes) {
      FG.recarregarNotifs().then(function () {
        refreshPill();
        // Só quando SOBE. Piscar porque o número caiu (o usuário leu a
        // notificação em outra aba) seria alarme ao contrário.
        if (mudou.chegouNotificacao) piscarPill();
        // A caixa de entrada aberta na tela também fica velha.
        if (location.hash === '#notificacoes') renderNotifs();
      });
    }

    if (!mudou.suporte) return;

    if (supAberto) {
      supAnexarNovas();                 // dentro do chamado: cola as novas
    } else if (location.hash === '#suporte') {
      renderSuporte();                  // na lista: redesenhar não perde nada
    }
  });

  // O pop-up avisa quando abriu um chamado novo: a lista atrás dele se atualiza
  // sozinha, em vez de mostrar um estado que já não é verdade.
  window.addEventListener('fg-suporte-novo', function () {
    // Só quando a LISTA está na tela. Estando dentro de um chamado
    // (#suporte/12), redesenhar jogaria a conversa fora sem o usuário pedir.
    if (location.hash === '#suporte') renderSuporte();
  });

  /* =========================================================
     BUSCA GLOBAL
     ========================================================= */
  function renderBusca(q) {
    setCrumb(['Pesquisa']); setTabOn('');
    var termo = decodeURIComponent(q || '').trim();
    var t = termo.toLowerCase();

    var vehs = FG.all('vehicles').filter(function (v) { return v.niv.toLowerCase().indexOf(t) >= 0; });
    var prods = FG.all('products').filter(function (p) {
      return p.artigo.toLowerCase().indexOf(t) >= 0 || p.nome.toLowerCase().indexOf(t) >= 0;
    });
    var mods = FG.all('models').filter(function (m) { return m.label.toLowerCase().indexOf(t) >= 0; });
    FG.logSearch(termo, vehs.length + prods.length + mods.length);

    var html = '<h2>Resultados para “' + esc(termo) + '”</h2>';
    if (!vehs.length && !prods.length && !mods.length) html += '<p class="muted">Nada encontrado.</p>';

    if (vehs.length) {
      html += '<h3>Veículos</h3><table class="table"><tbody>' + vehs.map(function (v) {
        return '<tr><td><a href="#acoes/' + v.niv + '">' + v.niv + '</a></td><td>' + esc(modelName(v.modeloId)) + '</td><td>' + esc(v.status) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (mods.length) {
      html += '<h3 style="margin-top:18px;">Modelos</h3><table class="table"><tbody>' + mods.map(function (m) {
        return '<tr><td>' + esc(m.label) + '</td><td><a href="/finder#/modelo/' + m.id + '/chassi">Abrir no Parts Finder</a></td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (prods.length) {
      html += '<h3 style="margin-top:18px;">Artigos</h3><table class="table"><tbody>' + prods.slice(0, 25).map(function (p) {
        return '<tr><td><a href="/loja#/produto/' + p.artigo + '">' + p.artigo + '</a></td><td>' + esc(p.nome) + '</td>' +
          '<td class="right">' + FG.fmtMoney(p.preco) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    view.innerHTML = html;
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    var h = (location.hash || '#home').slice(1);
    var partes = h.split('/');
    var rota = partes[0] || 'home';
    // Conta interna sem a área não entra nem por hash direto.
    if (GATE_ROTAS[rota] && !FG.temArea(sess, GATE_ROTAS[rota])) {
      FG.toast('Sua conta não tem acesso a esta área. Fale com o gestor da concessionária.', 'erro');
      location.hash = '#home';
      return;
    }
    // Subdealers é exclusivo do gestor: sub-dealer não gerencia (nem cria) outras contas.
    if (rota === 'subdealers' && !ehGestor) {
      FG.toast('Apenas a conta gestora da concessionária gerencia os sub-dealers.', 'erro');
      location.hash = '#home';
      return;
    }
    // Sair de um chamado (para onde for) apaga o alvo do batimento. Quem
    // continuar num chamado o preenche de novo ao terminar de desenhar.
    supAberto = null;
    telaSeq++;   // respostas pendentes da tela anterior não desenham mais

    switch (rota) {
      case 'home': renderHome(); break;
      case 'notificacoes': renderNotifs(); break;
      case 'reivindicacoes': renderClaims(); break;
      case 'pedidos': renderPedidos(); break;
      case 'pedido': renderPedidoDetalhe(partes[1]); break;
      case 'acoes': renderAcoes(partes[1]); break;
      case 'estoque': renderEstoque(); break;
      case 'financeiro': renderFinanceiro(); break;
      case 'conta': renderConta(); break;
      // #suporte = lista; #suporte/12 = o chamado 12. Sem trava de área: pedir
      // ajuda é o único caminho de quem PERDEU o acesso a alguma coisa.
      case 'suporte':
        if (partes[1]) renderSuporteChamado(partes[1]); else renderSuporte();
        break;
      case 'subdealers': renderSubdealers(); break;
      case 'busca': renderBusca(partes.slice(1).join('/')); break;
      default: renderHome();
    }
    refreshPill();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();

  }); // fim FG.pronto.then — tela montada só após o cache chegar
})();
