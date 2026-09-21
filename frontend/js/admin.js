/* =========================================================
   FULLGAS B2B — Painel administrativo (admin.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard('admin');
  if (!sess) return;

  // Espera o cache (carregado de forma assíncrona via fetch) antes de montar a
  // tela — nada de renderizar com dados vazios.
  FG.pronto.then(function () {

  var view = document.getElementById('adm-view');
  var h1 = document.getElementById('adm-h1');
  var esc = FG.esc;

  // Todo administrador é da Fábrica — o selo fica ao lado do nome.
  document.getElementById('adm-user').innerHTML = esc(sess.nome) + ' ' + FG.seloFabrica();
  document.getElementById('adm-sair').addEventListener('click', function () { FG.logout(); });

  // Ampliar qualquer miniatura (.fnd-thumb) em lightbox — vale para as fotos
  // nos pop-ups (editar produto/peça) e na tabela do catálogo. Listener único e
  // delegado no body: cobre telas re-renderizadas e modais criados na hora.
  document.body.addEventListener('click', function (e) {
    var img = e.target.closest('img.fnd-thumb');
    if (!img || !img.getAttribute('src')) return;
    // A miniatura aponta a foto inteira em data-grande (ver fotoProduto).
    var grande = img.getAttribute('data-grande') || img.src;
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal modal-img"><header><h3>' + esc(img.alt || 'Foto da peça') + '</h3>' +
      '<button class="x">×</button></header><div class="modal-body">' +
      '<img src="' + esc(grande) + '" alt="' + esc(img.alt || '') + '"></div></div>';
    document.body.appendChild(back);
    back.querySelector('.x').addEventListener('click', function () { back.remove(); });
    // Clicar fora NÃO fecha — pop-ups só fecham no X (padrão do painel).
  });
  // O sino conta cadastros esperando aprovação — que são sempre de clientes
  // (administrador criado pelo painel já nasce liberado), então leva à aba deles.
  document.getElementById('adm-bell').addEventListener('click', function () { location.hash = '#clientes'; });

  function refreshBell() {
    var n = FG.all('users').filter(function (u) { return u.status === 'pendente'; }).length;
    var dot = document.getElementById('adm-dot');
    dot.textContent = n;
    dot.classList.toggle('hidden', !n);
  }

  function setOn(rota) {
    Array.prototype.forEach.call(document.querySelectorAll('.adm-side a[data-rota]'), function (a) {
      a.classList.toggle('on', a.getAttribute('data-rota') === rota);
    });
  }

  /* Telas que buscam dados na hora (Parts Finder, Suporte, Tiny) desenham
     quando a resposta chega. Se o admin já trocou de seção nesse meio-tempo,
     a resposta atrasada NÃO pode desenhar por cima: a fila de suporte, por
     exemplo, tomava a tela de Clientes e ainda acendia "Suporte" na barra,
     com o endereço em #clientes — clicar em Clientes de novo não fazia nada
     e a página parecia travada até recarregar. Cada troca de tela ganha um
     número; quem busca guarda o seu e confere na volta. */
  var telaSeq = 0;
  function telaVigente() {
    var minha = telaSeq;
    return function () { return minha === telaSeq; };
  }

  // Além da classe com o texto cru (compatível com os estilos antigos), adiciona
  // uma classe slug ASCII (ps-<slug>) para status com espaço/acento — ex.:
  // "Em separação" → "ps-Em-separacao" — que o CSS consegue mirar.
  function pill(v) {
    var slug = String(v).normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-');
    return '<span class="pill-status ' + esc(v) + ' ps-' + esc(slug) + '">' + esc(v) + '</span>';
  }

  /* =========================================================
     FILTROS DAS ABAS
     ---------------------------------------------------------
     O estado mora aqui fora dos render() para sobreviver aos re-renders
     (salvar uma peça, aprovar um usuário, atribuir um chassi...). A chave
     `busca` é sempre o campo de texto livre da aba.
     ========================================================= */
  var filtros = {
    pedidos:  { status: '', busca: '' },
    prevenda: { status: '', busca: '' },
    produtos: { cat: '', estoque: '', busca: '' },
    chassis:  { status: '', modelo: '', atrib: '', busca: '' },
    // Duas populações, dois filtros: quem compra (clientes das concessionárias)
    // e quem opera o sistema (administradores da Fullgas).
    clientes: { status: '', tipo: '', busca: '' },
    admins:   { status: '', busca: '' },
    suporte:  { status: '', categoria: '', busca: '' }
  };

  function filtroAtivo(aba) {
    var st = filtros[aba];
    return Object.keys(st).some(function (k) { return st[k]; });
  }

  // Texto livre casa com qualquer um dos campos passados (sem acento, sem caixa).
  function casaBusca(aba, campos) {
    var termo = filtros[aba].busca.trim().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (!termo) return true;
    return campos.some(function (c) {
      return String(c == null ? '' : c).toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '').indexOf(termo) >= 0;
    });
  }

  // Barra de filtros. `selects` = [{ k, rotulo, opcoes: [[valor, texto], ...],
  // todos? }]. `placeholder` vazio esconde o campo de busca.
  function barraFiltro(aba, selects, placeholder) {
    var st = filtros[aba];
    return '<div class="shop-tools adm-filtros">' +
      selects.map(function (s) {
        return '<label>' + esc(s.rotulo) + ': <select data-f="' + aba + '|' + s.k + '">' +
          '<option value="">' + esc(s.todos || 'Todos') + '</option>' +
          s.opcoes.map(function (o) {
            return '<option value="' + esc(o[0]) + '"' + (st[s.k] === String(o[0]) ? ' selected' : '') +
              '>' + esc(o[1]) + '</option>';
          }).join('') + '</select></label>';
      }).join('') +
      (placeholder
        ? '<input type="text" class="f-busca" data-f="' + aba + '|busca" placeholder="' + esc(placeholder) +
          '" value="' + esc(st.busca) + '">'
        : '') +
      (filtroAtivo(aba) ? '<button class="btn-line btn-mini" data-f-limpar="' + aba + '">Limpar filtro</button>' : '') +
      '</div>';
  }

  // Liga a barra ao render da aba. A busca espera o usuário parar de digitar e
  // devolve o foco/cursor depois — o re-render recria o campo do zero.
  var buscaTimer = null;
  function bindFiltro(render) {
    Array.prototype.forEach.call(view.querySelectorAll('[data-f]'), function (el) {
      var p = el.getAttribute('data-f').split('|');
      if (el.tagName === 'SELECT') {
        el.addEventListener('change', function () { filtros[p[0]][p[1]] = el.value; render(); });
        return;
      }
      el.addEventListener('input', function () {
        filtros[p[0]][p[1]] = el.value;
        clearTimeout(buscaTimer);
        buscaTimer = setTimeout(function () {
          render();
          var novo = view.querySelector('[data-f="' + p[0] + '|busca"]');
          if (novo) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
        }, 350);
      });
    });
    var lim = view.querySelector('[data-f-limpar]');
    if (lim) lim.addEventListener('click', function () {
      var st = filtros[lim.getAttribute('data-f-limpar')];
      Object.keys(st).forEach(function (k) { st[k] = ''; });
      render();
    });
  }

  // "3 de 28" no cabeçalho do card quando há filtro; só "28" quando não há.
  function contagem(aba, mostrados, total) {
    return mostrados + (filtroAtivo(aba) && mostrados !== total ? ' de ' + total : '');
  }

  function vazioFiltro(cols, texto) {
    return '<tr><td colspan="' + cols + '" class="muted">' +
      esc(texto || 'Nada encontrado com esse filtro.') + '</td></tr>';
  }

  /* =========================================================
     DASHBOARD
     ========================================================= */
  function renderDash() {
    h1.textContent = 'Painel de Controle'; setOn('dashboard');
    var orders = FG.all('orders');
    var totalVendas = orders.reduce(function (t, o) { return t + o.total; }, 0);
    var ticket = orders.length ? totalVendas / orders.length : 0;

    /* pedidos por dia — últimos 7 dias */
    var dias = [], qtds = [], receita7 = 0, qtd7 = 0;
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var chave = d.toISOString().slice(0, 10);
      var doDia = orders.filter(function (o) { return o.data.slice(0, 10) === chave; });
      dias.push(FG.pad(d.getDate(), 2) + '/' + FG.pad(d.getMonth() + 1, 2));
      qtds.push(doDia.length);
      doDia.forEach(function (o) { receita7 += o.total; qtd7 += o.itens.reduce(function (n, it) { return n + it.qtd; }, 0); });
    }
    var maxQ = Math.max.apply(null, qtds.concat([1]));

    /* mais vendidos */
    var agg = {};
    orders.forEach(function (o) {
      o.itens.forEach(function (it) {
        var a = agg[it.artigo] || (agg[it.artigo] = { nome: it.nome, preco: it.preco, qtd: 0 });
        a.qtd += it.qtd;
      });
    });
    var top = Object.keys(agg).map(function (k) { return { artigo: k, nome: agg[k].nome, preco: agg[k].preco, qtd: agg[k].qtd }; })
      .sort(function (a, b) { return b.qtd - a.qtd; }).slice(0, 5);

    var buscas = FG.all('searches').slice(0, 5);

    view.innerHTML =
      '<div class="adm-banner">ℹ️ É hora de <b>mudar sua senha</b>.</div>' +
      '<div class="adm-bar"><span class="grow"></span><button class="btn-orange" id="dz-reload">Recarregar</button></div>' +

      '<div class="dash-grid">' +

      /* coluna esquerda */
      '<div>' +
      '<div class="kpi"><div class="k-lbl">Período de Vendas</div><div class="k-val">' + FG.fmtMoney(totalVendas) + '</div></div>' +
      '<div class="kpi"><div class="k-lbl">Ticket Médio</div><div class="k-val">' + FG.fmtMoney(ticket) + '</div></div>' +

      '<div class="adm-card"><div class="c-head">Últimos Pedidos</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Cliente</th><th class="r">Itens</th><th class="r">Total</th></tr></thead><tbody>' +
      orders.slice(0, 5).map(function (o) {
        var n = o.itens.reduce(function (t, it) { return t + it.qtd; }, 0);
        return '<tr><td>' + esc(o.empresa) + '</td><td class="r">' + n + '</td><td class="r">' + FG.fmtMoney(o.total) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' +

      '<div class="adm-card"><div class="c-head">Últimas Buscas</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Termo de pesquisa</th><th class="r">Resultados</th></tr></thead><tbody>' +
      (buscas.length ? buscas.map(function (s) {
        return '<tr><td>' + esc(s.termo) + '</td><td class="r">' + s.resultados + '</td></tr>';
      }).join('') : '<tr><td colspan="2" class="muted">Sem buscas registradas ainda.</td></tr>') +
      '</tbody></table></div></div>' +
      '</div>' +

      /* coluna direita */
      '<div>' +
      '<div class="adm-card"><div class="c-head">Pedidos — últimos 7 dias</div><div class="c-body">' +
      '<div class="chart">' + qtds.map(function (q) {
        return '<div class="bar" data-v="' + q + ' pedido(s)" style="height:' + Math.round((q / maxQ) * 100) + '%;"></div>';
      }).join('') + '</div>' +
      '<div class="chart-x">' + dias.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
      '<div class="chart-stats">' +
      '<div class="s"><b>Receita</b><span class="v">' + FG.fmtMoney(receita7) + '</span></div>' +
      '<div class="s"><b>Taxas</b><span class="v">' + FG.fmtMoney(0) + '</span></div>' +
      '<div class="s"><b>Entrega</b><span class="v">' + FG.fmtMoney(receita7 ? 102.26 : 0) + '</span></div>' +
      '<div class="s"><b>Quantidade</b><span class="v">' + qtd7 + '</span></div>' +
      '</div></div></div>' +

      '<div class="adm-card"><div class="c-head">Mais Vendidos</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Produto</th><th class="r">Preço</th><th class="r">Quantidade</th></tr></thead><tbody>' +
      (top.length ? top.map(function (t) {
        return '<tr><td>' + esc(t.nome) + ' <span class="muted">(' + t.artigo + ')</span></td>' +
          '<td class="r">' + FG.fmtMoney(t.preco) + '</td><td class="r">' + t.qtd + '</td></tr>';
      }).join('') : '<tr><td colspan="3" class="muted">Sem vendas.</td></tr>') +
      '</tbody></table></div></div>' +
      '</div></div>';

    document.getElementById('dz-reload').addEventListener('click', renderDash);
  }

  /* =========================================================
     CLIENTES  ×  ADMINISTRADORES
     ---------------------------------------------------------
     A tabela Usuario do banco guarda duas populações muito diferentes: quem
     COMPRA (concessionárias — conta gestora e contas internas) e quem OPERA o
     sistema (equipe Fullgas, com acesso a este painel). Numa lista só, as duas
     se escondiam: para achar um cadastro pendente era preciso varrer
     administradores no meio, e para conferir quem tem acesso ao painel era
     preciso lembrar de filtrar por papel. Agora são duas abas, cada uma com as
     colunas e as ações que fazem sentido para aquela população.
     ========================================================= */

  // Botão "Gerenciar" (ou "(você)" na própria linha do admin logado).
  function acoesUsuario(u) {
    if (String(u.id) === String(sess.id)) return '<span class="muted">(você)</span>';
    return '<button class="btn-orange btn-mini usr-ger" data-ger="' + u.id + '">⚙ Gerenciar</button>' +
      (u.status === 'pendente' ? ' <span class="usr-alerta" title="Cadastro aguardando aprovação">!</span>' : '');
  }

  // Liga os botões "Gerenciar" da tabela ao painel de ações. `voltar` é o
  // render da aba de onde o clique saiu — é para lá que o modal devolve.
  function bindGerenciar(voltar) {
    Array.prototype.forEach.call(view.querySelectorAll('[data-ger]'), function (b) {
      b.addEventListener('click', function () {
        var u = FG.all('users').find(function (x) { return String(x.id) === String(b.getAttribute('data-ger')); });
        if (u) modalUsuario(u, voltar);
      });
    });
  }

  /* ---------------------------------------------------------
     ABA CLIENTES — concessionárias (papel 'cliente')
     --------------------------------------------------------- */
  function renderClientes() {
    h1.textContent = 'Clientes'; setOn('clientes');
    var todos = FG.all('users').filter(function (u) { return u.papel === 'cliente'; });
    var f = filtros.clientes;
    var users = todos.filter(function (u) {
      if (f.status && u.status !== f.status) return false;
      if (f.tipo === 'interna' && u.gestor !== false) return false;
      if (f.tipo === 'gestor' && u.gestor === false) return false;
      return casaBusca('clientes', [u.nome, u.email, u.empresa, u.cnpj]);
    });
    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Clientes cadastrados (' + contagem('clientes', users.length, todos.length) + ')</div><div class="c-body">' +
      '<p class="adm-hint">Contas das concessionárias: a <b>conta principal</b> nasce no cadastro do site e as <b>contas internas</b> são criadas pelo próprio cliente em "Minha conta". Administradores da Fullgas ficam na aba <a href="#administradores">Administradores</a>.</p>' +
      barraFiltro('clientes', [
        { k: 'status', rotulo: 'Status', opcoes: [['pendente', 'Pendente'], ['aprovado', 'Aprovado'], ['bloqueado', 'Bloqueado']] },
        { k: 'tipo', rotulo: 'Tipo', opcoes: [['gestor', 'Conta principal'], ['interna', 'Conta interna']] }
      ], 'Buscar por nome, e-mail, empresa ou CNPJ') +
      '<table class="tbl"><thead><tr><th>Nome</th><th>E-mail</th><th>Empresa</th><th>CNPJ</th><th>Endereço</th><th>Tipo</th><th>Status</th><th>Ações</th></tr></thead><tbody>' +
      (users.length ? users.map(function (u) {
        var e = u.endereco;
        // Resumo compacto na tabela; os dados completos ficam na linha
        // expansível abaixo (botão "Expandir ▾"), bem divididos campo a campo.
        var endTxt = e ? (esc(e.cidade || '') + (e.uf ? '/' + esc(e.uf) : '')) : '<span class="muted">—</span>';
        function dd(rotulo, valor) {
          return '<div class="usr-dd"><b>' + rotulo + '</b><span>' +
            (valor ? esc(valor) : '<i class="muted">—</i>') + '</span></div>';
        }
        var det =
          '<div class="usr-det-sec">Empresa</div><div class="usr-det-grid">' +
          dd('Razão social', u.empresa) + dd('CNPJ', u.cnpj) +
          dd('Inscrição estadual', u.inscricaoEstadual) + dd('Telefone', u.telefone) +
          '<div class="usr-dd"><b>Contato Tiny</b><span>' + (u.tinyContatoId
            ? 'vinculado <span class="muted">(#' + esc(u.tinyContatoId) + ')</span>'
            : '<i class="muted">não vinculado</i>') + '</span></div>' +
          '</div>' +
          '<div class="usr-det-sec">Endereço</div>' +
          (e ? '<div class="usr-det-grid">' +
            dd('CEP', e.cep) + dd('Logradouro', e.logradouro) + dd('Número', e.numero) +
            dd('Complemento', e.complemento) + dd('Bairro', e.bairro) +
            dd('Cidade', e.cidade) + dd('UF', e.uf) +
            '</div>' : '<p class="muted" style="margin:4px 0 0;">Sem endereço cadastrado.</p>');
        return '<tr><td>' + esc(u.nome) + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.empresa) +
          (u.fabrica ? ' ' + FG.seloFabrica() : '') + '</td>' +
          '<td>' + (u.cnpj ? esc(u.cnpj) : '<span class="muted">—</span>') + '</td>' +
          '<td style="font-size:12px;">' + endTxt +
          ' <button class="btn-line btn-mini usr-exp" data-exp="' + u.id + '">Expandir ▾</button></td>' +
          '<td>' + (u.gestor === false
            ? '<span class="pill-status ps-interna">Conta interna</span>'
            : '<span class="pill-status ps-gestor">Conta principal</span>') + '</td>' +
          '<td>' + pill(u.status) + '</td><td>' + acoesUsuario(u) + '</td></tr>' +
          '<tr class="usr-det hidden" data-det="' + u.id + '"><td colspan="8">' + det + '</td></tr>';
      }).join('') : vazioFiltro(8, 'Nenhum cliente com esse filtro.')) + '</tbody></table></div></div>';

    bindFiltro(renderClientes);

    // Expandir/recolher os dados completos do cadastro.
    Array.prototype.forEach.call(view.querySelectorAll('[data-exp]'), function (b) {
      b.addEventListener('click', function () {
        var det = view.querySelector('[data-det="' + b.getAttribute('data-exp') + '"]');
        if (!det) return;
        var aberto = !det.classList.contains('hidden');
        det.classList.toggle('hidden', aberto);
        b.textContent = aberto ? 'Expandir ▾' : 'Recolher ▴';
      });
    });

    bindGerenciar(renderClientes);
  }

  /* ---------------------------------------------------------
     ABA ADMINISTRADORES — equipe Fullgas (papel 'admin')
     --------------------------------------------------------- */
  function renderAdmins() {
    h1.textContent = 'Administradores'; setOn('administradores');
    var todos = FG.all('users').filter(function (u) { return u.papel === 'admin'; });
    var f = filtros.admins;
    var admins = todos.filter(function (u) {
      if (f.status && u.status !== f.status) return false;
      return casaBusca('admins', [u.nome, u.email, u.empresa, 'Fábrica']);
    });
    var ativos = todos.filter(function (u) { return u.status === 'aprovado'; }).length;

    view.innerHTML =
      '<div class="adm-bar"><span class="grow"></span>' +
      '<button class="btn-orange" id="adm-novo">+ Adicionar administrador</button></div>' +

      '<div class="adm-card"><div class="c-head">Administradores (' + contagem('admins', admins.length, todos.length) + ')</div><div class="c-body">' +
      '<p class="adm-hint">Quem tem acesso a <b>este painel</b>: pedidos, catálogo, chassis, cadastros de clientes, Tiny e notificações. ' +
      'São ' + ativos + ' com acesso ativo. Contas de concessionária ficam na aba <a href="#clientes">Clientes</a>.</p>' +
      barraFiltro('admins', [
        { k: 'status', rotulo: 'Status', opcoes: [['aprovado', 'Ativo'], ['bloqueado', 'Bloqueado'], ['pendente', 'Pendente']] }
      ], 'Buscar por nome ou e-mail') +
      '<table class="tbl"><thead><tr><th>Nome</th><th>E-mail</th><th>Vínculo</th><th>Status</th>' +
      '<th>Criado em</th><th>Ações</th></tr></thead><tbody>' +
      (admins.length ? admins.map(function (u) {
        return '<tr><td>' + esc(u.nome) +
          (String(u.id) === String(sess.id) ? ' <span class="pill-status ps-voce">você</span>' : '') +
          '</td><td>' + esc(u.email) + '</td>' +
          '<td>' + FG.seloFabrica() + '</td>' +
          '<td>' + pill(u.status) + '</td>' +
          '<td class="nowrap">' + (u.criadoEm ? FG.fmtDate(u.criadoEm) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + acoesUsuario(u) + '</td></tr>';
      }).join('') : vazioFiltro(6, 'Nenhum administrador com esse filtro.')) +
      '</tbody></table></div></div>';

    bindFiltro(renderAdmins);
    bindGerenciar(renderAdmins);
    document.getElementById('adm-novo').addEventListener('click', modalNovoAdmin);
  }

  /* ---------------------------------------------------------
     NOVO ADMINISTRADOR
     ---------------------------------------------------------
     A conta nasce já aprovada e na mesma empresa de quem cria (a casa) — quem
     está aqui já é administrador, então mandar o convite para uma fila de
     aprovação seria cerimônia sem ganho. A senha mínima é maior que a do
     cadastro de cliente: é a conta que enxerga tudo.
     --------------------------------------------------------- */
  var SENHA_MINIMA_ADMIN = 8;

  function modalNovoAdmin() {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Adicionar administrador</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="adm-hint" style="margin-top:0;">A conta é criada já liberada e com acesso total ao painel. ' +
      'Passe a senha para a pessoa e peça que ela troque no primeiro acesso, em "Esqueci minha senha".</p>' +
      '<div class="field"><label for="na-nome">Nome *</label>' +
      '<input id="na-nome" type="text" maxlength="120" placeholder="Nome de quem vai administrar" autocomplete="off"></div>' +
      '<div class="field"><label for="na-email">E-mail *</label>' +
      '<input id="na-email" type="email" maxlength="160" placeholder="pessoa@fullgas.com.br" autocomplete="off"></div>' +
      '<div class="field"><label for="na-senha">Senha * <span class="muted">(mínimo de ' + SENHA_MINIMA_ADMIN + ' caracteres)</span></label>' +
      '<input id="na-senha" type="password" autocomplete="new-password"></div>' +
      '<div class="field"><label for="na-senha2">Repetir a senha *</label>' +
      '<input id="na-senha2" type="password" autocomplete="new-password"></div>' +
      '<p class="na-erro hidden" id="na-erro"></p>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="na-canc">Cancelar</button>' +
      '<button class="btn-orange" id="na-ok">Criar administrador</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('na-canc').addEventListener('click', fechar);
    document.getElementById('na-nome').focus();

    var erroEl = document.getElementById('na-erro');
    function erro(msg) {
      erroEl.textContent = msg;
      erroEl.classList.remove('hidden');
    }

    var btn = document.getElementById('na-ok');
    btn.addEventListener('click', async function () {
      var nome = document.getElementById('na-nome').value.trim();
      var email = document.getElementById('na-email').value.trim().toLowerCase();
      var senha = document.getElementById('na-senha').value;
      var senha2 = document.getElementById('na-senha2').value;

      if (!nome || !email || !senha) return erro('Preencha nome, e-mail e senha.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro('E-mail inválido.');
      if (senha.length < SENHA_MINIMA_ADMIN) return erro('A senha precisa de ao menos ' + SENHA_MINIMA_ADMIN + ' caracteres.');
      if (senha !== senha2) return erro('As duas senhas não são iguais.');

      erroEl.classList.add('hidden');
      btn.disabled = true; btn.textContent = 'Criando…';
      var r = await FG.criarAdmin({ nome: nome, email: email, senha: senha });
      if (!r.ok) {
        erro(r.msg || 'Não foi possível criar o administrador.');
        btn.disabled = false; btn.textContent = 'Criar administrador';
        return;
      }
      fechar();
      FG.toast('Administrador criado — ' + email + ' já pode entrar no painel.');
      renderAdmins();
    });

    // Enter em qualquer campo envia o formulário.
    Array.prototype.forEach.call(back.querySelectorAll('input'), function (inp) {
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
    });
  }

  /* ---------------------------------------------------------
     PAINEL DE GESTÃO DO USUÁRIO
     ---------------------------------------------------------
     Cada ação é um cartão com título, explicação do que acontece e um botão —
     em vez de quatro botões soltos numa célula de tabela sem contexto.
     --------------------------------------------------------- */
  function modalUsuario(u, voltar) {
    var interna = u.gestor === false;
    var ehAdmin = u.papel === 'admin';
    voltar = voltar || (ehAdmin ? renderAdmins : renderClientes);
    var back = document.createElement('div');
    back.className = 'modal-back';

    // Cada cartão: [chave, ícone, título, descrição, rótulo do botão, tom]
    var cards = [];

    // Assumir a identidade de outro administrador não existe: a API recusa
    // (não há ganho de suporte e embaralharia a trilha de auditoria).
    if (!ehAdmin)
      cards.push(['identidade', '👤', 'Alterar identidade',
        'Entra no portal como ' + esc(u.nome) + ' e vê exatamente o que ' + (interna ? 'esta conta interna' : 'o cliente') +
        ' vê. Uma tarja fica no topo e você volta para a sua conta quando quiser.',
        'Entrar na conta', 'destaque']);

    if (u.status === 'pendente')
      cards.push(['aprovar', '✅', 'Aprovar cadastro',
        'Libera o primeiro acesso. Enquanto está pendente, esta pessoa não consegue entrar no portal.',
        'Aprovar agora', 'ok']);

    cards.push(['papel', ehAdmin ? '⬇' : '⬆',
      ehAdmin ? 'Rebaixar para cliente' : 'Promover a administrador',
      ehAdmin
        ? 'Tira o acesso a este painel. A conta passa a usar só o portal e migra para a aba Clientes.'
        : 'Dá acesso total a este painel: pedidos, catálogo, chassis, clientes e Tiny. A conta migra para a aba Administradores ' +
          'e a empresa dela (' + esc(u.empresa || '—') + ') passa a contar como Fábrica: sai da lista de concessionárias.',
      ehAdmin ? 'Tornar cliente' : 'Tornar admin', '']);

    cards.push(['bloq', u.status === 'bloqueado' ? '🔓' : '🚫',
      u.status === 'bloqueado' ? 'Desbloquear acesso' : 'Bloquear acesso',
      u.status === 'bloqueado'
        ? 'Devolve o acesso ao portal, com os dados e o histórico intactos.'
        : 'Impede o login sem apagar nada. É o caminho recomendado no lugar de excluir.',
      u.status === 'bloqueado' ? 'Desbloquear' : 'Bloquear', u.status === 'bloqueado' ? '' : 'aviso']);

    cards.push(['del', '🗑', 'Excluir conta',
      'Apaga o usuário definitivamente. Não funciona se houver histórico (pedidos, reivindicações) — nesse caso, bloqueie.',
      'Excluir', 'perigo']);

    back.innerHTML =
      '<div class="modal usr-modal"><header><h3>Gerenciar usuário</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      /* ---- identificação ---- */
      '<div class="usr-ficha">' +
      '<div class="usr-avatar">' + esc((u.nome || '?').trim().charAt(0).toUpperCase()) + '</div>' +
      '<div class="usr-ficha-txt"><div class="usr-ficha-nome">' + esc(u.nome) + '</div>' +
      '<div class="usr-ficha-mail">' + esc(u.email) + '</div>' +
      '<div class="usr-ficha-tags">' + pill(u.papel) + pill(u.status) +
      (ehAdmin ? '' : (interna
        ? '<span class="pill-status ps-interna">Conta interna</span>'
        : '<span class="pill-status ps-gestor">Conta principal</span>')) +
      '</div>' +
      '<div class="usr-ficha-emp">' + (ehAdmin
        ? FG.seloFabrica()
        : esc(u.empresa || '—') + (u.fabrica ? ' ' + FG.seloFabrica() : '') +
          (u.cnpj ? ' <span class="muted">· ' + esc(u.cnpj) + '</span>' : '')) + '</div>' +
      '</div></div>' +
      /* ---- ações ---- */
      '<div class="usr-acoes">' +
      cards.map(function (c) {
        return '<div class="usr-acao ' + c[5] + '">' +
          '<div class="usr-acao-ico">' + c[1] + '</div>' +
          '<div class="usr-acao-txt"><b>' + c[2] + '</b><span>' + c[3] + '</span></div>' +
          '<button class="usr-acao-btn" data-ac="' + c[0] + '">' + c[4] + '</button></div>';
      }).join('') +
      '</div></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);

    Array.prototype.forEach.call(back.querySelectorAll('[data-ac]'), function (b) {
      b.addEventListener('click', async function () {
        var ac = b.getAttribute('data-ac');

        if (ac === 'identidade') {
          b.disabled = true; b.textContent = 'Entrando…';
          var r = await FG.assumirIdentidade(u.id);
          if (!r.ok) { FG.toast(r.msg, 'erro'); b.disabled = false; b.textContent = 'Entrar na conta'; return; }
          location.href = '/portal';   // recarrega o app já com a nova sessão
          return;
        }

        if (ac === 'del') {
          if (!confirm('Excluir o usuário "' + u.nome + '" (' + u.email + ')?\nEsta ação não pode ser desfeita.')) return;
          b.disabled = true;
          var rd = await FG.delUser(u.id);
          if (rd && rd.ok === false) { FG.toast(rd.msg || 'Não foi possível excluir o usuário.', 'erro'); b.disabled = false; return; }
          FG.toast(ehAdmin ? 'Administrador excluído.' : 'Cliente excluído.');
          fechar(); refreshBell(); voltar();
          return;
        }

        var patch = null, msg = '';
        if (ac === 'aprovar') { patch = { status: 'aprovado' }; msg = 'Cadastro aprovado.'; }
        else if (ac === 'papel') {
          // Trocar o papel move a conta de aba — o aviso evita a impressão de
          // que o usuário "sumiu" da lista onde ele estava.
          patch = { papel: ehAdmin ? 'cliente' : 'admin' };
          msg = ehAdmin
            ? 'Acesso ao painel removido — a conta agora está na aba Clientes.'
            : 'Agora é administrador — a conta está na aba Administradores.';
        } else if (ac === 'bloq') {
          var st = u.status === 'bloqueado' ? 'aprovado' : 'bloqueado';
          patch = { status: st }; msg = st === 'bloqueado' ? 'Acesso bloqueado.' : 'Acesso desbloqueado.';
        }
        if (!patch) return;
        b.disabled = true;
        var r2 = await FG.setUser(u.id, patch);
        if (r2 && r2.ok === false) { FG.toast(r2.msg || 'Não foi possível atualizar o usuário.', 'erro'); b.disabled = false; return; }
        FG.toast(msg);
        fechar(); refreshBell(); voltar();
      });
    });
  }

  /* =========================================================
     NOTIFICAÇÕES — admin envia mensagens às concessionárias
     ========================================================= */
  function renderNotifsAdmin() {
    h1.textContent = 'Notificações'; setOn('notificacoes');
    // Esta tela é a caixa de SAÍDA do administrador: só o que ele escreveu à
    // mão. Os avisos automáticos dos chamados (origem 'suporte') chegam na
    // caixa dele no portal, junto com a carta ✉️ — aqui só fariam volume, e
    // ainda com um botão "Apagar" que não faz sentido para um evento.
    var notifs = FG.all('notifications').filter(function (n) { return n.origem !== 'suporte'; });

    view.innerHTML =
      /* ---- envio ---- */
      '<div class="adm-card"><div class="c-head">Enviar mensagem às concessionárias</div><div class="c-body">' +
      '<div class="nt-form">' +
      '<div class="field"><label for="nt-emp">Destinatário</label>' +
      '<div class="ac-wrap"><input id="nt-emp" type="text" placeholder="Todas as concessionárias (digite p/ escolher uma)" autocomplete="off">' +
      '<div class="ac-list hidden" id="nt-emp-ac"></div></div></div>' +
      '<div class="field"><label for="nt-tipo">Tipo</label><select id="nt-tipo">' +
      '<option value="info">Aviso</option><option value="critica">Crítica (⚠ destaque)</option></select></div>' +
      '</div>' +
      '<div class="field"><label for="nt-titulo">Título *</label>' +
      '<input id="nt-titulo" type="text" maxlength="160" placeholder="Ex.: Recall do modelo FG 125"></div>' +
      '<div class="field"><label for="nt-texto">Mensagem</label>' +
      '<textarea id="nt-texto" rows="4" maxlength="2000" placeholder="Escreva a mensagem para as concessionárias..."></textarea></div>' +
      '<div class="field"><label for="nt-anexo">Anexo (imagem, vídeo, PDF... — opcional, máx. 60 MB)</label>' +
      '<input id="nt-anexo" type="file" accept="image/*,video/*,.pdf,.zip,.doc,.docx,.xls,.xlsx"></div>' +
      '<button class="btn-orange" id="nt-enviar">Enviar notificação</button>' +
      '</div></div>' +

      /* ---- enviadas ---- */
      '<div class="adm-card"><div class="c-head">Enviadas (' + notifs.length + ')</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Data</th><th>Destinatário</th><th>Tipo</th><th>Título</th>' +
      '<th>Mensagem</th><th>Anexo</th><th></th></tr></thead><tbody>' +
      (notifs.length ? notifs.map(function (n) {
        return '<tr><td class="nowrap">' + FG.fmtDateTime(n.data) + '</td>' +
          '<td>' + (n.empresa ? esc(n.empresa) : '<b>Todas</b>') + '</td>' +
          '<td>' + (n.tipo === 'critica' ? '⚠ Crítica' : 'Aviso') + '</td>' +
          '<td>' + esc(n.titulo) + '</td>' +
          '<td style="font-size:12px;max-width:320px;">' + esc((n.texto || '').slice(0, 140)) + ((n.texto || '').length > 140 ? '…' : '') + '</td>' +
          '<td>' + (n.anexo ? '<a data-arquivo="' + esc(n.anexo) + '" target="_blank" rel="noopener">📎 ' + esc(n.anexoTipo || 'anexo') + '</a>' : '<span class="muted">—</span>') + '</td>' +
          '<td><button class="btn-line btn-mini usr-del" data-del="' + n.id + '">Apagar</button></td></tr>';
      }).join('') : '<tr><td colspan="7" class="muted">Nenhuma notificação enviada ainda.</td></tr>') +
      '</tbody></table></div></div>';

    bindAcEmpresas('nt-emp');
    FG.carregarArquivos(view);       // busca os anexos protegidos da tabela

    document.getElementById('nt-enviar').addEventListener('click', function () {
      var empEl = document.getElementById('nt-emp');
      var idSel = empEl.getAttribute('data-ac-id');
      if (empEl.value.trim() && !idSel) {
        FG.toast('Escolha a concessionária na lista (ou apague o campo p/ enviar a todas).', 'erro'); return;
      }
      var dados = {
        titulo: document.getElementById('nt-titulo').value.trim(),
        texto: document.getElementById('nt-texto').value.trim(),
        tipo: document.getElementById('nt-tipo').value,
        empresaId: idSel ? Number(idSel) : null,
        anexo: document.getElementById('nt-anexo').files[0] || null
      };
      if (!dados.titulo) { FG.toast('Escreva o título da notificação.', 'erro'); return; }
      if (!dados.texto && !dados.anexo) { FG.toast('Escreva a mensagem ou anexe um arquivo.', 'erro'); return; }
      var b = document.getElementById('nt-enviar');
      b.disabled = true; b.textContent = 'Enviando…';
      FG.notifEnviar(dados).then(function (r) {
        b.disabled = false; b.textContent = 'Enviar notificação';
        if (!r.ok) { FG.toast(r.msg || 'Não foi possível enviar.', 'erro'); return; }
        FG.toast('Notificação enviada' + (idSel ? ' para ' + empEl.value.trim() : ' a todas as concessionárias') + '.');
        renderNotifsAdmin();
      });
    });

    Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Apagar esta notificação? Ela some do painel de todas as concessionárias.')) return;
        b.disabled = true;
        FG.notifApagar(b.getAttribute('data-del')).then(function (r) {
          if (r && r.ok === false) { FG.toast(r.msg || 'Não foi possível apagar.', 'erro'); b.disabled = false; return; }
          FG.toast('Notificação apagada.');
          renderNotifsAdmin();
        });
      });
    });
  }

  /* =========================================================
     CHASSIS (VINs) — cadastro na Fábrica e atribuição a concessionárias
     ---------------------------------------------------------
     Chassi sem concessionária está na Fábrica. A lista de destino
     (FG.empresas) já vem sem a empresa dos administradores — a API não
     aceita a Fábrica como concessionária.
     ========================================================= */

  // Autocomplete de concessionária (front próprio, estilo .ac-wrap).
  function bindAcEmpresas(inputId) {
    FG.bindAutocomplete(inputId, function (termo) {
      return FG.empresas().then(function (emps) {
        var t = termo.toLowerCase();
        return emps.filter(function (e2) {
          return e2.nome.toLowerCase().indexOf(t) !== -1 ||
            (e2.fantasia && e2.fantasia.toLowerCase().indexOf(t) !== -1);
        }).map(function (e2) { return { id: e2.id, label: e2.nome, sub: e2.fantasia || '' }; });
      });
    });
  }

  // Onde o chassi está: a concessionária ou o selo da Fábrica.
  function localChassi(v) {
    return v.fabrica ? FG.seloFabrica() : esc(v.empresa || '—');
  }

  // Modal para atribuir/transferir um chassi a uma concessionária — ou,
  // se ele já está numa, devolvê-lo à Fábrica.
  function modalAtribuir(v) {
    var naFabrica = !!v.fabrica;
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (naFabrica ? 'Atribuir' : 'Transferir') + ' chassi — ' + esc(v.niv) + '</h3>' +
      '<button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">Hoje está ' + (naFabrica ? 'na ' : 'em <b>') + localChassi(v) +
      (naFabrica ? '' : '</b>') + '.</p>' +
      '<div class="field"><label>Concessionária de destino *</label>' +
      '<div class="ac-wrap"><input id="ch-emp" type="text" placeholder="Digite o nome da concessionária" autocomplete="off">' +
      '<div class="ac-list hidden" id="ch-emp-ac"></div></div></div>' +
      '</div>' +
      '<div class="modal-foot">' +
      (naFabrica ? '' : '<button class="btn-line" id="ch-fab" style="margin-right:auto;">Devolver à Fábrica</button>') +
      '<button class="btn-line" id="ch-canc">Cancelar</button>' +
      '<button class="btn-orange" id="ch-ok">Confirmar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.querySelector('#ch-canc').addEventListener('click', fechar);
    document.getElementById('ch-emp').focus();
    bindAcEmpresas('ch-emp');

    var bFab = document.getElementById('ch-fab');
    if (bFab) bFab.addEventListener('click', function () {
      if (!confirm('Devolver o chassi ' + v.niv + ' à Fábrica?\n' + v.empresa + ' deixa de vê-lo.')) return;
      bFab.disabled = true;
      FG.transferirVeiculo(v.niv, { fabrica: true }).then(function (r) {
        if (!r.ok) { bFab.disabled = false; FG.toast(r.msg || 'Não foi possível devolver.', 'erro'); return; }
        fechar();
        FG.toast('Chassi ' + v.niv + ' devolvido à Fábrica.');
        renderChassis();
      });
    });

    document.getElementById('ch-ok').addEventListener('click', function () {
      var el = document.getElementById('ch-emp');
      var idSel = el.getAttribute('data-ac-id');
      var nome = el.value.trim();
      if (!nome) { FG.toast('Informe a concessionária.', 'erro'); return; }
      FG.transferirVeiculo(v.niv, idSel ? { empresaId: Number(idSel) } : nome).then(function (r) {
        if (!r.ok) { FG.toast(r.msg || 'Não foi possível atribuir.', 'erro'); return; }
        fechar();
        FG.toast('Chassi ' + v.niv + ' atribuído a ' + (r.empresa || nome) + '.');
        renderChassis();
      });
    });
  }

  // Conferencia antes de gravar o chassi — a "segunda chave" do cadastro.
  // Chassi digitado errado é caro de desfazer: o NIV é único e acompanha a
  // moto na garantia, no emplacamento e no histórico. Então, em vez de o botão
  // gravar direto, ele mostra tudo o que será gravado e exige um segundo sim,
  // com o resumo à vista. `onOk` só roda se a pessoa confirmar.
  function modalConferirChassi(resumo, onOk) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Todas as informações estão corretas?</h3>' +
      '<button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">Confira antes de cadastrar. Depois de gravado, ' +
      'o NIV não pode ser alterado — um erro aqui só se resolve com um chassi novo.</p>' +
      '<table class="tbl"><tbody>' +
      resumo.map(function (l) {
        return '<tr><th style="width:38%;text-align:left;">' + esc(l[0]) + '</th>' +
          '<td><b>' + esc(l[1]) + '</b></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="modal-foot">' +
      '<button class="btn-line" id="cf-canc">Revisar</button>' +
      '<button class="btn-orange" id="cf-ok">Sim, cadastrar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.querySelector('#cf-canc').addEventListener('click', fechar);
    // O foco começa em "Revisar": confirmar é uma escolha, não um Enter à toa.
    document.getElementById('cf-canc').focus();
    document.getElementById('cf-ok').addEventListener('click', function () {
      fechar();
      onOk();
    });
  }

  function renderChassis() {
    h1.textContent = 'Chassis (VINs)'; setOn('chassis');
    var todos = FG.all('vehicles');
    var modelos = FG.all('models');
    var f = filtros.chassis;
    var vehs = todos.filter(function (v) {
      if (f.status && v.status !== f.status) return false;
      if (f.modelo && String(v.modeloId) !== f.modelo) return false;
      if (f.atrib === 'sim' && v.fabrica) return false;
      if (f.atrib === 'nao' && !v.fabrica) return false;
      var m = FG.model(v.modeloId);
      return casaBusca('chassis', [v.niv, v.fabrica ? 'Fábrica' : v.empresa, m ? m.label : v.modeloId, v.ano]);
    });

    view.innerHTML =
      /* ---- cadastro de chassi novo ---- */
      '<div class="adm-card"><div class="c-head">Cadastrar novo chassi</div><div class="c-body">' +
      '<div class="ch-form">' +
      '<div class="field"><label for="ch-niv">NIV (chassi) *</label>' +
      '<input id="ch-niv" type="text" maxlength="17" placeholder="Ex.: VBFGA125XSM160872" style="text-transform:uppercase;"></div>' +
      '<div class="field"><label for="ch-modelo">Modelo *</label><select id="ch-modelo">' +
      '<option value="">— escolha o modelo —</option>' +
      modelos.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label for="ch-ano">Ano *</label>' +
      '<input id="ch-ano" type="number" min="1980" max="' + (new Date().getFullYear() + 1) + '" ' +
      'step="1" inputmode="numeric" placeholder="Ex.: ' + new Date().getFullYear() + '"></div>' +
      '<div class="field"><label for="ch-nova-emp">Concessionária (opcional)</label>' +
      '<div class="ac-wrap"><input id="ch-nova-emp" type="text" placeholder="Vazio = fica na Fábrica" autocomplete="off">' +
      '<div class="ac-list hidden" id="ch-nova-emp-ac"></div></div></div>' +
      '<div class="field" style="align-self:end;"><button class="btn-orange" id="ch-criar">Cadastrar chassi</button></div>' +
      '</div>' +
      '<p class="muted" style="font-size:12px;margin:8px 0 0;">Sem concessionária, o chassi fica na ' + FG.seloFabrica() +
      ' — nenhuma concessionária o vê até você atribuir. A atribuição pode ser feita (ou trocada) a qualquer momento na tabela abaixo.</p>' +
      '</div></div>' +

      /* ---- lista ---- */
      '<div class="adm-card"><div class="c-head">Chassis cadastrados (' + contagem('chassis', vehs.length, todos.length) + ')</div><div class="c-body">' +
      barraFiltro('chassis', [
        { k: 'status', rotulo: 'Status', opcoes: [['Disponível', 'Disponível'], ['Vendido', 'Vendido']] },
        { k: 'modelo', rotulo: 'Modelo', opcoes: modelos.map(function (m) { return [m.id, m.label]; }) },
        { k: 'atrib', rotulo: 'Localização', opcoes: [['nao', 'Na Fábrica'], ['sim', 'Em concessionária']] }
      ], 'Buscar por NIV, modelo, ano ou concessionária') +
      '<table class="tbl"><thead><tr><th>NIV</th><th>Modelo</th><th>Ano</th>' +
      '<th>Status</th><th>Localização</th><th>Entrada no local</th><th>Ações</th></tr></thead><tbody>' +
      (vehs.length ? vehs.map(function (v) {
        var m = FG.model(v.modeloId);
        return '<tr><td>' + esc(v.niv) + '</td><td>' + esc(m ? m.label : v.modeloId) + '</td>' +
          '<td>' + esc(v.ano || '—') + '</td>' +
          '<td>' + pill(v.status) + '</td>' +
          '<td>' + localChassi(v) + '</td>' +
          '<td>' + FG.fmtDate(v.entrada) + '</td>' +
          '<td><button class="btn-line btn-mini" data-atr="' + esc(v.niv) + '">' +
          (v.fabrica ? 'Atribuir' : 'Transferir') + '</button></td></tr>';
      }).join('') : vazioFiltro(7, todos.length
        ? 'Nenhum chassi com esse filtro.'
        : 'Nenhum chassi cadastrado ainda.')) +
      '</tbody></table></div></div>';

    bindFiltro(renderChassis);
    bindAcEmpresas('ch-nova-emp');

    /* cadastrar */
    document.getElementById('ch-criar').addEventListener('click', function () {
      var empEl = document.getElementById('ch-nova-emp');
      var idSel = empEl.getAttribute('data-ac-id');
      var anoMax = new Date().getFullYear() + 1;
      var dados = {
        niv: document.getElementById('ch-niv').value.trim().toUpperCase(),
        modeloId: document.getElementById('ch-modelo').value,
        ano: Number(document.getElementById('ch-ano').value),
        empresaId: idSel ? Number(idSel) : null
      };
      if (!/^[A-Z0-9]{11,17}$/.test(dados.niv)) { FG.toast('NIV inválido — use 11 a 17 letras/números.', 'erro'); return; }
      if (!dados.modeloId) { FG.toast('Escolha o modelo da moto.', 'erro'); return; }
      // Mesma faixa que a API cobra — aqui só para o erro aparecer sem ida ao servidor.
      if (!dados.ano || dados.ano < 1980 || dados.ano > anoMax) {
        FG.toast('Informe o ano da moto (entre 1980 e ' + anoMax + ').', 'erro'); return;
      }
      if (empEl.value.trim() && !idSel) { FG.toast('Escolha a concessionária na lista de sugestões (ou deixe vazio para ficar na Fábrica).', 'erro'); return; }

      var mod = FG.model(dados.modeloId);
      modalConferirChassi([
        ['NIV (chassi)', dados.niv],
        ['Modelo', mod ? mod.label : dados.modeloId],
        ['Ano', dados.ano],
        ['Concessionária', dados.empresaId ? empEl.value.trim() : 'Nenhuma — fica na Fábrica']
      ], function () {
        var b = document.getElementById('ch-criar');
        b.disabled = true;
        FG.criarVeiculo(dados).then(function (r) {
          b.disabled = false;
          if (r && r.ok === false) { FG.toast(r.msg || 'Não foi possível cadastrar o chassi.', 'erro'); return; }
          FG.toast('Chassi ' + dados.niv + ' cadastrado' + (dados.empresaId ? '.' : ' na Fábrica.'));
          renderChassis();
        });
      });
    });

    /* atribuir / transferir */
    Array.prototype.forEach.call(view.querySelectorAll('[data-atr]'), function (b) {
      b.addEventListener('click', function () {
        var v = FG.all('vehicles').find(function (x) { return x.niv === b.getAttribute('data-atr'); });
        if (v) modalAtribuir(v);
      });
    });
  }

  /* =========================================================
     CATÁLOGO DE PRODUTOS
     ========================================================= */
  // Foto de produto em 48 px: usa a miniatura gerada pela API (≈4 KB, com
  // cache) no lugar da foto inteira do Tiny, que chega a 170 KB e, em parte
  // dos casos, o navegador é proibido de guardar. `loading="lazy"`: o
  // Catálogo lista todos os produtos, e só as linhas na tela precisam da foto.
  function fotoProduto(p) {
    if (!p.imagem) return '<span class="fnd-thumb vazio">sem foto</span>';
    return '<img class="fnd-thumb" src="' + esc(p.miniatura || p.imagem) + '" data-grande="' + esc(p.imagem) +
      '" alt="" loading="lazy" decoding="async">';
  }

  function renderProdutos() {
    h1.textContent = 'Catálogo de produtos'; setOn('produtos');
    var prods = FG.all('products');
    var f = filtros.produtos;
    // A gestão de categorias abaixo continua vendo o catálogo INTEIRO (`prods`);
    // o filtro vale só para a tabela de produtos (`prodsF`).
    var prodsF = prods.filter(function (p) {
      // Categoria de topo casa também com os produtos das subcategorias.
      if (f.cat && FG.categoriaEDescendentes(f.cat).indexOf(p.cat) < 0) return false;
      if (f.estoque === 'com' && !(p.estoque > 0)) return false;
      if (f.estoque === 'sem' && p.estoque > 0) return false;
      var c = FG.category(p.cat);
      return casaBusca('produtos', [p.artigo, p.nome, c ? c.nome : p.cat]);
    });
    // Opções do filtro de categoria: topo e, indentadas, as subcategorias.
    var catOpcoes = [];
    FG.categoriasTopo().forEach(function (c) {
      catOpcoes.push([c.id, c.nome]);
      FG.subcategorias(c.id).forEach(function (s) { catOpcoes.push([s.id, '   ↳ ' + s.nome]); });
    });

    // --- Gestão de categorias (árvore de 2 níveis) ---
    function catRow(c, sub) {
      var n = prods.filter(function (p) { return p.cat === c.id; }).length;
      return '<tr>' +
        '<td>' + (c.imagem
            ? '<img class="fnd-thumb" src="' + esc(c.imagem) + '" alt="">'
            : '<span class="fnd-thumb vazio">sem foto</span>') + '</td>' +
        '<td>' + (sub ? '<span class="muted">↳&nbsp;</span>' : '') + esc(c.nome) +
          ' <span class="muted" style="font-size:11px;">(' + esc(c.id) + ')</span></td>' +
        '<td class="r">' + n + '</td>' +
        '<td class="nowrap">' +
          (sub ? '' : '<button class="btn-line btn-mini" data-cat-sub="' + esc(c.id) + '">＋ Sub</button> ') +
          '<button class="btn-line btn-mini" data-cat-edit="' + esc(c.id) + '">' + (c.imagem ? 'Editar / foto' : 'Editar / +foto') + '</button> ' +
          '<button class="btn-line btn-mini" data-cat-del="' + esc(c.id) + '">Excluir</button>' +
        '</td></tr>';
    }
    var catRows = FG.categoriasTopo().map(function (c) {
      return catRow(c, false) +
        FG.subcategorias(c.id).map(function (s) { return catRow(s, true); }).join('');
    }).join('');

    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Categorias e subcategorias</div><div class="c-body">' +
      '<div class="adm-bar"><span class="grow"></span>' +
      '<button class="btn-orange" id="ct-novo">Adicionar categoria</button></div>' +
      '<table class="tbl"><thead><tr><th>Foto</th><th>Categoria</th><th class="r">Produtos</th><th>Ações</th></tr></thead><tbody>' +
      (catRows || '<tr><td colspan="4" class="muted">Nenhuma categoria cadastrada.</td></tr>') +
      '</tbody></table>' +
      '<p class="muted" style="font-size:12px;margin:8px 0 0;">As subcategorias (↳) aparecem dentro da categoria pai na loja. ' +
      'Só é possível excluir categorias vazias (sem produtos e sem subcategorias).</p>' +
      '</div></div>' +

      '<div class="adm-bar"><span class="grow"></span>' +
      '<button class="btn-orange" id="pr-novo">Adicionar produto</button></div>' +
      '<div class="adm-card"><div class="c-head">Produtos (' + contagem('produtos', prodsF.length, prods.length) + ')</div><div class="c-body">' +
      barraFiltro('produtos', [
        { k: 'cat', rotulo: 'Categoria', todos: 'Todas', opcoes: catOpcoes },
        { k: 'estoque', rotulo: 'Estoque', opcoes: [['com', 'Com estoque'], ['sem', 'Fora de estoque']] }
      ], 'Buscar por artigo ou nome') +
      '<table class="tbl"><thead><tr><th>Foto</th><th>Artigo</th><th>Nome</th><th>Categoria</th>' +
      '<th class="r">Preço</th><th class="r">Estoque</th><th>Ações</th></tr></thead><tbody>' +
      (prodsF.length ? prodsF.map(function (p) {
        var c = FG.category(p.cat);
        return '<tr><td>' + fotoProduto(p) + '</td>' +
          '<td>' + p.artigo + '</td><td>' + esc(p.nome) +
          (p.tinyAtivo ? ' <span class="pill-status Tiny" title="Gerenciado pelo Tiny ERP">Tiny</span>' : '') +
          '</td><td>' + esc(c ? c.nome : p.cat) + '</td>' +
          '<td class="r">' + FG.fmtMoney(p.preco) + '</td>' +
          '<td class="r">' + (p.estoque > 0
            ? p.estoque
            : '<span style="color:#b91c1c;font-weight:700;">Fora de estoque</span>' +
              (p.previsao
                ? '<div style="color:#92600a;font-weight:600;font-size:12px;margin-top:2px;">⏳ Chega em ' + esc(p.previsao) + '</div>'
                : '<div style="color:#92600a;font-size:12px;margin-top:2px;">sem previsão</div>')) + '</td>' +
          '<td><button class="btn-line btn-mini" data-ac="edit" data-art="' + p.artigo + '">Editar</button> ' +
          '<button class="btn-line btn-mini" data-ac="del" data-art="' + p.artigo + '">Excluir</button></td></tr>';
      }).join('') : vazioFiltro(7, 'Nenhum produto com esse filtro.')) + '</tbody></table></div></div>';

    bindFiltro(renderProdutos);
    document.getElementById('pr-novo').addEventListener('click', function () { modalProduto(null); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-ac]'), function (b) {
      b.addEventListener('click', function () {
        var art = b.getAttribute('data-art');
        if (b.getAttribute('data-ac') === 'edit') { modalProduto(FG.product(art)); return; }
        if (!confirm('Excluir o artigo ' + art + '?')) return;
        FG.apiExcluirProduto(art)
          .then(function () { FG.toast('Artigo excluído.'); renderProdutos(); })
          .catch(function (e) { FG.toast((e && e.message) || 'Falha ao excluir.', 'erro'); });
      });
    });

    // --- categorias: criar / subcategoria / editar / excluir ---
    document.getElementById('ct-novo').addEventListener('click', function () { modalCategoria(null, ''); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-cat-sub]'), function (b) {
      b.addEventListener('click', function () { modalCategoria(null, b.getAttribute('data-cat-sub')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-cat-edit]'), function (b) {
      b.addEventListener('click', function () { modalCategoria(FG.category(b.getAttribute('data-cat-edit')), ''); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-cat-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-cat-del');
        var c = FG.category(id);
        if (!confirm('Excluir a categoria "' + (c ? c.nome : id) + '"? Só funciona se estiver vazia.')) return;
        b.disabled = true;
        FG.apiExcluirCategoria(id).then(function (r) {
          if (r && r.ok === false) { FG.toast(r.msg || 'Não foi possível excluir.', 'erro'); b.disabled = false; return; }
          FG.toast('Categoria excluída.'); renderProdutos();
        });
      });
    });
  }

  // Modal de criação/edição de categoria (ou subcategoria, quando `paiPre` traz
  // o código da categoria pai). Na edição, o pai não muda (mover = excluir/recriar).
  function modalCategoria(cat, paiPre) {
    var novo = !cat;
    var topo = FG.categoriasTopo();
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (novo ? 'Nova categoria' : 'Editar ' + esc(cat.nome)) + '</h3>' +
      '<button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Nome *</label>' +
      '<input id="ct-nome" type="text" maxlength="120" value="' + (cat ? esc(cat.nome) : '') + '"></div>' +
      (novo
        ? '<div class="field"><label>Categoria pai (opcional)</label>' +
          '<select id="ct-pai"><option value="">— Nenhuma (categoria de topo) —</option>' +
          topo.map(function (c) {
            return '<option value="' + esc(c.id) + '"' + (paiPre === c.id ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
          }).join('') + '</select>' +
          '<p class="muted" style="font-size:12px;margin:4px 0 0;">Escolha uma categoria pai para criar uma <b>subcategoria</b> dentro dela.</p></div>'
        : '<p class="muted" style="font-size:12px;">Para mover a categoria de lugar, exclua e recrie.</p>') +
      '<div class="field"><label>Foto da categoria (miniatura na grade da loja)</label>' +
      '<div class="fnd-foto-row">' +
      (cat && cat.imagem ? '<img class="fnd-thumb" src="' + esc(cat.imagem) + '" alt="">' : '<span class="fnd-thumb vazio">sem foto</span>') +
      '<input id="ct-foto" type="file" accept="image/*">' +
      (cat && cat.imagem ? '<button class="btn-line btn-mini" id="ct-foto-del" type="button">Remover foto</button>' : '') +
      '</div>' +
      '<p class="muted" style="font-size:12px;margin:4px 0 0;">Opcional. Sem foto, a loja usa o ícone padrão.</p>' +
      '<p class="muted" style="font-size:12px;margin:2px 0 0;">📐 Para caber perfeitamente no círculo, use uma imagem <b>quadrada (proporção 1:1)</b> — ideal 480×480 px (mínimo 240×240 px). Ela é exibida recortada num círculo de 120 px.</p></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="ct-canc">Cancelar</button>' +
      '<button class="btn-orange" id="ct-ok">' + (novo ? 'Criar' : 'Salvar') + '</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.querySelector('#ct-canc').addEventListener('click', fechar);
    var ctFotoDel = document.getElementById('ct-foto-del');
    if (ctFotoDel) ctFotoDel.addEventListener('click', function () {
      ctFotoDel.disabled = true;
      FG.removerImagemCategoria(cat.id).then(function (r) {
        if (r && r.ok === false) { FG.toast(r.msg || 'Falha ao remover a foto.', 'erro'); ctFotoDel.disabled = false; return; }
        FG.toast('Foto removida.'); fechar(); renderProdutos();
      });
    });
    back.querySelector('#ct-ok').addEventListener('click', function () {
      var nome = document.getElementById('ct-nome').value.trim();
      if (!nome) { FG.toast('Informe o nome da categoria.', 'erro'); return; }
      var btn = document.getElementById('ct-ok'); btn.disabled = true;
      var prom = novo
        ? FG.apiCriarCategoria({ nome: nome, pai: document.getElementById('ct-pai').value })
        : FG.apiEditarCategoria(cat.id, { nome: nome });
      prom.then(function (r) {
        if (r && r.ok === false) { btn.disabled = false; FG.toast(r.msg || 'Não foi possível salvar.', 'erro'); return; }
        // Foto: em categoria nova o código só existe após criar (r.id); na
        // edição usa o código atual. Sem arquivo escolhido, não faz upload.
        var arquivo = document.getElementById('ct-foto').files[0];
        var codigo = novo ? r.id : cat.id;
        var fotoOk = (arquivo && codigo) ? FG.uploadImagemCategoria(codigo, arquivo) : Promise.resolve({ ok: true });
        return fotoOk.then(function (rf) {
          btn.disabled = false;
          if (rf && rf.ok === false) FG.toast((novo ? 'Categoria criada' : 'Categoria salva') + ', mas a foto falhou: ' + (rf.msg || ''), 'erro');
          else FG.toast(novo ? 'Categoria criada.' : 'Categoria atualizada.');
          fechar(); renderProdutos();
        });
      });
    });
  }

  function modalProduto(p) {
    var novo = !p;
    // Produto do Tiny: nome, preço, estoque, descrição e foto são espelho do
    // ERP — ficam travados aqui. Só categoria e previsão continuam editáveis.
    var tiny = !!(p && p.tinyAtivo);
    var trava = tiny ? ' disabled' : '';
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (novo ? 'Novo produto' : 'Editar ' + p.artigo) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      (tiny
        ? '<div class="adm-banner">🔒 Este produto é gerenciado pelo <b>Tiny ERP</b>: nome, preço, estoque, descrição e foto ' +
          'são atualizados automaticamente. Para alterar, edite no Tiny. Aqui só categoria e previsão de chegada.' +
          (p.tinySincronizadoEm ? '<br><span class="muted">Última sincronização: ' + FG.fmtDateTime(p.tinySincronizadoEm) + '</span>' : '') +
          '</div>'
        : '') +
      '<div class="field"><label>Número do artigo</label><input id="mp-art" type="text"' + (novo ? '' : ' disabled') + ' value="' + (p ? p.artigo : '') + '"></div>' +
      '<div class="field"><label>Nome</label><input id="mp-nome" type="text"' + trava + ' value="' + (p ? esc(p.nome) : '') + '"></div>' +
      '<div class="field"><label>Categoria</label><select id="mp-cat">' +
      FG.categoriasTopo().map(function (c) {
        var opt = '<option value="' + c.id + '"' + (p && p.cat === c.id ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
        FG.subcategorias(c.id).forEach(function (s) {
          opt += '<option value="' + s.id + '"' + (p && p.cat === s.id ? ' selected' : '') + '>&nbsp;&nbsp;↳ ' + esc(s.nome) + '</option>';
        });
        return opt;
      }).join('') + '</select></div>' +
      '<div class="field"><label>Preço (R$)</label><input id="mp-preco" type="number" step="0.01" min="0"' + trava + ' value="' + (p ? p.preco : '') + '"></div>' +
      '<div class="field"><label>Estoque</label><input id="mp-est" type="number" min="0"' + trava + ' value="' + (p ? p.estoque : 0) + '"></div>' +
      '<div class="field"><label>Previsão de chegada (se sem estoque)</label><input id="mp-prev" type="text" placeholder="dd/mm/aa" value="' + (p && p.previsao ? p.previsao : '') + '"></div>' +
      '<div class="field"><label>Descrição</label><textarea id="mp-desc" rows="3"' + trava + '>' + (p ? esc(p.descricao) : '') + '</textarea></div>' +
      '<div class="field"><label>Foto da peça (miniatura no Parts Finder)</label>' +
      '<div class="fnd-foto-row">' +
      (p ? fotoProduto(p) : '<span class="fnd-thumb vazio">sem foto</span>') +
      '<input id="mp-foto" type="file" accept="image/*"' + trava + '>' +
      (p && p.imagem && !tiny ? '<button class="btn-line btn-mini" id="mp-foto-del" type="button">Remover foto</button>' : '') +
      '</div></div>' +
      // Log de sincronização DESTE produto (saiu da tela Tiny ERP para cá,
      // junto do cadastro — só aparece em produtos gerenciados pelo Tiny).
      (tiny ? '<div class="field"><label>Sincronizações com o Tiny (últimas)</label>' +
        '<div id="mp-tiny-log" class="muted" style="font-size:12px;">Carregando…</div></div>' : '') +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="mp-canc">Cancelar</button>' +
      '<button class="btn-orange" id="mp-ok">Salvar</button></div></div>';
    document.body.appendChild(back);

    if (tiny) {
      FG.tinyLog(p.artigo, 15).then(function (rows) {
        var el = document.getElementById('mp-tiny-log');
        if (!el) return;
        el.innerHTML = rows.length
          ? '<table class="tbl"><thead><tr><th>Data</th><th>Evento</th><th>Status</th><th>Mensagem</th></tr></thead><tbody>' +
            rows.map(function (l) {
              var cls = l.status === 'ok' ? 'aprovado' : l.status === 'erro' ? 'bloqueado' : 'Aguardando';
              return '<tr><td>' + FG.fmtDateTime(l.data) + '</td><td>' + esc(l.evento) + '</td>' +
                '<td><span class="pill-status ' + cls + '">' + esc(l.status) + '</span></td>' +
                '<td>' + esc(l.mensagem || '') + '</td></tr>';
            }).join('') + '</tbody></table>'
          : 'Nenhuma sincronização registrada ainda.';
      }, function () {
        var el = document.getElementById('mp-tiny-log');
        if (el) el.textContent = 'Não foi possível carregar o log.';
      });
    }

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('mp-canc').addEventListener('click', fechar);
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).

    var mpFotoDel = document.getElementById('mp-foto-del');
    if (mpFotoDel) mpFotoDel.addEventListener('click', function () {
      FG.removerImagemProduto(p.artigo).then(function (r) {
        if (r && r.ok === false) { FG.toast(r.msg || 'Falha ao remover a foto.', 'erro'); return; }
        FG.toast('Foto removida.'); fechar(); renderProdutos();
      });
    });

    document.getElementById('mp-ok').addEventListener('click', function () {
      var art = document.getElementById('mp-art').value.trim().toUpperCase();
      var nome = document.getElementById('mp-nome').value.trim();
      var preco = Number(document.getElementById('mp-preco').value);
      if (!art || !nome || !(preco >= 0)) { FG.toast('Preencha artigo, nome e preço.'); return; }
      var prods = FG.all('products');
      if (novo && prods.some(function (x) { return x.artigo === art; })) { FG.toast('Já existe um produto com este artigo.'); return; }
      var dados = {
        artigo: art, nome: nome,
        cat: document.getElementById('mp-cat').value,
        preco: preco,
        estoque: Math.max(0, Number(document.getElementById('mp-est').value) || 0),
        previsao: document.getElementById('mp-prev').value.trim() || null,
        descricao: document.getElementById('mp-desc').value.trim()
      };
      function fail(e) { FG.toast((e && e.message) || 'Falha ao salvar o produto.', 'erro'); }
      var acao = novo ? FG.apiCriarProduto(dados) : FG.apiEditarProduto(art, dados);
      acao.then(function () {
        var arquivo = document.getElementById('mp-foto').files[0];
        var fotoOk = arquivo ? FG.uploadImagemProduto(art, arquivo) : Promise.resolve({ ok: true });
        return fotoOk.then(function (rf) {
          if (rf && rf.ok === false) FG.toast('Produto salvo, mas a foto falhou: ' + (rf.msg || ''), 'erro');
          else FG.toast(novo ? 'Produto criado.' : 'Produto salvo.');
          fechar(); renderProdutos();
        });
      }).catch(fail);
    });
  }

  /* =========================================================
     PEDIDOS
     ========================================================= */
  // 'Parcial' (parte das peças já saiu) entra no FILTRO, mas não no seletor de
  // status: ele é consequência do envio — quem o define é o "Confirmar envio".
  var STATUS = ['Pendente', 'Em separação', 'Parcial', 'Enviado', 'Entregue', 'Cancelado'];
  var STATUS_ESCOLHIVEIS = STATUS.filter(function (s) { return s !== 'Parcial'; });
  // Status terminais: uma vez aqui, o pedido não pode mais mudar de status.
  var STATUS_TERMINAIS = ['Entregue', 'Cancelado'];

  // Status de cada peça do pedido (a partir de qtd/qtdEnviada/backorder):
  // Enviado (tudo), Parcial (parte), Pré-venda (backorder não enviado),
  // Pendente (normal não enviado). Não altera o status do pedido em si.
  function itemStatus(it) {
    if (it.qtdEnviada >= it.qtd) return { cls: 'Enviado', txt: 'Enviado' };
    if (it.qtdEnviada > 0) return { cls: 'Parcial', txt: 'Parcial ' + it.qtdEnviada + '/' + it.qtd };
    if (it.backorder) return { cls: 'PreVenda', txt: 'Pré-venda' };
    return { cls: 'Pendente', txt: 'Pendente' };
  }

  // Bolinha de status da peça — as MESMAS cores do portal do cliente:
  // verde=enviado, amarelo=parcial, cinza=não enviado, vermelho=cancelado.
  function dotItem(it, cancelado) {
    if (cancelado) return '<span class="item-dot dot-cancelado" title="Cancelado"></span>';
    var cls = it.qtdEnviada >= it.qtd ? 'dot-ok' : (it.qtdEnviada > 0 ? 'dot-parcial' : 'dot-pendente');
    return '<span class="item-dot ' + cls + '" title="' + itemStatus(it).txt + '"></span>';
  }

  var LEGENDA_DOTS =
    '<div class="dot-legenda"><strong>Legenda do status:</strong>' +
    '<span><span class="item-dot dot-ok"></span>Enviado — quantidade completa despachada</span>' +
    '<span><span class="item-dot dot-parcial"></span>Parcial — parte da quantidade já saiu</span>' +
    '<span><span class="item-dot dot-pendente"></span>Não enviado — aguardando separação/estoque</span>' +
    '<span><span class="item-dot dot-cancelado"></span>Cancelado — o pedido foi cancelado</span>' +
    '</div>';

  // Linha de uma peça no detalhe da venda. `ped` é o pedido dono da linha;
  // `editavel` libera o controle de quantidade enviada (pedido não terminal).
  function linhaItemVenda(it, ped, editavel) {
    var st = itemStatus(it);
    var cancelado = ped.status === 'Cancelado';
    // O controle por peça grava direto em PedidoItem.QuantidadeEnviada. Em
    // peça de pré-venda, aumentar consome estoque de verdade (a API recusa se
    // não houver) — por isso o campo é numérico e não um "Enviar" cego.
    var ctrl = editavel
      ? '<input type="number" class="it-qtd" data-item="' + it.itemId + '" min="0" max="' + it.qtd +
          '" value="' + it.qtdEnviada + '" style="width:62px;">' +
        '<button class="btn-line btn-mini it-save" data-ped="' + esc(ped.id) + '" data-item="' + it.itemId +
          '" data-qtd="' + it.qtd + '">Salvar</button>' +
        (it.qtdEnviada < it.qtd
          ? '<button class="btn-line btn-mini it-tudo" data-ped="' + esc(ped.id) + '" data-item="' + it.itemId +
            '" data-qtd="' + it.qtd + '">Tudo</button>' : '')
      : '<span class="muted">—</span>';
    return '<tr><td>' + dotItem(it, cancelado) + '</td>' +
      '<td>' + esc(it.artigo) + '</td><td>' + esc(it.nome) + '</td>' +
      '<td class="r">' + it.qtd + '</td><td class="r">' + it.qtdEnviada + '</td>' +
      '<td class="r">' + FG.fmtMoney(it.preco) + '</td>' +
      '<td><span class="pill-status ' + st.cls + '">' + esc(st.txt) + '</span></td>' +
      '<td class="it-ctrl">' + ctrl + '</td></tr>';
  }

  // Grupo de peças (cabeçalho + linhas) dentro do detalhe — separa "Em estoque"
  // das peças em "Pré-venda". Retorna '' quando o grupo está vazio.
  function grupoItens(titulo, itens, ped, editavel) {
    if (!itens.length) return '';
    return '<tr class="venda-grp"><td colspan="8">' + esc(titulo) + ' (' + itens.length + ')</td></tr>' +
      itens.map(function (it) { return linhaItemVenda(it, ped, editavel); }).join('');
  }

  // Pill do status de UMA exportação de pedido ao Tiny.
  function tinyPillExport(st) {
    var cls = st === 'enviado' ? 'aprovado' : st === 'erro' ? 'bloqueado' : 'Aguardando';
    var rot = st === 'enviado' ? 'Exportado' : st === 'erro' ? 'Erro' : st === 'cancelado' ? 'Cancelado' : 'Pendente';
    return '<span class="pill-status ' + cls + '">' + rot + '</span>';
  }

  // Bloco "Tiny ERP" dentro do detalhe da venda: exportações DESTE pedido
  // (saiu da tela Tiny ERP para cá). Carregado ao expandir o detalhe.
  function carregarTinyVenda(box, numeroPedido) {
    FG.tinyPedidos(numeroPedido).then(function (rows) {
      if (!rows.length) { box.innerHTML = ''; return; }
      box.innerHTML =
        '<div style="font-weight:600;margin:10px 0 4px;">Exportação ao Tiny ERP</div>' +
        '<table class="tbl"><thead><tr><th>Data</th><th>Escopo</th><th>Nº no Tiny</th>' +
        '<th>Status</th><th>Detalhe</th><th></th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td>' + FG.fmtDateTime(x.criadoEm) + '</td>' +
            '<td>' + (x.escopo === 'backorder' ? 'Pré-venda' : 'Normal') + '</td>' +
            '<td class="muted">' + esc(x.tinyNumero || '—') + '</td>' +
            '<td>' + tinyPillExport(x.status) + '</td>' +
            '<td class="muted" style="max-width:260px;">' + esc(x.erro || '') + '</td>' +
            '<td>' + (x.status === 'erro'
              ? '<button class="btn-line btn-mini ty-ped-re" data-id="' + x.id + '">Reexportar</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
      Array.prototype.forEach.call(box.querySelectorAll('.ty-ped-re'), function (b) {
        b.addEventListener('click', function () {
          b.disabled = true; b.textContent = 'Reexportando…';
          FG.tinyReexportar(b.getAttribute('data-id')).then(function (r) {
            FG.toast(r.ok !== false && r.status === 'enviado'
              ? 'Pedido exportado ao Tiny.' : (r.msg || 'Ainda com erro — veja o detalhe.'),
              r.status === 'enviado' ? undefined : 'erro');
            carregarTinyVenda(box, numeroPedido);
          });
        });
      });
    }, function () { box.innerHTML = ''; });
  }

  // Bloco de detalhe (cliente + data + peças com status, separadas entre
  // "Em estoque" e "Pré-venda") que abre sob o pedido.
  function detalheVenda(o) {
    var pg = o.progresso || { enviada: 0, qtd: 0, pct: 0 };
    var emEstoque = o.itens.filter(function (it) { return !it.backorder; });
    var preVenda = o.itens.filter(function (it) { return it.backorder; });
    // Pedido entregue ou cancelado está fechado: as peças não mudam mais.
    var editavel = STATUS_TERMINAIS.indexOf(o.status) < 0;
    // Peças marcadas como enviadas que ainda NÃO foram para o Tiny: é o que a
    // próxima remessa leva. Pré-venda fica de fora (tem fluxo próprio).
    var aConfirmar = emEstoque.reduce(function (s, it) {
      return s + Math.max(0, (it.qtdEnviada || 0) - (it.qtdExportada || 0));
    }, 0);
    return '<div class="venda-det">' +
      (editavel && aConfirmar
        ? '<div class="adm-banner"><b>' + aConfirmar + ' peça(s)</b> marcadas como enviadas e ainda não confirmadas. ' +
          'Confirmar fecha a remessa e envia ao Tiny <b>somente essas peças</b>; se ainda faltar peça, ' +
          'o pedido fica como <b>Parcial</b> e a fatura segue em aberto. ' +
          '<button class="btn-orange btn-mini vd-remessa" data-ped="' + esc(o.id) + '" style="margin-left:8px;">Confirmar envio</button></div>'
        : '') +
      '<div class="venda-meta">' +
      '<div><span class="muted">Cliente</span><br><b>' + esc(o.empresa) + '</b><br><span class="muted">' + esc(o.usuario) + '</span></div>' +
      '<div><span class="muted">Data da compra</span><br><b>' + FG.fmtDateTime(o.data) + '</b></div>' +
      '<div><span class="muted">Pedido</span><br><b>' + esc(o.id) + '</b></div>' +
      '<div><span class="muted">Envio</span><br><b>' + pg.enviada + '/' + pg.qtd + '</b> peças (' + pg.pct + '%)</div>' +
      '</div>' +
      '<table class="tbl"><thead><tr><th title="Status de envio da peça">Status</th>' +
      '<th>Artigo</th><th>Peça</th><th class="r">Qtd.</th>' +
      '<th class="r">Enviada</th><th class="r">Preço un.</th><th>Status da peça</th>' +
      '<th>Controle de envio</th></tr></thead><tbody>' +
      grupoItens('Em estoque', emEstoque, o, editavel) +
      grupoItens('Pré-venda', preVenda, o, editavel) +
      '</tbody></table>' + LEGENDA_DOTS +
      (editavel
        ? '<p class="muted" style="font-size:12px;margin:4px 0 0;">Ajuste a quantidade já despachada de cada peça, clique em <b>Salvar</b> ' +
          'e, quando a remessa estiver fechada, em <b>Confirmar envio</b> — é ele que manda as peças ao Tiny. ' +
          'Em peça de pré-venda, aumentar dá baixa no estoque de verdade e já vai ao Tiny na hora (fluxo próprio).</p>'
        : '<p class="muted" style="font-size:12px;margin:4px 0 0;">Pedido ' + esc(o.status.toLowerCase()) +
          ' — as peças não podem mais ser alteradas.</p>') +
      '<div class="tiny-venda" data-ped="' + esc(o.id) + '"></div></div>';
  }

  // Quais detalhes estão abertos (por número de pedido). Salvar uma peça
  // re-renderiza a tela inteira — sem isto, o detalhe fecharia a cada clique.
  var pedAbertos = {};

  function renderPedidos() {
    h1.textContent = 'Gestão de pedidos'; setOn('pedidos');
    var todos = FG.all('orders');
    var f = filtros.pedidos;
    var orders = todos.filter(function (o) {
      if (f.status === 'garantia' ? !o.garantia : (f.status && o.status !== f.status)) return false;
      // A busca alcança também os artigos/peças do pedido, não só o cabeçalho.
      var pecas = o.itens.map(function (it) { return it.artigo + ' ' + it.nome; }).join(' ');
      return casaBusca('pedidos', [o.id, o.empresa, o.usuario, pecas]);
    });
    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Pedidos (' + contagem('pedidos', orders.length, todos.length) + ')</div><div class="c-body">' +
      barraFiltro('pedidos', [
        { k: 'status', rotulo: 'Status', opcoes: STATUS.map(function (s) { return [s, s]; }).concat([['garantia', 'Só garantias']]) }
      ], 'Buscar por nº do pedido, empresa, e-mail ou peça') +
      '<table class="tbl"><thead><tr><th>Pedido</th><th>Empresa</th><th>Data</th>' +
      '<th class="r">Total</th><th>Status</th><th></th></tr></thead><tbody>' +
      (orders.length ? orders.map(function (o, i) {
        return '<tr><td><b>' + esc(o.id) + '</b>' +
          (o.garantia ? '<br><span class="pill-status Garantia">Garantia</span>' : '') + '</td>' +
          '<td>' + esc(o.empresa) + '<br><span class="muted">' + esc(o.usuario) + '</span></td>' +
          '<td>' + FG.fmtDateTime(o.data) + '</td>' +
          '<td class="r">' + FG.fmtMoney(o.total) + '</td>' +
          '<td>' + pill(o.status) +
          (STATUS_TERMINAIS.indexOf(o.status) >= 0
            ? '<br><span class="muted" style="font-size:11px;">Pedido ' + esc(o.status.toLowerCase()) + ' — status final.</span>'
            : '<br><select class="inline-status" data-id="' + o.id + '" style="margin-top:6px;">' +
              // Pedido em 'Parcial' mostra o próprio status como opção travada:
              // dali ele sai enviando o restante, não pelo seletor.
              (STATUS_ESCOLHIVEIS.indexOf(o.status) < 0
                ? '<option selected disabled>' + esc(o.status) + '</option>' : '') +
              STATUS_ESCOLHIVEIS.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
              '</select>') +
          '</td>' +
          '<td><button class="btn-line btn-mini od-open" data-i="' + i + '" data-ped="' + esc(o.id) + '">' +
          (pedAbertos[o.id] ? 'Detalhes ▴' : 'Detalhes ▾') + '</button></td></tr>' +
          '<tr class="venda-row' + (pedAbertos[o.id] ? '' : ' hidden') + '" data-i="' + i + '">' +
          '<td colspan="6">' + detalheVenda(o) + '</td></tr>';
      }).join('') : vazioFiltro(6, 'Nenhum pedido com esse filtro.')) + '</tbody></table></div></div>';

    bindFiltro(renderPedidos);

    // Exportações ao Tiny: carrega ao expandir (e já nos detalhes reabertos).
    function carregarTinySeAberto(row) {
      var tv = row.querySelector('.tiny-venda');
      if (tv && !tv.getAttribute('data-ok')) {
        tv.setAttribute('data-ok', '1');
        carregarTinyVenda(tv, tv.getAttribute('data-ped'));
      }
    }

    Array.prototype.forEach.call(view.querySelectorAll('.od-open'), function (b) {
      var row = view.querySelector('.venda-row[data-i="' + b.getAttribute('data-i') + '"]');
      if (pedAbertos[b.getAttribute('data-ped')]) carregarTinySeAberto(row);
      b.addEventListener('click', function () {
        var aberto = row.classList.toggle('hidden') === false;
        pedAbertos[b.getAttribute('data-ped')] = aberto;
        b.textContent = aberto ? 'Detalhes ▴' : 'Detalhes ▾';
        if (aberto) carregarTinySeAberto(row);
      });
    });

    /* ---- controle por peça: grava QuantidadeEnviada de um item ---- */
    async function salvarItem(b, forcado) {
      var max = Number(b.getAttribute('data-qtd'));
      var item = b.getAttribute('data-item');
      var inp = view.querySelector('.it-qtd[data-item="' + item + '"]');
      var qtd = forcado != null ? forcado : Number(inp.value);
      if (!isFinite(qtd) || qtd % 1 !== 0 || qtd < 0 || qtd > max) {
        FG.toast('Quantidade inválida — informe um número inteiro de 0 a ' + max + '.', 'erro');
        inp.value = inp.defaultValue; return;
      }
      b.disabled = true;
      var r = await FG.setItemEnviado(b.getAttribute('data-ped'), item, qtd);
      b.disabled = false;
      if (r && r.ok === false) {
        // Motivo mais comum: estoque insuficiente p/ liberar peça de pré-venda.
        FG.toast(r.msg || 'Não foi possível gravar o envio dessa peça.', 'erro');
        inp.value = inp.defaultValue; return;
      }
      FG.toast('Envio da peça atualizado.');
      renderPedidos();   // pedAbertos mantém o detalhe aberto
    }
    /* ---- fecha a remessa: só aqui o pedido vai ao Tiny ---- */
    Array.prototype.forEach.call(view.querySelectorAll('.vd-remessa'), function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true;
        var r = await FG.confirmarRemessa(b.getAttribute('data-ped'));
        b.disabled = false;
        if (r && r.ok === false) { FG.toast(r.msg || 'Não foi possível confirmar o envio.', 'erro'); return; }
        var n = (r.itens || []).reduce(function (s, i) { return s + i.qtd; }, 0);
        FG.toast(n + ' peça(s) enviadas' + (r.parcial ? ' — pedido Parcial, fatura segue em aberto.' : ' — pedido concluído.'));
        renderPedidos();
      });
    });

    Array.prototype.forEach.call(view.querySelectorAll('.it-save'), function (b) {
      b.addEventListener('click', function () { salvarItem(b, null); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.it-tudo'), function (b) {
      b.addEventListener('click', function () { salvarItem(b, Number(b.getAttribute('data-qtd'))); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('select.inline-status'), function (sel) {
      sel.addEventListener('change', async function () {
        var res = await FG.setOrderStatus(sel.getAttribute('data-id'), sel.value);
        if (res && res.ok === false) {
          FG.toast(res.msg || 'Não foi possível mudar o status.', 'erro');
        } else {
          FG.toast('Status atualizado.');
        }
        renderPedidos();
      });
    });
  }

  /* =========================================================
     REIVINDICAÇÕES
     ========================================================= */
  // "Esboço" não existe no admin — é só do cliente (rascunho no navegador).
  var CL_STATUS = ['Em processo', 'Aprovada', 'Recusada'];
  // Filtro do painel (mantido entre re-renders).
  var clFiltroStatus = '';   // '' = todos
  var clBusca = '';

  function renderClaims() {
    h1.textContent = 'Gestão de reivindicações'; setOn('reivindicacoes');
    var todas = FG.all('claims');
    var termo = clBusca.trim().toLowerCase();
    var claims = todas.filter(function (c) {
      if (clFiltroStatus && c.status !== clFiltroStatus) return false;
      if (termo) {
        if (String(c.id || '').toLowerCase().indexOf(termo) < 0 &&
            String(c.criador || '').toLowerCase().indexOf(termo) < 0 &&
            String(c.niv || '').toLowerCase().indexOf(termo) < 0 &&
            String(c.numeroPedido || '').toLowerCase().indexOf(termo) < 0) return false;
      }
      return true;
    });
    var filtrando = !!(clFiltroStatus || termo);

    // Tabela enxuta (só identificação). Detalhes + ações no modal ao clicar.
    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Reivindicações (' + claims.length +
        (filtrando ? ' de ' + todas.length : '') + ')</div><div class="c-body">' +
      '<div class="shop-tools" style="margin:0 0 14px;">' +
      '<label style="font-size:12px;">Status: <select id="cl-status">' +
        '<option value="">Todos</option>' +
        CL_STATUS.map(function (s) { return '<option value="' + s + '"' + (clFiltroStatus === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></label>' +
      '<input id="cl-busca" type="text" placeholder="Buscar por nº, criador ou NIV" value="' + esc(clBusca) + '" ' +
        'style="flex:1;min-width:200px;padding:6px 10px;border:1px solid #ccc;border-radius:4px;">' +
      (filtrando ? '<button class="btn-line btn-mini" id="cl-limpar">Limpar filtro</button>' : '') +
      '</div>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px;">Clique numa reivindicação para ver os detalhes e agir.</p>' +
      '<table class="tbl"><thead><tr><th>N° da reivindicação</th><th>Data</th><th>Criador</th><th>Tipo</th><th>Status</th><th>Aprovada em</th></tr></thead><tbody>' +
      (claims.length ? claims.map(function (c) {
        return '<tr class="adm-claim-row' + (c.reenviada ? ' tr-reenviada' : '') + '" data-id="' + esc(c.id) + '">' +
          '<td><b class="cl-num">' + c.id + '</b></td>' +
          '<td>' + FG.fmtDate(c.data) + '</td>' +
          '<td>' + esc(c.criador) + '</td>' +
          '<td>' + (c.origem === 'varejo'
            ? '<span class="pill-status Tiny">Varejo</span> <span class="muted">' + esc(c.numeroPedido || '') + '</span>'
            : c.origem === 'preentrega'
              ? '<span class="pill-status ps-preentrega">Pré-entrega</span>'
              : esc(c.tipo)) + '</td>' +
          '<td>' + pill(c.status) +
          (c.reenviada ? ' <span class="pill-status Reenviada">↩ Devolvida pelo revendedor</span>' : '') +
          (c.sentBack ? ' <span class="pill-status Devolvida">↩ Devolvida</span>' : '') +
          '</td>' +
          '<td>' + (c.dataAprovacao ? FG.fmtDate(c.dataAprovacao) : '<span class="muted">—</span>') + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="6" class="muted">Nenhuma reivindicação' + (filtrando ? ' com esse filtro' : '') + '.</td></tr>') +
      '</tbody></table></div></div>';

    document.getElementById('cl-status').addEventListener('change', function () { clFiltroStatus = this.value; renderClaims(); });
    var bx = document.getElementById('cl-busca');
    bx.addEventListener('input', function () {
      clBusca = this.value; renderClaims();
      var n = document.getElementById('cl-busca');
      if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    });
    var lp = document.getElementById('cl-limpar');
    if (lp) lp.addEventListener('click', function () { clFiltroStatus = ''; clBusca = ''; renderClaims(); });

    Array.prototype.forEach.call(view.querySelectorAll('.adm-claim-row'), function (row) {
      row.addEventListener('click', function () {
        var c = FG.all('claims').find(function (x) { return x.id === row.getAttribute('data-id'); });
        if (c) modalClaimAdmin(c);
      });
    });
  }

  // Modal de detalhe da reivindicação (admin): todas as infos + ações.
  function modalClaimAdmin(c) {
    var CL = ['Em processo', 'Aprovada', 'Recusada'];
    var term = c.status === 'Aprovada' || c.status === 'Recusada';
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

    var acoes = term
      ? '<div class="muted">Status final (' + esc(c.status) + ') — não pode mais mudar.</div>'
      : '<label style="font-size:12px;margin-right:4px;">Definir status:</label>' +
        '<select id="ad-status">' + CL.map(function (s) { return '<option' + (s === c.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select> ' +
        '<button class="btn-orange btn-mini" id="ad-aplicar">Aplicar</button> ' +
        '<button class="btn-line btn-mini" id="ad-devolver">Devolver ao revendedor</button>';

    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Reivindicação ' + esc(c.id) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      (c.reenviada ? '<div class="reenviada-aviso">↩ Devolvida pelo revendedor — revisar' + (c.atualizadoEm ? ' (em ' + FG.fmtDateTime(c.atualizadoEm) + ')' : '') + '</div>' : '') +
      (c.sentBack ? '<div class="devolvida-aviso">↩ Devolvida ao revendedor — aguardando. Falta: ' + esc(c.faltaInformacao || '—') + '</div>' : '') +
      (c.status === 'Aprovada' ? '<div class="det-credito">✔ Aprovada — pedido de garantia criado para repor a(s) peça(s) sem cobrança' +
        (c.valorGarantia ? ' (valor de referência: ' + FG.fmtMoney(c.valorGarantia) + ')' : '') + '. Acompanhe na área de pedidos.</div>' : '') +
      '<div class="det-grid">' +
      linha('N° da reivindicação', '<b class="cl-num">' + esc(c.id) + '</b>') +
      linha('Status', esc(c.status)) +
      (c.origem === 'varejo'
        ? linha('Origem', 'Varejo (peça de pedido)') +
          linha('Pedido', '<a href="#pedido/' + esc(c.numeroPedido) + '">' + esc(c.numeroPedido) + '</a>') +
          linha('Criador', esc(c.criador || '—')) +
          linha('Data da reivindicação', FG.fmtDateTime(c.data)) +
          (c.dataAprovacao ? linha('Data de aprovação', FG.fmtDateTime(c.dataAprovacao)) : '')
        : c.origem === 'preentrega'
          // Defeito achado na inspeção, com a moto ainda no estoque: não há
          // uso (horas/km) e a data é a da inspeção. A garantia do comprador
          // segue sem começar — ela só conta a partir da venda.
          ? linha('Origem', 'Pré-entrega (moto ainda no estoque)') +
            linha('NIV', esc(c.niv || '—')) +
            linha('Criador', esc(c.criador || '—')) +
            linha('Data da reivindicação', FG.fmtDateTime(c.data)) +
            (c.dataAprovacao ? linha('Data de aprovação', FG.fmtDateTime(c.dataAprovacao)) : '') +
            linha('Data da inspeção', c.dataDefeito ? FG.fmtDate(c.dataDefeito) : '—')
          : linha('Tipo', esc(c.tipo)) +
            linha('NIV', esc(c.niv || '—')) +
            linha('Criador', esc(c.criador || '—')) +
            linha('Data da reivindicação', FG.fmtDateTime(c.data)) +
            (c.dataAprovacao ? linha('Data de aprovação', FG.fmtDateTime(c.dataAprovacao)) : '') +
            linha('Data do ocorrido', c.dataDefeito ? FG.fmtDate(c.dataDefeito) : '—') +
            linha('Uso', uso.length ? uso.join(' / ') : '—')) +
      '</div>' +
      '<div class="field"><label>Peça(s) defeituosa(s)</label><div class="pecas-list">' + pecas + '</div></div>' +
      '<div class="field"><label>Descrição</label><div class="cell-value">' + esc(c.descricao || '—') + '</div></div>' +
      '<div class="field"><label>Fotos e vídeos</label>' + fotos + '</div>' +
      '</div>' +
      '<div class="modal-foot" style="flex-wrap:wrap;gap:8px;">' +
      '<div style="margin-right:auto;">' + acoes + '</div>' +
      '<button class="btn-line" id="ad-fechar">Fechar</button></div></div>';
    document.body.appendChild(back);
    FG.carregarArquivos(back);       // busca as fotos/vídeos protegidos

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('ad-fechar').addEventListener('click', fechar);
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).

    if (!term) {
      document.getElementById('ad-aplicar').addEventListener('click', async function () {
        var novo = document.getElementById('ad-status').value;
        if (novo === c.status) { FG.toast('Selecione um status diferente.'); return; }
        if ((novo === 'Aprovada' || novo === 'Recusada') &&
          !confirm('Definir como "' + novo + '"? Esse status é FINAL e não poderá ser alterado' +
            (novo === 'Aprovada' ? ' (cria um pedido de garantia repondo as peças, sem cobrança)' : '') + '.')) return;
        var r = await FG.setClaimStatus(c.id, novo);
        if (r && r.ok === false) return;
        fechar();
        FG.toast(r && r.pedidoGarantia
          ? 'Garantia aprovada — pedido de reposição ' + r.pedidoGarantia + ' criado.'
          : 'Status atualizado.');
        renderClaims();
      });
      document.getElementById('ad-devolver').addEventListener('click', function () { fechar(); modalDevolver(c.id); });
    }
  }

  // Modal para devolver ao revendedor com o que falta (obrigatório).
  function modalDevolver(numero) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Devolver ao revendedor</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">Descreva o que falta para o revendedor completar e reenviar a reivindicação ' + esc(numero) + '.</p>' +
      '<div class="field"><label>Falta de informação *</label>' +
      '<textarea id="dv-falta" rows="4" placeholder="Ex.: fotos da peça pelo lado interno, horímetro atual, nota fiscal..."></textarea></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="dv-canc">Cancelar</button>' +
      '<button class="btn-orange" id="dv-ok">Devolver</button></div></div>';
    document.body.appendChild(back);
    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('dv-canc').addEventListener('click', fechar);
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).
    document.getElementById('dv-ok').addEventListener('click', async function () {
      var falta = document.getElementById('dv-falta').value.trim();
      if (!falta) { FG.toast('Descreva o que falta antes de devolver.', 'erro'); return; }
      var r = await FG.devolverClaim(numero, falta);
      if (r && r.ok === false) return;
      fechar();
      FG.toast('Reivindicação devolvida ao revendedor.');
      renderClaims();
    });
  }

  /* =========================================================
     PRÉ-VENDA — rastreador de peças a enviar (sem valor; cobrança é a
     fatura do pedido). Agrupado por cliente; cada peça tem ação "Enviado"
     quando o produto volta ao estoque.
     ========================================================= */
  function pvStatusPill(it) {
    if (it.status === 'Disponivel') return '<span class="pill-status Disponivel">Disponível p/ envio</span>';
    // Aguardando: estoque insuficiente para a quantidade pendente. Mostra o
    // estoque atual quando há algo (parcial) para deixar claro o porquê.
    var detalhe = it.estoque > 0
      ? ' · estoque ' + it.estoque + '/' + it.pendente
      : (it.previsao ? ' · ' + esc(it.previsao) : '');
    return '<span class="pill-status Aguardando">Aguardando reposição' + detalhe + '</span>';
  }

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  // Chave ordenável do mês ("2026-07") e o rótulo humano ("Julho de 2026").
  function mesChave(iso) {
    if (!iso) return '0000-00';
    var d = new Date(iso);
    return d.getFullYear() + '-' + FG.pad(d.getMonth() + 1, 2);
  }
  function mesRotulo(chave) {
    if (chave === '0000-00') return 'Sem data';
    var p = chave.split('-');
    var nome = MESES[Number(p[1]) - 1] || '';
    return nome.charAt(0).toUpperCase() + nome.slice(1) + ' de ' + p[0];
  }

  function renderPreVenda() {
    h1.textContent = 'Pré-venda — peças a enviar'; setOn('prevenda');
    var todos = FG.all('prevenda');
    if (!todos.length) {
      view.innerHTML = '<div class="adm-card"><div class="c-body muted">' +
        'Nenhuma peça em pré-venda pendente. Elas aparecem aqui quando um pedido inclui ' +
        'itens sem estoque, e podem ser marcadas como enviadas quando o produto for reposto.</div></div>';
      return;
    }
    var f = filtros.prevenda;
    var itens = todos.filter(function (it) {
      if (f.status && it.status !== f.status) return false;
      return casaBusca('prevenda', [it.artigo, it.nome, it.empresa, it.pedido]);
    });

    // Bloco de uma empresa (cabeçalho + tabela das peças dela).
    function blocoEmpresa(emp, lista) {
      var linhas = lista.map(function (it) {
        var acao = it.status === 'Disponivel'
          ? '<button class="btn-orange btn-mini pv-enviar" data-ped="' + esc(it.pedido) + '" data-item="' + it.itemId + '" data-qtd="' + it.qtd + '">Liberar envio</button>'
          : '<span class="muted" style="font-size:11px;">' + (it.estoque > 0 ? 'estoque insuficiente (' + it.estoque + '/' + it.pendente + ')' : 'sem estoque') + '</span>';
        return '<tr><td>' + esc(it.artigo) + '</td><td>' + esc(it.nome) + '</td>' +
          '<td class="r">' + it.pendente + '</td>' +
          '<td>' + (it.data ? FG.fmtDate(it.data) : '—') + '</td>' +
          '<td><a href="#pedidos" title="Ver em Vendas">' + esc(it.pedido) + '</a></td>' +
          '<td>' + pvStatusPill(it) + '</td><td>' + acao + '</td></tr>';
      }).join('');
      return '<div class="venda-det"><div style="font-weight:600;margin:6px 0 2px;">' + esc(emp) + '</div>' +
        '<table class="tbl"><thead><tr><th>Artigo</th><th>Peça</th><th class="r">Qtd.</th>' +
        '<th>Data do pedido</th><th>Pedido de origem</th><th>Status</th><th>Ação</th></tr></thead><tbody>' +
        linhas + '</tbody></table></div>';
    }

    function porEmpresa(lista) {
      var g = {};
      lista.forEach(function (it) { (g[it.empresa] = g[it.empresa] || []).push(it); });
      return Object.keys(g).map(function (emp) { return blocoEmpresa(emp, g[emp]); }).join('');
    }

    // Quando a fila de pré-venda atravessa mais de um mês, ela é quebrada por
    // mês (do mais recente para o mais antigo) — senão a lista vira um bolo só
    // e some a noção de quanto tempo a peça está esperando. Um mês só: direto
    // por empresa, como sempre foi.
    var meses = {};
    itens.forEach(function (it) { (meses[mesChave(it.data)] = meses[mesChave(it.data)] || []).push(it); });
    var chaves = Object.keys(meses).sort().reverse();
    var mesAtual = mesChave(new Date().toISOString());

    var corpo;
    if (!itens.length) {
      corpo = '<p class="muted">Nenhuma peça com esse filtro.</p>';
    } else if (chaves.length <= 1) {
      corpo = porEmpresa(itens);
    } else {
      corpo = chaves.map(function (ch) {
        var atrasado = ch < mesAtual && ch !== '0000-00';
        return '<div class="pv-mes' + (atrasado ? ' atrasado' : '') + '">' +
          '<div class="pv-mes-head">' + esc(mesRotulo(ch)) +
          ' <span class="muted">(' + meses[ch].length + ' peça' + (meses[ch].length > 1 ? 's' : '') + ')</span>' +
          (atrasado ? '<span class="pv-atraso">aguardando desde ' + esc(mesRotulo(ch).toLowerCase()) + '</span>' : '') +
          '</div>' + porEmpresa(meses[ch]) + '</div>';
      }).join('');
    }

    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Peças a enviar — pré-venda (' +
      contagem('prevenda', itens.length, todos.length) + ')</div>' +
      '<div class="c-body">' +
      barraFiltro('prevenda', [
        { k: 'status', rotulo: 'Situação', opcoes: [['Disponivel', 'Disponível p/ envio'], ['Aguardando', 'Aguardando reposição']] }
      ], 'Buscar por artigo, peça, empresa ou pedido') +
      corpo + '</div></div>';

    bindFiltro(renderPreVenda);
    Array.prototype.forEach.call(view.querySelectorAll('.pv-enviar'), function (b) {
      b.addEventListener('click', async function () {
        var r = await FG.setItemEnviado(b.getAttribute('data-ped'), b.getAttribute('data-item'), Number(b.getAttribute('data-qtd')));
        if (r && r.ok === false) FG.toast(r.msg || 'Não foi possível liberar a peça.', 'erro');
        else FG.toast('Peça liberada para separação — confirme o envio no pedido quando sair.');
        renderPreVenda();
      });
    });
  }

  /* =========================================================
     PARTS FINDER — modelos, seções, peças e hotspots
     ---------------------------------------------------------
     Três níveis: #finder (modelos) → #finder/modelo/<código>
     (seções por lado) → #finder/secao/<id> (peças da lista +
     editor visual de áreas clicáveis sobre o diagrama).
     ========================================================= */
  var FND_LADOS = [['chassi', 'Frame (chassi)'], ['engine', 'Engine (motor)']];

  function fndErro(r, msg) {
    if (r && r.ok === false) { FG.toast(r.msg || msg || 'Operação não concluída.', 'erro'); return true; }
    return false;
  }
  function fndCrumb(itens) {
    return '<div class="fnd-crumbs">' + itens.map(function (it, i) {
      var ultimo = i === itens.length - 1;
      return ultimo ? '<b>' + esc(it[0]) + '</b>'
        : '<a href="' + it[1] + '">' + esc(it[0]) + '</a> <span>›</span> ';
    }).join('') + '</div>';
  }
  function thumbCell(url, alt) {
    return url
      ? '<img class="fnd-thumb" src="' + esc(url) + '" alt="' + esc(alt || '') + '">'
      : '<span class="fnd-thumb vazio">sem foto</span>';
  }

  /* ---------- nível 1: modelos ---------- */
  function renderFinderModelos() {
    h1.textContent = 'Parts Finder — modelos'; setOn('finder');
    view.innerHTML = '<div class="adm-card"><div class="c-body muted">Carregando…</div></div>';
    var vigente = telaVigente();
    FG.finderModelos(true).then(function (modelos) {
      if (!vigente()) return;
      view.innerHTML =
        '<div class="adm-bar"><span class="muted" style="font-size:13px;">Tudo que aparece no finder do cliente é editado aqui: ' +
        'modelos e árvore de seleção, seções (diagramas), peças de cada seção e áreas clicáveis da imagem.</span>' +
        '<span class="grow"></span><button class="btn-orange" id="fm-novo">Novo modelo</button></div>' +
        '<div class="adm-card"><div class="c-head">Modelos (' + modelos.length + ')</div><div class="c-body">' +
        '<table class="tbl"><thead><tr><th>Foto</th><th>Código</th><th>Modelo</th><th>Etiqueta (label)</th>' +
        '<th>Árvore de seleção</th><th>Situação</th><th>Ações</th></tr></thead><tbody>' +
        (modelos.length ? modelos.map(function (m) {
          return '<tr><td>' + thumbCell(m.imagem, m.nome) + '</td>' +
            '<td><span class="muted">' + esc(m.id) + '</span></td>' +
            '<td><b>' + esc(m.nome) + '</b> ' + m.ano + '</td>' +
            '<td>' + esc(m.label) + '</td>' +
            '<td class="fnd-arvore">' + esc((m.arvore || []).join(' › ')) + '</td>' +
            '<td>' + (m.ativo
              ? '<span class="pill-status aprovado">Ativo</span>'
              : '<span class="pill-status bloqueado">Inativo</span>') + '</td>' +
            '<td class="nowrap">' +
            '<a class="btn-line btn-mini" href="#finder/modelo/' + encodeURIComponent(m.id) + '">Seções</a> ' +
            '<button class="btn-line btn-mini" data-ac="edit" data-id="' + esc(m.id) + '">Editar</button> ' +
            '<button class="btn-line btn-mini" data-ac="del" data-id="' + esc(m.id) + '">Excluir</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="muted">Nenhum modelo. Crie o primeiro.</td></tr>') +
        '</tbody></table></div></div>';

      document.getElementById('fm-novo').addEventListener('click', function () { modalModelo(null, modelos); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ac]'), function (b) {
        b.addEventListener('click', function () {
          var m = modelos.find(function (x) { return x.id === b.getAttribute('data-id'); });
          if (!m) return;
          if (b.getAttribute('data-ac') === 'edit') { modalModelo(m, modelos); return; }
          if (!confirm('Excluir o modelo ' + m.label + '?\nSeções, peças e áreas do diagrama serão apagadas juntas.')) return;
          FG.finderExcluirModelo(m.id).then(function (r) {
            if (fndErro(r, 'Falha ao excluir.')) return;
            FG.toast('Modelo excluído.'); renderFinderModelos();
          });
        });
      });
    }, function (e) {
      if (!vigente()) return;
      view.innerHTML = '<div class="adm-card"><div class="c-body">Erro ao carregar: ' + esc(e.message || '') + '</div></div>';
    });
  }

  // Código do modelo = nome + ano ("FG 125", 2025 → "fg125-2025"). Espelho de
  // slugModelo em api/src/utils/modelo-moto.js, só para a prévia do modal —
  // quem grava o código é a API.
  function slugModelo(nome, ano) {
    var base = String(nome || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!base) return '';
    var sufixo = '-' + String(ano || '').trim();
    return base.slice(0, 40 - sufixo.length).replace(/-+$/, '') + sufixo;
  }

  // `modelos` é a lista já carregada: alimenta as sugestões de marca,
  // modalidade e categoria, para a árvore não se partir em "Enduro" e "enduro".
  function modalModelo(m, modelos) {
    var novo = !m;
    function val(campo, padrao) { return m && m[campo] ? esc(m[campo]) : (padrao || ''); }
    function campoAc(id, rotulo, campo, ph, padrao) {
      return '<div class="field"><label for="' + id + '">' + rotulo + ' *</label>' +
        '<div class="ac-wrap"><input id="' + id + '" type="text" maxlength="' + (campo === 'categoria' ? 40 : 60) + '"' +
        ' placeholder="' + ph + '" autocomplete="off" value="' + val(campo, padrao) + '">' +
        '<div class="ac-list hidden" id="' + id + '-ac"></div></div></div>';
    }
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (novo ? 'Novo modelo' : 'Editar ' + esc(m.label)) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;font-size:12px;">A árvore de seleção do finder é montada com ' +
      '<b>Marca › Modalidade › Categoria › Nome › Ano</b>. O código sai do nome e do ano, e muda junto quando você edita.</p>' +
      '<div class="fnd-2col">' +
      campoAc('fm-marca', 'Marca', 'marca', 'Fullgas', 'Fullgas') +
      campoAc('fm-modal', 'Modalidade', 'modalidade', 'Off-road', 'Off-road') +
      '</div>' +
      '<div class="fnd-2col">' +
      campoAc('fm-cat', 'Categoria', 'categoria', 'Enduro, Cross-country…') +
      '<div class="field"><label>Situação</label><select id="fm-ativo">' +
      '<option value="1"' + (!m || m.ativo ? ' selected' : '') + '>Ativo (aparece no finder)</option>' +
      '<option value="0"' + (m && !m.ativo ? ' selected' : '') + '>Inativo (oculto)</option></select></div>' +
      '</div>' +
      '<div class="fnd-2col">' +
      '<div class="field"><label for="fm-nome">Nome da moto *</label><input id="fm-nome" type="text" maxlength="80" placeholder="FG 125" value="' + val('nome') + '"></div>' +
      '<div class="field"><label for="fm-ano">Ano *</label><input id="fm-ano" type="number" min="1990" max="2100" value="' + (m ? m.ano : new Date().getFullYear()) + '"></div>' +
      '</div>' +
      '<div class="fnd-previa">' +
      '<div><span class="rot">Árvore de seleção</span><b id="fm-prev-arv"></b></div>' +
      '<div><span class="rot">Código</span><code id="fm-prev-cod"></code>' +
      (novo ? '' : ' <small id="fm-prev-muda" class="hidden">muda ao salvar — era <code>' + esc(m.id) + '</code></small>') +
      '</div></div>' +
      '<div class="field"><label for="fm-label">Etiqueta (label mostrado no finder)</label>' +
      '<input id="fm-label" type="text" placeholder="FG 125 2025 &lt;2025&gt;&lt;BR&gt;&lt;F0103Y1&gt;" value="' + (m ? esc(m.label) : '') + '"></div>' +
      '<div class="fnd-2col">' +
      '<div class="field"><label for="fm-cil">Cilindrada <span class="muted">(fora da árvore)</span></label><input id="fm-cil" type="text" placeholder="125" value="' + val('cilindrada') + '"></div>' +
      '<div class="field"><label for="fm-tm">Tipo de motor <span class="muted">(fora da árvore)</span></label><input id="fm-tm" type="text" placeholder="2 tempos" value="' + val('tipoMotor') + '"></div>' +
      '</div>' +
      '<div class="field"><label>Documentação técnica (link http)</label>' +
      '<input id="fm-doc" type="url" placeholder="https://..." value="' + val('docTecnica') + '"></div>' +
      '<div class="field"><label>Foto do modelo (botão "Show Image" do finder)</label>' +
      '<div class="fnd-foto-row">' + thumbCell(m && m.imagem, 'foto') +
      '<input id="fm-foto" type="file" accept="image/*">' +
      (m && m.imagem ? '<button class="btn-line btn-mini" id="fm-foto-del" type="button">Remover foto</button>' : '') +
      '</div></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="fm-canc">Cancelar</button>' +
      '<button class="btn-orange" id="fm-ok">Salvar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('fm-canc').addEventListener('click', fechar);
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).

    function ler(id) { return document.getElementById(id).value.trim(); }

    // Prévia ao vivo: o admin vê a árvore e o código antes de salvar.
    function atualizarPrevia() {
      var niveis = [ler('fm-marca') || 'Fullgas', ler('fm-modal') || 'Off-road',
        ler('fm-cat'), ler('fm-nome'), ler('fm-ano')];
      document.getElementById('fm-prev-arv').innerHTML = niveis.map(function (n) {
        return n ? esc(n) : '<i class="muted">?</i>';
      }).join(' <span class="muted">›</span> ');
      var cod = slugModelo(ler('fm-nome'), ler('fm-ano'));
      document.getElementById('fm-prev-cod').textContent = cod || '—';
      var muda = document.getElementById('fm-prev-muda');
      if (muda) muda.classList.toggle('hidden', !cod || cod === m.id);
    }
    ['fm-marca', 'fm-modal', 'fm-cat', 'fm-nome', 'fm-ano'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', atualizarPrevia);
    });
    atualizarPrevia();

    // Sugestões com os valores já usados em outros modelos.
    [['fm-marca', 'marca'], ['fm-modal', 'modalidade'], ['fm-cat', 'categoria']].forEach(function (par) {
      FG.bindAutocomplete(par[0], function (termo) {
        var t = termo.toLowerCase(), vistos = {};
        return (modelos || []).map(function (x) { return x[par[1]]; }).filter(function (v) {
          if (!v || vistos[v.toLowerCase()] || v.toLowerCase().indexOf(t) === -1) return false;
          vistos[v.toLowerCase()] = true;
          return true;
        }).sort().map(function (v) { return { id: v, label: v }; });
      }, atualizarPrevia);
    });

    var btnDel = document.getElementById('fm-foto-del');
    if (btnDel) btnDel.addEventListener('click', function () {
      FG.finderRemoverImagemModelo(m.id).then(function (r) {
        if (fndErro(r, 'Falha ao remover a foto.')) return;
        FG.toast('Foto removida.'); fechar(); renderFinderModelos();
      });
    });

    document.getElementById('fm-ok').addEventListener('click', function () {
      var dados = {
        marca: ler('fm-marca'),
        modalidade: ler('fm-modal'),
        categoria: ler('fm-cat'),
        nome: ler('fm-nome'),
        ano: Number(ler('fm-ano')),
        label: ler('fm-label'),
        cilindrada: ler('fm-cil'),
        tipoMotor: ler('fm-tm'),
        docTecnica: ler('fm-doc'),
        ativo: document.getElementById('fm-ativo').value === '1'
      };
      if (!dados.categoria || !dados.nome || !dados.ano) { FG.toast('Preencha categoria, nome e ano.', 'erro'); return; }
      var btn = document.getElementById('fm-ok');
      btn.disabled = true;
      var salvar = novo ? FG.finderCriarModelo(dados) : FG.finderEditarModelo(m.id, dados);
      salvar.then(function (r) {
        if (fndErro(r, 'Falha ao salvar o modelo.')) { btn.disabled = false; return; }
        // O código pode ter mudado (renomeou o modelo): segue o que a API devolveu.
        var codigo = r.id;
        var arquivo = document.getElementById('fm-foto').files[0];
        var fotoOk = arquivo
          ? FG.finderUploadImagemModelo(codigo, arquivo)
          : Promise.resolve({ ok: true });
        fotoOk.then(function (rf) {
          if (rf.ok === false) FG.toast('Modelo salvo, mas a foto falhou: ' + (rf.msg || ''), 'erro');
          else FG.toast(novo ? 'Modelo criado.' : 'Modelo salvo.' +
            (codigo !== m.id ? ' Novo código: ' + codigo + '.' : ''));
          fechar(); renderFinderModelos();
        });
      });
    });
  }

  /* ---------- nível 2: seções (diagramas) de um modelo ---------- */
  function renderFinderModelo(codigo, ladoAtivo) {
    setOn('finder');
    view.innerHTML = '<div class="adm-card"><div class="c-body muted">Carregando…</div></div>';
    var vigente = telaVigente();
    FG.finderModelo(codigo).then(function (m) {
      if (!vigente()) return;
      h1.textContent = 'Parts Finder — ' + m.label;
      var lado = ladoAtivo === 'engine' ? 'engine' : 'chassi';
      var secoes = m[lado] || [];

      view.innerHTML =
        fndCrumb([['Modelos', '#finder'], [m.label]]) +
        '<div class="adm-bar">' +
        '<div class="fnd-tabs">' + FND_LADOS.map(function (l) {
          return '<button class="' + (l[0] === lado ? 'on' : '') + '" data-lado="' + l[0] + '">' + l[1] +
            ' (' + ((m[l[0]] || []).length) + ')</button>';
        }).join('') + '</div>' +
        '<span class="grow"></span>' +
        '<a class="btn-line" href="/finder#/modelo/' + encodeURIComponent(m.id) + '/' + lado + '" target="_blank" rel="noopener">Ver no finder ↗</a> ' +
        '<button class="btn-orange" id="fs-nova">Nova seção</button></div>' +
        '<div class="adm-card"><div class="c-head">Seções — ' + (lado === 'engine' ? 'Engine (motor)' : 'Frame (chassi)') + '</div><div class="c-body">' +
        '<table class="tbl"><thead><tr><th>Diagrama</th><th>Nº</th><th>Nome</th><th class="r">Peças</th>' +
        '<th>Posição</th><th>Ações</th></tr></thead><tbody>' +
        (secoes.length ? secoes.map(function (s, i) {
          return '<tr><td>' + thumbCell(s.imagem, s.nome) + '</td>' +
            '<td>' + esc(s.numero) + '</td><td><b>' + esc(s.nome) + '</b></td>' +
            '<td class="r">' + (s.qtdPecas || 0) + '</td>' +
            '<td class="nowrap"><button class="btn-line btn-mini" data-mv="-1" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button> ' +
            '<button class="btn-line btn-mini" data-mv="1" data-i="' + i + '"' + (i === secoes.length - 1 ? ' disabled' : '') + '>▼</button></td>' +
            '<td class="nowrap"><a class="btn-orange btn-mini" href="#finder/secao/' + s.id + '">Peças e imagem</a> ' +
            '<button class="btn-line btn-mini" data-ed="' + s.id + '">Editar</button> ' +
            '<button class="btn-line btn-mini" data-del="' + s.id + '">Excluir</button></td></tr>';
        }).join('') : '<tr><td colspan="6" class="muted">Nenhuma seção neste lado ainda.</td></tr>') +
        '</tbody></table></div></div>';

      Array.prototype.forEach.call(view.querySelectorAll('.fnd-tabs button'), function (b) {
        b.addEventListener('click', function () { renderFinderModelo(codigo, b.getAttribute('data-lado')); });
      });
      document.getElementById('fs-nova').addEventListener('click', function () { modalSecao(m, lado); });

      Array.prototype.forEach.call(view.querySelectorAll('[data-mv]'), function (b) {
        b.addEventListener('click', function () {
          var i = Number(b.getAttribute('data-i'));
          var j = i + Number(b.getAttribute('data-mv'));
          if (j < 0 || j >= secoes.length) return;
          var ids = secoes.map(function (s) { return s.id; });
          var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
          FG.finderOrdemSecoes(m.id, lado, ids).then(function (r) {
            if (fndErro(r, 'Falha ao reordenar.')) return;
            renderFinderModelo(codigo, lado);
          });
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ed]'), function (b) {
        b.addEventListener('click', function () {
          var s = secoes.find(function (x) { return String(x.id) === b.getAttribute('data-ed'); });
          if (s) modalSecao(m, lado, s);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var s = secoes.find(function (x) { return String(x.id) === b.getAttribute('data-del'); });
          if (!s) return;
          if (!confirm('Excluir a seção "' + s.numero + ' ' + s.nome + '"?\nAs peças e áreas do diagrama vão junto.')) return;
          FG.finderExcluirSecao(s.id).then(function (r) {
            if (fndErro(r, 'Falha ao excluir.')) return;
            FG.toast('Seção excluída.'); renderFinderModelo(codigo, lado);
          });
        });
      });
    }, function () {
      if (!vigente()) return;
      view.innerHTML = '<div class="adm-card"><div class="c-body">Modelo não encontrado. <a href="#finder">Voltar</a></div></div>';
    });
  }

  function modalSecao(m, lado, s) {
    var novo = !s;
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (novo ? 'Nova seção — ' + esc(m.label) : 'Editar seção') + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Lado</label><select id="se-lado"' + (novo ? '' : ' disabled') + '>' +
      FND_LADOS.map(function (l) {
        return '<option value="' + l[0] + '"' + (l[0] === lado ? ' selected' : '') + '>' + l[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="fnd-2col">' +
      '<div class="field"><label>Número (ex.: 01) *</label><input id="se-num" type="text" maxlength="8" value="' + (s ? esc(s.numero) : '') + '"></div>' +
      '<div class="field"><label>Nome *</label><input id="se-nome" type="text" placeholder="FRONT FORK, TRIPLE CLAMP" value="' + (s ? esc(s.nome) : '') + '"></div>' +
      '</div>' +
      '<p class="muted" style="font-size:12px;">A imagem do diagrama e as peças são editadas em "Peças e imagem" depois de criar a seção.</p>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="se-canc">Cancelar</button>' +
      '<button class="btn-orange" id="se-ok">Salvar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('se-canc').addEventListener('click', fechar);
    // Clicar fora NÃO fecha — pop-ups só fecham no X (pedido do dono).

    document.getElementById('se-ok').addEventListener('click', function () {
      var dados = {
        lado: document.getElementById('se-lado').value,
        numero: document.getElementById('se-num').value.trim(),
        nome: document.getElementById('se-nome').value.trim()
      };
      if (!dados.numero || !dados.nome) { FG.toast('Preencha número e nome.'); return; }
      var salvar = novo ? FG.finderCriarSecao(m.id, dados)
        : FG.finderEditarSecao(s.id, { numero: dados.numero, nome: dados.nome });
      salvar.then(function (r) {
        if (fndErro(r, 'Falha ao salvar a seção.')) return;
        FG.toast(novo ? 'Seção criada.' : 'Seção salva.');
        fechar(); renderFinderModelo(m.id, dados.lado);
      });
    });
  }

  /* ---------- nível 3: peças da seção + editor de hotspots ---------- */
  function renderFinderSecao(secaoId) {
    setOn('finder');
    view.innerHTML = '<div class="adm-card"><div class="c-body muted">Carregando…</div></div>';
    var vigente = telaVigente();
    FG.finderSecao(secaoId).then(function (sec) {
      if (!vigente()) return;
      h1.textContent = 'Parts Finder — ' + sec.numero + ' ' + sec.nome;

      view.innerHTML =
        fndCrumb([['Modelos', '#finder'],
          [sec.modelo.label, '#finder/modelo/' + encodeURIComponent(sec.modelo.id)],
          [sec.numero + ' ' + sec.nome]]) +
        '<div class="adm-bar"><span class="muted" style="font-size:13px;">Lado: <b>' +
        (sec.lado === 'engine' ? 'Engine (motor)' : 'Frame (chassi)') + '</b></span><span class="grow"></span>' +
        '<a class="btn-line" href="/finder#/secao/' + sec.id + '" target="_blank" rel="noopener">Ver no finder ↗</a></div>' +

        /* ---- peças da seção: tabela no topo, largura cheia ---- */
        '<div class="adm-card"><div class="c-head">Peças desta seção (' + sec.pecas.length + ')</div><div class="c-body">' +
        '<div class="fnd-add-row"><input id="fp-sku" list="fp-skus" type="text" placeholder="Código do artigo (SKU) — ex.: A46001094000FB">' +
        '<datalist id="fp-skus">' + FG.all('products').map(function (p) {
          return '<option value="' + esc(p.artigo) + '">' + esc(p.nome) + '</option>';
        }).join('') + '</datalist>' +
        '<button class="btn-orange btn-mini" id="fp-add">Adicionar peça</button>' +
        '<span class="muted" style="font-size:12px;">A peça precisa existir no Catálogo. A miniatura vem da foto do produto.</span></div>' +
        '<table class="tbl fnd-itens"><thead><tr><th>ID</th><th>Miniatura</th><th>Nome</th><th>Status</th><th>Situação</th><th>Cód.</th>' +
        '<th class="r">Preço</th><th>Qtd. padrão</th><th>Number on Image</th><th>Qtd. no conjunto</th><th>Posição</th><th>Ações</th></tr></thead>' +
        '<tbody id="fp-tbody"></tbody></table>' +
        '</div></div>' +

        /* ---- diagrama à ESQUERDA + áreas clicáveis à DIREITA com rolagem
                própria — espelho invertido do que o cliente vê no finder ---- */
        '<div class="adm-card"><div class="c-head">Imagem do diagrama e áreas clicáveis</div><div class="c-body">' +
        '<div class="fnd-add-row">' +
        '<input id="hi-file" type="file" accept="image/*">' +
        '<button class="btn-line btn-mini" id="hi-up">' + (sec.imagem ? 'Trocar imagem' : 'Enviar imagem') + '</button>' +
        (sec.imagem ? '<button class="btn-line btn-mini" id="hi-del">Remover imagem</button>' : '') +
        '<span class="grow"></span>' +
        (sec.imagem ? '<button class="btn-orange" id="ha-save">Salvar áreas clicáveis</button>' : '') +
        '</div>' +
        (sec.imagem
          ? '<p class="muted" style="font-size:12px;margin:8px 0;">Clique na imagem para criar uma área; arraste para posicionar. ' +
            'O <b>Link Number</b> deve casar com o "Number on Image" das peças — clicar na área seleciona essas peças no finder do cliente.</p>' +
            '<div class="ha-2col">' +
            '<div class="ha-wrap">' +
            '<div class="ha-tools">' +
            '<button class="dg-btn" id="ha-reset" type="button" title="Ajustar à tela">⟳</button>' +
            '<button class="dg-btn" id="ha-nums" type="button" title="Mostrar/ocultar os números das áreas">#</button>' +
            '<span class="grow"></span>' +
            '<input type="range" id="ha-zoom" min="0.1" max="1.6" step="0.05" value="0.6">' +
            '<span class="dg-marks">0.1&nbsp;&nbsp;0.6&nbsp;&nbsp;1.1&nbsp;&nbsp;1.6</span>' +
            '</div>' +
            '<div class="ha-view" id="ha-view"><div class="ha-canvas" id="ha-canvas"><img id="ha-img" src="' + esc(sec.imagem) + '" alt="diagrama" draggable="false"></div></div>' +
            '</div>' +
            '<div class="ha-side">' +
            '<div class="ha-list-head"><span></span><span>#</span><span>Clickable Area (px)</span><span>Link Number</span><span></span></div>' +
            '<div id="ha-list" class="ha-scroll"></div>' +
            '</div></div>'
          : '<p class="muted">Envie a imagem do diagrama explodido para poder marcar as áreas clicáveis.</p>') +
        '</div></div>';

      /* ----- tabela de peças (linhas com edição inline) ----- */
      var tbody = document.getElementById('fp-tbody');

      // Mesmo princípio de cores da loja: verde = em estoque, amarelo =
      // pré-venda (com previsão), vermelho = indisponível para compra.
      function statusPecaAdm(p) {
        if (p.estoque > 0) return '<span class="fnde-status ok">● Em estoque (' + p.estoque + ')</span>';
        if (p.previsao) return '<span class="fnde-status pre">● Pré-venda · ' + esc(p.previsao) + '</span>';
        return '<span class="fnde-status out">● Indisponível</span>';
      }

      function linhasPecas() {
        tbody.innerHTML = sec.pecas.length ? sec.pecas.map(function (p, i) {
          return '<tr data-id="' + p.id + '">' +
            '<td class="muted">' + p.id + '</td>' +
            '<td>' + thumbCell(p.imagem, p.nome) + '</td>' +
            '<td><b>' + esc(p.nome) + '</b></td>' +
            '<td>' + statusPecaAdm(p) + '</td>' +
            '<td><label class="fnd-hab"><input type="checkbox" class="fi-at"' + (p.ativo ? ' checked' : '') + '> Habilitar</label></td>' +
            '<td>' + esc(p.sku) + '</td>' +
            '<td class="r">' + FG.fmtMoney(p.preco) + '</td>' +
            '<td><input class="fi-qp fnd-in" type="number" min="0" value="' + p.quantidadePadrao + '"></td>' +
            '<td><input class="fi-num fnd-in" type="text" maxlength="12" value="' + esc(p.numeroImagem) + '"></td>' +
            '<td><input class="fi-qtd fnd-in" type="number" min="1" value="' + p.quantidade + '"></td>' +
            '<td class="nowrap"><button class="btn-line btn-mini" data-mv="-1" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button> ' +
            '<button class="btn-line btn-mini" data-mv="1" data-i="' + i + '"' + (i === sec.pecas.length - 1 ? ' disabled' : '') + '>▼</button></td>' +
            '<td><button class="link-action" data-rm="' + p.id + '">Remover</button></td></tr>';
        }).join('') : '<tr><td colspan="12" class="muted">Nenhuma peça nesta seção. Adicione pela busca acima.</td></tr>';

        Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-id]'), function (tr) {
          var pecaId = Number(tr.getAttribute('data-id'));
          Array.prototype.forEach.call(tr.querySelectorAll('.fi-at,.fi-qp,.fi-num,.fi-qtd'), function (inp) {
            inp.addEventListener('change', function () {
              FG.finderEditarPeca(pecaId, {
                ativo: tr.querySelector('.fi-at').checked,
                quantidadePadrao: Number(tr.querySelector('.fi-qp').value) || 0,
                numeroImagem: tr.querySelector('.fi-num').value.trim(),
                quantidade: Math.max(1, Number(tr.querySelector('.fi-qtd').value) || 1)
              }).then(function (r) {
                if (fndErro(r, 'Falha ao salvar a peça.')) return;
                var p = sec.pecas.find(function (x) { return x.id === pecaId; });
                if (p) {
                  p.ativo = tr.querySelector('.fi-at').checked;
                  p.quantidadePadrao = Number(tr.querySelector('.fi-qp').value) || 0;
                  p.numeroImagem = tr.querySelector('.fi-num').value.trim();
                  p.quantidade = Math.max(1, Number(tr.querySelector('.fi-qtd').value) || 1);
                }
                FG.toast('Peça atualizada.');
              });
            });
          });
        });
        Array.prototype.forEach.call(tbody.querySelectorAll('[data-mv]'), function (b) {
          b.addEventListener('click', function () {
            var i = Number(b.getAttribute('data-i'));
            var j = i + Number(b.getAttribute('data-mv'));
            if (j < 0 || j >= sec.pecas.length) return;
            var t = sec.pecas[i]; sec.pecas[i] = sec.pecas[j]; sec.pecas[j] = t;
            FG.finderOrdemPecas(sec.id, sec.pecas.map(function (p) { return p.id; })).then(function (r) {
              if (fndErro(r, 'Falha ao reordenar.')) return;
              linhasPecas();
            });
          });
        });
        Array.prototype.forEach.call(tbody.querySelectorAll('[data-rm]'), function (b) {
          b.addEventListener('click', function () {
            var pecaId = Number(b.getAttribute('data-rm'));
            var p = sec.pecas.find(function (x) { return x.id === pecaId; });
            if (!confirm('Remover ' + (p ? p.sku : 'a peça') + ' desta seção?')) return;
            FG.finderExcluirPeca(pecaId).then(function (r) {
              if (fndErro(r, 'Falha ao remover.')) return;
              sec.pecas = sec.pecas.filter(function (x) { return x.id !== pecaId; });
              FG.toast('Peça removida.'); linhasPecas();
            });
          });
        });
      }
      linhasPecas();

      document.getElementById('fp-add').addEventListener('click', function () {
        var sku = document.getElementById('fp-sku').value.trim().toUpperCase();
        if (!sku) { FG.toast('Informe o SKU da peça.'); return; }
        FG.finderAddPeca(sec.id, { sku: sku }).then(function (r) {
          if (fndErro(r, 'Falha ao adicionar (o SKU existe no catálogo?).')) return;
          FG.toast('Peça adicionada.');
          renderFinderSecao(secaoId); // recarrega com a nova linha
        });
      });

      /* ----- upload / remoção da imagem do diagrama ----- */
      document.getElementById('hi-up').addEventListener('click', function () {
        var f = document.getElementById('hi-file').files[0];
        if (!f) { FG.toast('Escolha o arquivo de imagem primeiro.'); return; }
        FG.finderUploadImagemSecao(sec.id, f).then(function (r) {
          if (fndErro(r, 'Falha no upload.')) return;
          FG.toast('Imagem do diagrama salva.');
          renderFinderSecao(secaoId);
        });
      });
      var hiDel = document.getElementById('hi-del');
      if (hiDel) hiDel.addEventListener('click', function () {
        if (!confirm('Remover a imagem do diagrama? As áreas clicáveis continuam salvas.')) return;
        FG.finderRemoverImagemSecao(sec.id).then(function (r) {
          if (fndErro(r, 'Falha ao remover.')) return;
          FG.toast('Imagem removida.'); renderFinderSecao(secaoId);
        });
      });

      /* ----- editor visual de hotspots ----- */
      if (!sec.imagem) return;
      var canvas = document.getElementById('ha-canvas');
      var img = document.getElementById('ha-img');
      var lista = document.getElementById('ha-list');
      var viewport = document.getElementById('ha-view');
      var slider = document.getElementById('ha-zoom');
      var natW = 0, natH = 0;
      var hs = sec.hotspots.map(function (h) {
        return { x: h.x, y: h.y, w: h.w, h: h.h, texto: h.texto || '', linkNumero: h.linkNumero || '' };
      });
      // Preferência do admin (lembrada entre seções): mostrar ou não o número
      // de POSIÇÃO nas áreas do diagrama. É só um apoio visual da montagem — o
      // cliente nunca vê esses números.
      var NUM_KEY = 'fullgas_finder_ha_nums';
      var mostrarNums = localStorage.getItem(NUM_KEY) !== '0';

      // Zoom igual ao finder do cliente: o slider define a largura do canvas
      // (natW*z); a imagem ocupa 100% do canvas e as caixas se posicionam em %,
      // então tudo escala junto. escala() usa img.clientWidth (que já reflete o
      // zoom), logo os cliques/arrastos continuam corretos em qualquer nível.
      function escala() { return natW / (img.clientWidth || 1); }

      function aplicarZoom(z) {
        if (!natW) return;
        slider.value = z;
        canvas.style.width = Math.round(natW * z) + 'px';
      }
      function zoomAjuste() {
        if (!natW) return 0.6;
        var fit = Math.min((viewport.clientWidth - 2) / natW,
                           (viewport.clientHeight - 2) / natH);
        return Math.max(0.1, Math.min(1.6, Math.floor(fit * 20) / 20));
      }

      function boxHTML(h, i) {
        var b = document.createElement('div');
        b.className = 'ha-box';
        b.setAttribute('data-i', i);
        b.style.left = (h.x / natW * 100) + '%';
        b.style.top = (h.y / natH * 100) + '%';
        b.style.width = (h.w / natW * 100) + '%';
        b.style.height = (h.h / natH * 100) + '%';
        // O número da área é a POSIÇÃO na lista (começa em 0), não o Link
        // Number da peça — reordenar a lista renumera as áreas na hora.
        b.innerHTML = '<span>' + i + '</span>';
        return b;
      }

      function desenharBoxes() {
        Array.prototype.forEach.call(canvas.querySelectorAll('.ha-box'), function (el) { el.remove(); });
        canvas.classList.toggle('ha-nonum', !mostrarNums);
        hs.forEach(function (h, i) { canvas.appendChild(boxHTML(h, i)); });
      }

      // O campo "Texto (opcional)" foi removido da interface (nunca é usado);
      // o valor que existir no banco é preservado em hs[i].texto ao salvar.
      // A lista pode ser reordenada arrastando pelo "⠿": mover uma linha
      // reordena o array hs e, como o número da área é a posição, renumera
      // tudo automaticamente (canvas + lista).
      var dragLista = null; // índice da linha sendo arrastada
      function desenharLista() {
        lista.innerHTML = hs.map(function (h, i) {
          return '<div class="ha-row" data-i="' + i + '" draggable="false">' +
            '<span class="ha-grip" title="Arraste para reordenar">⠿</span>' +
            '<span class="muted ha-idx">' + i + '</span>' +
            '<span class="ha-size"><input class="hw" type="number" min="8" value="' + h.w + '"> × ' +
            '<input class="hh" type="number" min="8" value="' + h.h + '"></span>' +
            '<input class="hl" type="text" maxlength="12" placeholder="nº" value="' + esc(h.linkNumero) + '">' +
            '<button class="ha-x" title="Remover área">X</button></div>';
        }).join('') || '<p class="muted" style="font-size:12px;">Nenhuma área ainda — clique na imagem para criar.</p>';

        Array.prototype.forEach.call(lista.querySelectorAll('.ha-row'), function (row) {
          var i = Number(row.getAttribute('data-i'));
          row.querySelector('.hw').addEventListener('change', function (e) { hs[i].w = Math.max(8, Number(e.target.value) || 32); desenharBoxes(); });
          row.querySelector('.hh').addEventListener('change', function (e) { hs[i].h = Math.max(8, Number(e.target.value) || 32); desenharBoxes(); });
          row.querySelector('.hl').addEventListener('input', function (e) { hs[i].linkNumero = e.target.value.trim(); desenharBoxes(); });
          row.querySelector('.ha-x').addEventListener('click', function () {
            hs.splice(i, 1); desenharBoxes(); desenharLista();
          });
          row.addEventListener('mouseenter', function () {
            if (dragLista != null) return;
            var b = canvas.querySelector('.ha-box[data-i="' + i + '"]');
            if (b) b.classList.add('sel');
          });
          row.addEventListener('mouseleave', function () {
            var b = canvas.querySelector('.ha-box[data-i="' + i + '"]');
            if (b) b.classList.remove('sel');
          });

          /* ---- reordenar arrastando (só a partir do "grip") ---- */
          var grip = row.querySelector('.ha-grip');
          grip.addEventListener('mousedown', function () { row.draggable = true; });
          grip.addEventListener('mouseup', function () { row.draggable = false; });
          row.addEventListener('dragstart', function (e) {
            dragLista = i;
            row.classList.add('arrastando');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
          });
          row.addEventListener('dragend', function () {
            row.draggable = false;
            dragLista = null;
            Array.prototype.forEach.call(lista.querySelectorAll('.ha-row'), function (r) {
              r.classList.remove('arrastando', 'drop-alvo');
            });
          });
          row.addEventListener('dragover', function (e) {
            if (dragLista == null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (i !== dragLista) row.classList.add('drop-alvo');
          });
          row.addEventListener('dragleave', function () { row.classList.remove('drop-alvo'); });
          row.addEventListener('drop', function (e) {
            e.preventDefault();
            var alvo = Number(row.getAttribute('data-i'));
            if (dragLista == null || alvo === dragLista) return;
            var movido = hs.splice(dragLista, 1)[0];
            hs.splice(alvo, 0, movido);
            dragLista = null;
            desenharBoxes(); desenharLista();
          });
        });
      }

      /* clique no vazio cria área; arrastar uma caixa move */
      var drag = null;
      canvas.addEventListener('pointerdown', function (e) {
        var box = e.target.closest('.ha-box');
        if (!box) return;
        e.preventDefault();
        var i = Number(box.getAttribute('data-i'));
        drag = { i: i, px: e.clientX, py: e.clientY, x0: hs[i].x, y0: hs[i].y, moveu: false, box: box };
        box.setPointerCapture && box.setPointerCapture(e.pointerId);
      });
      // move/solta ficam no canvas, e não no document: com o setPointerCapture
      // acima, os eventos do arrasto chegam à caixa e sobem até aqui mesmo com
      // o ponteiro fora da imagem. No document, cada abertura desta tela
      // somava mais um par de listeners que nunca saía (e segurava a tela
      // antiga inteira na memória).
      canvas.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var k = escala();
        var nx = Math.round(drag.x0 + (e.clientX - drag.px) * k);
        var ny = Math.round(drag.y0 + (e.clientY - drag.py) * k);
        var h = hs[drag.i];
        h.x = Math.max(0, Math.min(natW - h.w, nx));
        h.y = Math.max(0, Math.min(natH - h.h, ny));
        if (Math.abs(e.clientX - drag.px) + Math.abs(e.clientY - drag.py) > 3) drag.moveu = true;
        drag.box.style.left = (h.x / natW * 100) + '%';
        drag.box.style.top = (h.y / natH * 100) + '%';
      });
      canvas.addEventListener('pointerup', function () { drag = null; });
      canvas.addEventListener('lostpointercapture', function () { drag = null; });

      canvas.addEventListener('click', function (e) {
        if (e.target.closest('.ha-box')) return;   // clique numa caixa não cria outra
        if (!natW) return;
        var r = canvas.getBoundingClientRect();
        var k = escala();
        var cx = Math.round((e.clientX - r.left) * k);
        var cy = Math.round((e.clientY - r.top) * k);
        // A nova área herda o tamanho da última já criada (fica prático manter
        // todas com as mesmas dimensões); 32×32 só quando é a primeira.
        var ult = hs[hs.length - 1];
        var nw = ult ? ult.w : 32, nh = ult ? ult.h : 32;
        var nova = { x: Math.max(0, cx - Math.round(nw / 2)), y: Math.max(0, cy - Math.round(nh / 2)), w: nw, h: nh, texto: '', linkNumero: '' };
        hs.push(nova);
        desenharBoxes(); desenharLista();
        var ultima = lista.querySelector('.ha-row[data-i="' + (hs.length - 1) + '"] .hl');
        if (ultima) ultima.focus();
      });

      document.getElementById('ha-save').addEventListener('click', function () {
        FG.finderSalvarHotspots(sec.id, hs).then(function (r) {
          if (fndErro(r, 'Falha ao salvar as áreas.')) return;
          FG.toast('Áreas clicáveis salvas.');
        });
      });

      function prontoImg() {
        natW = img.naturalWidth || 1; natH = img.naturalHeight || 1;
        aplicarZoom(zoomAjuste());
        desenharBoxes(); desenharLista();
      }
      if (img.complete && img.naturalWidth) prontoImg();
      else img.addEventListener('load', prontoImg);

      slider.addEventListener('input', function () { aplicarZoom(Number(slider.value)); });
      document.getElementById('ha-reset').addEventListener('click', function () { aplicarZoom(zoomAjuste()); });

      var btnNums = document.getElementById('ha-nums');
      btnNums.classList.toggle('on', mostrarNums);
      btnNums.addEventListener('click', function () {
        mostrarNums = !mostrarNums;
        localStorage.setItem(NUM_KEY, mostrarNums ? '1' : '0');
        btnNums.classList.toggle('on', mostrarNums);
        canvas.classList.toggle('ha-nonum', !mostrarNums);
      });
    }, function () {
      if (!vigente()) return;
      view.innerHTML = '<div class="adm-card"><div class="c-body">Seção não encontrada. <a href="#finder">Voltar</a></div></div>';
    });
  }

  /* =========================================================
     TINY ERP — importação, sincronização em lote e log
     ---------------------------------------------------------
     O Tiny é a fonte de verdade dos produtos importados dele.
     Aqui o admin: (1) importa produtos do Tiny para o catálogo,
     (2) força a sincronização em lote dos já importados e
     (3) confere o log (cron / importação / lote).
     ========================================================= */
  var TINY_LOTE = 20; // blocos por requisição — o Tiny limita o ritmo da API

  function tinyPillLocal(st) {
    if (st === 'importado') return '<span class="pill-status aprovado">Já importado</span>';
    if (st === 'sku-existe') return '<span class="pill-status Aguardando">SKU existe — vincula</span>';
    return '<span class="pill-status Pendente">Novo</span>';
  }

  function renderTiny() {
    h1.textContent = 'Integração Tiny ERP'; setOn('tiny');
    view.innerHTML =
      '<div class="adm-bar"><span class="muted" style="font-size:13px;">O Tiny é a fonte de verdade: estoque, preço, nome, ' +
      'descrição e foto dos produtos importados são sempre espelho do ERP — pela sincronização automática agendada na API ' +
      '(node-cron, a cada X minutos, evento "cron" no log) ou pelo botão de sincronizar abaixo.</span></div>' +

      '<div class="adm-card"><div class="c-head">Produtos no Tiny — importação</div><div class="c-body">' +
      '<div class="fnd-add-row">' +
      '<input id="ty-busca" type="text" placeholder="Pesquisar por nome ou código no Tiny">' +
      '<button class="btn-line btn-mini" id="ty-buscar">Buscar</button>' +
      '<span class="grow"></span>' +
      '<label style="font-size:12px;">Categoria p/ novos: <select id="ty-cat">' +
      FG.categoriasTopo().map(function (c) {
        var opt = '<option value="' + c.id + '">' + esc(c.nome) + '</option>';
        FG.subcategorias(c.id).forEach(function (s) { opt += '<option value="' + s.id + '">&nbsp;&nbsp;↳ ' + esc(s.nome) + '</option>'; });
        return opt;
      }).join('') +
      '</select></label>' +
      '<button class="btn-orange btn-mini" id="ty-importar">Importar selecionados</button>' +
      '</div><div id="ty-imp" class="muted">Carregando…</div></div></div>' +

      '<div class="adm-card"><div class="c-head">Produtos sincronizados com o Tiny</div><div class="c-body" id="ty-sync"></div></div>' +

      // O log de sincronização fica no editor de cada produto (Catálogo) e as
      // exportações de pedido ficam no detalhe de cada venda — sem poluir aqui.
      '<div class="adm-bar"><span class="muted" style="font-size:12px;">ℹ O log de sincronização de cada produto está no ' +
      'seu cadastro (Catálogo → editar) e o status de exportação de cada pedido está no detalhe da venda (Pedidos → Detalhes).</span></div>';

    /* ----- importação (lista paginada do Tiny) -----
       A API do Tiny devolve 100 produtos por página; para a visualização não
       ficar gigante, cada página do Tiny vira 5 páginas locais de 20 itens
       (a última página do Tiny já buscada é cacheada — navegar entre as 5
       sub-páginas não repete a consulta). */
    var TINY_POR_PAGINA = 100;
    var IMP_POR_PAGINA = 20;
    var impCache = { pesquisa: null, tinyPagina: 0, dados: null };

    function carregarImportacao(pagina) {
      var box = document.getElementById('ty-imp');
      var pesquisa = document.getElementById('ty-busca').value.trim();
      var subPorTiny = TINY_POR_PAGINA / IMP_POR_PAGINA; // 5
      var tinyPag = Math.floor((pagina - 1) / subPorTiny) + 1;
      var offset = ((pagina - 1) % subPorTiny) * IMP_POR_PAGINA;

      var emCache = impCache.dados && impCache.pesquisa === pesquisa && impCache.tinyPagina === tinyPag;
      if (!emCache) box.innerHTML = '<p class="muted">Consultando o Tiny…</p>';
      var fonte = emCache
        ? Promise.resolve(impCache.dados)
        : FG.tinyProdutos(tinyPag, pesquisa).then(function (r) {
            impCache = { pesquisa: pesquisa, tinyPagina: tinyPag, dados: r };
            return r;
          });

      fonte.then(function (r) {
        if (!box.isConnected) return;   // o admin já saiu da tela do Tiny
        var itens = r.produtos.slice(offset, offset + IMP_POR_PAGINA);
        // Total exato quando estamos na última página do Tiny; senão, estimado
        // (páginas anteriores do Tiny vêm sempre cheias).
        var naUltima = r.pagina >= r.totalPaginas;
        var totalView = r.totalPaginas
          ? (r.totalPaginas - 1) * subPorTiny +
            (naUltima ? Math.max(1, Math.ceil(r.produtos.length / IMP_POR_PAGINA)) : subPorTiny)
          : 1;
        box.innerHTML =
          '<table class="tbl"><thead><tr>' +
          '<th><input type="checkbox" id="ty-todos" title="Selecionar todos"></th>' +
          '<th>ID Tiny</th><th>SKU</th><th>Nome</th><th class="r">Preço</th><th>Situação no Fullgas</th></tr></thead><tbody>' +
          (itens.length ? itens.map(function (p) {
            var pode = p.statusLocal !== 'importado';
            return '<tr><td>' + (pode ? '<input type="checkbox" class="ty-sel" value="' + esc(p.tinyId) + '">' : '') + '</td>' +
              '<td class="muted">' + esc(p.tinyId) + '</td><td>' + esc(p.sku || '—') + '</td><td>' + esc(p.nome) + '</td>' +
              '<td class="r">' + FG.fmtMoney(p.preco) + '</td><td>' + tinyPillLocal(p.statusLocal) + '</td></tr>';
          }).join('') : '<tr><td colspan="6" class="muted">Nada encontrado no Tiny.</td></tr>') +
          '</tbody></table>' +
          '<div class="fnd-add-row" style="margin-top:8px;">' +
          '<button class="btn-line btn-mini" id="ty-ant"' + (pagina <= 1 ? ' disabled' : '') + '>« Anterior</button>' +
          '<span class="muted" style="font-size:12px;">Página ' + pagina + ' de ' + totalView + '</span>' +
          '<button class="btn-line btn-mini" id="ty-prox"' + (pagina >= totalView ? ' disabled' : '') + '>Próxima »</button></div>';

        var todos = document.getElementById('ty-todos');
        if (todos) todos.addEventListener('change', function () {
          Array.prototype.forEach.call(box.querySelectorAll('.ty-sel'), function (c) { c.checked = todos.checked; });
        });
        document.getElementById('ty-ant').addEventListener('click', function () { carregarImportacao(pagina - 1); });
        document.getElementById('ty-prox').addEventListener('click', function () { carregarImportacao(pagina + 1); });
      }, function (e) {
        if (!box.isConnected) return;
        box.innerHTML = '<p class="muted">Erro ao consultar o Tiny: ' + esc((e && e.message) || '') + '</p>';
      });
    }

    document.getElementById('ty-buscar').addEventListener('click', function () { carregarImportacao(1); });
    document.getElementById('ty-busca').addEventListener('keydown', function (e) { if (e.key === 'Enter') carregarImportacao(1); });

    document.getElementById('ty-importar').addEventListener('click', function () {
      var ids = Array.prototype.map.call(view.querySelectorAll('#ty-imp .ty-sel:checked'), function (c) { return c.value; });
      if (!ids.length) { FG.toast('Selecione ao menos um produto do Tiny.'); return; }
      var btn = document.getElementById('ty-importar');
      btn.disabled = true; btn.textContent = 'Importando…';
      FG.tinyImportar(ids, document.getElementById('ty-cat').value).then(function (r) {
        btn.disabled = false; btn.textContent = 'Importar selecionados';
        if (r.ok === false) { FG.toast(r.msg || 'Falha na importação.', 'erro'); return; }
        FG.toast(r.sucesso + ' importado(s)' + (r.erros ? ', ' + r.erros + ' com erro (ver log)' : '') +
          (r.ignorados ? ', ' + r.ignorados + ' já importado(s)' : '') + '.', r.erros ? 'erro' : undefined);
        carregarImportacao(1); desenharSync();
      });
    });

    /* ----- sincronizados (produtos locais com TinyAtivo) ----- */
    function desenharSync() {
      var el = document.getElementById('ty-sync');
      var prods = FG.all('products').filter(function (p) { return p.tinyAtivo; });
      if (!prods.length) {
        el.innerHTML = '<p class="muted">Nenhum produto importado do Tiny ainda. Importe pela lista acima.</p>';
        return;
      }
      el.innerHTML =
        '<div class="fnd-add-row">' +
        '<button class="btn-orange btn-mini" id="ty-sync-sel">Sincronizar selecionados</button>' +
        '<button class="btn-line btn-mini" id="ty-sync-all">Sincronizar todos (' + prods.length + ')</button>' +
        '<span class="muted" style="font-size:12px;" id="ty-sync-msg"></span></div>' +
        '<table class="tbl"><thead><tr>' +
        '<th><input type="checkbox" id="ty-sync-todos" title="Selecionar todos"></th>' +
        '<th>SKU</th><th>Nome</th><th class="r">Preço</th><th class="r">Estoque</th><th>Última sincronização</th></tr></thead><tbody>' +
        prods.map(function (p) {
          return '<tr><td><input type="checkbox" class="ty-sync-sel" value="' + esc(p.artigo) + '"></td>' +
            '<td>' + esc(p.artigo) + '</td><td>' + esc(p.nome) + '</td>' +
            '<td class="r">' + FG.fmtMoney(p.preco) + '</td><td class="r">' + p.estoque + '</td>' +
            '<td>' + (p.tinySincronizadoEm ? FG.fmtDateTime(p.tinySincronizadoEm) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';

      var todos = document.getElementById('ty-sync-todos');
      todos.addEventListener('change', function () {
        Array.prototype.forEach.call(el.querySelectorAll('.ty-sync-sel'), function (c) { c.checked = todos.checked; });
      });

      // Envia em blocos (a API consulta o Tiny produto a produto, e o Tiny
      // limita o ritmo — um catálogo grande leva alguns minutos).
      function sincronizar(skus) {
        var fila = skus.slice();
        var soma = { total: 0, sucesso: 0, erros: 0, ignorados: 0 };
        var msg = document.getElementById('ty-sync-msg');
        var btns = [document.getElementById('ty-sync-sel'), document.getElementById('ty-sync-all')];
        btns.forEach(function (b) { b.disabled = true; });

        function passo() {
          if (!fila.length) {
            FG.toast(soma.sucesso + ' atualizado(s)' + (soma.erros ? ', ' + soma.erros + ' com erro (ver log)' : '') + '.',
              soma.erros ? 'erro' : undefined);
            desenharSync();
            return;
          }
          msg.textContent = 'Sincronizando… ' + (skus.length - fila.length) + '/' + skus.length +
            ' (pode levar alguns minutos)';
          FG.tinySyncLote(fila.splice(0, TINY_LOTE)).then(function (r) {
            if (r.ok === false) {
              btns.forEach(function (b) { b.disabled = false; });
              msg.textContent = '';
              FG.toast(r.msg || 'Falha na sincronização.', 'erro');
              return;
            }
            soma.total += r.total; soma.sucesso += r.sucesso;
            soma.erros += r.erros; soma.ignorados += r.ignorados;
            passo();
          });
        }
        passo();
      }

      document.getElementById('ty-sync-sel').addEventListener('click', function () {
        var skus = Array.prototype.map.call(el.querySelectorAll('.ty-sync-sel:checked'), function (c) { return c.value; });
        if (!skus.length) { FG.toast('Selecione ao menos um produto.'); return; }
        sincronizar(skus);
      });
      document.getElementById('ty-sync-all').addEventListener('click', function () {
        sincronizar(prods.map(function (p) { return p.artigo; }));
      });
    }

    carregarImportacao(1);
    desenharSync();
  }

  /* =========================================================
     SUPORTE TÉCNICO — atendimento dos chamados
     ---------------------------------------------------------
     O outro lado do pop-up flutuante que o revendedor usa no portal. Aqui o
     administrador lê a fila, responde e move o chamado pelos status.

     A lista NÃO passa pelo cache do FG (que carrega junto com a página): ela é
     buscada ao entrar na aba e guardada só em memória, para os filtros
     redesenharem sem ir à rede de novo. Conversa envelhece rápido demais para
     entrar no pacote que a página carrega uma vez e usa a sessão inteira.
     ========================================================= */
  var supLista = null;          // último resultado carregado (memória da aba)

  /* Qual chamado está desenhado agora e até onde a conversa já foi
     desenhada. É o que deixa o batimento (js/ao-vivo.js) colar só as
     mensagens novas no fim do fio, em vez de redesenhar a tela e apagar a
     resposta que o atendente está digitando. null = não estamos num chamado. */
  var supAberto = null;   // { id, ultimoId, status }

  function supMaiorId(conversa) {
    return (conversa || []).reduce(function (mx, m) {
      return Number(m.id) > mx ? Number(m.id) : mx;
    }, 0);
  }

  var SUP_STATUS = ['Aberto', 'Em atendimento', 'Aguardando cliente', 'Resolvido', 'Fechado'];
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
  // O banco guarda a urgência em minúscula ('alta'); a tela mostra o rótulo.
  var SUP_PRIO = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta' };
  function supPrio(p) { return SUP_PRIO[p] || p || 'Normal'; }

  // Contador da barra lateral: mensagens de revendedor que ninguém leu ainda.
  // Pintar e buscar são separados porque o batimento (js/ao-vivo.js) já traz
  // o número pronto de 10 em 10 segundos — pedi-lo de novo seria uma segunda
  // ida ao servidor para saber o que ele acabou de dizer.
  function pintarDotSuporte(n) {
    var dot = document.getElementById('adm-sup-dot');
    if (!dot) return;
    n = Number(n) || 0;
    dot.textContent = n > 9 ? '9+' : String(n);
    dot.classList.toggle('hidden', !n);
  }

  function atualizarDotSuporte() {
    if (!FG.suporteResumo) return;
    FG.suporteResumo().then(function (r) { pintarDotSuporte((r && r.naoLidas) || 0); });
  }

  function renderSuporte(recarregar) {
    h1.textContent = 'Suporte Técnico'; setOn('suporte');

    if (!supLista || recarregar) {
      view.innerHTML = '<div class="adm-card"><div class="c-body">Carregando chamados…</div></div>';
      var vigente = telaVigente();
      FG.suporteChamados().then(function (l) {
        supLista = l;                   // a lista fresca serve mesmo se o admin já saiu
        if (vigente()) renderSuporte();
      }, function () {
        if (!vigente()) return;
        view.innerHTML = '<div class="adm-card"><div class="c-body">' +
          'Não foi possível carregar os chamados agora. Tente de novo em instantes.</div></div>';
      });
      return;
    }

    var todos = supLista;
    var lista = todos.filter(function (c) {
      var f = filtros.suporte;
      if (f.status && c.status !== f.status) return false;
      if (f.categoria && c.categoria !== f.categoria) return false;
      return casaBusca('suporte', [c.numero, c.assunto, c.empresa, c.autor, c.categoriaNome]);
    });

    // As categorias do filtro saem dos próprios chamados: sem lista fixa aqui,
    // nada a corrigir no painel quando o portal ganha uma categoria nova.
    var cats = {};
    todos.forEach(function (c) { if (c.categoria) cats[c.categoria] = c.categoriaNome; });
    var opcoesCat = Object.keys(cats).sort().map(function (k) { return [k, cats[k]]; });

    var esperando = todos.filter(function (c) { return c.naoLidas > 0; }).length;

    view.innerHTML =
      (esperando
        ? '<div class="adm-banner"><b>' + esperando + '</b> chamado' + (esperando > 1 ? 's' : '') +
          ' com mensagem sem resposta.</div>'
        : '') +
      '<div class="adm-card"><div class="c-head">Chamados (' +
      contagem('suporte', lista.length, todos.length) + ')' +
      '<button class="btn-line btn-mini" id="sup-recarregar" style="float:right;">Atualizar</button></div>' +
      '<div class="c-body">' +
      barraFiltro('suporte', [
        { k: 'status', rotulo: 'Status', opcoes: SUP_STATUS.map(function (s) { return [s, s]; }) },
        { k: 'categoria', rotulo: 'Categoria', opcoes: opcoesCat }
      ], 'Buscar por número, assunto ou concessionária') +
      '<table class="tbl sup-tabela"><thead><tr><th>Chamado</th><th>Concessionária</th><th>Assunto</th>' +
      '<th>Categoria</th><th>Urgência</th><th>Status</th><th>Última movimentação</th></tr></thead><tbody>' +
      (lista.length ? lista.map(function (c) {
        return '<tr class="' + (c.naoLidas ? 'tem-novo' : '') + '">' +
          '<td class="nowrap"><a href="#suporte/' + c.id + '"><b>' + esc(c.numero) + '</b></a></td>' +
          '<td>' + esc(c.empresa) + '<br><span class="muted" style="font-size:11px;">' + esc(c.autor) + '</span></td>' +
          '<td>' + esc(c.assunto) +
          (c.naoLidas ? '<span class="sup-badge-novo">' + c.naoLidas + ' nova' +
            (c.naoLidas > 1 ? 's' : '') + '</span>' : '') + '</td>' +
          '<td>' + esc(c.categoriaNome) + '</td>' +
          '<td>' + esc(supPrio(c.prioridade)) + '</td>' +
          '<td>' + supPill(c.status) + '</td>' +
          '<td class="nowrap">' + FG.fmtDateTime(c.atualizadoEm) + '</td></tr>';
      }).join('') : vazioFiltro(7, 'Nenhum chamado por aqui.')) +
      '</tbody></table></div></div>';

    bindFiltro(renderSuporte);
    document.getElementById('sup-recarregar').addEventListener('click', function () { renderSuporte(true); });
  }

  function renderSuporteChamado(id) {
    h1.textContent = 'Suporte Técnico'; setOn('suporte');
    view.innerHTML = '<div class="adm-card"><div class="c-body">Carregando chamado…</div></div>';

    var vigente = telaVigente();
    FG.suporteChamado(id).then(function (c) {
      // Saiu antes de abrir: não desenha e não se registra como chamado aberto.
      if (!vigente()) return;
      if (!c) {
        view.innerHTML = '<div class="adm-card"><div class="c-body">Chamado não encontrado. ' +
          '<a href="#suporte">Voltar à fila</a>.</div></div>';
        return;
      }
      // Abrir marcou as mensagens do revendedor como lidas no servidor; a lista
      // guardada em memória ficou velha e o contador da barra também.
      supLista = null;
      atualizarDotSuporte();
      // Abrir o chamado zerou contadores no servidor: o batimento recomeça
      // deste estado, em vez de anunciar como novidade o que acabou de ser lido.
      if (FG.aoVivo) FG.aoVivo.agora();

      var fechado = c.status === 'Fechado';
      view.innerHTML =
        '<div class="adm-card"><div class="c-head">' + esc(c.numero) + ' — ' + esc(c.assunto) +
        '<a href="#suporte" class="btn-line btn-mini" style="float:right;">Voltar à fila</a></div>' +
        '<div class="c-body">' +
        '<div class="sup-det-head">' +
        '<div class="sup-det-meta">' +
        '<div><span class="lbl">Concessionária</span>' + esc(c.empresa) + '</div>' +
        '<div><span class="lbl">Aberto por</span>' + esc(c.autor) +
        (c.autorEmail ? '<br><span class="muted" style="font-size:11px;">' + esc(c.autorEmail) + '</span>' : '') + '</div>' +
        '<div><span class="lbl">Categoria</span>' + esc(c.categoriaNome) + '</div>' +
        '<div><span class="lbl">Urgência</span>' + esc(supPrio(c.prioridade)) + '</div>' +
        '<div><span class="lbl">Abertura</span>' + FG.fmtDateTime(c.criadoEm) + '</div>' +
        '<div><span class="lbl">Status</span>' + supPill(c.status) + '</div>' +
        '</div>' +
        '<div class="sup-det-acoes">' +
        '<label style="font-size:12px;">Mudar status: ' +
        '<select id="sup-status">' + SUP_STATUS.map(function (s) {
          return '<option value="' + esc(s) + '"' + (s === c.status ? ' selected' : '') + '>' + esc(s) + '</option>';
        }).join('') + '</select></label>' +
        '<button class="btn-line btn-mini" id="sup-salvar-status" type="button">Aplicar</button>' +
        '</div></div>' +

        '<div class="sup-conversa">' + (c.conversa || []).map(supMensagemHtml).join('') + '</div>' +

        (fechado
          ? '<div class="sup-fechado-aviso">Chamado fechado. Mude o status acima para voltar a responder.</div>'
          : '<div class="sup-responder">' +
            '<div class="field"><label for="sup-resp-txt">Resposta ao revendedor</label>' +
            '<textarea id="sup-resp-txt" rows="4" maxlength="4000" ' +
            'placeholder="Escreva a resposta que o revendedor vai ler no portal…"></textarea></div>' +
            '<div class="sup-resp-foot">' +
            '<input type="file" id="sup-resp-anexo" accept="image/*,video/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.csv,.txt">' +
            '<span class="grow"></span>' +
            '<button class="btn-orange" id="sup-resp-enviar" type="button">Enviar resposta</button>' +
            '</div></div>') +
        '</div></div>';

      FG.carregarArquivos(view);       // anexos privados: vêm por fetch autenticado

      // A partir daqui o batimento sabe o que está na tela.
      supAberto = { id: c.id, ultimoId: supMaiorId(c.conversa), status: c.status };

      document.getElementById('sup-salvar-status').addEventListener('click', function () {
        var novo = document.getElementById('sup-status').value;
        if (novo === c.status) { FG.toast('O status já é esse.'); return; }
        FG.suporteStatus(c.id, novo).then(function (r) {
          if (!r.ok) { FG.toast(r.msg || 'Não foi possível mudar o status.', 'erro'); return; }
          FG.toast('Status alterado para "' + novo + '".');
          supLista = null;
          renderSuporteChamado(c.id);
        });
      });

      var bEnv = document.getElementById('sup-resp-enviar');
      if (bEnv) bEnv.addEventListener('click', function () {
        var txt = document.getElementById('sup-resp-txt').value.trim();
        var arq = document.getElementById('sup-resp-anexo').files[0] || null;
        if (!txt && !arq) { FG.toast('Escreva a resposta (ou anexe um arquivo).', 'erro'); return; }
        bEnv.disabled = true; bEnv.textContent = 'Enviando…';
        FG.suporteResponder(c.id, { texto: txt, anexo: arq }).then(function (r) {
          if (!r.ok) {
            bEnv.disabled = false; bEnv.textContent = 'Enviar resposta';
            FG.toast(r.msg || 'Não foi possível enviar.', 'erro');
            return;
          }
          FG.toast('Resposta enviada ao revendedor.');
          supLista = null;
          renderSuporteChamado(c.id);
        });
      });
    }, function () {
      if (!vigente()) return;
      view.innerHTML = '<div class="adm-card"><div class="c-body">' +
        'Não foi possível carregar o chamado agora. <a href="#suporte">Voltar à fila</a>.</div></div>';
    });
  }

  // Uma mensagem da conversa. 'sistema' (mudança de status) entra como linha
  // discreta no meio do fio; as outras, em balões separados por lado.
  function supMensagemHtml(m) {
    if (m.autor === 'sistema') {
      return '<div class="sup-msg de-sistema">' + esc(m.texto) + ' · ' + FG.fmtDateTime(m.criadoEm) + '</div>';
    }
    var anexo = '';
    if (m.anexo) {
      if (m.anexoTipo === 'imagem') anexo = '<img class="sup-anexo-img fnd-thumb" data-arquivo="' + esc(m.anexo) + '" alt="Anexo do chamado" loading="lazy">';
      else if (m.anexoTipo === 'video') anexo = '<video class="sup-anexo-video" data-arquivo="' + esc(m.anexo) + '" controls preload="metadata"></video>';
      else anexo = '<a class="link-action" data-arquivo="' + esc(m.anexo) + '" target="_blank" rel="noopener">📎 Abrir anexo</a>';
    }
    // Aqui quem lê é o atendente: as respostas do suporte ficam à direita e as
    // do revendedor à esquerda — o espelho exato do que o portal mostra a ele.
    return '<div class="sup-msg de-' + (m.autor === 'admin' ? 'mim' : 'outro') + '">' +
      '<span class="sup-msg-quem">' + esc(m.autor === 'admin'
        ? ('Suporte' + (m.autorNome ? ' · ' + m.autorNome : ''))
        : (m.autorNome || 'Revendedor')) + '</span>' +
      (m.texto ? '<span class="sup-msg-txt">' + esc(m.texto) + '</span>' : '') +
      anexo +
      '<span class="sup-msg-hora">' + FG.fmtDateTime(m.criadoEm) + '</span>' +
      '</div>';
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    var h = (location.hash || '#dashboard').slice(1);
    var seg = h.split('/');
    // Sair de um chamado apaga o alvo do batimento; quem continuar num chamado
    // o preenche de novo ao terminar de desenhar.
    supAberto = null;
    telaSeq++;   // respostas pendentes da tela anterior não desenham mais

    switch (seg[0]) {
      case 'dashboard': renderDash(); break;
      case 'clientes': renderClientes(); break;
      case 'administradores': renderAdmins(); break;
      // #usuarios era a aba única antes da separação. Continua atendendo
      // links antigos (favoritos, menu do portal) caindo em Clientes.
      case 'usuarios': renderClientes(); break;
      case 'chassis': renderChassis(); break;
      case 'notificacoes': renderNotifsAdmin(); break;
      // #suporte = fila; #suporte/12 = o chamado 12.
      case 'suporte':
        if (seg[1]) renderSuporteChamado(seg[1]); else renderSuporte();
        break;
      case 'produtos': renderProdutos(); break;
      case 'pedidos': renderPedidos(); break;
      case 'prevenda': renderPreVenda(); break;
      case 'reivindicacoes': renderClaims(); break;
      case 'tiny': renderTiny(); break;
      case 'finder':
        if (seg[1] === 'modelo' && seg[2]) renderFinderModelo(decodeURIComponent(seg[2]));
        else if (seg[1] === 'secao' && seg[2]) renderFinderSecao(Number(seg[2]));
        else renderFinderModelos();
        break;
      default: renderDash();
    }
    refreshBell();
    atualizarDotSuporte();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();

  /* =========================================================
     AO VIVO — o painel acompanha o revendedor sem F5
     ---------------------------------------------------------
     Havia aqui um laço próprio de 3 minutos só para o contador da barra
     lateral. Ele saiu: quem confere agora é o batimento compartilhado
     (js/ao-vivo.js), a cada 10 segundos e em UMA requisição.

     A regra ao reagir é a mesma do portal: nunca redesenhar o que o atendente
     está usando. Dentro de um chamado as mensagens novas são COLADAS no fim
     da conversa — redesenhar apagaria a resposta meio digitada, a cada 10
     segundos.
     ========================================================= */

  // Cola no fim da conversa as mensagens que ainda não estão na tela.
  function supAnexarNovas() {
    var alvo = supAberto;
    if (!alvo) return;

    FG.suporteChamado(alvo.id).then(function (c) {
      // A resposta demorou e o atendente já saiu (ou trocou de chamado).
      if (!c || !supAberto || supAberto.id !== alvo.id) return;

      var novas = (c.conversa || []).filter(function (m) {
        return Number(m.id) > alvo.ultimoId;
      });

      if (c.status !== supAberto.status) {
        var sel = document.getElementById('sup-status');
        if (sel) sel.value = c.status;
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

      FG.carregarArquivos(fio);
      supAberto.ultimoId = supMaiorId(c.conversa);
      supLista = null;                  // a fila em memória ficou velha

      // Buscar o chamado marcou as mensagens como lidas no servidor: o
      // contador da barra precisa saber, e o batimento tem que recomeçar do
      // estado novo em vez de reanunciar o que já foi tratado.
      atualizarDotSuporte();
      if (FG.aoVivo) FG.aoVivo.agora();

      if (novas.some(function (m) { return m.autor === 'cliente'; })) {
        FG.toast('Nova mensagem do revendedor no chamado ' + c.numero + '.');
      }
      if (ultimo && ultimo.scrollIntoView) ultimo.scrollIntoView({ block: 'nearest' });
    });
  }

  window.addEventListener('fg-pulso', function (e) {
    pintarDotSuporte(e.detail.pulso.suporteNaoLidas);
    if (!e.detail.mudou.suporte) return;

    if (supAberto) {
      supAnexarNovas();                 // dentro do chamado: cola as novas
    } else if (location.hash === '#suporte') {
      // Comparação EXATA de propósito: '#suporte/12' é um chamado aberto, e
      // um `indexOf(...) === 0` o traria para cá e redesenharia a fila por
      // cima da conversa se o batimento chegasse antes de `supAberto` estar
      // preenchido.
      renderSuporte(true);              // na fila: redesenhar não perde nada
    }
  });

  // Sem o batimento na página, o contador voltaria a ficar parado. O laço
  // antigo fica como rede de segurança — e só neste caso.
  if (!FG.aoVivo) {
    setInterval(function () {
      if (document.visibilityState === 'visible') atualizarDotSuporte();
    }, 3 * 60 * 1000);
  }

  }); // fim FG.pronto.then — tela montada só após o cache chegar
})();
