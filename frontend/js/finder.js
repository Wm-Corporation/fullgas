/* =========================================================
   FULLGAS B2B — Spare Parts Finder (finder.html), alimentado por /api/finder/*
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  // Conta interna (sub-dealer) sem a área "finder" volta ao portal.
  if (!FG.temArea(sess, 'finder')) {
    alert('Sua conta não tem acesso ao Localizador de Peças. Fale com o gestor da concessionária.');
    location.href = '/portal'; return;
  }

  // Espera o cache (produtos p/ cesta) antes de montar a tela.
  FG.pronto.then(function () {

  var fdView = document.getElementById('fd-view');
  var esc = FG.esc;
  var USAGE_KEY = 'fullgas_finder_usage_v1';

  document.getElementById('fd-who').innerHTML = FG.esc(sess.email) + ' - ' + FG.empresaDaSessao(sess);

  /* contador da cesta da loja no topo */
  function refreshCart() {
    var el = document.getElementById('fd-cart-n');
    if (el) el.textContent = FG.cartCount();
  }
  refreshCart();

  /* estado atual: modelo (código) + lado (chassi/engine) */
  var atual = { modelo: null, lado: 'chassi' };
  var MODELOS = [];           // lista p/ árvore e busca (carregada da API)

  function modeloPorCodigo(cod) {
    for (var i = 0; i < MODELOS.length; i++) if (MODELOS[i].id === cod) return MODELOS[i];
    return null;
  }

  function logUsage(m) {
    try {
      var l = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]').filter(function (x) { return x.id !== m.id; });
      l.unshift({ id: m.id, label: m.label, data: new Date().toISOString() });
      localStorage.setItem(USAGE_KEY, JSON.stringify(l.slice(0, 10)));
    } catch (e) { /* noop */ }
  }

  function falha(msg) {
    return function (e) { FG.toast((e && e.message) || msg || 'Falha ao carregar.', 'erro'); };
  }

  // Cada troca de tela ganha um número; resposta de tela antiga é descartada.
  var telaSeq = 0;
  function telaVigente() {
    var minha = telaSeq;
    return function () { return minha === telaSeq; };
  }

  /* ---------- painel de busca: expandir/recolher e reset ---------- */
  var spBody = document.getElementById('sp-body');
  var spToggle = document.getElementById('sp-toggle');
  function recolherBusca() { spBody.classList.add('hidden'); spToggle.textContent = '▸ Buscar'; }
  spToggle.addEventListener('click', function () {
    var aberto = !spBody.classList.contains('hidden');
    spBody.classList.toggle('hidden', aberto);
    spToggle.textContent = (aberto ? '▸' : '▾') + ' Buscar';
  });
  document.getElementById('sp-reset').addEventListener('click', function (e) {
    e.preventDefault();
    location.hash = '';
    document.getElementById('sp-vin').value = '';
    document.getElementById('sp-eng').value = '';
    resetCascade();
    atual = { modelo: null, lado: 'chassi' };
    fdView.innerHTML = '';
    spBody.classList.remove('hidden');
    spToggle.textContent = '▾ Buscar';
  });

  /* ---------- árvore de seleção: Marca › Modalidade › Categoria › Modelo › Ano ---------- */
  var CASC = [
    { id: 'mc-marca',      campo: 'marca',      ph: 'Marca' },
    { id: 'mc-modalidade', campo: 'modalidade', ph: 'Modalidade' },
    { id: 'mc-categoria',  campo: 'categoria',  ph: 'Categoria' },
    { id: 'mc-modelo',     campo: 'nome',       ph: 'Modelo' },
    { id: 'mc-ano',        campo: 'ano',        ph: 'Ano' }   // final: escolhe o modelo
  ];
  var FINAL = CASC.length - 1;
  var sel = [null, null, null, null, null]; // valor escolhido por nível
  var SEM = '—';                        // rótulo interno p/ atributo vazio (—)

  function elNivel(i) { return document.getElementById(CASC[i].id); }
  function valNivel(m, campo) {
    var v = m[campo];
    return (v === null || v === undefined || v === '') ? SEM : String(v);
  }
  function optEl(v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; return o; }
  function rotulo(v) {
    return v === SEM ? 'Não especificado' : v;
  }
  // Modelos que casam com as escolhas dos níveis 0..i-1.
  function modelosAcima(i) {
    return MODELOS.filter(function (m) {
      for (var j = 0; j < i; j++) if (valNivel(m, CASC[j].campo) !== sel[j]) return false;
      return true;
    });
  }
  function valoresDistintos(base, campo) {
    var vistos = {}, out = [];
    base.forEach(function (m) { var v = valNivel(m, campo); if (!vistos[v]) { vistos[v] = true; out.push(v); } });
    out.sort(function (a, b) {
      if (a === SEM) return 1; if (b === SEM) return -1;
      var na = parseFloat(a), nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return campo === 'ano' ? nb - na : na - nb; // ano: recente primeiro
      return a.localeCompare(b, 'pt-BR');
    });
    return out;
  }
  // Preenche as opções do nível i (sem mexer em sel/disabled).
  function preencherOpcoes(i) {
    var el = elNivel(i);
    var base = modelosAcima(i);
    el.innerHTML = '';
    el.appendChild(optEl('', CASC[i].ph + '…'));
    if (i === FINAL) {
      // Um ano por modelo: o código (nome + ano) é único. Recente primeiro.
      base.slice().sort(function (a, b) { return b.ano - a.ano; }).forEach(function (m) {
        el.appendChild(optEl(m.id, String(m.ano)));
      });
    } else {
      valoresDistintos(base, CASC[i].campo).forEach(function (v) { el.appendChild(optEl(v, rotulo(v))); });
    }
  }
  // Zera e desabilita os níveis de i até o fim.
  function limparAbaixo(i) {
    for (var k = i; k < CASC.length; k++) {
      var el = elNivel(k);
      el.innerHTML = '';
      el.appendChild(optEl('', CASC[k].ph + '…'));
      el.value = ''; el.disabled = true; sel[k] = null;
    }
  }
  // Nível com uma única opção é selecionado sozinho (nunca o modelo).
  function autoAvancar(i) {
    if (i >= FINAL) return;
    var el = elNivel(i);
    var reais = Array.prototype.filter.call(el.options, function (o) { return o.value !== ''; });
    if (reais.length === 1) { el.value = reais[0].value; selecionar(i); }
  }
  function selecionar(i) {
    sel[i] = elNivel(i).value || null;
    if (i === FINAL) {
      atual.modelo = sel[i];
      if (sel[i]) {
        var lado = document.querySelector('input[name="sp-cat"]:checked').value;
        location.hash = '#/modelo/' + sel[i] + '/' + lado;
      }
      return;
    }
    limparAbaixo(i + 1);
    atual.modelo = null;
    if (sel[i]) {
      preencherOpcoes(i + 1);
      elNivel(i + 1).disabled = false;
      autoAvancar(i + 1);
    }
  }
  function initCascade() {
    limparAbaixo(0);
    preencherOpcoes(0);
    elNivel(0).disabled = false;
    CASC.forEach(function (c, i) {
      elNivel(i).addEventListener('change', function () { selecionar(i); });
    });
    autoAvancar(0);
  }
  function resetCascade() {
    limparAbaixo(0);
    preencherOpcoes(0);
    elNivel(0).disabled = false;
    atual.modelo = null;
    autoAvancar(0);
  }
  // Mostra nos seletores um modelo já resolvido (VIN, usage list ou rota).
  function sincronizarCascade(m) {
    if (!m) return;
    for (var i = 0; i < CASC.length; i++) {
      preencherOpcoes(i);
      var el = elNivel(i);
      var v = (i === FINAL) ? m.id : valNivel(m, CASC[i].campo);
      el.value = v; el.disabled = false; sel[i] = v;
    }
  }

  /* ---------- busca por VIN / número de motor ---------- */
  document.getElementById('sp-search').addEventListener('click', function () {
    var vin = document.getElementById('sp-vin').value.trim().toUpperCase();
    var eng = document.getElementById('sp-eng').value.trim().toUpperCase();
    var lado = document.querySelector('input[name="sp-cat"]:checked').value;
    atual.lado = lado;

    if (vin || eng) {
      FG.finderBusca(vin ? { vin: vin } : { motor: eng }).then(function (r) {
        if (eng) atual.lado = 'engine';
        location.hash = '#/modelo/' + r.modelo.id + '/' + atual.lado;
      }, falha('Nenhum veículo encontrado.'));
      return;
    }
    if (atual.modelo) { location.hash = '#/modelo/' + atual.modelo + '/' + lado; return; }
    FG.toast('Informe um NIV, número de motor ou selecione um modelo.');
  });

  /* ---------- usage list (página própria) ---------- */
  document.getElementById('btn-usage').addEventListener('click', function () {
    location.href = '/finder-uso';
  });

  /* miniatura de uma seção: diagrama enviado pelo admin ou moto esquemática */
  function thumbHTML(s, tam) {
    if (s.imagem) return '<img src="' + esc(s.imagem) + '" alt="' + esc(s.nome) + '" loading="lazy">';
    return '<span class="thumb-bg">' + FG.bikeSVG(s.destaque, tam || 92) + '</span>';
  }

  /* =========================================================
     TELA: modelo (seções + miniaturas)
     ========================================================= */
  function renderModelo(codigo, lado) {
    fdView.innerHTML = '<p class="muted">Carregando…</p>';
    var vigente = telaVigente();
    FG.finderModelo(codigo).then(function (m) {
      if (!vigente()) return;
      atual.modelo = m.id; atual.lado = lado;
      logUsage(m);
      sincronizarCascade(m);
      document.querySelector('input[name="sp-cat"][value="' + (lado === 'engine' ? 'engine' : 'chassi') + '"]').checked = true;
      recolherBusca();

      var secoes = m[lado] || [];
      var outro = lado === 'chassi' ? 'engine' : 'chassi';

      fdView.innerHTML =
        '<div class="finder-model-name">' + esc(m.label) + '</div>' +
        '<div class="finder-links">' +
        '<button id="fl-img">🖼 Ver imagem</button>' +
        '<a href="#/modelo/' + esc(m.id) + '/' + outro + '">Ver ' + (outro === 'engine' ? 'motor' : 'chassi') + '</a>' +
        '<button id="fl-doc">📘 Documentação técnica</button>' +
        '</div>' +
        (secoes.length
          ? '<div class="finder-layout">' +
            '<div class="sec-list">' + secoes.map(function (s) {
              return '<button class="sec-item" data-id="' + s.id + '"><span class="n">' + esc(s.numero) + '</span>' +
                '<span>' + esc(s.nome) + '</span><span class="chev">›</span></button>';
            }).join('') + '</div>' +
            '<div class="thumb-grid">' + secoes.map(function (s) {
              return '<div class="thumb" data-id="' + s.id + '" role="button" tabindex="0">' +
                '<span class="tn">' + esc(s.numero) + '</span>' + thumbHTML(s, 92) + '</div>';
            }).join('') + '</div>' +
            '</div>'
          : '<p class="muted">Nenhuma seção cadastrada para o lado ' +
            (lado === 'engine' ? 'motor' : 'chassi') + ' deste modelo.</p>');

      Array.prototype.forEach.call(fdView.querySelectorAll('[data-id]'), function (el) {
        function abrir() { location.hash = '#/secao/' + el.getAttribute('data-id'); }
        el.addEventListener('click', abrir);
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrir(); });
      });

      document.getElementById('fl-img').addEventListener('click', function () {
        if (!m.imagem) { FG.toast('O administrador ainda não enviou a foto deste modelo.'); return; }
        var back = document.createElement('div');
        back.className = 'modal-back';
        back.innerHTML = '<div class="modal modal-img"><header><h3>' + esc(m.label) + '</h3>' +
          '<button class="x">×</button></header><div class="modal-body">' +
          '<img src="' + esc(m.imagem) + '" alt="' + esc(m.label) + '"></div></div>';
        document.body.appendChild(back);
        back.querySelector('.x').addEventListener('click', function () { back.remove(); });
        // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).
      });
      document.getElementById('fl-doc').addEventListener('click', function () {
        if (m.docTecnica) window.open(m.docTecnica, '_blank', 'noopener');
        else FG.toast('Nenhuma documentação técnica cadastrada para este modelo.');
      });
    }, function () {
      if (!vigente()) return;
      fdView.innerHTML = '<p class="muted">Modelo não encontrado.</p>';
    });
  }

  /* =========================================================
     TELA: seção (peças + diagrama com hotspots e zoom)
     ========================================================= */
  function renderSecao(secaoId) {
    fdView.innerHTML = '<p class="muted">Carregando…</p>';
    var vigente = telaVigente();
    FG.finderSecao(secaoId).then(function (s) {
      if (!vigente()) return;
      atual.modelo = s.modelo.id; atual.lado = s.lado;
      recolherBusca();
      sincronizarCascade(modeloPorCodigo(s.modelo.id));
      var outro = s.lado === 'chassi' ? 'engine' : 'chassi';


      // Bolinha pela quantidade (FG.nivelEstoque). Sem estoque a peça ainda é pedida: vira black order.
      function statusPeca(p) { return '<span class="pt-status">' + FG.seloEstoque(p) + '</span>'; }

      var linhas = s.pecas.map(function (p, i) {
        // Número = "nº na imagem" do admin (liga a peça ao diagrama); "—" se não houver.
        var num = (p.numeroImagem === null || p.numeroImagem === undefined || p.numeroImagem === '')
          ? '—' : String(p.numeroImagem);
        var marcada = p.quantidadePadrao > 0;
        var vIni = p.quantidadePadrao;
        // Ver a peça na loja abre em NOVA aba: o cliente não perde o finder.
        var link = '/loja#/produto/' + encodeURIComponent(p.sku);
        // Texto da busca, montado uma vez.
        var busca = esc((num + ' ' + p.sku + ' ' + p.nome).toLowerCase());
        return '<div class="part-row' + (marcada ? ' sel' : '') + '" data-row="' + i + '"' +
          ' data-busca="' + busca + '" data-num="' + esc(p.numeroImagem) + '">' +
          '<div class="pr-top">' +
            '<span class="pr-num">' + esc(num) + '</span>' +
            '<span class="pr-id">' +
              '<span class="pr-nome"><a href="' + link + '" target="_blank" rel="noopener">' + esc(p.nome) + '</a></span>' +
              '<a class="pr-sku" href="' + link + '" target="_blank" rel="noopener">' + esc(p.sku) + '</a>' +
            '</span>' +
            '<span class="pr-preco">' + FG.fmtMoney(p.preco) + '</span>' +
          '</div>' +
          '<div class="pr-bot">' +
            '<span class="pr-info">' +
              // Referência de montagem (não é a quantidade da cesta).
              '<span class="pr-ref">Qtd. no conjunto: <b>' + p.quantidade + '</b></span>' +
              statusPeca(p) +
            '</span>' +
            '<span class="pr-acao">' +
              '<label class="pr-sel"><input type="checkbox" class="pr-chk" data-row="' + i + '"' +
                (marcada ? ' checked' : '') + '> Selecionar</label>' +
              '<input class="qn" type="number" min="0" step="1" value="' + vIni + '"' +
              ' aria-label="Quantidade" data-art="' + esc(p.sku) + '">' +
            '</span>' +
          '</div>' +
          '</div>';
      }).join('');

      fdView.innerHTML =
        '<div class="finder-crumb"><a href="#/modelo/' + esc(s.modelo.id) + '/' + s.lado + '">' + esc(s.modelo.label) + '</a>' +
        ' <span class="chev">›</span> ' + esc(s.nome) +
        '<button class="link-action crumb-print" id="fa-print">🖨 Imprimir</button></div>' +
        '<div class="fnd-actions">' +
        '<button class="btn" id="fa-next"' + (s.vizinhos.proxima ? '' : ' disabled') + '>PRÓXIMA SEÇÃO</button>' +
        '<a class="btn" href="#/modelo/' + esc(s.modelo.id) + '/' + outro + '">VER ' + (outro === 'engine' ? 'MOTOR' : 'CHASSI') + '</a>' +
        '</div>' +
        '<div class="part-layout">' +
        '<div class="part-col">' +
        '<div class="part-toolbar"><span class="muted">' + esc(s.numero) + ' — ' + esc(s.nome) + '</span>' +
        '<button class="btn" id="fa-cart">🛒 ADICIONAR À CESTA</button></div>' +
        (linhas
          ? '<div class="pt-busca"><span class="lupa">🔍</span>' +
            '<input type="search" id="pt-busca" autocomplete="off"' +
            ' placeholder="Buscar peça por nº, código ou nome" aria-label="Buscar peça nesta seção">' +
            '<button class="limpa hidden" id="pt-limpa" type="button" title="Limpar busca" aria-label="Limpar busca">✕</button></div>' +
            '<div class="part-list">' + linhas + '</div>' +
            '<p class="muted hidden" id="pt-vazio">Nenhuma peça desta seção corresponde à busca.</p>'
          : '<p class="muted">Nenhuma peça cadastrada nesta seção ainda.</p>') +
        '</div>' +
        '<div class="diagram-box">' +
        (s.imagem
          ? '<div class="diag-fab nav">' +
            '<button class="dg-btn" id="dg-prev"' + (s.vizinhos.anterior ? '' : ' disabled') + ' title="Seção anterior">◀</button>' +
            '<button class="dg-btn" id="dg-next"' + (s.vizinhos.proxima ? '' : ' disabled') + ' title="Próxima seção">▶</button>' +
            '</div>' +
            '<div class="diag-fab zoom">' +
            '<button class="dg-btn" id="dg-in" title="Aproximar">+</button>' +
            '<button class="dg-btn" id="dg-reset" title="Ajustar à tela">⟳</button>' +
            '<button class="dg-btn" id="dg-out" title="Afastar">−</button>' +
            '</div>' +
            '<div class="diag-viewport" id="dg-view" title="Use a roda do mouse para aproximar; arraste para mover">' +
            '<div class="diag-canvas" id="dg-canvas">' +
            '<img id="dg-img" src="' + esc(s.imagem) + '" alt="' + esc(s.nome) + '" draggable="false">' +
            '</div></div>'
          : '<div class="diag-vazio">' + FG.bikeSVG(s.destaque, 360) +
            '<div class="cap">O administrador ainda não enviou o diagrama desta seção.</div></div>') +
        '</div></div>';

      document.getElementById('fa-print').addEventListener('click', function () { window.print(); });
      document.getElementById('fa-next').addEventListener('click', function () {
        if (s.vizinhos.proxima) location.hash = '#/secao/' + s.vizinhos.proxima;
      });

      // Destaca no diagrama os hotspots das peças marcadas.
      function sincronizarHotspots() {
        var cv = document.getElementById('dg-canvas');
        if (!cv) return;
        var nums = {};
        Array.prototype.forEach.call(fdView.querySelectorAll('.part-row.sel'), function (r) {
          var n = r.getAttribute('data-num'); if (n) nums[n] = true;
        });
        Array.prototype.forEach.call(cv.querySelectorAll('.hotspot'), function (h) {
          h.classList.toggle('on', !!nums[h.getAttribute('data-num')]);
        });
      }

      /* seleção de linha (checkbox) destaca em vermelho */
      Array.prototype.forEach.call(fdView.querySelectorAll('.pr-chk'), function (chk) {
        chk.addEventListener('change', function () {
          var row = fdView.querySelector('.part-row[data-row="' + chk.getAttribute('data-row') + '"]');
          row.classList.toggle('sel', chk.checked);
          var qn = row.querySelector('.qn');
          if (chk.checked && Number(qn.value) === 0) qn.value = 1;
          sincronizarHotspots();
        });
      });

      /* Quantidade limitada ao estoque enquanto digita (peças em estoque). */
      Array.prototype.forEach.call(fdView.querySelectorAll('.qn[max]'), function (qn) {
        qn.addEventListener('input', function () {
          var max = Number(qn.getAttribute('max'));
          if (Number(qn.value) > max) { qn.value = max; FG.toast('Estoque disponível: ' + max + ' un.', 'erro'); }
        });
      });

      /* adiciona as marcadas à cesta; o que passar do estoque vira black order no pedido (avisado após o envio) */
      document.getElementById('fa-cart').addEventListener('click', function () {
        var add = 0, recusadas = 0, ajustadas = 0;
        Array.prototype.forEach.call(fdView.querySelectorAll('.part-row.sel .qn'), function (qn) {
          var qtd = Math.max(0, Number(qn.value) || 0);
          if (qtd <= 0) return;
          var art = qn.getAttribute('data-art');
          var lim = FG.limiteCompra(art);
          var ja = (FG.cart().find(function (c) { return c.artigo === art; }) || {}).qtd || 0;
          if (!FG.cartAdd(art, qtd)) { recusadas++; return; }
          var cabia = Math.max(0, Math.min(qtd, lim - ja));
          if (cabia < qtd) ajustadas++;
          add += cabia;
        });
        if (add) FG.toast(add + ' item(ns) enviados à cesta da loja.' +
          (ajustadas ? ' ' + ajustadas + ' ajustado(s) ao máximo por item.' : '') +
          (recusadas ? ' ' + recusadas + ' indisponível(is).' : ''),
          (ajustadas || recusadas) ? 'erro' : undefined);
        else if (ajustadas) FG.toast('A cesta já tem a quantidade máxima dessa(s) peça(s).', 'erro');
        else if (recusadas) FG.toast('Peça(s) fora do catálogo da loja.', 'erro');
        else FG.toast('Marque ao menos uma peça com quantidade.');
        refreshCart();
      });

      /* ---------- busca na lista de peças ----------
         Só esconde: as marcadas continuam marcadas e vão para a cesta.
         Fica antes do diagrama, que dá `return` em seção sem imagem. */
      var campoBusca = document.getElementById('pt-busca');
      var botaoLimpa = document.getElementById('pt-limpa');
      var avisoVazio = document.getElementById('pt-vazio');

      function filtrarPecas() {
        if (!campoBusca) return;
        var termo = campoBusca.value.trim().toLowerCase();
        var visiveis = 0;
        Array.prototype.forEach.call(fdView.querySelectorAll('.part-row'), function (row) {
          var casa = !termo || (row.getAttribute('data-busca') || '').indexOf(termo) >= 0;
          row.classList.toggle('oculta', !casa);
          if (casa) visiveis++;
        });
        botaoLimpa.classList.toggle('hidden', !termo);
        avisoVazio.classList.toggle('hidden', visiveis > 0);
      }
      if (campoBusca) {
        campoBusca.addEventListener('input', filtrarPecas);
        botaoLimpa.addEventListener('click', function () {
          campoBusca.value = ''; filtrarPecas(); campoBusca.focus();
        });
      }

      /* ---------- diagrama: zoom + hotspots ---------- */
      if (!s.imagem) return;
      var img = document.getElementById('dg-img');
      var canvas = document.getElementById('dg-canvas');
      var viewport = document.getElementById('dg-view');
      var natW = 0, natH = 0;
      var zoom = 1;             // fator atual sobre o tamanho natural da imagem
      var posX = 0, posY = 0;   // canto superior esquerdo do desenho, no quadro
      // Máximo 100% (além disso só borra).
      var Z_MAX = 1;
      // Mínimo = imagem inteira no quadro (calculado no carregamento).
      var zMin = 0.1;

      // Posição do desenho em pixels (posX/posY), sem rolagem: move sempre e ancora o zoom no cursor.
      function aplicarPos() {
        canvas.style.left = Math.round(posX) + 'px';
        canvas.style.top  = Math.round(posY) + 'px';
      }

      // Mantém o desenho no quadro: se cabe, centraliza; se não, as bordas param nas bordas.
      function limitarPos() {
        var w = natW * zoom, h = natH * zoom;
        var vw = viewport.clientWidth, vh = viewport.clientHeight;
        posX = (w <= vw) ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, posX));
        posY = (h <= vh) ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, posY));
        // A mãozinha só aparece quando há mesmo para onde arrastar.
        viewport.classList.toggle('movel', w > vw || h > vh);
      }

      // Zoom mantendo fixo o ponto sob (ancoraX, ancoraY). Sem âncora, o centro.
      function aplicarZoom(z, ancoraX, ancoraY) {
        if (!natW) return;
        z = Math.max(zMin, Math.min(Z_MAX, z));
        if (z === zoom) return;
        var ax = (ancoraX === undefined) ? viewport.clientWidth / 2 : ancoraX;
        var ay = (ancoraY === undefined) ? viewport.clientHeight / 2 : ancoraY;

        // Onde a âncora cai DENTRO do desenho, em fração de 0 a 1.
        var fx = (ax - posX) / (natW * zoom);
        var fy = (ay - posY) / (natH * zoom);

        zoom = z;
        canvas.style.width = Math.max(1, natW * zoom) + 'px';
        // Reposiciona para essa mesma fração voltar a cair sob a âncora.
        posX = ax - fx * natW * zoom;
        posY = ay - fy * natH * zoom;
        limitarPos();
        aplicarPos();
      }

      // Zoom em que a imagem inteira cabe (também o mínimo), até 100%.
      function zoomAjuste() {
        if (!natW) return 1;
        var fit = Math.min((viewport.clientWidth - 16) / natW,
                           (viewport.clientHeight - 16) / natH);
        return Math.min(Z_MAX, Math.max(0.02, fit));
      }
      // Encaixa e centraliza (estado inicial e botão ⟳).
      function ajustarNaTela() {
        zMin = zoomAjuste();
        zoom = zMin;
        canvas.style.width = Math.max(1, natW * zoom) + 'px';
        limitarPos();   // no mínimo, centraliza
        aplicarPos();
      }

      function montarHotspots() {
        s.hotspots.forEach(function (h) {
          var el = document.createElement('button');
          el.className = 'hotspot';
          el.type = 'button';
          // data-num liga à peça; o número não é exibido ao cliente.
          el.setAttribute('data-num', h.linkNumero || '');
          el.title = h.texto || 'Selecionar peça(s) desta área';
          el.style.left = (h.x / natW * 100) + '%';
          el.style.top = (h.y / natH * 100) + '%';
          el.style.width = (h.w / natW * 100) + '%';
          el.style.height = (h.h / natH * 100) + '%';
          // Marca as peças daquele número (compara como String).
          el.addEventListener('click', function () {
            var num = h.linkNumero != null ? String(h.linkNumero) : '';
            if (!num) { if (h.texto) FG.toast(h.texto); return; }
            var alvo = null;
            Array.prototype.forEach.call(fdView.querySelectorAll('.part-row'), function (row) {
              if (String(row.getAttribute('data-num')) === num) {
                var chk = row.querySelector('.pr-chk');
                chk.checked = true;
                row.classList.add('sel');
                var qn = row.querySelector('.qn');
                if (Number(qn.value) === 0) qn.value = 1;
                if (!alvo) alvo = row;
              }
            });
            if (alvo) {
              // Peça escondida pela busca: limpa o filtro.
              if (alvo.classList.contains('oculta')) { campoBusca.value = ''; filtrarPecas(); }
              alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            else FG.toast('Nenhuma peça com o nº ' + num + ' nesta lista.');
            sincronizarHotspots();
          });
          canvas.appendChild(el);
        });
        sincronizarHotspots();
      }

      function prontoImg() {
        natW = img.naturalWidth || 1; natH = img.naturalHeight || 1;
        ajustarNaTela();
        montarHotspots();
      }
      if (img.complete && img.naturalWidth) prontoImg();
      else { img.addEventListener('load', prontoImg); img.addEventListener('error', function () {
        viewport.innerHTML = '<p class="muted" style="padding:20px;">Não foi possível carregar o diagrama.</p>';
      }); }

      /* ---- roda do mouse: zoom no ponto do cursor (passive:false e deltaY normalizado) ---- */
      viewport.addEventListener('wheel', function (e) {
        e.preventDefault();
        var d = e.deltaY;
        if (e.deltaMode === 1) d *= 16;        // linhas → px
        else if (e.deltaMode === 2) d *= 100;  // páginas → px
        var r = viewport.getBoundingClientRect();
        aplicarZoom(zoom * Math.pow(1.0016, -d), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });

      /* ---- arrastar o desenho (mouse e toque); não começa em cima de hotspot ---- */
      var arrastando = false, xIni = 0, yIni = 0, pxIni = 0, pyIni = 0;
      viewport.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest('.hotspot')) return;
        arrastando = true;
        xIni = e.clientX; yIni = e.clientY;
        pxIni = posX; pyIni = posY;
        viewport.classList.add('arrastando');
        viewport.setPointerCapture(e.pointerId);
      });
      viewport.addEventListener('pointermove', function (e) {
        if (!arrastando) return;
        posX = pxIni + (e.clientX - xIni);
        posY = pyIni + (e.clientY - yIni);
        limitarPos();
        aplicarPos();
      });
      function fimArrasto() { arrastando = false; viewport.classList.remove('arrastando'); }
      viewport.addEventListener('pointerup', fimArrasto);
      viewport.addEventListener('pointercancel', fimArrasto);

      document.getElementById('dg-in').addEventListener('click', function () { aplicarZoom(zoom * 1.3); });
      document.getElementById('dg-out').addEventListener('click', function () { aplicarZoom(zoom / 1.3); });
      document.getElementById('dg-reset').addEventListener('click', ajustarNaTela);
      document.getElementById('dg-prev').addEventListener('click', function () {
        if (s.vizinhos.anterior) location.hash = '#/secao/' + s.vizinhos.anterior;
      });
      document.getElementById('dg-next').addEventListener('click', function () {
        if (s.vizinhos.proxima) location.hash = '#/secao/' + s.vizinhos.proxima;
      });

      /* passar o mouse numa linha realça os hotspots daquele número */
      Array.prototype.forEach.call(fdView.querySelectorAll('.part-row'), function (row) {
        row.addEventListener('mouseenter', function () {
          var n = row.getAttribute('data-num');
          Array.prototype.forEach.call(canvas.querySelectorAll('.hotspot'), function (h) {
            if (h.getAttribute('data-num') === n && n) h.classList.add('hover');
          });
        });
        row.addEventListener('mouseleave', function () {
          Array.prototype.forEach.call(canvas.querySelectorAll('.hotspot.hover'), function (h) {
            h.classList.remove('hover');
          });
        });
      });
    }, function () {
      if (!vigente()) return;
      fdView.innerHTML = '<p class="muted">Seção não encontrada.</p>';
    });
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    telaSeq++;   // respostas da tela anterior não desenham mais
    var h = (location.hash || '').slice(1);
    if (h[0] === '/') h = h.slice(1);
    var p = h.split('/');
    if (p[0] === 'modelo' && p[1]) renderModelo(decodeURIComponent(p[1]), p[2] === 'engine' ? 'engine' : 'chassi');
    else if (p[0] === 'secao' && p[1]) renderSecao(Number(p[1]));
    else {
      // Tela inicial: limpa e reabre a busca.
      fdView.innerHTML = '';
      spBody.classList.remove('hidden');
      spToggle.textContent = '▾ Buscar';
    }
    window.scrollTo(0, 0);
  }

  // VOLTAR: um passo atrás; na busca, sai para o portal.
  document.getElementById('fd-voltar').addEventListener('click', function () {
    if ((location.hash || '').replace('#', '') && history.length > 1) history.back();
    else location.href = '/portal';
  });

  /* carrega os modelos (árvore) e só então liga o router */
  FG.finderModelos().then(function (lista) {
    MODELOS = lista || [];
    initCascade();
    window.addEventListener('hashchange', route);
    route();
  }, function (e) {
    fdView.innerHTML = '<p class="muted">Não foi possível carregar os modelos: ' +
      esc((e && e.message) || 'erro de rede') + '</p>';
  });

  }); // fim FG.pronto.then
})();
