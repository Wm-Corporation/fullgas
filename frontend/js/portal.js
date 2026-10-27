/* =========================================================
   FULLGAS B2B — Portal do concessionário (portal.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  // Espera o cache carregar antes de montar a tela.
  FG.pronto.then(function () {

  var view = document.getElementById('view');
  var crumb = document.getElementById('crumb');
  var esc = FG.esc;

  /* ---------- cabeçalho ---------- */
  // Admin aparece como Fábrica.
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

  // Aba "Subdealers": só gestor ou admin.
  var ehGestor = !!(sess.gestor || sess.papel === 'admin');
  if (ehGestor) document.getElementById('tab-subdealers').classList.remove('hidden');

  /* ---------- permissões por área: abas bloqueadas somem (o roteador também barra) ---------- */
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

  // Faz o badge da carta pulsar por alguns segundos quando chega algo.
  function piscarPill() {
    var pill = document.getElementById('notif-pill');
    if (!pill) return;
    pill.classList.remove('novo');
    // Força o navegador a reiniciar a animação.
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

  // Mínimo de fotos/vídeos por reivindicação (a API exige na aprovação).
  var FOTOS_MINIMAS = 3;

  // Cada troca de tela ganha um número; resposta atrasada de outra tela não desenha.
  var telaSeq = 0;
  function telaVigente() {
    var minha = telaSeq;
    return function () { return minha === telaSeq; };
  }

  /* ---------- util ---------- */
  function setCrumb(partes) {
    // Fora da home, VOLTAR abre a trilha.
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
      // Contagem por criador.
      var g = grupos[c.criador] || (grupos[c.criador] = { total: 0, analise: 0, aprovadas: 0, recusadas: 0 });
      g.total++;
      if (c.status === 'Em processo') g.analise++;
      if (c.status === 'Aprovada') g.aprovadas++;
      if (c.status === 'Recusada') g.recusadas++;
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
      '<table class="claims-mini"><thead><tr><th></th><th>Total</th><th>Em análise</th><th>Aprovadas</th><th>Recusadas</th></tr></thead><tbody>';
    nomes.forEach(function (n) {
      var g = grupos[n];
      html += '<tr><td>' + esc(n) + '</td><td class="num"><b>' + g.total + '</b></td>' +
        '<td class="hq">' + g.analise + '</td><td class="num">' + g.aprovadas + '</td>' +
        '<td class="num">' + g.recusadas + '</td></tr>';
    });
    if (!nomes.length) html += '<tr><td colspan="5" class="muted">Nenhuma reivindicação ainda.</td></tr>';
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
      // Anexo privado: data-arquivo, preenchido por FG.carregarArquivos.
      var anexo = '';
      if (n.anexo) {
        if (n.anexoTipo === 'imagem') anexo = '<img class="nt-img" data-arquivo="' + esc(n.anexo) + '" alt="Anexo" loading="lazy">';
        else if (n.anexoTipo === 'video') anexo = '<video class="nt-video" data-arquivo="' + esc(n.anexo) + '" controls preload="metadata"></video>';
        else anexo = '<a class="link-action" data-arquivo="' + esc(n.anexo) + '" target="_blank" rel="noopener">📎 Abrir anexo</a>';
      }
      // Aviso de chamado: link para a conversa (admin vai ao painel).
      var linkChamado = n.chamadoId
        ? '<a class="link-action nt-chamado" href="' +
          (sess.papel === 'admin' ? '/admin#suporte/' : '#suporte/') + esc(n.chamadoId) +
          '">Abrir chamado &rsaquo;</a>'
        : '';

      // Link interno (só rotas do portal, começando por '#'), ex.: carrinho da black order.
      var linkInterno = n.link && /^#[\w/-]+$/.test(n.link)
        ? '<a class="link-action nt-chamado" href="' + esc(n.link) + '">' +
          (n.link.indexOf('carrinho') >= 0 ? 'Abrir carrinho da black order' : 'Abrir') + ' &rsaquo;</a>'
        : '';

      html += '<div class="notif ' + n.tipo + (n.lida ? '' : ' unread') + '">' +
        '<div class="nt-body"><div class="nt-title">' + (n.tipo === 'critica' ? '⚠ ' : '') + esc(n.titulo) + '</div>' +
        (n.texto ? '<div style="white-space:pre-line;">' + esc(n.texto) + '</div>' : '') +
        anexo + linkChamado + linkInterno +
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
  // Sub-aba: 'veiculo' (por NIV) | 'varejo' (por pedido).
  var claimAba = 'veiculo';

  // Rascunhos ("Esboço") ficam só no navegador.
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
    // Só as da sub-aba. Sem origem = 'veiculo'; pré-entrega fica junto com veículo.
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
      // Rascunhos só no fluxo de veículo.
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
      '<span>País</span><span>Criador da reivindicação</span><span>Tipo</span><span>Status</span><span></span></div>' +
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
          '<div><span class="cell-label">País</span><span class="cell-value">' + esc(c.pais) + '</span></div>' +
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
     FOTOS E VÍDEOS DA REIVINDICAÇÃO — soma escolhas até MAX_MIDIA, com X e tela cheia
     --------------------------------------------------------- */
  var MAX_MIDIA = 5;
  var RE_VIDEO = /\.(mp4|webm|mov|avi|mkv|m4v|3gp|ogv|mpe?g)$/i;
  function ehVideo(f) { return (f.type || '').indexOf('video/') === 0 || RE_VIDEO.test(f.name || ''); }

  // Foto/vídeo em tela cheia sobre o formulário. Fecha no X.
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

  // Liga o seletor ao formulário. Devolve arquivos() e liberar() (solta os blobs).
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
      // Zera o campo para poder escolher de novo o mesmo arquivo.
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
        return '<option value="' + v.niv + '">' + v.niv + ' — ' + esc(FG.modeloDaUnidade(v)) +
          (v.venda ? '' : ' (em estoque)') + '</option>';
      }).join('') +
      '</select></div>' +
      // Ficha da moto escolhida.
      '<div id="nc-veic"></div>' +
      // Aviso de pré-entrega (aparece se o chassi não tem venda registrada).
      '<div class="pre-entrega-aviso hidden" id="nc-pe-aviso">' +
      '<b class="pe-titulo">🛠 Garantia de pré-entrega</b>' +
      '<span>Este chassi ainda não tem venda registrada, então a reivindicação será aberta como ' +
      '<b>pré-entrega</b>: o defeito foi constatado na inspeção, com a moto ainda no seu estoque. ' +
      'O prazo de garantia do comprador não começa a contar por causa disso — ele só passa a correr ' +
      'quando você registrar a venda.</span></div>' +
      '<div class="field"><label>Peça(s) defeituosa(s) *</label>' +
      '<div class="peca-add">' +
      // Autocomplete próprio.
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
    // Só o X fecha (clique fora não perde o preenchido).
    back.querySelector('.x').addEventListener('click', fechar);

    /* ---- Modo pré-entrega: chassi sem venda → sem Tipo, horas e km; rótulo da data muda ---- */
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
      var vSel = vehs.find(function (x) { return x.niv === selNiv.value; });
      document.getElementById('nc-veic').innerHTML = vSel ? FG.fichaVeiculoResumo(vSel) : '';
      var pe = ehPreEntrega();
      avisoPE.classList.toggle('hidden', !pe);
      campoTipo.classList.toggle('hidden', pe);
      campoHoras.classList.toggle('hidden', pe);
      campoKm.classList.toggle('hidden', pe);
      lblData.textContent = pe ? 'Data da inspeção *' : 'Data do ocorrido *';
    }
    selNiv.addEventListener('change', aplicarModo);

    // Texto digitado → SKU. '' (vazio), SKU ou null (não encontrado).
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

    // Autocomplete: até 8 sugestões; setas, Enter, Esc e clique.
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
    // Recalcula o modo pelo chassi selecionado.
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

    // Campos no formato da API (pré-entrega sem horas/km).
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

    // ENVIAR: cria ou atualiza+reenvia e sobe as fotos, com cortina de envio.
    document.getElementById('nc-env').addEventListener('click', async function () {
      var d = coletar();
      if (!validarEnvio(d)) return;
      var jaEnviadas = (modo === 'editar' && ctx.claim && ctx.claim.anexos) ? ctx.claim.anexos.length : 0;
      if (jaEnviadas + midia.arquivos().length < FOTOS_MINIMAS) {
        FG.toast('Envie no mínimo ' + FOTOS_MINIMAS + ' fotos ou vídeos' +
          (jaEnviadas ? ' (já há ' + jaEnviadas + ').' : '.'), 'erro');
        return;
      }

      // Cortina sobre o overlay inteiro, centralizada.
      var cortina = document.createElement('div');
      cortina.className = 'claim-envio';
      cortina.innerHTML = '<div class="claim-envio-card"><div class="fg-spinner"></div>' +
        '<p><b>Enviando sua garantia…</b></p></div>';
      back.appendChild(cortina);

      // Espera mínima, para a cortina não piscar.
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

    // SALVAR COMO ESBOÇO: só no navegador.
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

  // Nova reivindicação de VAREJO: peças de um pedido do revendedor.
  function modalClaimVarejo() {
    // Só pedidos de venda não cancelados.
    var orders = FG.all('orders').filter(function (o) { return !o.garantia && o.status !== 'Cancelado'; });

    // Livre para garantia = enviado menos outras reivindicações (a API confere).
    function livrePorSku(o) {
      var reclamado = {};
      FG.all('claims').forEach(function (c) {
        if (c.numeroPedido !== o.id || c.status === 'Recusada') return;
        (c.pecas || []).forEach(function (p) { reclamado[p.sku] = (reclamado[p.sku] || 0) + p.quantidade; });
      });
      var livre = {};
      (o.itens || []).forEach(function (it) {
        livre[it.artigo] = { enviada: it.qtdEnviada || 0, reclamada: reclamado[it.artigo] || 0,
          livre: Math.max(0, (it.qtdEnviada || 0) - (reclamado[it.artigo] || 0)) };
      });
      return livre;
    }
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
      '<div class="muted" style="font-size:11px;margin-top:4px;">Só peças já enviadas podem entrar na garantia. ' +
      'Envie no mínimo 3 fotos ou vídeos da peça.</div>' +
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

    // Itens do pedido escolhido que ainda têm saldo para reivindicar.
    function itensDoPedido() {
      var o = orders.find(function (x) { return x.id === selPedido.value; });
      if (!o) return [];
      var livre = livrePorSku(o);
      return (o.itens || []).filter(function (it) { return livre[it.artigo].livre > 0; })
        .map(function (it) { return Object.assign({}, it, { saldo: livre[it.artigo] }); });
    }

    // Item atualmente selecionado no seletor de peça (ou null).
    function itemSelecionado() {
      var sku = selItem.value;
      if (!sku) return null;
      return itensDoPedido().find(function (x) { return x.artigo === sku; }) || null;
    }

    // Teto = quantidade comprada do item.
    function atualizarMaxQtd() {
      var it = itemSelecionado();
      var max = it ? it.saldo.livre : 1;
      inpQtd.max = max;
      if ((parseInt(inpQtd.value, 10) || 0) > max) inpQtd.value = max;
      hintQtd.textContent = it
        ? 'Máximo para esta peça: ' + max + ' un. (' + it.saldo.enviada + ' enviada(s)' +
          (it.saldo.reclamada ? ', ' + it.saldo.reclamada + ' já em outra reivindicação' : '') + ').'
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
        selItem.innerHTML = '<option value="">' + (selPedido.value ? 'Nenhuma peça enviada disponível para garantia' : 'Escolha o pedido primeiro') + '</option>';
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
      var max = it ? it.saldo.livre : 1;
      if ((parseInt(inpQtd.value, 10) || 0) > max) {
        inpQtd.value = max;
        FG.toast('Máximo para esta peça: ' + max + ' un. (enviadas e ainda não reclamadas).', 'erro');
      }
    });

    document.getElementById('vj-add').addEventListener('click', function () {
      var sku = selItem.value;
      if (!sku) { FG.toast('Selecione uma peça do pedido.', 'erro'); return; }
      var it = itensDoPedido().find(function (x) { return x.artigo === sku; });
      if (!it) { FG.toast('Peça não pertence ao pedido.', 'erro'); return; }
      var max = it.saldo.livre;
      var q = Math.max(1, parseInt(inpQtd.value, 10) || 1);
      if (q > max) { q = max; FG.toast('Máximo para esta peça: ' + max + ' un. (enviadas e ainda não reclamadas).', 'erro'); }
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
      if (midia.arquivos().length < FOTOS_MINIMAS) {
        FG.toast('Envie no mínimo ' + FOTOS_MINIMAS + ' fotos ou vídeos da peça.', 'erro'); return;
      }

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
    // Arquivo privado: data-arquivo, preenchido por FG.carregarArquivos().
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
    // Ficha da moto (chassi fora do estoque fica só com o NIV).
    var veic = c.origem !== 'varejo' && c.niv
      ? FG.all('vehicles').find(function (x) { return x.niv === c.niv; }) : null;
    back.innerHTML =
      '<div class="modal"><header><h3>Reivindicação ' + esc(c.id) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      (c.sentBack ? '<div class="devolvida-aviso">↩ Devolvida — falta: ' + esc(c.faltaInformacao || 'informações') + '</div>' : '') +
      (c.status === 'Aprovada' ? '<div class="det-credito">✔ Garantia aprovada — as peças serão repostas sem cobrança ' +
        'por um pedido de garantia. Acompanhe na área de pedidos.</div>' : '') +
      (veic ? FG.fichaVeiculoResumo(veic, { ocorrido: c.origem === 'preentrega' ? null : c.dataDefeito }) : '') +
      '<div class="det-grid">' +
      linha('N° da reivindicação', '<b class="cl-num">' + esc(c.id) + '</b>') +
      linha('Status', esc(c.status)) +
      (c.origem === 'varejo'
        ? linha('Origem', 'Varejo (peça de pedido)') +
          linha('Pedido', '<a href="#pedido/' + esc(c.numeroPedido) + '">' + esc(c.numeroPedido) + '</a>') +
          linha('Criador', esc(c.criador || '—')) +
          linha('Data da reivindicação', FG.fmtDateTime(c.data))
        : c.origem === 'preentrega'
          // Pré-entrega: sem "Uso"; a data é da inspeção.
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

  function boDisponiveis() {
    return FG.all('blackorders').filter(function (b) { return b.status === 'Disponivel'; }).length;
  }

  function renderPedidos() {
    setCrumb(pedFiltro === 'Blackorder' ? ['Pedidos', 'Blackorder'] : ['Pedidos']); setTabOn('pedidos');
    var html =
      '<div class="side-layout">' +
      '<aside class="side-nav"><h2>Gestão de pedidos</h2>' +
      '<div class="group-title">Cestas</div>' + nav('Cesta atual') +
      '<div class="group-title">Pedidos</div>' + nav('Ordens pendentes') + nav('Arquivado') +
      '<div class="group-title">Black order</div>' + nav('Blackorder', boDisponiveis()) +
      '</aside>' +
      '<section id="ped-body"></section></div>';
    view.innerHTML = html;

    function nav(n, badge) {
      return '<button class="' + (pedFiltro === n ? 'on' : '') + '" data-f="' + n + '">' + n +
        (badge ? ' <span class="bo-badge" title="Peças que chegaram e esperam sua compra">' + badge + '</span>' : '') + '</button>';
    }

    Array.prototype.forEach.call(view.querySelectorAll('.side-nav [data-f]'), function (b) {
      b.addEventListener('click', function () {
        pedFiltro = b.getAttribute('data-f');
        if (pedFiltro === 'Blackorder' && location.hash !== '#blackorder') { location.hash = '#blackorder'; return; }
        if (pedFiltro !== 'Blackorder' && location.hash !== '#pedidos') { location.hash = '#pedidos'; return; }
        renderPedidos();
      });
    });

    var body = document.getElementById('ped-body');
    if (pedFiltro === 'Blackorder') { renderBlackOrders(body); return; }

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
          (o.progresso && o.progresso.parcial && o.status !== 'Parcial' && o.status !== 'Cancelado' ? ' <span class="pill-status Parcial">Parcial</span>' : '') +
          (o.temBackorder ? '<br><span class="muted" style="font-size:11px;">contém pré-venda</span>' : '') +
          (o.daBlackOrder ? ' <span class="pill-status bo-Disponivel">Da black order</span>' : '') +
          (o.blackOrders ? '<br><a class="muted bo-link-lista" href="#blackorder">+ ' + o.blackOrders.pecas +
            ' peça(s) em black order</a>' : '');
        return '<tr><td><a href="#pedido/' + esc(o.id) + '">' + esc(o.id) + '</a>' +
          ' <button class="link-action pd-open" data-i="' + i + '" title="Ver itens">⤢</button>' +
          '<div class="pd-itens hidden" data-i="' + i + '">' +
          o.itens.map(function (it) { return '<div class="muted">' + it.qtd + '× ' + esc(it.nome) + ' (' + it.artigo + ')</div>'; }).join('') +
          '</div></td>' +
          '<td>Peças de reposição</td><td>' + FG.fmtDateTime(o.data) + '</td>' +
          '<td>' + statusCol + '</td><td class="right">' + FG.fmtMoneyOpt(o.total) + '</td></tr>';
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
      meus.forEach(function (o) { linhas.push([o.id, FG.fmtDateTime(o.data), o.status, o.total == null ? '' : o.total.toFixed(2)]); });
      FG.exportCSV('pedidos', linhas);
    });
  }

  /* =========================================================
     DETALHE DO PEDIDO (#pedido/:numero)
     ========================================================= */
  // Bolinha da peça: verde enviado, amarelo parcial, cinza pendente, vermelho cancelado.
  function dotItem(it, cancelado) {
    if (cancelado) return '<span class="item-dot dot-cancelado" title="Cancelado"></span>';
    if (!it.qtd && it.naoEncontrada) return '<span class="item-dot dot-cancelado" title="Não encontrada"></span>';
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
          (it.naoEncontrada ? '<div class="nf-info">' + it.naoEncontrada + ' un. não encontrada(s) no estoque — ' +
            esc(it.motivoNaoEncontrada || '') + '. Não serão cobradas.</div>' : '') +
          '</td>' +
          '<td class="right">' + it.qtd + '</td><td class="right">' + it.qtdEnviada + '</td>' +
          '<td class="right">' + FG.fmtMoneyOpt(it.preco) + '</td>' +
          '<td class="right">' + (it.preco == null ? '—' : FG.fmtMoney(it.preco * it.qtd)) + '</td></tr>';
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
    var cancelado = String(d.status || '').toLowerCase() === 'cancelado';

    // O VOLTAR fica só na trilha (botão padrão) — não se repete aqui dentro.
    var html =
      '<div class="ped-det-head"><h2 style="margin:0;">Pedido ' + esc(d.id) + '</h2>' +
      '<span class="pill-status ' + esc(d.status) + '">' + esc(d.status) + '</span>' +
      (d.garantia ? ' <span class="pill-status Garantia">Garantia — reposição sem cobrança</span>' : '') +
      (pg.parcial && d.status !== 'Parcial' && !cancelado ? ' <span class="pill-status Parcial">Parcial</span>' : '') + '</div>' +
      '<p class="muted">' + FG.fmtDateTime(d.data) + ' · ' + esc(d.empresa) + ' · Total ' + FG.fmtMoneyOpt(d.total) + '</p>' +
      '<div class="prog-wrap"><div class="prog-bar"><div class="prog-fill" style="width:' + pg.pct + '%;"></div></div>' +
      '<span class="prog-label">' + (cancelado ? 'Pedido cancelado — ' + pg.enviada + ' de ' + pg.qtd + ' peças tinham sido enviadas'
        : pg.pct + '% (' + pg.enviada + ' de ' + pg.qtd + ' enviadas)') + '</span></div>';

    if (normais.length)
      html += '<h3 class="sec-title">Itens em envio normal</h3>' + tabelaItens(normais, cancelado);

    if (preVenda.length)
      html += '<h3 class="sec-title">Itens em pré-venda</h3>' +
        '<div class="backorder-aviso">Estes itens serão enviados quando o estoque for reposto.</div>' +
        tabelaItens(preVenda, cancelado);

    // Legenda uma única vez, logo abaixo da(s) tabela(s) de itens.
    if (normais.length || preVenda.length) html += LEGENDA_DOTS;

    // Pedido feito pelo carrinho da black order.
    if (d.daBlackOrder && d.daBlackOrder.length)
      html += '<div class="backorder-aviso bo-aviso">Pedido feito pelo <b>carrinho da black order</b> — compra(s) de origem: ' +
        d.daBlackOrder.map(function (o) { return esc(o.compra) + ' (' + esc(o.nome) + ', ' + o.qtd + ' un.)'; }).join('; ') + '.</div>';

    // O que esta compra deixou em black order (não entra no total nem na fatura).
    if (d.blackOrders && d.blackOrders.length)
      html += '<h3 class="sec-title">Black order desta compra</h3>' +
        '<div class="backorder-aviso bo-aviso">Estas peças não tinham estoque: <b>não foram cobradas</b>. ' +
        'Quando chegarem, você é avisado e decide quanto comprar. <a href="#blackorder">Acompanhar em Blackorder ›</a></div>' +
        '<table class="table"><thead><tr><th>SKU</th><th>Produto</th><th class="right">Pedida</th>' +
        '<th class="right">Disponível</th><th class="right">Comprada</th><th>Situação</th></tr></thead><tbody>' +
        d.blackOrders.map(function (b) {
          return '<tr><td>' + esc(b.artigo) + '</td><td>' + esc(b.nome) + '</td>' +
            '<td class="right">' + b.qtd + '</td><td class="right">' + b.reservada + '</td>' +
            '<td class="right">' + b.atendida + '</td>' +
            '<td><span class="pill-status bo-' + esc(b.status) + '">' + esc(BO_ROTULO[b.status] || b.status) + '</span></td></tr>';
        }).join('') + '</tbody></table>';

    if (d.faturaNaRemessa && !cancelado && (!d.faturas || !d.faturas.length))
      html += '<h3 class="sec-title">Faturas</h3><p class="muted">A fatura é gerada quando as peças forem enviadas ' +
        '(uma por remessa), só com o que foi encontrado no estoque.</p>';
    if (d.faturas && d.faturas.length)
      html += '<h3 class="sec-title">Faturas</h3>' +
        (d.faturaNaRemessa ? '<p class="muted">Uma fatura por remessa enviada, só com as peças que saíram nela.</p>' : '') +
        '<table class="table"><thead><tr><th>Fatura</th><th>Data</th><th>Status</th>' +
        '<th class="right">Valor</th></tr></thead><tbody>' +
        d.faturas.map(function (f) {
          return '<tr><td>' + esc(f.numero) + '</td><td>' + (f.data ? FG.fmtDate(f.data) : '—') + '</td>' +
            '<td>' + (f.status ? '<span class="pill-status ' + esc(f.status) + '">' + esc(f.status) + '</span>' : '—') + '</td>' +
            '<td class="right">' + (f.valor != null ? FG.fmtMoney(f.valor) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';

    // Linha do tempo: compra, aprovação/Tiny, envios, garantias (30/09/2026).
    html += '<h3 class="sec-title">Histórico do pedido</h3>' + FG.historicoPedidoHTML(d.historico);

    view.innerHTML = html;
    });
  }

  /* =========================================================
     BLACK ORDER (#blackorder e #blackorder/carrinho)
     ========================================================= */
  // O que faltou no estoque no checkout. Não é cobrado; quando chega, o cliente compra pelo carrinho.
  var BO_ROTULO = { Fila: 'Aguardando chegada', Disponivel: 'Chegou — disponível', Atendida: 'Concluída', Cancelada: 'Cancelada' };
  var boVer = 'abertas';
  var boAberta = function (b) { return b.status === 'Fila' || b.status === 'Disponivel'; };

  function boFoto(b) {
    var src = b.miniatura || b.imagem;
    return src
      ? '<img src="' + esc(src) + '" alt="' + esc(b.nome) + '" loading="lazy">'
      : FG.bikeSVG('frame', 64, { cls: 'lite' });
  }

  function boCompraHTML(b) {
    return b.pedidoExiste
      ? '<a href="#pedido/' + esc(b.compra) + '">' + esc(b.compra) + '</a>'
      : esc(b.compra) + ' <span class="muted">(nada tinha estoque)</span>';
  }

  // Botão que pede um segundo clique para confirmar (o portal não usa confirm()).
  function boBotaoDuplo(btn, acao) {
    var texto = btn.textContent;
    var armado = false, t = null;
    btn.addEventListener('click', function () {
      if (!armado) {
        armado = true; btn.textContent = 'Clique de novo para confirmar'; btn.classList.add('armado');
        t = setTimeout(function () { armado = false; btn.textContent = texto; btn.classList.remove('armado'); }, 4000);
        return;
      }
      clearTimeout(t); btn.disabled = true; acao();
    });
  }

  function boCard(b) {
    var aguardando = Math.max(0, b.pendente - b.reservada);
    function dado(rot, val) { return '<div><b>' + rot + '</b>' + val + '</div>'; }
    return '<div class="bo-card st-' + esc(b.status) + '">' +
      '<div class="bo-foto">' + boFoto(b) + '</div>' +
      '<div class="bo-info">' +
      '<div class="bo-topo"><span class="bo-nome">' + esc(b.nome) + '</span>' +
      '<span class="muted">' + esc(b.artigo) + '</span>' +
      '<span class="pill-status bo-' + esc(b.status) + '">' + esc(BO_ROTULO[b.status] || b.status) + '</span></div>' +
      (b.descricao ? '<div class="bo-desc">' + esc(b.descricao) + '</div>' : '') +
      '<div class="bo-grid">' +
      dado('Compra de origem', boCompraHTML(b)) +
      dado('Data', FG.fmtDateTime(b.data)) +
      dado('Categoria', esc(b.categoria || '—')) +
      dado('Pedida por', esc(b.usuario || '—')) +
      dado('Quantidade pedida', b.qtd + ' un.') +
      (b.reservada ? dado('Disponível agora', '<b class="bo-ok">' + b.reservada + ' un.</b>') : '') +
      (boAberta(b) ? dado('Aguardando chegada', aguardando + ' un.') : '') +
      (boAberta(b) && b.aFrente != null ? dado('À sua frente na fila', b.aFrente + ' un.') : '') +
      dado('Já comprada', b.atendida + ' un.' + (b.atendimentos.length
        ? ' <span class="muted">(' + b.atendimentos.map(function (a) {
          return '<a href="#pedido/' + esc(a.pedido) + '">' + esc(a.pedido) + '</a>';
        }).join(', ') + ')</span>' : '')) +
      (b.descartada ? dado('Não comprada / cancelada', b.descartada + ' un.') : '') +
      dado('Situação do envio', esc(b.situacao || (boAberta(b) ? 'Aguardando atualização da Fullgas' : '—'))) +
      dado('Previsão de chegada', esc(b.previsao || '—')) +
      (b.preco !== undefined ? dado('Preço hoje', FG.fmtMoney(b.preco) + ' <span class="muted">/un.</span>') : '') +
      '</div>' +
      (b.observacao ? '<div class="bo-obs"><b>Observação da Fullgas:</b> ' + esc(b.observacao) + '</div>' : '') +
      (boAberta(b)
        ? '<div class="bo-acoes">' +
          (b.status === 'Disponivel' ? '<a class="btn red" href="#blackorder/carrinho">Comprar no carrinho da black order</a>' : '') +
          '<button class="btn bo-desistir" data-id="' + b.id + '">Desistir do restante</button></div>'
        : '') +
      '</div></div>';
  }

  function renderBlackOrders(body) {
    var todas = FG.all('blackorders');
    var abertas = todas.filter(boAberta);
    var encerradas = todas.filter(function (b) { return !boAberta(b); });
    var disp = abertas.filter(function (b) { return b.status === 'Disponivel'; });
    var lista = boVer === 'abertas' ? abertas : encerradas;

    body.innerHTML =
      (disp.length
        ? '<div class="bo-chegou"><b>Chegaram peças da sua black order:</b> ' + disp.length +
          ' item(ns) prontos para compra.<a class="btn red" href="#blackorder/carrinho">Abrir carrinho da black order</a></div>'
        : '') +
      '<p class="muted bo-intro">Black order é o que você pediu e não tinha em estoque. Não é cobrada agora: ' +
      'entra na fila por ordem de chegada e, quando a peça chega, você é avisado nas Notificações e decide quanto comprar.</p>' +
      '<div class="claim-subtabs">' +
      '<button class="claim-subtab' + (boVer === 'abertas' ? ' on' : '') + '" data-bo-ver="abertas">Abertas (' + abertas.length + ')</button>' +
      '<button class="claim-subtab' + (boVer === 'encerradas' ? ' on' : '') + '" data-bo-ver="encerradas">Encerradas (' + encerradas.length + ')</button>' +
      '</div>' +
      (lista.length ? lista.map(boCard).join('')
        : '<div class="empty-box">' + (boVer === 'abertas'
          ? 'Nenhuma black order aberta. Quando você pedir mais do que temos em estoque, o restante aparece aqui.'
          : 'Nenhuma black order encerrada.') + '</div>');

    Array.prototype.forEach.call(body.querySelectorAll('[data-bo-ver]'), function (b) {
      b.addEventListener('click', function () { boVer = b.getAttribute('data-bo-ver'); renderBlackOrders(body); });
    });
    Array.prototype.forEach.call(body.querySelectorAll('.bo-desistir'), function (btn) {
      boBotaoDuplo(btn, function () {
        FG.boDesistir(btn.getAttribute('data-id')).then(function (r) {
          if (!r.ok) { FG.toast(r.msg, 'erro'); btn.disabled = false; return; }
          FG.toast('Pronto: você desistiu do restante desta black order. Nada foi cobrado.');
          renderBlackOrders(body);
        });
      });
    });
  }

  function renderBOCarrinho() {
    setCrumb(['Pedidos', 'Carrinho da black order']); setTabOn('pedidos');
    var disp = FG.all('blackorders').filter(function (b) { return b.status === 'Disponivel' && b.reservada > 0; });
    if (!disp.length) {
      view.innerHTML = '<div class="empty-box">Nenhuma peça da sua black order chegou ainda.<br>' +
        'Você é avisado nas Notificações quando chegar.<br><a class="btn red" href="#blackorder">Ver minhas black orders</a></div>';
      return;
    }
    var comPreco = disp.every(function (b) { return b.preco !== undefined; });
    view.innerHTML =
      '<h2>Carrinho da black order</h2>' +
      '<p class="muted">Estas peças chegaram e estão separadas para você. Escolha quanto quer de cada uma: ' +
      'você paga só o que comprar, pelo preço de hoje, e vira um pedido normal (faturado quando as peças saírem). ' +
      'Comprando tudo o que chegou, o que ainda não chegou continua na sua black order. ' +
      'Comprando menos, essa passa a ser a sua quantidade final: a black order da peça é encerrada e o que sobrou vai para o próximo da fila.</p>' +
      '<table class="table bo-carrinho"><thead><tr><th>Foto</th><th>Peça</th><th>Compra de origem</th>' +
      '<th class="right">Disponível</th><th class="right">Ainda na fila</th><th class="right">Comprar</th>' +
      (comPreco ? '<th class="right">Preço un.</th><th class="right">Subtotal</th>' : '') + '</tr></thead><tbody>' +
      disp.map(function (b) {
        return '<tr><td class="td-foto bo-foto-mini">' + boFoto(b) + '</td>' +
          '<td><b>' + esc(b.nome) + '</b><br><span class="muted">' + esc(b.artigo) + '</span></td>' +
          '<td>' + boCompraHTML(b) + '</td>' +
          '<td class="right">' + b.reservada + '</td>' +
          '<td class="right">' + Math.max(0, b.pendente - b.reservada) + '</td>' +
          '<td class="right"><input class="qty-in bo-qtd" type="number" min="0" step="1" max="' + b.reservada +
          '" value="' + b.reservada + '" data-id="' + b.id + '" aria-label="Quantidade a comprar">' +
          '<small class="bo-encerra" data-id="' + b.id + '" hidden></small></td>' +
          (comPreco ? '<td class="right">' + FG.fmtMoney(b.preco) + '</td><td class="right bo-sub" data-id="' + b.id + '"></td>' : '') +
          '</tr>';
      }).join('') + '</tbody></table>' +
      (comPreco ? '<div class="cart-tot"><span>Total a pagar</span><span class="v" id="bo-total"></span></div>' : '') +
      '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px;">' +
      '<a class="btn" href="#blackorder">Voltar</a><button class="btn red" id="bo-comprar">Confirmar compra</button></div>';

    var inputs = view.querySelectorAll('.bo-qtd');
    function lerQtd(inp) {
      var max = Number(inp.getAttribute('max'));
      var q = Math.max(0, Math.min(max, Math.floor(Number(inp.value)) || 0));
      return q;
    }
    function atualizar() {
      // Menos do que chegou = quantidade final: avisa que a black order da peça será encerrada.
      Array.prototype.forEach.call(inputs, function (inp) {
        var b = disp.find(function (x) { return String(x.id) === inp.getAttribute('data-id'); });
        var aviso = view.querySelector('.bo-encerra[data-id="' + b.id + '"]');
        var q = lerQtd(inp);
        var naFila = Math.max(0, b.pendente - b.reservada);
        aviso.hidden = q >= b.reservada;
        aviso.textContent = q >= b.reservada ? '' : (b.reservada - q) + ' volta(m) ao estoque' +
          (naFila ? ' e ' + naFila + ' na fila saem da black order' : '') + ' — encerra esta black order';
      });
      if (!comPreco) return;
      var total = 0;
      Array.prototype.forEach.call(inputs, function (inp) {
        var b = disp.find(function (x) { return String(x.id) === inp.getAttribute('data-id'); });
        var sub = b.preco * lerQtd(inp);
        total += sub;
        view.querySelector('.bo-sub[data-id="' + b.id + '"]').textContent = FG.fmtMoney(sub);
      });
      document.getElementById('bo-total').textContent = FG.fmtMoney(total);
    }
    Array.prototype.forEach.call(inputs, function (inp) {
      inp.addEventListener('input', atualizar);
      inp.addEventListener('change', function () { inp.value = lerQtd(inp); atualizar(); });
    });
    atualizar();

    document.getElementById('bo-comprar').addEventListener('click', function () {
      var btn = this;
      var itens = Array.prototype.map.call(inputs, function (inp) {
        return { id: Number(inp.getAttribute('data-id')), quantidade: lerQtd(inp) };
      });
      btn.disabled = true; btn.textContent = 'Enviando…';
      FG.boComprar(itens).then(function (r) {
        if (!r.ok) {
          FG.toast(r.msg, 'erro');
          renderBOCarrinho();     // a lista já foi recarregada com o que está disponível agora
          return;
        }
        var lib = (r.liberadas || []).length
          ? '<p class="muted">Liberadas (não compradas): ' + r.liberadas.map(function (l) {
            return esc(l.nome) + ' — ' + l.quantidade + ' un.';
          }).join('; ') + '</p>' : '';
        view.innerHTML = '<div class="empty-box"><h2 style="color:var(--green);">✔ ' +
          (r.id ? 'Compra feita!' : 'Pronto!') + '</h2>' +
          (r.id
            ? '<p>Pedido <a href="#pedido/' + esc(r.id) + '"><b>' + esc(r.id) + '</b></a> criado' +
              (r.total != null ? ' · total <b>' + FG.fmtMoney(r.total) + '</b>' : '') + '. A fatura é gerada quando as peças forem enviadas.</p>'
            : '<p>Você não comprou nenhuma peça desta vez.</p>') +
          lib + '<a class="btn red" href="#blackorder">Ver minhas black orders</a></div>';
      });
    });
  }

  /* =========================================================
     AÇÕES DO VEÍCULO
     ========================================================= */
  // Registrar a venda. onDone() após sucesso.
  function modalVenda(v, onDone) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Registrar venda — ' + esc(v.niv) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      FG.fichaVeiculoResumo(v) +
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

  // Transferir chassi (admin) pelo nome da concessionária, ou devolver à Fábrica.
  function modalTransferir(v, onDone) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Transferir revendedor — ' + esc(v.niv) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      FG.fichaVeiculoResumo(v) +
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
     HISTÓRICO DO VEÍCULO (evento automático não tem botão de excluir)
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
        // Meio-dia, para a data não voltar um dia no fuso do Brasil.
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
      // Ficha do veículo, ações e histórico.
      box.innerHTML = FG.fichaVeiculo(v, {
        acoes:
          (v.status === 'Disponível' ? '<button class="btn red" id="av-venda">Registrar venda</button>' : '') +
          // A garantia começa no registro da venda.
          (!v.garantia && v.status === 'Disponível'
            ? '<span class="muted" style="font-size:12px;align-self:center;">A garantia começa ao registrar a venda.</span>' : '') +
          (sess.papel === 'admin' ? '<button class="btn" id="av-transf">Transferir revendedor</button>' : '') +
          '<a class="btn" href="#reivindicacoes">Criar reivindicação</a>' +
          '<a class="btn" href="/finder">Abrir no Localizador de Peças</a>',
        rodape:
          /* ---- histórico do chassi ---- */
          '<div class="hist-bloco">' +
          '<div class="hist-head"><h4>Histórico do veículo</h4>' +
          (sess.papel === 'admin'
            ? '<button class="btn small" id="av-hist-novo">+ Registrar no histórico</button>' : '') +
          '</div>' +
          '<div id="av-hist" class="hist-lista"><p class="muted">Carregando…</p></div>' +
          '</div>'
      });

      var bv = document.getElementById('av-venda');
      if (bv) bv.addEventListener('click', function () { modalVenda(v, buscar); });
      var bt = document.getElementById('av-transf');
      if (bt) bt.addEventListener('click', function () { modalTransferir(v, buscar); });

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
    var admin = sess.papel === 'admin';
    var f = { busca: '', status: '', modelo: '', ano: '', local: '' };
    var ord = { col: '', dir: 1 };
    function local(v) { return v.fabrica ? 'Fábrica' : (v.empresa || ''); }
    function norm(t) { return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

    var CHAVE = {
      niv: function (v) { return v.niv; },
      modelo: function (v) { return FG.nomeModelo(v); },
      ano: function (v) { return v.ano || 0; },
      local: local,
      status: function (v) { return v.status || ''; },
      entrada: function (v) { return v.entrada ? new Date(v.entrada).getTime() : 0; }
    };
    function comparar(a, b) {
      var x = CHAVE[ord.col](a), y = CHAVE[ord.col](b);
      var r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
      return (r || a.niv.localeCompare(b.niv)) * ord.dir;
    }
    function visiveis() {
      var termo = norm(f.busca.trim());
      var l = vehs.filter(function (v) {
        if (f.status && v.status !== f.status) return false;
        if (f.modelo && FG.nomeModelo(v) !== f.modelo) return false;
        if (f.ano && String(v.ano) !== f.ano) return false;
        if (f.local === 'fabrica' && !v.fabrica) return false;
        if (f.local === 'conc' && v.fabrica) return false;
        return !termo || norm([v.niv, FG.modeloDaUnidade(v), local(v), v.status].join(' ')).indexOf(termo) >= 0;
      });
      return ord.col ? l.slice().sort(comparar) : l;
    }
    function distintos(fn, desc) {
      var s = {};
      vehs.forEach(function (v) { var k = fn(v); if (k) s[k] = 1; });
      var l = Object.keys(s).sort(function (a, b) { return String(a).localeCompare(String(b), 'pt-BR', { numeric: true }); });
      return desc ? l.reverse() : l;
    }
    function selFiltro(k, rotulo, opcoes) {
      return '<label>' + rotulo + ': <select data-es="' + k + '"><option value="">Todos</option>' +
        opcoes.map(function (o) {
          return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>';
        }).join('') + '</select></label>';
    }
    function cab(col, texto) {
      return '<th data-col="' + col + '"><button type="button" class="th-ord" data-ord="' + col + '">' + texto + '</button></th>';
    }
    function linha(v) {
      return '<tr class="lin-clic" data-niv="' + esc(v.niv) + '"><td class="td-foto">' + FG.fotoVeiculo(v, 'mini') + '</td>' +
        '<td><a href="#acoes/' + esc(v.niv) + '">' + esc(v.niv) + '</a></td>' +
        '<td>' + esc(FG.nomeModelo(v)) + '</td><td class="nowrap">' + esc(v.ano || '—') + '</td>' +
        (admin ? '<td>' + (v.fabrica ? FG.seloFabrica() : esc(v.empresa || '—')) + '</td>' : '') +
        '<td>' + (v.status === 'Disponível' ? '<span class="stock-ok">Disponível</span>' : esc(v.status)) + '</td>' +
        '<td>' + FG.fmtDate(v.entrada) + '</td>' +
        '<td><a href="#acoes/' + esc(v.niv) + '">Ações &rsaquo;</a></td></tr>';
    }

    view.innerHTML =
      '<h2>Estoque do revendedor</h2>' +
      '<div class="toolbar"><button class="tool" id="es-csv" title="Exporta as motos que estão na lista, com o filtro e a ordem atuais">📄 Export. p/ Excel</button></div>' +
      (vehs.length
        ? '<div class="es-filtros">' +
          '<input type="text" class="es-busca" data-es="busca" placeholder="Buscar por NIV, modelo, ano' + (admin ? ' ou localização' : '') + '" autocomplete="off">' +
          selFiltro('status', 'Status', distintos(function (v) { return v.status; }).map(function (x) { return [x, x]; })) +
          selFiltro('modelo', 'Modelo', distintos(function (v) { return FG.nomeModelo(v); }).map(function (x) { return [x, x]; })) +
          selFiltro('ano', 'Ano', distintos(function (v) { return v.ano; }, true).map(function (x) { return [x, x]; })) +
          (admin ? selFiltro('local', 'Localização', [['fabrica', 'Na Fábrica'], ['conc', 'Em concessionária']]) : '') +
          '<button type="button" class="tool" id="es-limpar" hidden>✖ Limpar filtros</button>' +
          '<span class="es-cont" id="es-cont" aria-live="polite"></span></div>'
        : '') +
      '<table class="table tbl-veic"><thead><tr><th>Foto</th>' +
      cab('niv', 'NIV') + cab('modelo', 'Modelo') + cab('ano', 'Ano') + (admin ? cab('local', 'Localização') : '') +
      cab('status', 'Status') + cab('entrada', 'Entrada') + '<th></th></tr></thead><tbody id="es-corpo"></tbody></table>';

    var corpo = document.getElementById('es-corpo');
    var colunas = admin ? 8 : 7;
    function atualizar() {
      var l = visiveis();
      var filtrado = !!(f.busca.trim() || f.status || f.modelo || f.ano || f.local);
      corpo.innerHTML = l.length ? l.map(linha).join('')
        : '<tr><td colspan="' + colunas + '" class="muted">' + (vehs.length
          ? 'Nenhuma moto com esse filtro.'
          : 'Nenhuma moto no seu estoque ainda. Quando a Fullgas atribuir chassis à sua concessionária, eles aparecem aqui.') + '</td></tr>';
      var cont = document.getElementById('es-cont');
      if (cont) cont.textContent = (filtrado ? l.length + ' de ' + vehs.length : vehs.length) + (vehs.length === 1 ? ' moto' : ' motos');
      var lim = document.getElementById('es-limpar');
      if (lim) lim.hidden = !filtrado;
      Array.prototype.forEach.call(view.querySelectorAll('thead th[data-col]'), function (th) {
        if (th.getAttribute('data-col') === ord.col) th.setAttribute('aria-sort', ord.dir > 0 ? 'ascending' : 'descending');
        else th.removeAttribute('aria-sort');
      });
    }

    Array.prototype.forEach.call(view.querySelectorAll('[data-es]'), function (el) {
      var k = el.getAttribute('data-es');
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { f[k] = el.value; atualizar(); });
    });
    var btnLimpar = document.getElementById('es-limpar');
    if (btnLimpar) btnLimpar.addEventListener('click', function () {
      Object.keys(f).forEach(function (k) { f[k] = ''; });
      Array.prototype.forEach.call(view.querySelectorAll('[data-es]'), function (el) { el.value = ''; });
      atualizar();
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-ord]'), function (b) {
      b.addEventListener('click', function () {
        var col = b.getAttribute('data-ord');
        if (ord.col === col) ord.dir = -ord.dir; else { ord.col = col; ord.dir = 1; }
        atualizar();
      });
    });
    // A linha inteira abre a ficha; link, botão e foto (que amplia) seguem com a ação própria.
    corpo.addEventListener('click', function (e) {
      if (e.target.closest('a, button, img')) return;
      var tr = e.target.closest('tr[data-niv]');
      if (tr) location.hash = '#acoes/' + tr.getAttribute('data-niv');
    });
    document.getElementById('es-csv').addEventListener('click', function () {
      var linhas = [['NIV', 'Modelo', 'Ano'].concat(admin ? ['Localização'] : [], ['Status', 'Entrada'])];
      visiveis().forEach(function (v) {
        linhas.push([v.niv, FG.nomeModelo(v), v.ano || ''].concat(admin ? [local(v)] : [], [v.status, FG.fmtDate(v.entrada)]));
      });
      FG.exportCSV('estoque', linhas);
    });
    atualizar();
  }

  /* =========================================================
     CONTA FINANCEIRA
     ========================================================= */
  function renderFinanceiro() {
    setCrumb(['Conta financeira', 'Faturas']); setTabOn('financeiro');
    var inv = FG.all('invoices'); // faturas reais (cobrança)
    // Faturas anuladas aparecem, mas não somam.
    var faturado = 0;
    inv.forEach(function (i) { if (i.status !== 'Anulada') faturado += i.valor; });

    // Garantias aprovadas.
    var garantias = FG.all('claims').filter(function (c) { return c.status === 'Aprovada'; })
      .slice().sort(function (a, b) {
        return (b.dataAprovacao || b.data || '') < (a.dataAprovacao || a.data || '') ? -1 : 1;
      });
    var totalGarantias = garantias.reduce(function (s, c) { return s + (c.valorGarantia || 0); }, 0);


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
      // Pedido de origem e situação de cada fatura.
      '<table class="table"><thead><tr><th class="filt">Tipo</th><th class="filt">N° da fatura</th>' +
      '<th class="filt">Pedido</th><th class="filt">Data da fatura ↓</th><th>Situação</th>' +
      '<th class="right filt">Quantia cobrada</th><th></th></tr></thead><tbody>' +
      (inv.length ? inv.map(function (i, idx) {
        return '<tr><td>' + esc(i.tipo) + '</td><td>' + esc(i.numero) + '</td>' +
          '<td>' + ((i.pedidos || []).map(function (n) { return '<a href="#pedido/' + esc(n) + '">' + esc(n) + '</a>'; }).join(', ') || '—') + '</td>' +
          '<td>' + FG.fmtDate(i.data) + '</td>' +
          '<td>' + (i.status ? '<span class="pill-status ' + esc(i.status) + '">' + esc(i.status) + '</span>' : '—') + '</td>' +
          '<td class="right">' + i.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '</td>' +
          '<td class="nowrap"><button class="pdf-ico pdf-baixar" data-i="' + idx + '">⬇ Baixar PDF</button> ' +
          '<button class="pdf-ico pdf-imprimir" data-i="' + idx + '">🖨 Imprimir</button></td></tr>';
      }).join('') : '<tr><td colspan="7" class="muted">Nenhuma fatura.</td></tr>') +
      '</tbody></table>' + garantiasHTML;

    document.getElementById('fi-csv').addEventListener('click', function () {
      var linhas = [['Tipo', 'N°', 'Pedido', 'Data', 'Situação', 'Valor']];
      inv.forEach(function (i) { linhas.push([i.tipo, i.numero, (i.pedidos || []).join(' '), FG.fmtDate(i.data), i.status || '', i.valor.toFixed(2)]); });
      FG.exportCSV('faturas', linhas);
    });
    Array.prototype.forEach.call(view.querySelectorAll('.pdf-baixar'), function (b) {
      b.addEventListener('click', function () { baixarFaturaPDF(inv[Number(b.getAttribute('data-i'))], b); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.pdf-imprimir'), function (b) {
      b.addEventListener('click', function () { imprimirFatura(inv[Number(b.getAttribute('data-i'))]); });
    });
  }

  // Endereço do destinatário em linhas (<br>).
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

  // HTML da fatura detalhada (layout de docs/referencias/fatura_referencia.png), para imprimir ou PDF.
  function faturaHTML(i) {
    var itens = i.itens || [];
    var somaItens = itens.reduce(function (s, it) { return s + (it.subtotal || 0); }, 0);
    var total = itens.length ? somaItens : i.valor;
    var endLinhas = linhasEndereco(i.endereco).map(esc).join('<br>');
    var nomeEmpresa = esc(i.empresa || sess.empresa || '');
    // Crus: o campo() escapa.
    var paisCru = i.pais || (i.endereco && i.endereco.pais) || '';
    var pedidos = (i.pedidos || []).length ? (i.pedidos || []).join(', ') : '';
    var compra = i.compra || {};
    var pecas = itens.reduce(function (s, it) { return s + (Number(it.qtd) || 0); }, 0);
    var lista = compra.lista
      ? compra.lista + (compra.listaPercentual ? ' (' + (compra.listaPercentual > 0 ? '+' : '') +
        String(compra.listaPercentual).replace('.', ',') + '%)' : '')
      : '';
    var bos = i.blackOrders || [];

    // Estilos inline (o print-area é isolado), tamanhos para A4.
    var thBase = 'text-align:left;padding:9px 8px;border-bottom:2px solid #e5b100;font-size:14px;';
    var tdBase = 'padding:9px 8px;border-bottom:1px solid #e5e5e5;font-size:14px;vertical-align:top;';
    var lbl = 'font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.4px;';
    var val = 'font-size:15px;font-weight:700;color:#222;';

    // Escapa aqui dentro: quem chama passa o valor cru.
    function campo(rotulo, valor) {
      return '<div style="margin-bottom:10px;"><div style="' + lbl + '">' + esc(rotulo) + '</div>' +
        '<div style="' + val + '">' + (valor ? esc(valor) : '—') + '</div></div>';
    }

    // Logo (js/logo-data.js) com tamanho fixo; sem ele, o nome em texto.
    var logo = window.FG_LOGO
      ? '<img src="' + window.FG_LOGO + '" alt="FULLGAS" width="110" height="70" ' +
        'style="width:110px;height:70px;display:block;flex:0 0 110px;">'
      : '<div style="font-size:26px;font-weight:800;font-style:italic;color:#e5b100;">FULLGAS</div>';

    // Padding lateral na raiz: o html2pdf clona só este elemento (sem ele, a logo sai cortada).
    return '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;' +
      'max-width:760px;box-sizing:border-box;padding:0 18px;">' +

      /* ---- cabeçalho: título + logo ---- */
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">' +
      '<h1 style="margin:0;font-size:36px;letter-spacing:.5px;">Fatura' +
      (i.status === 'Anulada' ? ' <span style="color:#b91c1c;border:3px solid #b91c1c;padding:0 10px;font-size:26px;margin-left:10px;">ANULADA</span>' : '') +
      '</h1>' +
      logo +
      '</div>' +

      /* ---- grade de dados do documento ---- */
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 24px;margin-top:22px;">' +
      // Valores crus (o campo() escapa).
      campo('Fatura n°', i.numero) +
      campo('Data da fatura', FG.fmtDate(i.data)) +
      campo('Pedido(s)', pedidos) +
      campo('Data do pedido', compra.data ? FG.fmtDateTime(compra.data) : '') +
      campo('Comprador', compra.comprador ? compra.comprador + (compra.compradorEmail ? ' · ' + compra.compradorEmail : '') : '') +
      campo('Lista de preço', lista) +
      campo('CNPJ', i.cnpj) +
      campo('País', paisCru) +
      campo('Documento', i.tipo) +
      '</div>' +

      /* ---- destinatário ---- */
      '<div style="margin-top:8px;border-top:1px solid #e5e5e5;padding-top:14px;">' +
      '<div style="' + lbl + '">Destinatário da fatura</div>' +
      '<div style="font-size:17px;font-weight:700;margin-top:3px;">' + nomeEmpresa + '</div>' +
      (i.fantasia ? '<div style="font-size:14px;color:#555;">' + esc(i.fantasia) + '</div>' : '') +
      (endLinhas ? '<div style="font-size:14px;line-height:1.5;margin-top:2px;">' + endLinhas + '</div>' : '') +
      '<div style="font-size:14px;margin-top:4px;line-height:1.5;">' +
      [i.cnpj ? 'CNPJ: ' + esc(i.cnpj) : '', i.ie ? 'IE: ' + esc(i.ie) : '',
        i.telefone ? 'Tel.: ' + esc(i.telefone) : '', i.email ? 'E-mail: ' + esc(i.email) : '']
        .filter(Boolean).join(' &nbsp;·&nbsp; ') +
      '</div>' +
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
      '<tr><td style="padding:8px 12px;font-size:15px;">Total de peças</td>' +
      '<td style="padding:8px 12px;text-align:right;font-size:15px;">' + pecas + '</td></tr>' +
      '<tr><td style="padding:12px;font-size:19px;font-weight:800;border-top:2px solid #e5b100;">Total</td>' +
      '<td style="padding:12px;text-align:right;font-size:19px;font-weight:800;border-top:2px solid #e5b100;">' + FG.fmtMoney(total) + '</td></tr>' +
      '</table></div>' +

      /* ---- peças da compra em black order (não cobradas) ---- */
      (bos.length
        ? '<div style="margin-top:20px;border:1px solid #e5e5e5;border-left:4px solid #e5b100;padding:10px 14px;">' +
          '<div style="' + lbl + '">Peças desta compra em black order — não cobradas nesta fatura</div>' +
          '<div style="font-size:14px;line-height:1.6;margin-top:4px;">' +
          bos.map(function (b) { return esc(b.sku) + ' — ' + esc(b.nome) + ': ' + b.qtd + ' un.'; }).join('<br>') +
          '</div></div>'
        : '') +

      /* ---- nota final ---- */
      '<div style="margin-top:18px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:15px;font-weight:700;">' +
      'Verifique suas blackorders em pedidos</div>' +

      '</div>';
  }

  // Imprimir: põe o HTML no #print-area e abre a impressão do navegador.
  function imprimirFatura(i) {
    var area = document.getElementById('print-area');
    area.innerHTML = faturaHTML(i);
    area.classList.remove('hidden');
    window.print();
    setTimeout(function () { area.classList.add('hidden'); }, 300);
  }

  // html2pdf (~900 KB) só é baixado no primeiro "Baixar PDF".
  var html2pdfPromessa = null;
  function carregarHtml2pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (!html2pdfPromessa) {
      html2pdfPromessa = new Promise(function (ok, falha) {
        var s = document.createElement('script');
        s.src = 'js/vendor/html2pdf.bundle.min.js';
        s.onload = function () {
          if (window.html2pdf) ok(window.html2pdf); else falha(new Error('html2pdf ausente'));
        };
        s.onerror = function () { falha(new Error('Falha ao baixar o gerador de PDF.')); };
        document.head.appendChild(s);
      });
      // Falhou (rede caiu)? O próximo clique tenta de novo.
      html2pdfPromessa['catch'](function () { html2pdfPromessa = null; });
    }
    return html2pdfPromessa;
  }

  // Baixar: gera fatura-<numero>.pdf direto.
  function baixarFaturaPDF(i, btn) {
    var rotulo = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
    carregarHtml2pdf().then(function () {
      gerarFaturaPDF(i, btn, rotulo);
    }, function () {
      // Sem a biblioteca, a fatura ainda sai pela impressão do navegador.
      if (btn) { btn.disabled = false; btn.textContent = rotulo; }
      FG.toast('Gerador de PDF indisponível — abrindo a impressão.', 'erro');
      imprimirFatura(i);
    });
  }

  function gerarFaturaPDF(i, btn, rotulo) {

    // Container fora da tela, preso ao <html> para escapar do zoom do body.
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
     MINHA CONTA — cadastro da empresa (gestor edita; conta interna só lê)
     ========================================================= */
  var AREA_LABELS = {
    loja: 'Loja', finder: 'Localizador de Peças', pedidos: 'Pedidos',
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
        // CNPJ travado (chave do Tiny); só o admin em "Entrar na conta" muda.
        '<div class="field"><label for="ct-cnpj">CNPJ</label><input id="ct-cnpj" type="text" maxlength="18" value="' + esc(c.empresa.cnpj) + '"' +
          (FG.identidadeAssumida() ? ro : ' readonly disabled title="Para alterar o CNPJ, abra um chamado no Suporte."') + '>' +
          (FG.identidadeAssumida() ? '' : '<small class="muted">Para alterar o CNPJ, abra um chamado no Suporte.</small>') + '</div>' +
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
        (gestor ? '<p class="muted" style="font-size:12px;margin-top:18px;">As contas internas (sub-dealers) são gerenciadas na aba <a href="#subdealers">Subdealers</a>.</p>' : '') +
        // Trocar a própria senha (some em identidade assumida).
        (FG.identidadeAssumida() ? '' :
          '<h3 class="sec-title">Trocar minha senha</h3>' +
          '<div class="conta-grid">' +
          '<div class="field"><label for="ts-atual">Senha atual</label><input id="ts-atual" type="password" autocomplete="current-password"></div>' +
          '<div class="field"><label for="ts-nova">Nova senha (mín. 8 caracteres)</label><input id="ts-nova" type="password" autocomplete="new-password"></div>' +
          '<div class="field"><label for="ts-conf">Repita a nova senha</label><input id="ts-conf" type="password" autocomplete="new-password"></div>' +
          '</div><button class="btn" id="ts-salvar" type="button">Trocar senha</button>');

      view.innerHTML = html;

      var tsBtn = document.getElementById('ts-salvar');
      if (tsBtn) tsBtn.addEventListener('click', async function () {
        var atual = document.getElementById('ts-atual').value;
        var nova = document.getElementById('ts-nova').value;
        var conf = document.getElementById('ts-conf').value;
        if (!atual || !nova) { FG.toast('Informe a senha atual e a nova.', 'erro'); return; }
        if (nova !== conf) { FG.toast('A confirmação não bate com a nova senha.', 'erro'); return; }
        tsBtn.disabled = true; tsBtn.textContent = 'Trocando…';
        var r = await FG.trocarSenha(atual, nova);
        tsBtn.disabled = false; tsBtn.textContent = 'Trocar senha';
        if (!r.ok) { FG.toast(r.msg || 'Não foi possível trocar a senha.', 'erro'); return; }
        ['ts-atual', 'ts-nova', 'ts-conf'].forEach(function (id) { document.getElementById(id).value = ''; });
        FG.toast(r.msg || 'Senha alterada.');
      });

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
          // E-mail é o login: atualiza a sessão e o cabeçalho.
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
     SUBDEALERS — contas internas (só o gestor). Nascem pendentes até o admin aprovar.
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
     SUPORTE TÉCNICO — lista e conversa (o pop-up js/suporte.js abre chamados)
     Chamados são buscados a cada render, sem cache.
     ========================================================= */
  // 'andamento' (o que ainda espera alguém) | 'encerrados' | 'todos'
  var supFiltro = 'andamento';

  // Chamado aberto e último id desenhado: o batimento cola só as mensagens novas. null = fora de chamado.
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

  // Algo mudou no suporte: atualiza o badge e a carta (abrir um chamado zera os dois).
  function supMudou() {
    window.dispatchEvent(new Event('fg-suporte-mudou'));
    FG.recarregarNotifs().then(refreshPill);
    // Realinha o batimento, para não anunciar a própria ação como novidade.
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
          ? 'Nenhum chamado neste filtro.' + (todos.some(function (c) { return c.naoLidas; })
            ? ' Há respostas novas em chamados encerrados — veja em "Encerrados" ou "Todos".' : '')
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
      // Saiu antes de carregar: não desenha.
      if (!vigente()) return;
      if (!c) {
        view.innerHTML = '<h2>Chamado</h2><p class="muted">Chamado não encontrado.</p>' +
          '<p><a href="#suporte">Voltar para os chamados</a></p>';
        return;
      }
      setCrumb(['Suporte Técnico', c.numero]);
      // Abrir marcou como lidas: atualiza o badge.
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

      // Registra o que está na tela para o batimento.
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

  // Mensagem: 'sistema' vira linha discreta; as demais, balões.
  function supMensagemHtml(m) {
    if (m.autor === 'sistema') {
      return '<div class="sup-msg de-sistema">' + esc(m.texto) + ' · ' + FG.fmtDateTime(m.criadoEm) + '</div>';
    }
    var anexo = '';
    if (m.anexo) {
      // Anexo privado: data-arquivo, resolvido por FG.carregarArquivos.
      if (m.anexoTipo === 'imagem') anexo = '<img class="sup-anexo-img" data-arquivo="' + esc(m.anexo) + '" alt="Anexo" loading="lazy">';
      else if (m.anexoTipo === 'video') anexo = '<video class="sup-anexo-video" data-arquivo="' + esc(m.anexo) + '" controls preload="metadata"></video>';
      else anexo = '<a class="link-action" data-arquivo="' + esc(m.anexo) + '" target="_blank" rel="noopener">📎 Abrir anexo</a>';
    }
    // Aqui o revendedor lê: o lado dele à direita.
    return '<div class="sup-msg de-' + (m.autor === 'admin' ? 'outro' : 'mim') + '">' +
      '<span class="sup-msg-quem">' + esc(m.autor === 'admin' ? ('Suporte Fullgas' + (m.autorNome ? ' · ' + m.autorNome : '')) : (m.autorNome || 'Você')) + '</span>' +
      (m.texto ? '<span class="sup-msg-txt">' + esc(m.texto) + '</span>' : '') +
      anexo +
      '<span class="sup-msg-hora">' + FG.fmtDateTime(m.criadoEm) + '</span>' +
      '</div>';
  }

  /* =========================================================
     AO VIVO — reage ao batimento sem redesenhar o que está em uso
     (dentro de um chamado, só cola as mensagens novas)
     ========================================================= */

  // Cola no fim da conversa as mensagens que ainda não estão na tela.
  function supAnexarNovas() {
    var alvo = supAberto;
    if (!alvo) return;

    FG.suporteChamado(alvo.id).then(function (c) {
      // Já saiu do chamado: descarta.
      if (!c || !supAberto || supAberto.id !== alvo.id) return;

      var novas = (c.conversa || []).filter(function (m) {
        return Number(m.id) > alvo.ultimoId;
      });

      // Status mudou: troca só o rótulo.
      if (c.status !== supAberto.status) {
        var pill = view.querySelector('.sup-det-head .sup-st');
        if (pill) pill.outerHTML = supPill(c.status);
        supAberto.status = c.status;
      }

      if (!novas.length) return;

      var fio = view.querySelector('.sup-conversa');
      if (!fio) return;

      // Monta fora e anexa: innerHTML += recriaria os balões e perderia os blobs.
      var caixa = document.createElement('div');
      caixa.innerHTML = novas.map(supMensagemHtml).join('');
      var ultimo = null;
      while (caixa.firstChild) { ultimo = fio.appendChild(caixa.firstChild); }

      FG.carregarArquivos(fio);       // anexos das mensagens recém-coladas
      supAberto.ultimoId = supMaiorId(c.conversa);

      // Marcou como lidas: atualiza carta e badge.
      supMudou();

      // Só avisa se a mensagem veio do suporte.
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

    // Carta ✉️ do topo.
    if (mudou.notificacoes) {
      FG.recarregarNotifs().then(function () {
        refreshPill();
        // Pisca só quando sobe.
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

  // Chamado novo aberto pelo pop-up: atualiza a lista.
  window.addEventListener('fg-suporte-novo', function () {
    // Só na lista (dentro de um chamado perderia a conversa).
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
        return '<tr><td><a href="#acoes/' + v.niv + '">' + v.niv + '</a></td><td>' + esc(FG.modeloDaUnidade(v)) + '</td><td>' + esc(v.status) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (mods.length) {
      html += '<h3 style="margin-top:18px;">Modelos</h3><table class="table"><tbody>' + mods.map(function (m) {
        return '<tr><td>' + esc(m.label) + '</td><td><a href="/finder#/modelo/' + m.id + '/chassi">Abrir no Localizador de Peças</a></td></tr>';
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
    // Black order: quem compra (loja) ou acompanha pedidos.
    if (rota === 'blackorder' && !FG.temArea(sess, 'pedidos') && !FG.temArea(sess, 'loja')) {
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
    // Sair do chamado limpa o alvo do batimento.
    supAberto = null;
    telaSeq++;   // respostas da tela anterior não desenham mais

    switch (rota) {
      case 'home': renderHome(); break;
      case 'notificacoes': renderNotifs(); break;
      case 'reivindicacoes': renderClaims(); break;
      case 'pedidos': if (pedFiltro === 'Blackorder') pedFiltro = 'Ordens pendentes'; renderPedidos(); break;
      case 'pedido': renderPedidoDetalhe(partes[1]); break;
      case 'blackorder':
        if (partes[1] === 'carrinho') renderBOCarrinho();
        else { pedFiltro = 'Blackorder'; renderPedidos(); }
        break;
      case 'acoes': renderAcoes(partes[1]); break;
      case 'estoque': renderEstoque(); break;
      case 'financeiro': renderFinanceiro(); break;
      case 'conta': renderConta(); break;
      // #suporte = lista; #suporte/12 = chamado. Sem trava de área.
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

  }); // fim FG.pronto.then
})();
