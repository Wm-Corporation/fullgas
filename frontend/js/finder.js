/* =========================================================
   FULLGAS B2B — Spare Parts Finder (finder.html)
   ---------------------------------------------------------
   100% alimentado pela API (/api/finder/*): modelos com árvore,
   seções por lado, peças com quantidade padrão e diagrama com
   hotspots clicáveis — tudo editável no painel do administrador.
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  // Conta interna (sub-dealer) sem a área "finder" volta ao portal.
  if (!FG.temArea(sess, 'finder')) {
    alert('Sua conta não tem acesso ao Parts Finder. Fale com o gestor da concessionária.');
    location.href = '/portal'; return;
  }

  // Espera o cache (produtos p/ cesta) antes de montar a tela.
  FG.pronto.then(function () {

  var fdView = document.getElementById('fd-view');
  var esc = FG.esc;
  var USAGE_KEY = 'fullgas_finder_usage_v1';

  document.getElementById('fd-who').innerHTML = FG.esc(sess.email) + ' - ' + FG.empresaDaSessao(sess);

  /* carrinho da loja no topo — o finder envia peças à mesma cesta da loja,
     então o contador acompanha cada "ADD ITEM(S) TO BASKET" */
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

  /* Modelo e seção desenham quando a resposta chega. Clicando rápido em NEXT
     CATEGORY (ou nas setas), as respostas podem voltar fora de ordem: a tela
     mostrava a seção 2 com o endereço já na 3, e o próximo clique apontava
     para a própria 3 — nada acontecia, como se a página tivesse travado. Cada
     troca de tela ganha um número; resposta de tela antiga é descartada. */
  var telaSeq = 0;
  function telaVigente() {
    var minha = telaSeq;
    return function () { return minha === telaSeq; };
  }

  /* ---------- painel de busca: expandir/recolher e reset ---------- */
  var spBody = document.getElementById('sp-body');
  var spToggle = document.getElementById('sp-toggle');
  function recolherBusca() { spBody.classList.add('hidden'); spToggle.textContent = '▸ Search'; }
  spToggle.addEventListener('click', function () {
    var aberto = !spBody.classList.contains('hidden');
    spBody.classList.toggle('hidden', aberto);
    spToggle.textContent = (aberto ? '▸' : '▾') + ' Search';
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
    spToggle.textContent = '▾ Search';
  });

  /* ---------- árvore de seleção (filtro em cascata) ---------------------
     Marca › Modalidade › Categoria › Modelo › Ano — os mesmos níveis que a
     API devolve em `arvore`, lidos direto dos campos do modelo; editar um
     modelo no painel já muda a árvore. Cilindrada e tipo de motor não
     entram. O último nível lista os anos do modelo escolhido e resolve o
     código para navegar — respeitando o lado (Frame/Engine) escolhido. */
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
  // Se um nível tem exatamente uma opção real (fora o placeholder), seleciona-a
  // e segue — evita passos vazios quando o atributo é único ou ausente. Nunca
  // escolhe o modelo (nível final) sozinho.
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
  // Reflete um modelo já resolvido (via VIN, usage list ou rota direta) nos
  // seletores, para o usuário ver onde está na cascata.
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

  /* ---------- usage list ----------
     Agora abre uma PÁGINA própria (finder-uso.html): o cliente busca uma peça
     pelo SKU/descrição e vê todas as seções que a utilizam. */
  document.getElementById('btn-usage').addEventListener('click', function () {
    location.href = '/finder-uso';
  });

  /* miniatura de uma seção: diagrama enviado pelo admin ou moto esquemática */
  function thumbHTML(s, tam) {
    if (s.imagem) return '<img src="' + esc(s.imagem) + '" alt="' + esc(s.nome) + '" loading="lazy">';
    return '<span class="thumb-bg">' + FG.bikeSVG(s.destaque, tam || 92) + '</span>';
  }

  /* =========================================================
     TELA: visão geral do modelo (lista de seções + miniaturas)
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
        '<button id="fl-img">🖼 Show Image</button>' +
        '<a href="#/modelo/' + esc(m.id) + '/' + outro + '">Switch To ' + (outro === 'engine' ? 'Engine' : 'Frame') + '</a>' +
        '<button id="fl-doc">📘 Technical documentation</button>' +
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
            (lado === 'engine' ? 'Engine' : 'Frame') + ' deste modelo.</p>');

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
     TELA: seção (tabela de peças + diagrama com hotspots e zoom)
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

      // Não há mais cabeçalho de colunas: cada peça virou um card, e dentro
      // dele cada dado já se identifica sozinho (nome em destaque, código
      // abaixo, preço à direita, status com bolinha colorida). Uma legenda
      // de colunas só faz sentido quando os dados estão alinhados em grade.

      // Status de compra da peça — mesmo princípio de cores da loja:
      // verde = em estoque, amarelo = pré-venda (com previsão), vermelho =
      // indisponível (não pode ser comprada; o campo de quantidade trava).
      function statusPeca(p) {
        if (p.estoque > 0) return '<span class="pt-status ok">● Em estoque</span>';
        if (p.previsao) return '<span class="pt-status pre">● Pré-venda · ' + esc(p.previsao) + '</span>';
        return '<span class="pt-status out">● Indisponível</span>';
      }

      var linhas = s.pecas.map(function (p, i) {
        // O número da linha é o "nº na imagem" definido pelo admin — o mesmo que
        // liga a peça à área clicável do diagrama. NÃO é a posição na tela: uma
        // contagem sequencial faria a lista parecer fora de ordem para o cliente.
        // Sem número cadastrado, mostra "—" (a peça não tem área no diagrama).
        var num = (p.numeroImagem === null || p.numeroImagem === undefined || p.numeroImagem === '')
          ? '—' : String(p.numeroImagem);
        var marcada = p.quantidadePadrao > 0;
        var indisp = !(p.estoque > 0) && !p.previsao;
        // Em estoque: quantidade limitada ao saldo (mesma regra do carrinho
        // da loja). Pré-venda não limita aqui — vai para o backorder.
        var max = p.estoque > 0 ? p.estoque : null;
        var vIni = indisp ? 0 : (max ? Math.min(p.quantidadePadrao, max) : p.quantidadePadrao);
        // Ver a peça na loja abre em NOVA aba: o cliente não perde o finder.
        var link = '/loja#/produto/' + encodeURIComponent(p.sku);
        // Texto que a busca varre: nº na imagem + código + nome, tudo junto e
        // em minúsculas. Fica pronto aqui, uma vez, em vez de ser remontado a
        // cada tecla digitada no filtro.
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
              // Quantidade que o diagrama pede desta peça no conjunto — é
              // referência de montagem, não o que vai à cesta (esse é o campo
              // editável ao lado).
              '<span class="pr-ref">Uds. <b>' + p.quantidade + '</b></span>' +
              statusPeca(p) +
            '</span>' +
            '<span class="pr-acao">' +
              '<label class="pr-sel"><input type="checkbox" class="pr-chk" data-row="' + i + '"' +
                (marcada ? ' checked' : '') + '> Selecionar</label>' +
              '<input class="qn" type="number" min="0"' + (max ? ' max="' + max + '"' : '') + ' value="' + vIni + '"' +
              ' aria-label="Quantidade" data-art="' + esc(p.sku) + '"' +
              (indisp ? ' disabled title="Peça indisponível para compra"' : '') + '>' +
            '</span>' +
          '</div>' +
          '</div>';
      }).join('');

      fdView.innerHTML =
        '<div class="finder-crumb"><a href="#/modelo/' + esc(s.modelo.id) + '/' + s.lado + '">' + esc(s.modelo.label) + '</a>' +
        ' <span class="chev">›</span> ' + esc(s.nome) +
        '<button class="link-action crumb-print" id="fa-print">🖨 Print</button></div>' +
        '<div class="fnd-actions">' +
        '<button class="btn" id="fa-next"' + (s.vizinhos.proxima ? '' : ' disabled') + '>NEXT CATEGORY</button>' +
        '<a class="btn" href="#/modelo/' + esc(s.modelo.id) + '/' + outro + '">SWITCH TO ' + (outro === 'engine' ? 'ENGINE' : 'FRAME') + '</a>' +
        '</div>' +
        '<div class="part-layout">' +
        '<div class="part-col">' +
        '<div class="part-toolbar"><span class="muted">' + esc(s.numero) + ' — ' + esc(s.nome) + '</span>' +
        '<button class="btn" id="fa-cart">🛒 ADD ITEM(S) TO BASKET</button></div>' +
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

      // Destaca no diagrama os hotspots das linhas selecionadas (no-op sem
      // diagrama — o canvas só existe quando a seção tem imagem).
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

      /* adicionar selecionados à cesta da loja — mesma regra do carrinho:
         nunca passa do estoque disponível (contando o que JÁ está na cesta) */
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
          (ajustadas ? ' ' + ajustadas + ' ajustado(s) ao estoque disponível.' : '') +
          (recusadas ? ' ' + recusadas + ' indisponível(is).' : ''),
          (ajustadas || recusadas) ? 'erro' : undefined);
        else if (ajustadas) FG.toast('A cesta já tem todo o estoque disponível dessa(s) peça(s).', 'erro');
        else if (recusadas) FG.toast('Peça(s) indisponível(is) no momento — sem estoque e sem previsão.', 'erro');
        else FG.toast('Marque ao menos uma peça com quantidade.');
        refreshCart();
      });

      /* ---------- busca dentro da lista de peças ----------
         Filtra só a EXIBIÇÃO. As peças marcadas continuam marcadas mesmo
         escondidas, e o botão de enviar à cesta continua levando todas elas:
         a busca é uma lente para achar a peça, não uma seleção. Se ela
         apagasse o que está fora do filtro, o cliente perderia sem aviso o
         que já tinha escolhido em outra busca.

         Fica ANTES do bloco do diagrama de propósito: aquele trecho começa
         com um `return` para as seções sem imagem, e a lista de peças (com a
         busca) existe nessas seções também. */
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
      // Teto de 1 = 100% do tamanho original. Passar disso não revela nenhum
      // detalhe novo: só amplia os pixels que o admin enviou, e o desenho
      // aparece borrado como se a foto fosse de má qualidade.
      var Z_MAX = 1;
      // Piso = o zoom em que a imagem cabe inteira no quadro (calculado quando
      // ela carrega). Afastar além disso só produziria um desenho pequeno
      // boiando num quadro vazio — não há nada a mais para ver.
      var zMin = 0.1;

      /* POR QUE A IMAGEM NÃO USA MAIS ROLAGEM (overflow: auto)
         ------------------------------------------------------------------
         O quadro rolava, e a posição do desenho era o scroll. Isso tem um
         defeito que aparece justo no uso mais comum: enquanto a imagem CABE
         no quadro — que é o estado inicial, o "ajustar à tela" —, não há o
         que rolar, o scroll fica preso em zero e o desenho não sai do lugar.
         Resultado: arrastar não funcionava, e o zoom com a roda não tinha
         como manter o ponto sob o cursor, porque o único jeito de deslocar a
         imagem estava travado.

         Agora o desenho é posicionado à mão (posX/posY, em pixels dentro do
         quadro). Some o travamento: ele se move sempre, ampliado ou não, e a
         âncora do zoom vira uma conta direta de subtração. */
      function aplicarPos() {
        canvas.style.left = Math.round(posX) + 'px';
        canvas.style.top  = Math.round(posY) + 'px';
      }

      // O desenho nunca sai do quadro. Em cada eixo, só há dois casos:
      //   • cabe no quadro  → fica CENTRADO e não se move (o zoom mínimo é
      //     exatamente esse ponto, então é o estado de repouso da tela);
      //   • maior que o quadro → desliza, mas as bordas param nas bordas do
      //     quadro. Nunca aparece faixa branca ao lado do desenho.
      // Sem isto o cliente arrasta a imagem para fora e fica olhando um quadro
      // vazio, sem entender que o diagrama continua ali, só que deslocado.
      function limitarPos() {
        var w = natW * zoom, h = natH * zoom;
        var vw = viewport.clientWidth, vh = viewport.clientHeight;
        posX = (w <= vw) ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, posX));
        posY = (h <= vh) ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, posY));
        // A mãozinha só aparece quando há mesmo para onde arrastar.
        viewport.classList.toggle('movel', w > vw || h > vh);
      }

      // Zoom mantendo FIXO o ponto do desenho que está sob (ancoraX, ancoraY),
      // coordenadas relativas ao canto do quadro. Sem âncora, usa o centro do
      // quadro — é o que os botões + e − fazem.
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

      // Zoom em que a imagem INTEIRA cabe no quadro (largura E altura),
      // qualquer que seja o tamanho enviado pelo admin — o padrão dos diagramas
      // é 750×1080 (retrato), que sem o limite de altura estouraria o quadro.
      // É também o PISO do zoom, e o teto de 100% vale aqui: um diagrama menor
      // que o quadro aparece no tamanho real, e não esticado.
      function zoomAjuste() {
        if (!natW) return 1;
        var fit = Math.min((viewport.clientWidth - 16) / natW,
                           (viewport.clientHeight - 16) / natH);
        return Math.min(Z_MAX, Math.max(0.02, fit));
      }
      // Encaixa e centraliza — estado inicial e o que o botão ⟳ devolve.
      //
      // A tela abre no encaixe exato, sem passo extra de aproximação. O passo
      // extra existia porque o quadro era deitado: o desenho é retrato, então
      // ele encaixava pela altura e ficava pequeno no meio de duas faixas
      // brancas. Com o quadro em pé, na proporção do próprio desenho, o
      // encaixe JÁ preenche o quadro — aproximar além disso agora só cortaria
      // parte do diagrama logo na abertura.
      function ajustarNaTela() {
        zMin = zoomAjuste();
        zoom = zMin;
        canvas.style.width = Math.max(1, natW * zoom) + 'px';
        limitarPos();   // no piso a imagem cabe inteira, então isto a centraliza
        aplicarPos();
      }

      function montarHotspots() {
        s.hotspots.forEach(function (h) {
          var el = document.createElement('button');
          el.className = 'hotspot';
          el.type = 'button';
          // data-num continua no elemento (usado para casar com as peças e para
          // o realce ao passar o mouse), mas o NÚMERO não é exibido: é um dado
          // interno do administrador — o cliente vê só a área clicável.
          el.setAttribute('data-num', h.linkNumero || '');
          el.title = h.texto || 'Selecionar peça(s) desta área';
          el.style.left = (h.x / natW * 100) + '%';
          el.style.top = (h.y / natH * 100) + '%';
          el.style.width = (h.w / natW * 100) + '%';
          el.style.height = (h.h / natH * 100) + '%';
          // Clicar no quadrado marca a(s) peça(s) daquele número na lista.
          // Compara como String: o data-num do row é string e o linkNumero
          // pode vir número da API (evita "1" === 1 dar falso).
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
              // A peça pode estar escondida por uma busca em aberto. Sem
              // limpar o filtro, o clique no diagrama marcaria a peça e não
              // rolaria para lugar nenhum — parece que nada aconteceu.
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

      /* ---- roda do mouse: aproxima/afasta no ponto sob o cursor ----
         preventDefault exige passive:false — sem isso o navegador ignora o
         pedido e a PÁGINA rola junto com o zoom. E a normalização do deltaY é
         obrigatória: o mesmo giro de roda chega como ~100 (pixels), ~3
         (linhas, Firefox) ou ~1 (páginas), então usar o valor cru daria um
         salto absurdo num navegador e quase nada em outro. */
      viewport.addEventListener('wheel', function (e) {
        e.preventDefault();
        var d = e.deltaY;
        if (e.deltaMode === 1) d *= 16;        // linhas → px
        else if (e.deltaMode === 2) d *= 100;  // páginas → px
        var r = viewport.getBoundingClientRect();
        aplicarZoom(zoom * Math.pow(1.0016, -d), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });

      /* ---- arrastar o desenho livremente, ampliado ou não ----
         Vale para mouse e para o toque: o quadro não rola mais, então sem isto
         não haveria como mover a imagem no celular.
         Nada é iniciado quando o clique começa em cima de um hotspot — senão o
         arrasto engoliria o clique que seleciona a peça. */
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
    telaSeq++;   // respostas pendentes da tela anterior não desenham mais
    var h = (location.hash || '').slice(1);
    if (h[0] === '/') h = h.slice(1);
    var p = h.split('/');
    if (p[0] === 'modelo' && p[1]) renderModelo(decodeURIComponent(p[1]), p[2] === 'engine' ? 'engine' : 'chassi');
    else if (p[0] === 'secao' && p[1]) renderSecao(Number(p[1]));
    else {
      // Tela inicial: limpa o resultado e reabre o painel de busca — é o que
      // o VOLTAR encontra ao sair de um modelo/seção.
      fdView.innerHTML = '';
      spBody.classList.remove('hidden');
      spToggle.textContent = '▾ Search';
    }
    window.scrollTo(0, 0);
  }

  // Botão VOLTAR único do finder: dentro de um modelo/seção volta um passo na
  // navegação; já na tela de busca, sai para o portal.
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
