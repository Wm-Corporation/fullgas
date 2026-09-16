/* =========================================================
   FULLGAS B2B — Dealer Shop (loja.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  // Conta interna (sub-dealer) sem a área "loja" volta ao portal.
  if (!FG.temArea(sess, 'loja')) {
    alert('Sua conta não tem acesso à Loja. Fale com o gestor da concessionária.');
    location.href = '/portal'; return;
  }

  // Espera o cache (carregado de forma assíncrona via fetch) antes de montar a
  // tela — nada de renderizar com dados vazios.
  FG.pronto.then(function () {

  var view = document.getElementById('view');
  var esc = FG.esc;

  document.getElementById('sh-user').innerHTML = FG.esc(sess.nome) + '  -  ' + FG.empresaDaSessao(sess) + '  ›';

  /* ---------- ícones de categoria (line-art próprio) ---------- */
  var ICONS = {
    escape: '<path d="M8 38 L40 22 q14 -6 22 0 l6 5" /><ellipse cx="14" cy="36" rx="9" ry="7"/><path class="acc" d="M30 20 l4 -7 M40 17 l4 -7"/>',
    oculos: '<rect x="8" y="22" width="34" height="18" rx="8"/><path d="M42 26 H66 M42 36 H66"/><path class="acc" d="M50 24 l-5 16 M57 24 l-5 16"/>',
    bike: '<circle cx="18" cy="44" r="10"/><circle cx="58" cy="44" r="10"/><path class="acc" d="M18 44 L32 24 H48 L58 44 M40 24 V18 H50"/>',
    kit: '<circle cx="44" cy="34" r="13"/><circle cx="44" cy="34" r="5"/><path d="M44 21 v-4 M44 51 v-4 M31 34 h-4 M61 34 h-4"/><path class="acc" d="M10 22 l12 6 M10 30 l12 -2"/>',
    loja: '<rect x="14" y="24" width="44" height="26"/><path d="M14 24 L20 12 H52 L58 24"/><path class="acc" d="M28 50 V36 H44 V50"/>',
    sacola: '<path class="acc" d="M20 24 H52 L56 54 H16 Z"/><path d="M27 24 v-5 a9 9 0 0 1 18 0 v5"/>',
    ferramenta: '<path d="M16 50 L36 30"/><circle cx="44" cy="22" r="10"/><path class="acc" d="M40 18 l8 8 M52 30 l8 8"/>',
    engrenagem: '<circle cx="36" cy="34" r="12"/><circle class="acc" cx="36" cy="34" r="4"/><path d="M36 18 v-6 M36 56 v-6 M20 34 h-6 M58 34 h-6 M25 23 l-4 -4 M51 49 l-4 -4 M47 23 l4 -4 M25 45 l-4 4"/>'
  };
  function catIcon(key, w) {
    return '<svg class="cat-ico" viewBox="0 0 72 64" width="' + (w || 110) + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      (ICONS[key] || ICONS.engrenagem) + '</svg>';
  }

  /* ---------- cabeçalho ---------- */
  function refreshCart() {
    var n = FG.cartCount();
    var head = document.getElementById('cart-n');
    if (head) head.textContent = n;
    var fabN = document.getElementById('cart-fab-n');
    if (fabN) fabN.textContent = n;
    var fab = document.getElementById('cart-fab');
    if (fab) fab.classList.toggle('empty', !n);
  }

  // Conta produtos de uma categoria incluindo os das suas subcategorias.
  function contaCategoria(catId) {
    var ids = FG.categoriaEDescendentes(catId);
    return FG.all('products').filter(function (p) { return ids.indexOf(p.cat) >= 0; }).length;
  }

  var mega = document.getElementById('shop-mega');
  mega.innerHTML = FG.categoriasTopo().map(function (c) {
    return '<a href="#/categoria/' + esc(c.id) + '">' + esc(c.nome) + ' <span>' + contaCategoria(c.id) + ' ›</span></a>';
  }).join('');

  var menuBtn = document.getElementById('menu-btn');
  menuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    mega.classList.toggle('open');
    document.getElementById('menu-x').textContent = mega.classList.contains('open') ? '✕' : '☰';
  });
  document.addEventListener('click', function () {
    mega.classList.remove('open');
    document.getElementById('menu-x').textContent = '☰';
  });

  document.getElementById('sh-search').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('sh-q').value.trim();
    if (q) location.hash = '#/busca/' + encodeURIComponent(q);
  });

  function setBand(titulo, trilha) {
    document.getElementById('page-title').textContent = titulo.toUpperCase();
    // Botão VOLTAR sempre visível no início da trilha: na home leva ao
    // portal; nas demais telas volta um passo na navegação.
    var home = !(trilha || []).length;
    var bc = home
      ? '<a class="btn-voltar" href="/portal">Portal</a>'
      : '<button class="btn-voltar" id="bt-voltar" type="button">Voltar</button>';
    bc += '<a href="#/">LOJA</a>';
    (trilha || []).forEach(function (t) {
      bc += ' › ' + (t.href ? '<a href="' + t.href + '">' + esc(t.nome).toUpperCase() + '</a>' : '<span>' + esc(t.nome).toUpperCase() + '</span>');
    });
    document.getElementById('page-bc').innerHTML = bc;
    var bv = document.getElementById('bt-voltar');
    if (bv) bv.addEventListener('click', function () {
      if (history.length > 1) history.back(); else location.hash = '#/';
    });
  }

  function stockHTML(p) {
    if (p.estoque > 0) return '<span class="stock-ok">Em estoque</span>';
    if (p.previsao) return '<span class="stock-date">' + esc(p.previsao) + '</span>';
    return '<span class="stock-out">Indisponível</span>';
  }

  // Foto real do produto quando houver (upload do admin ou espelhada do Tiny
  // ERP); sem foto, cai no desenho esquemático da categoria.
  function prodImg(p, w) {
    if (p.imagem) return '<img src="' + esc(p.imagem) + '" alt="' + esc(p.nome) + '" loading="lazy">';
    var key = { tecnicos: 'escape', vestuario: 'oculos', balance: 'bike', kits: 'kit', retail: 'loja', marketing: 'sacola', ferramentas: 'ferramenta' }[p.cat];
    if (p.cat === 'pecas') return FG.bikeSVG('frame', w || 120, { cls: 'lite' });
    return catIcon(key || 'engrenagem', w || 95);
  }

  /* clique na foto do produto abre em tamanho grande (lightbox) — listener
     delegado no container, porque as telas são re-renderizadas a cada rota */
  view.addEventListener('click', function (e) {
    var img = e.target.closest('.prod-img img, .prod-page .big-img img, .cart-img img');
    if (!img) return;
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal modal-img"><header><h3>' + esc(img.alt || 'Foto do produto') + '</h3>' +
      '<button class="x">×</button></header><div class="modal-body">' +
      '<img src="' + esc(img.src) + '" alt="' + esc(img.alt || '') + '"></div></div>';
    document.body.appendChild(back);
    back.querySelector('.x').addEventListener('click', function () { back.remove(); });
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).
  });

  /* =========================================================
     ROTA: grade de categorias
     ========================================================= */
  function renderCats() {
    setBand('Categorias', []);
    view.innerHTML = '<div class="cat-grid">' + FG.categoriasTopo().map(function (c) {
      var subs = FG.subcategorias(c.id);
      var midia = c.imagem
        ? '<img class="cat-photo" src="' + esc(c.imagem) + '" alt="' + esc(c.nome) + '">'
        : catIcon(c.icone);
      return '<button class="cat-tile" data-cat="' + esc(c.id) + '">' + midia +
        '<div class="cat-name">' + esc(c.nome) + '</div>' +
        (subs.length ? '<div class="cat-sub muted">' + subs.length + ' subcategoria' + (subs.length > 1 ? 's' : '') + '</div>' : '') +
        '</button>';
    }).join('') + '</div>';
    Array.prototype.forEach.call(view.querySelectorAll('.cat-tile'), function (b) {
      b.addEventListener('click', function () { location.hash = '#/categoria/' + b.getAttribute('data-cat'); });
    });
  }

  /* =========================================================
     ROTA: categoria (lista com sidebar)
     ========================================================= */
  var soDisponiveis = false;
  var motoFiltro = '';
  var pagina = 1;
  var POR_PAGINA = 12;

  function renderCategoria(catId, termoBusca) {
    var cat = FG.category(catId);
    var titulo = termoBusca != null ? 'Resultado da busca' : (cat ? cat.nome : 'Categoria');
    // Trilha: subcategoria mostra "Pai › Subcategoria"; topo mostra só o nome.
    var trilha;
    if (termoBusca != null) trilha = [{ nome: 'Busca' }];
    else if (cat && cat.pai) {
      var paiCat = FG.category(cat.pai);
      trilha = [{ nome: paiCat ? paiCat.nome : cat.pai, href: '#/categoria/' + esc(cat.pai) }, { nome: cat.nome }];
    } else trilha = cat ? [{ nome: cat.nome }] : [{ nome: 'Categoria' }];
    setBand(titulo, trilha);

    // Numa categoria de topo, inclui os produtos das suas subcategorias.
    var catIds = (termoBusca != null || !cat) ? null : FG.categoriaEDescendentes(catId);
    var artigosModelo = motoFiltro ? FG.modelArticles(motoFiltro) : null;
    var todos = FG.all('products').filter(function (p) {
      if (termoBusca != null) {
        var t = termoBusca.toLowerCase();
        if (p.artigo.toLowerCase().indexOf(t) < 0 && p.nome.toLowerCase().indexOf(t) < 0) return false;
      } else if (catIds && catIds.indexOf(p.cat) < 0) return false;
      if (soDisponiveis && p.estoque <= 0) return false;
      if (artigosModelo && artigosModelo.indexOf(p.artigo) < 0) return false;
      return true;
    });
    if (termoBusca != null) FG.logSearch(termoBusca, todos.length);

    var totalPag = Math.max(1, Math.ceil(todos.length / POR_PAGINA));
    if (pagina > totalPag) pagina = totalPag;
    var lista = todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

    // Sidebar em árvore: categorias de topo sempre; subcategorias aparecem
    // expandidas sob a categoria ativa (a atual ou a mãe da subcategoria atual).
    function contaCat(id) {
      var ids = FG.categoriaEDescendentes(id);
      return FG.all('products').filter(function (p) { return ids.indexOf(p.cat) >= 0; }).length;
    }
    var side = '<aside class="shop-side"><h4>CATEGORIAS</h4>' +
      FG.categoriasTopo().map(function (c) {
        var ativa = c.id === catId || (cat && cat.pai === c.id);
        var html = '<button class="cat-link' + (c.id === catId ? ' on' : '') + '" data-cat="' + esc(c.id) + '">' +
          esc(c.nome) + ' <span>(' + contaCat(c.id) + ')</span></button>';
        var subs = FG.subcategorias(c.id);
        if (subs.length && ativa) {
          html += subs.map(function (s) {
            var ns = FG.all('products').filter(function (p) { return p.cat === s.id; }).length;
            return '<button class="cat-link sub' + (s.id === catId ? ' on' : '') + '" data-cat="' + esc(s.id) + '">↳ ' +
              esc(s.nome) + ' <span>(' + ns + ')</span></button>';
          }).join('');
        }
        return html;
      }).join('') + '</aside>';

    // Chips de subcategoria acima da lista (drill-in rápido).
    var subChips = '';
    if (termoBusca == null && cat && !cat.pai) {
      var subsTopo = FG.subcategorias(catId);
      if (subsTopo.length) {
        subChips = '<div class="subcat-chips"><a class="chip on" href="#/categoria/' + catId + '">Todos</a>' +
          subsTopo.map(function (s) { return '<a class="chip" href="#/categoria/' + s.id + '">' + esc(s.nome) + '</a>'; }).join('') +
          '</div>';
      }
    } else if (termoBusca == null && cat && cat.pai) {
      var paiChip = FG.category(cat.pai);
      subChips = '<div class="subcat-chips"><a class="chip" href="#/categoria/' + cat.pai + '">↩ ' + esc(paiChip ? paiChip.nome : 'Todos') + '</a>' +
        FG.subcategorias(cat.pai).map(function (s) {
          return '<a class="chip' + (s.id === catId ? ' on' : '') + '" href="#/categoria/' + s.id + '">' + esc(s.nome) + '</a>';
        }).join('') + '</div>';
    }

    var tools =
      '<div class="shop-tools">' +
      '<span class="avail' + (soDisponiveis ? ' on' : '') + '" id="tg-avail" role="switch" aria-checked="' + soDisponiveis + '" tabindex="0">' +
      'MOSTRAR SOMENTE PRODUTOS DISPONÍVEIS <span class="switch"></span></span>' +
      '<select id="sel-moto"><option value="">BUSCAR POR MOTO — EX.: FG 300 2026</option>' +
      FG.all('models').map(function (m) {
        return '<option value="' + m.id + '"' + (m.id === motoFiltro ? ' selected' : '') + '>' + esc(m.nome + ' ' + m.ano) + '</option>';
      }).join('') + '</select>' +
      '<span class="pager" id="pager"></span></div>';

    var rows = lista.map(function (p) {
      return '<div class="prod-row">' +
        '<div class="prod-img">' + prodImg(p) + '</div>' +
        '<div><div class="prod-name"><a href="#/produto/' + esc(p.artigo) + '">' + esc(p.nome) + '</a></div>' +
        '<div class="prod-desc">' + esc(p.descricao) + '</div>' +
        '<div class="prod-meta">' +
        '<div class="m"><b>Article No.</b>' + esc(p.artigo) + '</div>' +
        '<div class="m"><b>Stock</b>' + stockHTML(p) + '</div>' +
        '<div class="m"><b>Preço</b>' + FG.fmtMoney(p.preco) + '</div>' +
        (FG.compravel(p.artigo)
          ? '<div class="prod-buy"><input class="qty-in" type="number" min="1" value="1"' + (p.estoque > 0 ? ' max="' + p.estoque + '"' : '') + ' data-art="' + esc(p.artigo) + '">' +
            '<button class="btn dark add-cart" data-art="' + esc(p.artigo) + '">🛒 Adicionar</button></div>'
          : '<div class="prod-buy"><button class="btn dark" disabled style="opacity:.55;cursor:not-allowed;">Indisponível</button></div>') +
        '</div></div></div>';
    }).join('');
    if (!lista.length) rows = '<div class="empty-box">Nenhum artigo encontrado com os filtros atuais.</div>';

    view.innerHTML = '<div class="shop-layout">' + side + '<section>' + subChips + tools + rows + '</section></div>';

    /* sidebar */
    Array.prototype.forEach.call(view.querySelectorAll('.cat-link'), function (b) {
      b.addEventListener('click', function () { pagina = 1; location.hash = '#/categoria/' + b.getAttribute('data-cat'); });
    });

    /* toggle disponíveis */
    var tg = document.getElementById('tg-avail');
    function toggleAvail() { soDisponiveis = !soDisponiveis; pagina = 1; renderCategoria(catId, termoBusca); }
    tg.addEventListener('click', toggleAvail);
    tg.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAvail(); } });

    /* filtro por moto */
    document.getElementById('sel-moto').addEventListener('change', function (e) {
      motoFiltro = e.target.value; pagina = 1; renderCategoria(catId, termoBusca);
    });

    /* paginação */
    var pager = document.getElementById('pager');
    if (totalPag > 1) {
      var ph = '<button id="pg-prev" aria-label="Anterior">‹</button>';
      for (var i = 1; i <= totalPag; i++) ph += '<button class="' + (i === pagina ? 'on' : '') + '" data-pg="' + i + '">' + i + '</button>';
      ph += '<button id="pg-next" aria-label="Próxima">›</button>';
      pager.innerHTML = ph;
      Array.prototype.forEach.call(pager.querySelectorAll('[data-pg]'), function (b) {
        b.addEventListener('click', function () { pagina = Number(b.getAttribute('data-pg')); renderCategoria(catId, termoBusca); });
      });
      document.getElementById('pg-prev').addEventListener('click', function () { if (pagina > 1) { pagina--; renderCategoria(catId, termoBusca); } });
      document.getElementById('pg-next').addEventListener('click', function () { if (pagina < totalPag) { pagina++; renderCategoria(catId, termoBusca); } });
    }

    bindAddCart();
  }

  function bindAddCart() {
    Array.prototype.forEach.call(view.querySelectorAll('.add-cart'), function (b) {
      b.addEventListener('click', function () {
        var art = b.getAttribute('data-art');
        var inp = view.querySelector('.qty-in[data-art="' + art + '"]');
        var qtd = Math.max(1, Number(inp && inp.value) || 1);
        var lim = FG.limiteCompra(art);
        var jaNoCarro = (FG.cart().find(function (i) { return i.artigo === art; }) || {}).qtd || 0;
        var ajustou = (jaNoCarro + qtd) > lim;
        if (!FG.cartAdd(art, qtd)) {
          if (!FG.compravel(art)) FG.toast('Produto indisponível para compra.', 'erro');
          return;
        }
        if (ajustou) FG.toast('Estoque disponível: ' + lim + ' un. Quantidade ajustada.', 'erro');
        else FG.toast(qtd + '× adicionado à cesta.');
        refreshCart();
      });
    });
  }

  /* =========================================================
     ROTA: produto
     ========================================================= */
  function renderProduto(artigo) {
    var p = FG.product(artigo);
    if (!p) { view.innerHTML = '<div class="empty-box">Artigo não encontrado.</div>'; setBand('Artigo', []); return; }
    var cat = FG.category(p.cat);
    setBand(p.nome, [{ nome: cat ? cat.nome : '', href: '#/categoria/' + esc(p.cat) }, { nome: p.artigo }]);

    /* modelos que usam o artigo (link para o finder) */
    var usados = FG.all('models').filter(function (m) { return FG.modelArticles(m.id).indexOf(p.artigo) >= 0; });

    view.innerHTML =
      '<div class="prod-page">' +
      '<div class="big-img">' + prodImg(p, 240) + '</div>' +
      '<div><div class="prod-name">' + esc(p.nome) + '</div>' +
      '<p class="muted">Article No. ' + esc(p.artigo) + '</p>' +
      '<div class="prod-desc prod-desc-full">' + esc(p.descricao) + '</div>' +
      '<div class="price-big">' + FG.fmtMoney(p.preco) + '</div>' +
      '<p><b>Stock:</b> ' + stockHTML(p) + (p.estoque > 0 ? ' <span class="muted">(' + p.estoque + ' un.)</span>' : '') + '</p>' +
      (FG.compravel(p.artigo)
        ? '<div class="prod-buy" style="margin:0 0 18px;justify-content:flex-start;">' +
          '<input class="qty-in" type="number" min="1" value="1"' + (p.estoque > 0 ? ' max="' + p.estoque + '"' : '') + ' data-art="' + esc(p.artigo) + '">' +
          '<button class="btn dark add-cart" data-art="' + esc(p.artigo) + '">🛒 Adicionar ao carrinho</button></div>'
        : '<div class="prod-buy" style="margin:0 0 18px;justify-content:flex-start;">' +
          '<button class="btn dark" disabled style="opacity:.55;cursor:not-allowed;">Indisponível</button>' +
          '<span class="muted" style="font-size:12px;">Produto sem estoque e sem previsão de chegada.</span></div>') +
      (usados.length ? '<p class="muted" style="font-size:12px;">Aplicação (Parts Finder): ' +
        usados.map(function (m) { return '<a href="/finder#/modelo/' + esc(m.id) + '/chassi">' + esc(m.nome + ' ' + m.ano) + '</a>'; }).join(' · ') + '</p>' : '') +
      '</div></div>';
    bindAddCart();
  }

  /* =========================================================
     ROTA: quick order
     ========================================================= */
  function renderQuickOrder() {
    setBand('Quick Order', [{ nome: 'Quick Order' }]);
    var LINHAS = 5;
    var html = '<div class="qo-head"><span class="muted">Digite o número do artigo e a quantidade.</span>' +
      '<span><button class="link-action" id="qo-reset">RESET FORM</button> ' +
      '<button class="btn dark" id="qo-add">ADICIONAR AO CARRINHO</button></span></div>' +
      '<div class="qo-row" style="border-bottom:2px solid #ccc;font-weight:600;font-size:12px;">' +
      '<span>Article No.</span><span>Stock</span><span>Quantity</span><span></span></div>';
    for (var i = 0; i < LINHAS; i++) {
      html += '<div class="qo-row">' +
        '<input class="art" data-i="' + i + '" type="text" placeholder="Enter Article No.">' +
        '<span class="qo-stock" data-i="' + i + '"></span>' +
        '<input class="qty-in qo-qty" data-i="' + i + '" type="number" min="1" value="1">' +
        '<button class="del" data-i="' + i + '" title="Limpar linha">✕</button></div>';
    }
    view.innerHTML = html;

    function checa(i) {
      var inp = view.querySelector('.art[data-i="' + i + '"]');
      var st = view.querySelector('.qo-stock[data-i="' + i + '"]');
      var p = FG.product(inp.value.trim().toUpperCase()) || FG.product(inp.value.trim());
      if (!inp.value.trim()) { st.innerHTML = ''; return; }
      st.innerHTML = p ? (esc(p.nome) + ' — ' + stockHTML(p)) : '<span class="stock-out">Artigo não encontrado</span>';
    }
    Array.prototype.forEach.call(view.querySelectorAll('.art'), function (inp) {
      inp.addEventListener('input', function () { checa(inp.getAttribute('data-i')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.del'), function (b) {
      b.addEventListener('click', function () {
        var i = b.getAttribute('data-i');
        view.querySelector('.art[data-i="' + i + '"]').value = '';
        view.querySelector('.qo-qty[data-i="' + i + '"]').value = 1;
        checa(i);
      });
    });
    document.getElementById('qo-reset').addEventListener('click', renderQuickOrder);
    document.getElementById('qo-add').addEventListener('click', function () {
      var add = 0, ajustados = 0, indisp = 0;
      for (var i = 0; i < LINHAS; i++) {
        var art = view.querySelector('.art[data-i="' + i + '"]').value.trim();
        if (!art) continue;
        var p = FG.product(art.toUpperCase()) || FG.product(art);
        if (!p) continue;
        if (!FG.compravel(p.artigo)) { indisp++; continue; }   // indisponível: ignora
        var qtd = Math.max(1, Number(view.querySelector('.qo-qty[data-i="' + i + '"]').value) || 1);
        var ja = (FG.cart().find(function (c) { return c.artigo === p.artigo; }) || {}).qtd || 0;
        if (ja + qtd > FG.limiteCompra(p.artigo)) ajustados++;
        FG.cartAdd(p.artigo, qtd); add += qtd;
      }
      if (add) {
        FG.toast(add + ' item(ns) adicionados à cesta.' +
          (ajustados ? ' ' + ajustados + ' ajustado(s) ao estoque disponível.' : '') +
          (indisp ? ' ' + indisp + ' indisponível(is) ignorado(s).' : ''),
          (ajustados || indisp) ? 'erro' : undefined);
        refreshCart(); location.hash = '#/carrinho';
      } else if (indisp) {
        FG.toast(indisp + ' produto(s) indisponível(is) — nada adicionado.', 'erro');
      } else FG.toast('Nenhum artigo válido informado.');
    });
  }

  /* =========================================================
     ROTA: carrinho
     ========================================================= */
  function renderCarrinho() {
    setBand('Cesta', [{ nome: 'Cesta' }]);
    var cart = FG.cart();
    if (!cart.length) {
      view.innerHTML = '<div class="empty-box">Sua cesta está vazia.<br><a class="btn red" href="#/">Ir às compras</a></div>';
      return;
    }
    var html = '<div class="cart-line" style="border-bottom:2px solid #ccc;font-weight:600;font-size:12px;">' +
      '<span>Imagem</span><span>Artigo</span><span>Preço un.</span><span>Qtd.</span><span class="right">Subtotal</span><span></span></div>';
    cart.forEach(function (i) {
      var p = FG.product(i.artigo); if (!p) return;
      html += '<div class="cart-line">' +
        '<span class="cart-img">' + prodImg(p, 70) + '</span>' +
        '<span><b><a href="#/produto/' + esc(p.artigo) + '">' + esc(p.nome) + '</a></b><br><span class="muted">' + esc(p.artigo) + '</span>' +
        '<br>' + stockHTML(p) + '</span>' +
        '<span>' + FG.fmtMoney(p.preco) + '</span>' +
        '<span><input class="qty-in ct-qty" data-art="' + esc(p.artigo) + '" type="number" min="0"' + (p.estoque > 0 ? ' max="' + p.estoque + '"' : '') + ' value="' + i.qtd + '"></span>' +
        '<span class="right"><b>' + FG.fmtMoney(p.preco * i.qtd) + '</b></span>' +
        '<button class="del link-action ct-del" data-art="' + esc(p.artigo) + '" title="Remover">✕</button></div>';
    });
    // Itens indisponíveis (sem estoque e sem previsão) não podem ser comprados;
    // bloqueiam o envio. Itens em pré-venda (sem estoque, com previsão) entram
    // em backorder ao confirmar.
    var indispItens = cart.filter(function (i) { return !FG.compravel(i.artigo); });
    var preVenda = cart.filter(function (i) { var p = FG.product(i.artigo); return p && p.estoque < i.qtd && FG.compravel(i.artigo); });
    var avisoHTML = '';
    if (indispItens.length) {
      avisoHTML += '<div class="backorder-aviso" style="background:#fef2f2;border-color:#fecaca;">' +
        '<b>⛔ Indisponível:</b> remova para enviar o pedido — ' +
        indispItens.length + ' item(ns) sem estoque e sem previsão de chegada.<ul>' +
        indispItens.map(function (i) {
          var p = FG.product(i.artigo);
          return '<li>' + esc(p.nome) + ' <span class="muted">(' + esc(p.artigo) + ')</span></li>';
        }).join('') + '</ul></div>';
    }
    if (preVenda.length) {
      avisoHTML += '<div class="backorder-aviso"><b>⚠ Aviso:</b> ' + preVenda.length +
        ' item(ns) será(ão) enviado(s) em <b>pré-venda</b>. Prazo de envio depende de reposição.<ul>' +
        preVenda.map(function (i) {
          var p = FG.product(i.artigo);
          return '<li>' + esc(p.nome) + ' <span class="muted">(' + esc(p.artigo) + ')</span> — ' + i.qtd + ' un.' +
            (p.previsao ? ' · previsão: ' + esc(p.previsao) : '') + '</li>';
        }).join('') + '</ul></div>';
    }

    html += '<div class="cart-tot"><span>Total da cesta</span><span class="v">' + FG.fmtMoney(FG.cartTotal()) + '</span></div>' +
      avisoHTML +
      '<div style="display:flex;justify-content:flex-end;gap:10px;">' +
      '<button class="btn" id="ct-limpar">Limpar cesta</button>' +
      '<button class="btn red" id="ct-enviar"' + (indispItens.length ? ' disabled style="opacity:.55;cursor:not-allowed;"' : '') + '>Enviar pedido</button></div>';
    view.innerHTML = html;

    Array.prototype.forEach.call(view.querySelectorAll('.ct-qty'), function (inp) {
      inp.addEventListener('change', function () {
        var art = inp.getAttribute('data-art');
        var pedido = Math.max(0, Number(inp.value) || 0);
        var lim = FG.limiteCompra(art);
        FG.cartSet(art, pedido);
        if (pedido > lim) FG.toast('Estoque disponível: ' + lim + ' un. Quantidade ajustada.', 'erro');
        refreshCart(); renderCarrinho();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.ct-del'), function (b) {
      b.addEventListener('click', function () { FG.cartRemove(b.getAttribute('data-art')); refreshCart(); renderCarrinho(); });
    });
    document.getElementById('ct-limpar').addEventListener('click', function () { FG.cartClear(); refreshCart(); renderCarrinho(); });
    document.getElementById('ct-enviar').addEventListener('click', async function () {
      var o = await FG.createOrder();
      refreshCart();
      if (!o) return;
      var backHTML = (o.itensEmBackorder && o.itensEmBackorder.length) ?
        '<div class="backorder-aviso" style="max-width:540px;margin:14px auto;text-align:left;">' +
        '<b>⚠ Itens em pré-venda:</b> serão enviados quando o estoque for reposto.<ul>' +
        o.itensEmBackorder.map(function (b) {
          return '<li>' + esc(b.nome) + ' <span class="muted">(' + b.sku + ')</span> — ' + b.quantidade + ' un.</li>';
        }).join('') + '</ul></div>' : '';
      view.innerHTML = '<div class="empty-box"><h2 style="color:var(--green);">✔ Pedido enviado!</h2>' +
        '<p>Número do pedido: <b>' + o.id + '</b></p>' +
        backHTML +
        '<p class="muted">Acompanhe o andamento no histórico de pedidos.</p>' +
        '<a class="btn red" href="#/pedidos">Ver histórico</a> <a class="btn" href="#/">Continuar comprando</a></div>';
    });
  }

  /* =========================================================
     ROTA: histórico de pedidos (entregas saíram do fluxo —
     não há módulo de entrega no projeto)
     ========================================================= */
  var verEmpresa = false;

  function renderHistorico() {
    setBand('Order History', [{ nome: 'Histórico' }]);
    view.innerHTML = '<div id="hist-body"></div>';
    var body = document.getElementById('hist-body');

    var orders = FG.all('orders').filter(function (o) {
      return verEmpresa ? o.empresa === sess.empresa : o.usuario === sess.email;
    });
    if (sess.papel === 'admin' && !orders.length && !verEmpresa) orders = FG.all('orders');
    if (!orders.length) {
      body.innerHTML = '<div class="empty-box">No Orders Found<br>' +
        '<button class="btn red" id="ho-all">Show all orders of company</button></div>';
      document.getElementById('ho-all').addEventListener('click', function () { verEmpresa = true; renderHistorico(); });
      return;
    }
    body.innerHTML =
      '<p class="right muted" style="font-size:11px;">SHOW ALL ORDERS OF COMPANY ' +
      '<input type="checkbox" id="ho-chk"' + (verEmpresa ? ' checked' : '') + '></p>' +
      orders.map(function (o) {
        // O número linka direto para o detalhe do pedido na aba Pedidos do portal.
        return '<div class="order-card"><div class="oc-head">' +
          '<span><b><a href="/portal#pedido/' + esc(o.id) + '" title="Ver detalhes do pedido">' + esc(o.id) + '</a></b>' +
          (o.garantia ? ' <span class="pill-status Garantia">Garantia</span>' : '') + '</span>' +
          '<span>' + FG.fmtDateTime(o.data) + '</span>' +
          '<span><span class="pill-status ' + esc(o.status) + '">' + esc(o.status) + '</span></span>' +
          '<span style="margin-left:auto;"><b>' + FG.fmtMoney(o.total) + '</b></span></div>' +
          '<div class="oc-items">' + o.itens.map(function (it) {
            return '<div>' + it.qtd + '× <a href="#/produto/' + esc(it.artigo) + '">' + esc(it.nome) + '</a> ' +
              '<span class="muted">(' + esc(it.artigo) + ')</span> — ' + FG.fmtMoney(it.preco * it.qtd) + '</div>';
          }).join('') + '</div></div>';
      }).join('');
    document.getElementById('ho-chk').addEventListener('change', function (e) { verEmpresa = e.target.checked; renderHistorico(); });
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    var h = (location.hash || '#/').slice(1);
    if (h[0] === '/') h = h.slice(1);
    var partes = h.split('/');
    switch (partes[0] || '') {
      case '': renderCats(); break;
      case 'categoria': pagina = 1; renderCategoria(partes[1]); break;
      case 'produto': renderProduto(decodeURIComponent(partes[1] || '')); break;
      case 'quick-order': renderQuickOrder(); break;
      case 'carrinho': renderCarrinho(); break;
      case 'pedidos': renderHistorico(); break;
      case 'busca': pagina = 1; renderCategoria(null, decodeURIComponent(partes.slice(1).join('/'))); break;
      default: renderCats();
    }
    refreshCart();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();

  }); // fim FG.pronto.then — tela montada só após o cache chegar
})();
