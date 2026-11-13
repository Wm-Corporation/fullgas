/* =========================================================
   FULLGAS B2B — Catálogo de Peças KTM (pecas-ktm.html), alimentado por /api/catalogo-ktm/*
   Em teste: só administradores. Mesmo visual e mesma cesta do Localizador de Peças.
   Rotas: #/<marca>  ·  #/<marca>/<modelo>/<lado>  ·  #/<marca>/<modelo>/<lado>/<grupo>
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard('admin');
  if (!sess) return;

  FG.pronto.then(function () {

  var esc = FG.esc;
  var fdView = document.getElementById('fd-view');
  var MARCAS = [{ id: 'gasgas', nome: 'GASGAS' }, { id: 'ktm', nome: 'KTM' }, { id: 'husqvarna', nome: 'Husqvarna' }];
  var MARCA_KEY = 'fullgas_pecas_ktm_marca_v1';

  document.getElementById('fd-who').innerHTML = esc(sess.email) + ' - ' + FG.empresaDaSessao(sess);

  function refreshCart() { document.getElementById('fd-cart-n').textContent = FG.cartCount(); }
  refreshCart();

  function falha(e) { FG.toast((e && e.message) || 'Falha ao carregar.', 'erro'); }

  // Cada troca de tela ganha um número; resposta de tela antiga é descartada.
  var telaSeq = 0;
  function telaVigente() { var minha = telaSeq; return function () { return minha === telaSeq; }; }

  function marcaValida(m) { return MARCAS.some(function (x) { return x.id === m; }); }
  function nomeMarca(m) { return (MARCAS.filter(function (x) { return x.id === m; })[0] || {}).nome || m; }
  function lerMarcaSalva() { try { return localStorage.getItem(MARCA_KEY); } catch (e) { return null; } }
  function salvarMarca(m) { try { localStorage.setItem(MARCA_KEY, m); } catch (e) { /* sem storage */ } }

  var estado = { marca: marcaValida(lerMarcaSalva()) ? lerMarcaSalva() : 'gasgas', modelos: [], carregadas: {} };
  function ladoMarcado() { return document.querySelector('input[name="sp-cat"]:checked').value; }
  function marcarLado(lado) {
    document.querySelector('input[name="sp-cat"][value="' + (lado === 'engine' ? 'engine' : 'chassi') + '"]').checked = true;
  }

  /* ---------- painel de busca ---------- */
  var spBody = document.getElementById('sp-body');
  var spToggle = document.getElementById('sp-toggle');
  function recolherBusca() { spBody.classList.add('hidden'); spToggle.textContent = '▸ Buscar peças'; }
  function abrirBusca() { spBody.classList.remove('hidden'); spToggle.textContent = '▾ Buscar peças'; }
  spToggle.addEventListener('click', function () {
    if (spBody.classList.contains('hidden')) abrirBusca(); else recolherBusca();
  });
  document.getElementById('sp-reset').addEventListener('click', function (e) {
    e.preventDefault();
    document.getElementById('sp-vin').value = '';
    campoBusca.value = '';
    mostrarResultados();
    location.hash = '#/' + estado.marca;
  });

  /* ---------- marcas ---------- */
  var caixaMarcas = document.getElementById('kt-marcas');
  caixaMarcas.innerHTML = MARCAS.map(function (m) {
    return '<button type="button" role="tab" data-marca="' + m.id + '">' + esc(m.nome) + '</button>';
  }).join('');
  caixaMarcas.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-marca]');
    if (b && b.getAttribute('data-marca') !== estado.marca) location.hash = '#/' + b.getAttribute('data-marca');
  });
  function pintarMarcas() {
    Array.prototype.forEach.call(caixaMarcas.querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-marca') === estado.marca;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  // Árvore de modelos da marca (uma leitura; o servidor guarda por 7 dias).
  function carregarModelos(marca) {
    if (estado.carregadas[marca]) return Promise.resolve(estado.carregadas[marca]);
    return FG.ktmModelos(marca).then(function (l) { estado.carregadas[marca] = l || []; return estado.carregadas[marca]; });
  }
  function trocarMarca(marca) {
    if (marca === estado.marca && estado.modelos.length) return Promise.resolve();
    estado.marca = marca;
    salvarMarca(marca);
    pintarMarcas();
    estado.modelos = [];
    campoBusca.value = '';
    campoBusca.placeholder = 'Carregando modelos da ' + nomeMarca(marca) + '…';
    mostrarResultados();
    return carregarModelos(marca).then(function (l) {
      if (estado.marca !== marca) return;
      estado.modelos = l;
      campoBusca.placeholder = 'Digite modelo e ano. Ex.: ' + exemploBusca(l);
      montarArvore();
    }, function (e) {
      campoBusca.placeholder = 'Não foi possível carregar os modelos.';
      falha(e);
    });
  }
  function exemploBusca(l) {
    var m = l.filter(function (x) { return x.ano; }).slice(-1)[0];
    return m ? m.nome : '450 EXC 2019';
  }
  function modeloPorId(id) {
    for (var i = 0; i < estado.modelos.length; i++) if (estado.modelos[i].id === String(id)) return estado.modelos[i];
    return null;
  }
  function rotuloModelo(m) {
    return m.nome + (m.mercado ? ' · ' + m.mercado : '') + (m.codigo ? ' · ' + m.codigo : '');
  }

  /* ---------- busca do modelo por texto ---------- */
  var campoBusca = document.getElementById('kt-busca');
  var caixaRes = document.getElementById('kt-resultados');
  function normal(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-.,()]/g, ' ');
  }
  function mostrarResultados() {
    var termos = normal(campoBusca.value).split(/\s+/).filter(Boolean);
    if (!termos.length) { caixaRes.classList.add('hidden'); caixaRes.innerHTML = ''; return; }
    var achados = [];
    for (var i = 0; i < estado.modelos.length && achados.length < 60; i++) {
      var m = estado.modelos[i];
      var alvo = normal(m.caminho.join(' ') + ' ' + m.nome + ' ' + (m.ano || '') + ' ' + (m.mercado || '') + ' ' + (m.codigo || ''));
      if (termos.every(function (t) { return alvo.indexOf(t) >= 0; })) achados.push(m);
    }
    achados.sort(function (a, b) { return (b.ano || 0) - (a.ano || 0) || a.nome.localeCompare(b.nome); });
    caixaRes.innerHTML = achados.length
      ? achados.map(function (m) {
          return '<button type="button" data-id="' + esc(m.id) + '">' + esc(rotuloModelo(m)) +
            '<span class="kt-cam">' + esc(m.caminho.slice(1).join(' › ')) + '</span></button>';
        }).join('')
      : '<div class="kt-vazio">Nenhum modelo da ' + esc(nomeMarca(estado.marca)) + ' com esse nome.</div>';
    caixaRes.classList.remove('hidden');
  }
  campoBusca.addEventListener('input', mostrarResultados);
  campoBusca.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { var b = caixaRes.querySelector('button'); if (b) { e.preventDefault(); b.focus(); } }
    if (e.key === 'Enter') { var p = caixaRes.querySelector('button'); if (p) { e.preventDefault(); p.click(); } }
  });
  caixaRes.addEventListener('keydown', function (e) {
    var at = document.activeElement;
    if (e.key === 'ArrowDown' && at.nextElementSibling) { e.preventDefault(); at.nextElementSibling.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (at.previousElementSibling || campoBusca).focus(); }
  });
  caixaRes.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-id]');
    if (!b) return;
    caixaRes.classList.add('hidden');
    abrirModelo(b.getAttribute('data-id'));
  });
  function abrirModelo(id) {
    location.hash = '#/' + estado.marca + '/' + id + '/' + ladoMarcado();
  }

  /* ---------- navegação pela árvore (níveis variam de marca para marca) ---------- */
  var caixaArvore = document.getElementById('kt-arvore');
  var botaoArvore = document.getElementById('kt-arvore-btn');
  var escolhas = [];
  botaoArvore.addEventListener('click', function () {
    var abrir = caixaArvore.classList.contains('hidden');
    caixaArvore.classList.toggle('hidden', !abrir);
    botaoArvore.textContent = (abrir ? '▾' : '▸') + ' Navegar pela árvore de modelos';
  });
  function montarArvore() { escolhas = []; desenharArvore(); }
  function desenharArvore() {
    var html = '';
    var base = estado.modelos;
    for (var nivel = 0; ; nivel++) {
      var filtro = escolhas.slice(0, nivel);
      base = estado.modelos.filter(function (m) {
        for (var k = 0; k < filtro.length; k++) if (m.caminho[k] !== filtro[k]) return false;
        return true;
      });
      var abaixo = base.filter(function (m) { return m.caminho.length > nivel; });
      if (!abaixo.length) break;
      var vistos = {}, opcoes = [];
      abaixo.forEach(function (m) { var v = m.caminho[nivel]; if (!vistos[v]) { vistos[v] = 1; opcoes.push(v); } });
      opcoes.sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
      if (opcoes.length === 1 && escolhas[nivel] === undefined) escolhas[nivel] = opcoes[0];
      html += '<select data-nivel="' + nivel + '"><option value="">Escolha…</option>' + opcoes.map(function (v) {
        return '<option' + (escolhas[nivel] === v ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('') + '</select>';
      if (escolhas[nivel] === undefined) { base = null; break; }
    }
    if (base) {
      var finais = base.slice().sort(function (a, b) { return (b.ano || 0) - (a.ano || 0) || rotuloModelo(a).localeCompare(rotuloModelo(b)); });
      html += '<select data-final="1"><option value="">Modelo e ano…</option>' + finais.map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(rotuloModelo(m)) + '</option>';
      }).join('') + '</select>';
    }
    caixaArvore.innerHTML = html;
  }
  caixaArvore.addEventListener('change', function (e) {
    var s = e.target;
    if (s.getAttribute('data-final')) { if (s.value) abrirModelo(s.value); return; }
    var nivel = Number(s.getAttribute('data-nivel'));
    escolhas = escolhas.slice(0, nivel);
    if (s.value) escolhas[nivel] = s.value;
    desenharArvore();
  });

  /* ---------- busca por VIN ---------- */
  document.getElementById('sp-search').addEventListener('click', function () {
    var vin = document.getElementById('sp-vin').value.trim().toUpperCase();
    if (!vin) {
      var primeiro = caixaRes.querySelector('button[data-id]');
      if (primeiro) { primeiro.click(); return; }
      FG.toast('Informe o chassi (VIN) ou escolha o modelo.');
      return;
    }
    var botao = this;
    botao.disabled = true;
    FG.ktmVin(estado.marca, vin).then(function (m) {
      botao.disabled = false;
      location.hash = '#/' + estado.marca + '/' + m.id + '/' + ladoMarcado();
    }, function (e) { botao.disabled = false; falha(e); });
  });

  /* =========================================================
     TELA: modelo (foto da moto + grupos com a prancha como miniatura)
     ========================================================= */
  function renderModelo(modeloId, lado) {
    fdView.innerHTML = '<p class="muted">Carregando os grupos da ' + esc(nomeMarca(estado.marca)) + '…</p>';
    var vigente = telaVigente();
    var marca = estado.marca;
    FG.ktmGrupos(marca, modeloId, lado).then(function (r) {
      if (!vigente()) return;
      marcarLado(lado);
      recolherBusca();
      var m = r.modelo;
      var outro = lado === 'chassi' ? 'engine' : 'chassi';
      fdView.innerHTML =
        '<div class="kt-modelo">' +
          '<div class="kt-foto' + (r.temFoto ? '' : ' sem') + '" id="kt-foto">' +
            (r.temFoto
              ? '<img src="' + esc(FG.ktmFotoUrl(marca, m.id)) + '" alt="' + esc(m.nome) + '">'
              : '<span>Sem foto no catálogo</span>') +
          '</div>' +
          '<div class="kt-dados">' +
            '<div class="finder-model-name">' + esc(m.nome) + '</div>' +
            '<div class="kt-cod">' + esc(nomeMarca(marca)) + (m.mercado ? ' · mercado ' + esc(m.mercado) : '') +
              (m.codigo ? ' · código ' + esc(m.codigo) : '') + '</div>' +
            '<div class="kt-cod">' + esc(m.caminho.slice(1).join(' › ')) + '</div>' +
            '<div class="finder-links"><a href="#/' + marca + '/' + esc(m.id) + '/' + outro + '">Ver ' +
              (outro === 'engine' ? 'motor' : 'chassi') + '</a></div>' +
          '</div>' +
        '</div>' +
        (r.grupos.length
          ? '<div class="kt-grupos">' + r.grupos.map(function (g) {
              return '<button type="button" class="kt-grupo" data-grupo="' + g.id + '">' +
                '<span class="kt-mini">' + (g.mapa
                  ? '<img loading="lazy" src="' + esc(FG.ktmMapaUrl(marca, g.mapa)) + '" alt="">'
                  : '') + '</span>' +
                '<span class="kt-rot"' + (g.nomeKtm ? ' title="KTM: ' + esc(g.nomeKtm) + '"' : '') + '><b>' + esc(g.numero) + '</b>' + esc(g.nome) + '</span></button>';
            }).join('') + '</div>'
          : '<p class="muted">A ' + esc(nomeMarca(marca)) + ' não tem grupos de ' +
            (lado === 'engine' ? 'motor' : 'chassi') + ' para este modelo.</p>');

      var foto = document.getElementById('kt-foto');
      var img = foto.querySelector('img');
      if (img) {
        img.addEventListener('error', function () { foto.classList.add('sem'); foto.innerHTML = '<span>Sem foto no catálogo</span>'; });
        foto.addEventListener('click', function () { if (foto.querySelector('img')) ampliar(m.nome, img.src); });
      }
      Array.prototype.forEach.call(fdView.querySelectorAll('.kt-grupo'), function (b) {
        b.addEventListener('click', function () {
          location.hash = '#/' + marca + '/' + m.id + '/' + lado + '/' + b.getAttribute('data-grupo');
        });
      });
    }, function (e) {
      if (!vigente()) return;
      fdView.innerHTML = '<p class="muted">' + esc((e && e.message) || 'Modelo não encontrado.') + '</p>';
    });
  }

  // Foto ampliada (pop-up fecha só no X, como no resto do portal).
  function ampliar(titulo, src) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal modal-img"><header><h3>' + esc(titulo) + '</h3>' +
      '<button class="x" type="button" aria-label="Fechar">×</button></header><div class="modal-body">' +
      '<img src="' + esc(src) + '" alt="' + esc(titulo) + '"></div></div>';
    document.body.appendChild(back);
    back.querySelector('.x').addEventListener('click', function () { back.remove(); });
  }

  /* =========================================================
     TELA: grupo (peças + prancha com pontos clicáveis e zoom)
     ========================================================= */
  // loja = { origem: 'portal'|'tiny'|'fora'|'verificar', opcoes: [{ artigo, classe, noPortal, estoque, preco, foto }] }.
  // p.escolha = índice da opção (kit de pistão: classe I, II...).
  function opcaoDe(p) { var l = p.loja || {}; return (l.opcoes || [])[p.escolha || 0] || {}; }
  function situacao(p) {
    if (!p.pedivel) return '<span class="kt-selo conjunto">Vem só no conjunto</span>';
    var o = opcaoDe(p);
    if (o.noPortal) return '<span class="pt-status">' + FG.seloEstoque({ estoque: o.estoque }) + '</span>';
    switch ((p.loja || {}).origem) {
      case 'tiny': return '<span class="kt-selo tiny" title="Cadastrada no Tiny, ainda não importada no portal. Ao adicionar, vem com preço e estoque reais.">No Tiny · importa ao adicionar</span>';
      case 'verificar': return '<span class="kt-selo verificar" title="A lista de códigos do Tiny ainda está sendo lida. A peça é conferida no Tiny quando for para a cesta.">Conferida no Tiny ao adicionar</span>';
      default: return '<span class="kt-selo fora" title="Não existe no Tiny: o pedido vira black order e o preço é definido na chegada">Fora do Tiny · black order</span>';
    }
  }
  function precoDe(p) {
    if (!p.pedivel) return '';
    var o = opcaoDe(p);
    return o.preco ? FG.fmtMoney(o.preco) : '<span class="muted" title="Preço definido quando a peça chegar">a definir</span>';
  }
  function fotoPeca(p) {
    var o = opcaoDe(p);
    var src = o.miniatura || o.foto;
    return src
      ? '<span class="kt-foto-peca" data-foto="' + esc(o.foto || src) + '"><img loading="lazy" src="' + esc(src) + '" alt=""></span>'
      : '<span class="kt-foto-peca sem" aria-hidden="true">⚙</span>';
  }
  // Kit de pistão: o Tiny tem um código por classe ("… I" = pistão A, "… II" = pistão B).
  function seletorClasse(p, i) {
    var ops = (p.loja || {}).opcoes || [];
    if (ops.length < 2) return '';
    return '<label class="kt-classe">Classe <select data-row="' + i + '">' + ops.map(function (o, k) {
      return '<option value="' + k + '"' + (k === (p.escolha || 0) ? ' selected' : '') + '>' +
        esc(o.classe ? o.classe + (o.classe === 'I' ? ' (pistão A)' : o.classe === 'II' ? ' (pistão B)' : '') : o.artigo) +
        '</option>';
    }).join('') + '</select></label>';
  }

  function renderGrupo(modeloId, lado, grupoId) {
    fdView.innerHTML = '<p class="muted">Carregando peças…</p>';
    var vigente = telaVigente();
    var marca = estado.marca;
    FG.ktmGrupo(marca, modeloId, lado, grupoId).then(function (g) {
      if (!vigente()) return;
      marcarLado(lado);
      recolherBusca();
      var base = '#/' + marca + '/' + g.modelo.id + '/' + lado;
      var outro = lado === 'chassi' ? 'engine' : 'chassi';

      var linhas = g.pecas.map(function (p, i) {
        var busca = esc(((p.seq || '') + ' ' + p.sku + ' ' + p.nome + ' ' + (p.nomeKtm || '') + ' ' + p.adicional).toLowerCase());
        return '<div class="part-row' + (p.pedivel ? '' : ' nao-pedivel') + '" data-row="' + i + '" data-busca="' + busca + '"' +
          ' data-num="' + esc(p.sku) + '">' +
          '<div class="pr-top">' +
            '<span class="pr-num">' + esc(p.seq == null ? '—' : String(p.seq)) + '</span>' +
            '<span class="kt-foto-slot">' + fotoPeca(p) + '</span>' +
            '<span class="pr-id">' +
              '<span class="pr-nome">' + esc(p.nome) + (p.novo ? ' <span class="kt-selo novo">Nova</span>' : '') + '</span>' +
              (p.nomeKtm && p.nomeKtm !== p.nome ? '<span class="kt-orig" title="Nome no catálogo da KTM">KTM: ' + esc(p.nomeKtm) + '</span>' : '') +
              '<span class="pr-sku">' + esc(p.pedivel ? p.sku : (p.adicional || p.sku)) + '</span>' +
              (p.pedivel && p.adicional ? '<span class="kt-adic">' + esc(p.adicional) + '</span>' : '') +
            '</span>' +
            '<span class="pr-preco">' + precoDe(p) + '</span>' +
          '</div>' +
          '<div class="pr-bot">' +
            '<span class="pr-info"><span class="pr-ref">Qtd. no conjunto: <b>' + p.quantidade + '</b></span>' +
              '<span class="kt-sit">' + situacao(p) + '</span>' + seletorClasse(p, i) + '</span>' +
            (p.pedivel
              ? '<span class="pr-acao"><label class="pr-sel"><input type="checkbox" class="pr-chk" data-row="' + i + '"> Selecionar</label>' +
                '<input class="qn" type="number" min="0" step="1" value="0" aria-label="Quantidade" data-row="' + i + '"></span>'
              : '') +
          '</div></div>';
      }).join('');

      var conta = { tiny: 0, fora: 0, verificar: 0 };
      g.pecas.forEach(function (p) {
        var o = p.pedivel && p.loja && p.loja.origem;
        if (o && conta[o] !== undefined && !opcaoDe(p).noPortal) conta[o]++;
      });
      var avisos = [];
      if (conta.tiny) avisos.push(conta.tiny + ' peça(s) estão no Tiny mas ainda não no portal: ao adicionar, são importadas com preço e estoque reais.');
      if (conta.fora) avisos.push(conta.fora + ' peça(s) não existem no Tiny: ao adicionar, são cadastradas no portal (só admin vê) e o checkout as manda para a black order.');
      if (conta.verificar) avisos.push('A lista de códigos do Tiny ainda está sendo lida (leva uns 2 minutos na primeira vez). ' +
        conta.verificar + ' peça(s) serão conferidas no Tiny quando forem para a cesta.');

      fdView.innerHTML =
        '<div class="finder-crumb"><a href="' + base + '">' + esc(g.modelo.nome) + '</a>' +
        ' <span class="chev">›</span> ' + esc(g.grupo.numero + ' ' + g.grupo.nome) +
        '<button class="link-action crumb-print" id="fa-print" type="button">🖨 Imprimir</button></div>' +
        '<div class="fnd-actions">' +
          '<button class="btn" id="fa-next" type="button"' + (g.vizinhos.proxima ? '' : ' disabled') + '>PRÓXIMO GRUPO</button>' +
          '<a class="btn" href="#/' + marca + '/' + g.modelo.id + '/' + outro + '">VER ' + (outro === 'engine' ? 'MOTOR' : 'CHASSI') + '</a>' +
        '</div>' +
        avisos.map(function (a) { return '<div class="kt-aviso">' + esc(a) + '</div>'; }).join('') +
        '<div class="part-layout">' +
          '<div class="part-col">' +
            '<div class="part-toolbar"><span class="muted">' + esc(g.grupo.numero + ' — ' + g.grupo.nome) + '</span>' +
            '<button class="btn" id="fa-cart" type="button">🛒 ADICIONAR À CESTA</button></div>' +
            (linhas
              ? '<div class="pt-busca"><span class="lupa">🔍</span>' +
                '<input type="search" id="pt-busca" autocomplete="off" placeholder="Buscar peça por nº, código ou nome" aria-label="Buscar peça neste grupo">' +
                '<button class="limpa hidden" id="pt-limpa" type="button" title="Limpar busca" aria-label="Limpar busca">✕</button></div>' +
                '<div class="part-list">' + linhas + '</div>' +
                '<p class="muted hidden" id="pt-vazio">Nenhuma peça deste grupo corresponde à busca.</p>'
              : '<p class="muted">A KTM não lista peças neste grupo.</p>') +
          '</div>' +
          '<div class="diagram-box">' +
            (g.mapa
              ? '<div class="diag-fab nav">' +
                  '<button class="dg-btn" id="dg-prev" type="button"' + (g.vizinhos.anterior ? '' : ' disabled') + ' title="Grupo anterior">◀</button>' +
                  '<button class="dg-btn" id="dg-next" type="button"' + (g.vizinhos.proxima ? '' : ' disabled') + ' title="Próximo grupo">▶</button>' +
                '</div>' +
                '<div class="diag-fab zoom">' +
                  '<button class="dg-btn" id="dg-in" type="button" title="Aproximar">+</button>' +
                  '<button class="dg-btn" id="dg-reset" type="button" title="Ajustar à tela">⟳</button>' +
                  '<button class="dg-btn" id="dg-out" type="button" title="Afastar">−</button>' +
                '</div>' +
                '<div class="diag-viewport" id="dg-view" title="Use a roda do mouse para aproximar; arraste para mover">' +
                  '<div class="diag-canvas" id="dg-canvas"><img id="dg-img" src="' + esc(FG.ktmMapaUrl(marca, g.mapa.arquivo)) + '" alt="' + esc(g.grupo.nome) + '" draggable="false"></div>' +
                '</div>'
              : '<div class="diag-vazio"><div class="cap">A KTM não tem prancha para este grupo.</div></div>') +
          '</div>' +
        '</div>';

      ligarLista(g, marca);
      if (g.mapa) ligarPrancha(g);
      document.getElementById('fa-print').addEventListener('click', function () { window.print(); });
      document.getElementById('fa-next').addEventListener('click', function () {
        if (g.vizinhos.proxima) location.hash = base + '/' + g.vizinhos.proxima;
      });
    }, function (e) {
      if (!vigente()) return;
      fdView.innerHTML = '<p class="muted">' + esc((e && e.message) || 'Grupo não encontrado.') + '</p>';
    });
  }

  function linhaDe(i) { return fdView.querySelector('.part-row[data-row="' + i + '"]'); }
  function marcar(row, on) {
    var chk = row.querySelector('.pr-chk');
    if (!chk) return;
    chk.checked = on;
    row.classList.toggle('sel', on);
    var qn = row.querySelector('.qn');
    if (on && Number(qn.value) === 0) qn.value = 1;
  }
  function sincronizarPontos() {
    var cv = document.getElementById('dg-canvas');
    if (!cv) return;
    var sel = {};
    Array.prototype.forEach.call(fdView.querySelectorAll('.part-row.sel'), function (r) { sel[r.getAttribute('data-num')] = true; });
    Array.prototype.forEach.call(cv.querySelectorAll('.hotspot'), function (h) { h.classList.toggle('on', !!sel[h.getAttribute('data-num')]); });
  }

  function ligarLista(g, marca) {
    Array.prototype.forEach.call(fdView.querySelectorAll('.pr-chk'), function (chk) {
      chk.addEventListener('change', function () { marcar(linhaDe(chk.getAttribute('data-row')), chk.checked); sincronizarPontos(); });
    });
    Array.prototype.forEach.call(fdView.querySelectorAll('.qn'), function (qn) {
      qn.addEventListener('input', function () {
        var row = linhaDe(qn.getAttribute('data-row'));
        var on = Number(qn.value) > 0;
        row.querySelector('.pr-chk').checked = on;
        row.classList.toggle('sel', on);
        sincronizarPontos();
      });
    });
    // Foto ampliada (delegado: a foto muda quando troca a classe).
    fdView.querySelector('.part-list') && fdView.querySelector('.part-list').addEventListener('click', function (e) {
      var f = e.target.closest('.kt-foto-peca[data-foto]');
      if (f) ampliar(f.closest('.part-row').querySelector('.pr-nome').textContent, f.getAttribute('data-foto'));
    });
    // Troca de classe (kit de pistão): atualiza foto, preço e situação da linha.
    Array.prototype.forEach.call(fdView.querySelectorAll('.kt-classe select'), function (s) {
      s.addEventListener('change', function () {
        var i = Number(s.getAttribute('data-row'));
        var p = g.pecas[i];
        p.escolha = Number(s.value) || 0;
        var row = linhaDe(i);
        row.querySelector('.kt-foto-slot').innerHTML = fotoPeca(p);
        row.querySelector('.pr-preco').innerHTML = precoDe(p);
        row.querySelector('.kt-sit').innerHTML = situacao(p);
      });
    });

    // Busca na lista: só esconde; as marcadas continuam marcadas.
    var campo = document.getElementById('pt-busca');
    if (campo) {
      var limpa = document.getElementById('pt-limpa');
      var vazio = document.getElementById('pt-vazio');
      var filtrar = function () {
        var t = campo.value.trim().toLowerCase(), vis = 0;
        Array.prototype.forEach.call(fdView.querySelectorAll('.part-row'), function (row) {
          var casa = !t || row.getAttribute('data-busca').indexOf(t) >= 0;
          row.classList.toggle('oculta', !casa);
          if (casa) vis++;
        });
        limpa.classList.toggle('hidden', !t);
        vazio.classList.toggle('hidden', vis > 0);
      };
      campo.addEventListener('input', filtrar);
      limpa.addEventListener('click', function () { campo.value = ''; filtrar(); campo.focus(); });
      g._limparBusca = function () { if (campo.value) { campo.value = ''; filtrar(); } };
    }

    // Adiciona à cesta. O que ainda não está no portal passa antes pela API: importa do Tiny ou,
    // se não existir lá, cadastra fora do Tiny (vira black order no checkout).
    document.getElementById('fa-cart').addEventListener('click', function () {
      var botao = this;
      var escolhidas = [];
      Array.prototype.forEach.call(fdView.querySelectorAll('.part-row.sel'), function (row) {
        var p = g.pecas[Number(row.getAttribute('data-row'))];
        var qtd = Math.max(0, Math.floor(Number(row.querySelector('.qn').value) || 0));
        if (p.pedivel && qtd > 0) escolhidas.push({ p: p, qtd: qtd, o: opcaoDe(p) });
      });
      if (!escolhidas.length) { FG.toast('Marque ao menos uma peça com quantidade.'); return; }
      var faltam = escolhidas.filter(function (e) { return !e.o.noPortal; });
      botao.disabled = true;
      var rotulo = botao.textContent;
      if (faltam.length) botao.textContent = 'Conferindo no Tiny…';
      var preparo = faltam.length
        ? FG.ktmGarantirPecas(marca, faltam.map(function (e) {
            var ops = (e.p.loja && e.p.loja.opcoes) || [];
            return { sku: e.p.sku, nome: e.p.nome, artigo: e.p.loja.origem === 'tiny' || ops.length > 1 ? e.o.artigo : undefined };
          }))
        : Promise.resolve(null);
      preparo.then(function (r) {
        var prontas = {};
        (r && r.pecas || []).forEach(function (x) { prontas[x.sku] = x; });
        var add = 0, bo = 0, falharam = 0;
        escolhidas.forEach(function (e) {
          var o = e.o.noPortal ? e.o : prontas[e.p.sku.toUpperCase()];
          if (!o || !FG.cartAdd(o.artigo, e.qtd)) { falharam++; return; }
          add += e.qtd;
          if (o.foraDoTiny || e.qtd > (o.estoque || 0)) bo++;
        });
        botao.disabled = false;
        botao.textContent = rotulo;
        refreshCart();
        var erros = (r && r.erros || []).map(function (x) { return x.erro; });
        if (add) FG.toast(add + ' item(ns) enviados à cesta.' +
          (bo ? ' ' + bo + ' peça(s) vão para a black order no checkout.' : '') +
          (erros.length ? ' Não entraram: ' + erros.join(' ') : (falharam ? ' ' + falharam + ' não entraram.' : '')),
          falharam ? 'erro' : undefined);
        else FG.toast(erros.length ? erros.join(' ') : 'Nenhuma peça entrou na cesta.', 'erro');
        // Peças importadas agora: a lista volta com o estoque e o preço reais.
        if (r && (r.importados || r.criados)) route();
      }, function (e) { botao.disabled = false; botao.textContent = rotulo; falha(e); });
    });
  }

  /* ---------- prancha: zoom, arrasto e pontos ---------- */
  function ligarPrancha(g) {
    var img = document.getElementById('dg-img');
    var canvas = document.getElementById('dg-canvas');
    var viewport = document.getElementById('dg-view');
    var W = g.mapa.largura || 0, H = g.mapa.altura || 0;
    var zoom = 1, zMin = 0.1, Z_MAX = 2.5, posX = 0, posY = 0;

    function aplicarPos() { canvas.style.left = Math.round(posX) + 'px'; canvas.style.top = Math.round(posY) + 'px'; }
    function limitarPos() {
      var w = W * zoom, h = H * zoom, vw = viewport.clientWidth, vh = viewport.clientHeight;
      posX = (w <= vw) ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, posX));
      posY = (h <= vh) ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, posY));
      viewport.classList.toggle('movel', w > vw || h > vh);
    }
    function aplicarZoom(z, ax, ay) {
      if (!W) return;
      z = Math.max(zMin, Math.min(Z_MAX, z));
      if (z === zoom) return;
      ax = ax === undefined ? viewport.clientWidth / 2 : ax;
      ay = ay === undefined ? viewport.clientHeight / 2 : ay;
      var fx = (ax - posX) / (W * zoom), fy = (ay - posY) / (H * zoom);
      zoom = z;
      canvas.style.width = Math.max(1, W * zoom) + 'px';
      posX = ax - fx * W * zoom; posY = ay - fy * H * zoom;
      limitarPos(); aplicarPos();
    }
    function ajustar() {
      zMin = Math.min(1, Math.max(0.05, Math.min((viewport.clientWidth - 16) / W, (viewport.clientHeight - 16) / H)));
      zoom = zMin;
      canvas.style.width = Math.max(1, W * zoom) + 'px';
      limitarPos(); aplicarPos();
    }
    function montarPontos() {
      g.pontos.forEach(function (pt) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'hotspot kt-ponto';
        el.setAttribute('data-num', pt.sku);
        var peca = g.pecas.filter(function (p) { return p.sku === pt.sku; })[0];
        el.title = peca ? (peca.seq + ' · ' + peca.nome) : pt.sku;
        el.style.left = (pt.x / W * 100) + '%';
        el.style.top = (pt.y / H * 100) + '%';
        el.style.width = (pt.w / W * 100) + '%';
        el.style.height = (pt.h / H * 100) + '%';
        el.addEventListener('click', function () {
          var alvo = null;
          Array.prototype.forEach.call(fdView.querySelectorAll('.part-row'), function (row) {
            if (row.getAttribute('data-num') === pt.sku) { marcar(row, true); if (!alvo) alvo = row; }
          });
          if (alvo) {
            if (alvo.classList.contains('oculta') && g._limparBusca) g._limparBusca();
            alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          sincronizarPontos();
        });
        canvas.appendChild(el);
      });
      sincronizarPontos();
    }
    function pronto() {
      if (!W) { W = img.naturalWidth || 1; H = img.naturalHeight || 1; }
      ajustar();
      montarPontos();
    }
    if (img.complete && img.naturalWidth) pronto();
    else {
      img.addEventListener('load', pronto);
      img.addEventListener('error', function () {
        viewport.innerHTML = '<p class="muted" style="padding:20px;">Não foi possível carregar a prancha.</p>';
      });
    }

    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 100;
      var r = viewport.getBoundingClientRect();
      aplicarZoom(zoom * Math.pow(1.0016, -d), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    var arrastando = false, xi = 0, yi = 0, pxi = 0, pyi = 0;
    viewport.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || (e.target.closest && e.target.closest('.hotspot'))) return;
      arrastando = true; xi = e.clientX; yi = e.clientY; pxi = posX; pyi = posY;
      viewport.classList.add('arrastando');
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', function (e) {
      if (!arrastando) return;
      posX = pxi + (e.clientX - xi); posY = pyi + (e.clientY - yi);
      limitarPos(); aplicarPos();
    });
    function fim() { arrastando = false; viewport.classList.remove('arrastando'); }
    viewport.addEventListener('pointerup', fim);
    viewport.addEventListener('pointercancel', fim);

    document.getElementById('dg-in').addEventListener('click', function () { aplicarZoom(zoom * 1.3); });
    document.getElementById('dg-out').addEventListener('click', function () { aplicarZoom(zoom / 1.3); });
    document.getElementById('dg-reset').addEventListener('click', ajustar);
    var base = '#/' + estado.marca + '/' + g.modelo.id + '/' + g.lado + '/';
    document.getElementById('dg-prev').addEventListener('click', function () { if (g.vizinhos.anterior) location.hash = base + g.vizinhos.anterior; });
    document.getElementById('dg-next').addEventListener('click', function () { if (g.vizinhos.proxima) location.hash = base + g.vizinhos.proxima; });

    // Passar o mouse numa linha realça o ponto da peça.
    Array.prototype.forEach.call(fdView.querySelectorAll('.part-row'), function (row) {
      var n = row.getAttribute('data-num');
      row.addEventListener('mouseenter', function () {
        Array.prototype.forEach.call(canvas.querySelectorAll('.hotspot'), function (h) { if (h.getAttribute('data-num') === n) h.classList.add('hover'); });
      });
      row.addEventListener('mouseleave', function () {
        Array.prototype.forEach.call(canvas.querySelectorAll('.hotspot.hover'), function (h) { h.classList.remove('hover'); });
      });
    });
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    telaSeq++;
    var p = (location.hash || '').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    var marca = marcaValida(p[0]) ? p[0] : estado.marca;
    trocarMarca(marca).then(function () {
      var lado = p[2] === 'engine' ? 'engine' : 'chassi';
      if (/^\d+$/.test(p[1] || '') && /^\d+$/.test(p[3] || '')) renderGrupo(p[1], lado, p[3]);
      else if (/^\d+$/.test(p[1] || '')) renderModelo(p[1], lado);
      else { fdView.innerHTML = ''; abrirBusca(); }
    });
    window.scrollTo(0, 0);
  }

  document.getElementById('fd-voltar').addEventListener('click', function () {
    if ((location.hash || '').split('/').length > 2 && history.length > 1) history.back();
    else location.href = '/admin';
  });

  pintarMarcas();
  window.addEventListener('hashchange', route);
  route();

  }); // fim FG.pronto.then
})();
