/* =========================================================
   FULLGAS B2B — Adaptador de API
   ---------------------------------------------------------
   Inclua este arquivo DEPOIS de js/store.js em cada página:
     <script src="js/store.js"></script>
     <script src="js/api-adapter.js"></script>

   Ele substitui o "miolo" das funções FG que mexiam no
   localStorage por chamadas à API real. As telas (portal,
   loja, finder, admin) continuam LENDO os dados de forma
   síncrona: FG.all() lê de um cache em memória.

   O cache é carregado de forma ASSÍNCRONA (fetch) — sem
   XMLHttpRequest síncrono, que os navegadores bloqueiam em
   requisições cross-origin (impede acesso de outro dispositivo
   ou hospedagem externa). Cada tela espera FG.pronto (uma
   Promise que resolve quando o cache está cheio) antes de
   renderizar.
   ========================================================= */
(function () {
  'use strict';

  // Ajuste para a URL onde a API está publicada.
  var API_BASE = window.FULLGAS_API_BASE || 'http://localhost:3000/api';

  /* =======================================================================
     A SESSÃO SAIU DO ALCANCE DESTE ARQUIVO
     -----------------------------------------------------------------------
     Antes o token JWT ficava no localStorage e era colado à mão no header
     Authorization. O problema é que localStorage é lido por QUALQUER script
     que rode na página — um XSS levava a sessão inteira embora.

     Agora o token vive no cookie fg_sess, marcado httpOnly: o navegador o
     envia sozinho em toda requisição e o JavaScript não consegue lê-lo. Nem
     este arquivo. É o objetivo, não uma limitação.

     Mas o front ainda precisa saber DUAS coisas que lia dentro do token, e
     por isso a API manda dois cookies legíveis junto:
       fg_exp  — quando a sessão expira (segundos UNIX). Substitui o `exp`
                 que líamos decodificando o JWT com atob.
       fg_csrf — o segredo que devolvemos no header X-CSRF-Token.

     Por que cookie companheiro e não um endpoint: o guardião abaixo roda a
     cada 30 s e a cada carregamento de página, de forma SÍNCRONA. Perguntar
     ao servidor exigiria await em todo lugar que hoje só lê uma variável.
     ======================================================================= */
  function cookie(nome) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + nome + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  // Apaga um cookie legível pelo JS. O `path` precisa ser o MESMO usado na
  // gravação, senão o navegador entende que é outro cookie e ignora o pedido —
  // é o mesmo detalhe que o fecharSessao do servidor comenta.
  function apagarCookie(nome) {
    document.cookie = nome + '=; path=/; max-age=0';
  }

  // Há sessão? É um palpite do lado do cliente, e é o suficiente: serve para
  // decidir o que RENDERIZAR. Quem decide de verdade é a API, que valida a
  // assinatura do fg_sess — este cookie aqui é só o aviso legível.
  function temSessao() { return !!cookie('fg_exp'); }

  /* Cabeçalhos comuns a TODA chamada à API.
     -----------------------------------------------------------------------
     O X-CSRF-Token é o que separa uma requisição nossa de uma forjada por
     outro site. O raciocínio: o navegador anexa o cookie sozinho, mas
     NENHUM site consegue fazer o navegador anexar um header customizado a
     uma requisição para outra origem — para isso ele precisaria passar pelo
     preflight de CORS, que a nossa API só concede a origens conhecidas.
     Então "sabe o valor e conseguiu mandá-lo num header" prova que o código
     rodou dentro do fullgas.app.br.

     Repare que não montamos Authorization em lugar nenhum. É o coração da
     Fase 3: a credencial deixou de passar por aqui. */
  function cabecalhos(extra) {
    var h = extra || {};
    h['ngrok-skip-browser-warning'] = '1';
    var c = cookie('fg_csrf');
    if (c) h['X-CSRF-Token'] = c;
    return h;
  }

  /* =======================================================================
     GUARDIÃO DE SESSÃO — expiração por tempo e por inatividade
     -----------------------------------------------------------------------
     Problema que isto resolve: o token JWT expira no servidor (8h), mas o
     front guardava a sessão no localStorage SEM nenhuma validade. Se o
     usuário deixava o PC ligado e logado, ao voltar (F5) a tela continuava
     "logada" — mas toda chamada à API respondia 401 e o portal quebrava,
     sem devolver o usuário ao login.

     Três camadas, todas convergindo para encerrarSessao():
       1. Validade do token: lemos o claim `exp` do próprio JWT.
       2. Inatividade: INATIVIDADE_MS sem mouse/teclado/toque encerram a
          sessão. O carimbo fica no localStorage porque o site tem várias
          páginas (portal → loja → finder) e um timer em memória zeraria a
          cada navegação.
       3. Resposta 401 da API: qualquer chamada autenticada que volte 401
          encerra a sessão na hora (ver função api(), logo abaixo).
     ======================================================================= */
  var INATIVIDADE_MS = 4 * 60 * 60 * 1000;      // 4 h sem interação
  var ATIVIDADE_KEY  = 'fullgas_ultima_atividade';
  var CHECAGEM_MS    = 30 * 1000;               // varredura periódica
  var encerrando     = false;                   // trava anti-loop de redirect

  // Quando a sessão expira, em ms. Vem do cookie fg_exp — antes era preciso
  // fatiar o JWT e decodificar o payload com atob. Some um pedaço de código
  // que só existia porque o front tinha o token na mão.
  // 0 = sem sessão ou cookie ilegível (a inatividade ainda cobre o caso).
  function tokenExpiraEm() {
    var exp = parseInt(cookie('fg_exp'), 10);
    return exp ? exp * 1000 : 0;
  }

  function marcarAtividade() {
    try { localStorage.setItem(ATIVIDADE_KEY, String(Date.now())); } catch (e) {}
  }

  // Devolve o motivo pelo qual a sessão deve ser encerrada, ou null se está OK.
  // 'expirada' = token venceu; 'inatividade' = tempo ocioso estourado.
  function motivoEncerramento() {
    if (!temSessao()) return null;              // não há sessão a encerrar
    var exp = tokenExpiraEm();
    if (exp && Date.now() >= exp) return 'expirada';
    var ultima = parseInt(localStorage.getItem(ATIVIDADE_KEY) || '0', 10);
    if (ultima && (Date.now() - ultima) >= INATIVIDADE_MS) return 'inatividade';
    return null;
  }

  // Apaga o que é do lado do cliente. As três primeiras chaves são LIXO DA
  // ERA DO localStorage: ninguém mais grava nelas. Continuam sendo removidas
  // por um release para limpar a máquina de quem volta com elas guardadas —
  // podem sair na Fase 5.
  function limparLocal() {
    try {
      localStorage.removeItem('fullgas_token_v1');
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(ADMIN_SESS_KEY);
      localStorage.removeItem('fullgas_session_v1');
      localStorage.removeItem(IMP_KEY);
      localStorage.removeItem(ATIVIDADE_KEY);
    } catch (e) {}
  }

  // Encerra de verdade e vai para `destino`.
  //
  // O ponto importante: o fg_sess é httpOnly, então ESTE ARQUIVO NÃO CONSEGUE
  // APAGÁ-LO. Só o servidor apaga, respondendo com Set-Cookie vazio. Sem esta
  // chamada, "sair" apenas limparia o localStorage e o navegador continuaria
  // portando uma sessão válida — o usuário voltaria logado no próximo acesso.
  // Por isso o logout deixou de ser uma operação local e virou uma requisição.
  //
  // O redirecionamento acontece de qualquer jeito, dando ou não certo: um
  // usuário que quer sair não pode ficar preso na tela porque a rede caiu.
  function encerrarSessao(motivo, destino) {
    if (encerrando) return;                     // trava anti-loop de redirect
    encerrando = true;
    limparLocal();
    // Os dois cookies legíveis saem JÁ, sem esperar a resposta do servidor.
    // Quem apaga de verdade é o /auth/logout abaixo — e só ele alcança o
    // fg_sess, que é httpOnly. Mas o redirecionamento acontece dando ou não
    // certo, e o fg_exp agora sobrevive ao token: se a chamada falhasse por
    // rede, ele ficaria no navegador com data vencida, a tela de login o leria
    // como "sessão expirada" e mandaria de volta para cá, em círculo.
    apagarCookie('fg_exp');
    apagarCookie('fg_csrf');
    var url = destino || ('/?sessao=' + (motivo || 'expirada'));
    var ir = function () { location.href = url; };
    fetch(API_BASE + '/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: cabecalhos()
    }).then(ir, ir);
  }
  FG.encerrarSessao = encerrarSessao;

  // FG.guard() (definido em store.js) passa a checar validade, não só presença.
  var guardBase = FG.guard;
  FG.guard = function (papel) {
    var motivo = motivoEncerramento();
    if (motivo) { encerrarSessao(motivo); return null; }
    return guardBase ? guardBase.call(FG, papel) : null;
  };

  // Vigilância só faz sentido quando há sessão. Na tela de login não há cookie.
  if (temSessao()) {
    marcarAtividade();                          // (re)abrir a página conta como atividade
    ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, marcarAtividade, { passive: true });
    });
    // Pega o PC deixado ligado sem nenhuma chamada de API acontecendo.
    setInterval(function () {
      var motivo = motivoEncerramento();
      if (motivo) encerrarSessao(motivo);
    }, CHECAGEM_MS);
  }

  // fetch autenticado que devolve JSON (REJEITA em erro HTTP, com a msg da API).
  function api(path, opts) {
    opts = opts || {};
    var headers = cabecalhos(opts.headers || {});
    headers['Content-Type'] = 'application/json';
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      // 'include' manda o cookie MESMO em origem cruzada. Em produção front e
      // API são a mesma origem e o padrão já bastaria, mas no desenvolvimento
      // (Live Server na :5500 falando com a API na :3000) sem isto o cookie
      // simplesmente não viaja — e tudo responde 401 só na sua máquina.
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          // Sessão invalidada no servidor: se o front ainda se julga logado,
          // ela morreu — encerra na hora e volta ao login.
          if (r.status === 401 && temSessao()) encerrarSessao('expirada');
          throw new Error(data.erro || ('HTTP ' + r.status));
        }
        return data;
      });
    });
  }

  // GET resiliente para o cache: resolve com os dados ou null (nunca rejeita).
  function apiGet(path) {
    return api(path).then(function (d) { return d; }, function () { return null; });
  }

  /* =======================================================================
     ARQUIVOS PROTEGIDOS — fotos de reivindicação, anexos de notificação e
     anexos dos chamados de suporte
     -----------------------------------------------------------------------
     Esse material é de cliente: a foto da peça quebrada de uma concessionária
     não pode ser vista por outra. Ele deixou de ser servido abertamente em
     /uploads e passou a sair por /api/arquivos/..., que confere no banco de
     quem é o arquivo.

     O problema: <img src> e <a href> não mandam o cabeçalho de autenticação.
     Então buscamos o arquivo por fetch (aí o token vai junto) e trocamos a URL
     por um blob local. O HTML marca esses elementos com data-arquivo em vez de
     src/href, e quem renderiza chama FG.carregarArquivos() depois.
     ======================================================================= */
  var PROTEGIDO_RE = /\/uploads\/(reivindicacoes|notificacoes|suporte)\/([A-Za-z0-9._-]+)/;
  var cacheBlob = {};        // URL original -> Promise<URL de blob>

  function urlBlob(url) {
    if (cacheBlob[url]) return cacheBlob[url];
    var m = String(url || '').match(PROTEGIDO_RE);
    if (!m) return Promise.resolve(url);   // catálogo: continua no estático
    cacheBlob[url] = fetch(API_BASE + '/arquivos/' + m[1] + '/' + m[2],
                           { headers: cabecalhos(), credentials: 'include' })
      .then(function (r) {
        if (r.status === 401 && temSessao()) encerrarSessao('expirada');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(function (b) { return URL.createObjectURL(b); });
    // Falha não fica grudada no cache: a próxima tentativa refaz a busca.
    cacheBlob[url]['catch'](function () { delete cacheBlob[url]; });
    return cacheBlob[url];
  }

  // Resolve todo elemento com data-arquivo dentro de `raiz` (padrão: a página).
  // Em <a> preenche href; nos demais (img, video) preenche src.
  FG.carregarArquivos = function (raiz) {
    var els = (raiz || document).querySelectorAll('[data-arquivo]');
    Array.prototype.forEach.call(els, function (el) {
      var u = el.getAttribute('data-arquivo');
      el.removeAttribute('data-arquivo');       // não recarrega se rodar de novo
      urlBlob(u).then(function (b) {
        if (el.tagName === 'A') el.href = b; else el.src = b;
      }, function () {
        el.setAttribute('alt', 'Não foi possível carregar o arquivo');
      });
    });
  };

  // Cache em memória que espelha o antigo "db".
  var CACHE = { products: [], categories: [], models: [], vehicles: [],
                orders: [], claims: [], invoices: [], deliveries: [],
                notifications: [], users: [], searches: [], prevenda: [] };

  // De onde vem cada lista do cache.
  var FONTES = [
    ['products', '/produtos'],
    ['categories', '/categorias'],
    ['orders', '/pedidos'],
    ['models', '/veiculos/modelos'],
    ['vehicles', '/veiculos'],
    ['invoices', '/faturas'],
    ['prevenda', '/prevenda'],
    ['claims', '/reivindicacoes'],
    ['users', '/usuarios'],   // só admin recebe; cliente resolve null (apiGet nunca rejeita)
    ['notifications', '/notificacoes']
  ];

  /* Cada página diz no <body data-cache="products categories ..."> quais
     listas usa, e só essas são buscadas. Antes toda página pedia as 10 — a
     loja baixava faturas, usuários e reivindicações que nunca mostra — e cada
     pedido a mais custa uma ida e volta à API, o que pesa em internet lenta
     e em computador fraco. `data-cache=""` = nenhuma lista. Sem o atributo,
     busca todas (página nova que ainda não declarou continua funcionando). */
  function listasDaPagina() {
    var attr = document.body ? document.body.getAttribute('data-cache') : null;
    return attr == null ? null : attr.split(/\s+/).filter(Boolean);
  }
  var LISTAS_DA_PAGINA = listasDaPagina();

  // Carrega o cache da página (em paralelo). Assíncrono — devolve uma Promise
  // que resolve quando o cache está cheio. Sem token, resolve vazio.
  function carregarCache() {
    if (!temSessao()) return Promise.resolve(CACHE);
    var fontes = FONTES.filter(function (f) {
      return !LISTAS_DA_PAGINA || LISTAS_DA_PAGINA.indexOf(f[0]) >= 0;
    });
    return Promise.all(fontes.map(function (f) { return apiGet(f[1]); })).then(function (r) {
      fontes.forEach(function (f, i) { if (r[i]) CACHE[f[0]] = r[i]; });
      return CACHE;
    });
  }

  // Recargas pontuais (após mutações). Todas assíncronas — devolvem Promise.
  function recarregarFaturas() {
    return apiGet('/faturas').then(function (l) { if (l) CACHE.invoices = l; return l; });
  }
  FG.recarregarFaturas = recarregarFaturas;

  function recarregarPreVenda() {
    return apiGet('/prevenda').then(function (l) { if (l) CACHE.prevenda = l; return l; });
  }
  FG.recarregarPreVenda = recarregarPreVenda;

  function recarregarVeiculos() {
    return apiGet('/veiculos').then(function (l) { if (l) CACHE.vehicles = l; return l; });
  }
  FG.recarregarVeiculos = recarregarVeiculos;

  function recarregarClaims() {
    return apiGet('/reivindicacoes').then(function (l) { if (l) CACHE.claims = l; return l; });
  }
  FG.recarregarClaims = recarregarClaims;

  function recarregarPedidos() {
    return apiGet('/pedidos').then(function (l) { if (l) CACHE.orders = l; return l; });
  }
  FG.recarregarPedidos = recarregarPedidos;

  function recarregarUsuarios() {
    return apiGet('/usuarios').then(function (l) { if (l) CACHE.users = l; return l; });
  }
  FG.recarregarUsuarios = recarregarUsuarios;

  function recarregarNotifs() {
    return apiGet('/notificacoes').then(function (l) { if (l) CACHE.notifications = l; return l; });
  }
  FG.recarregarNotifs = recarregarNotifs;

  /* ---------- notificações (admin → concessionárias) ---------- */
  // Marca lida/não lida (estado POR USUÁRIO na API). Atualiza o cache.
  FG.markNotif = function (id, lida) {
    var n = CACHE.notifications.find(function (x) { return String(x.id) === String(id); });
    if (n) n.lida = lida; // otimista: a tela reflete na hora
    return req('PATCH', '/notificacoes/' + encodeURIComponent(id) + '/lida', { lida: !!lida });
  };

  // Admin envia notificação. `dados` = { titulo, texto, tipo, empresaId?,
  // anexo? (File) }. Multipart montado aqui (fetch próprio — o api() força
  // Content-Type JSON). Devolve Promise<{ ok, msg? }>.
  FG.notifEnviar = function (dados) {
    var fd = new FormData();
    fd.append('titulo', dados.titulo || '');
    fd.append('texto', dados.texto || '');
    fd.append('tipo', dados.tipo || 'info');
    if (dados.empresaId) fd.append('empresaId', dados.empresaId);
    if (dados.anexo) fd.append('anexo', dados.anexo);
    // Sem Content-Type de propósito: quem monta o boundary do multipart é o
    // browser. Note que cabecalhos() ainda entrega o X-CSRF-Token — upload é
    // escrita, e escrita por cookie precisa provar a origem como qualquer
    // outra. Foi o detalhe que mais quebrou upload em migrações assim.
    return fetch(API_BASE + '/notificacoes', {
      method: 'POST',
      headers: cabecalhos(),
      credentials: 'include',
      body: fd
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) return { ok: false, msg: data.erro || ('HTTP ' + r.status) };
        return recarregarNotifs().then(function () { return { ok: true }; });
      });
    }, function () { return { ok: false, msg: 'Sem conexão com a API.' }; });
  };

  // Admin apaga uma notificação (anexo sai do disco na API).
  FG.notifApagar = function (id) {
    return req('DELETE', '/notificacoes/' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) return r;
      CACHE.notifications = CACHE.notifications.filter(function (x) { return String(x.id) !== String(id); });
      return r;
    });
  };

  /* ---------- Minha conta (concessionário) ---------- */
  // Visão da própria empresa: cadastro, endereço e contas internas.
  // Devolve Promise<{empresa, endereco, areas, usuarios} | null>.
  FG.conta = function () { return apiGet('/conta'); };

  // Gestor atualiza o cadastro da empresa (CNPJ, telefone, e-mail, endereço).
  FG.contaSalvarEmpresa = function (dados) { return req('PUT', '/conta/empresa', dados); };

  // Gestor cria conta interna (sub-dealer): { nome, email, senha, permissoes }.
  FG.subdealerCriar = function (dados) { return req('POST', '/conta/subdealers', dados); };

  // Gestor edita conta interna: { permissoes?, status?, senha? }.
  FG.subdealerEditar = function (id, patch) {
    return req('PATCH', '/conta/subdealers/' + encodeURIComponent(id), patch);
  };

  // Gestor exclui uma conta interna da própria empresa.
  FG.subdealerExcluir = function (id) {
    return req('DELETE', '/conta/subdealers/' + encodeURIComponent(id));
  };

  // Sub-dealer tem acesso à área? (null/ausente = acesso total; admin e
  // gestor nunca são restringidos). Usada p/ esconder abas e travar páginas.
  FG.temArea = function (sess, area) {
    if (!sess) return false;
    if (sess.papel === 'admin' || sess.gestor || !Array.isArray(sess.permissoes)) return true;
    return sess.permissoes.indexOf(area) !== -1;
  };

  // Gestão de usuários (admin): aprova / bloqueia / muda papel. Devolve
  // Promise<{ ok, msg? }>. Atualiza o cache no sucesso para o re-render refletir.
  FG.setUser = function (id, patch) {
    return req('PATCH', '/usuarios/' + encodeURIComponent(id), patch).then(function (r) {
      if (!r.ok) return r;
      var u = CACHE.users.find(function (x) { return String(x.id) === String(id); });
      if (u) Object.keys(patch).forEach(function (k) { u[k] = patch[k]; });
      return r;
    });
  };

  // Cria um administrador pelo painel (admin). `dados` = { nome, email, senha }.
  // A API devolve o usuário pronto; guardamos no cache para a lista já mostrar
  // a conta nova sem recarregar tudo. Devolve Promise<{ ok, msg? }>.
  FG.criarAdmin = function (dados) {
    return req('POST', '/usuarios', {
      nome: dados.nome, email: dados.email, senha: dados.senha
    }).then(function (r) {
      if (!r.ok) return r;
      if (r.id) {
        var novo = {};
        Object.keys(r).forEach(function (k) { if (k !== 'ok') novo[k] = r[k]; });
        CACHE.users.unshift(novo);
      }
      return r;
    });
  };

  // Exclui um cliente indesejado/bloqueado (admin). Master e usuários com
  // histórico são recusados pela API. Devolve Promise<{ ok, msg? }>.
  FG.delUser = function (id) {
    return req('DELETE', '/usuarios/' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) return r;
      CACHE.users = CACHE.users.filter(function (x) { return String(x.id) !== String(id); });
      return r;
    });
  };

  function recarregarProdutos() {
    return apiGet('/produtos').then(function (l) { if (l) CACHE.products = l; return l; });
  }

  /* ---------- sobrescreve a camada de dados do FG ---------- */
  // Leituras continuam SÍNCRONAS, lendo do cache em memória.
  FG.db = function () { return CACHE; };
  // Aviso para quem mexer no código: pedir uma lista que a página não
  // declarou devolve vazio (ela nunca foi buscada). Some com a correção do
  // data-cache no HTML da página.
  var avisadas = {};
  FG.all = function (col) {
    if (LISTAS_DA_PAGINA && LISTAS_DA_PAGINA.indexOf(col) < 0 && !avisadas[col] &&
        FONTES.some(function (f) { return f[0] === col; }) && !CACHE[col].length) {
      avisadas[col] = true;
      console.warn('[Fullgas] FG.all("' + col + '") numa página que não declarou essa lista em <body data-cache>.');
    }
    return CACHE[col] || [];
  };

  // Requisição genérica que NÃO rejeita: resolve { ok:true, ... } no sucesso
  // ou { ok:false, msg } no erro. Usada pelos wrappers de mutação.
  function req(method, path, body) {
    var opts = { method: method };
    if (body !== undefined) opts.body = body;
    return api(path, opts).then(function (data) {
      data = data || {};
      data.ok = true;
      return data;
    }, function (e) {
      return { ok: false, msg: (e && e.message) || 'Operação não concluída.' };
    });
  }

  /* Guarda o PERFIL de exibição (nome, empresa, papel, permissões).
     -----------------------------------------------------------------------
     Isto continua no localStorage de propósito, e não é uma inconsistência
     com o resto da fase: perfil não é credencial. Ele existe para as telas
     desenharem o cabeçalho e esconderem menus sem esperar a rede. Se alguém
     adulterar esse objeto, ganha um menu a mais na tela e nada além disso —
     toda rota da API decide pelo que está no fg_sess assinado, nunca por
     isto aqui. O que NÃO pode voltar para o localStorage é o token. */
  function guardarPerfil(u) {
    try {
      localStorage.setItem('fullgas_session_v1', JSON.stringify({
        id: u.id, nome: u.nome, email: u.email,
        papel: u.papel, empresa: u.empresa, empresaId: u.empresaId,
        gestor: !!u.gestor,
        permissoes: u.permissoes || null      // null = acesso total
      }));
    } catch (e) {}
  }

  // Chave pública do widget anti-robô, ou '' quando não há configuração no
  // servidor. Nunca rejeita: sem captcha, a tela de login continua inteira.
  FG.captchaConfig = function () {
    return api('/auth/captcha/config').then(function (d) { return (d && d.siteKey) || ''; },
                                            function () { return ''; });
  };

  // Login. Devolve Promise<{ ok, msg? }>. Não guarda token nenhum: a resposta
  // do /auth/login já veio com os cookies de sessão em Set-Cookie, e o
  // navegador os aplicou antes desta linha rodar.
  // `captcha` é o token do widget — vazio quando não há captcha configurado,
  // e nesse caso o servidor simplesmente não o exige.
  // O cache é (re)carregado na próxima página (redirect recarrega o app).
  FG.login = function (email, senha, captcha) {
    return api('/auth/login', { method: 'POST', body: { email: email, senha: senha, captcha: captcha || '' } })
      .then(function (data) {
        guardarPerfil(data.usuario);
        return { ok: true };
      }, function (e) {
        return { ok: false, msg: (e && e.message) || 'Falha no login.' };
      });
  };

  // Cadastro. Devolve Promise<{ ok, msg? }>.
  // `dados.captcha` é o token do widget anti-robô do formulário de cadastro
  // (vazio quando não há chave configurada — aí o servidor não o exige).
  FG.register = function (dados) {
    return api('/auth/register', { method: 'POST', body: dados })
      .then(function () { return { ok: true }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Falha no cadastro.' }; });
  };

  /* ---------- esqueci minha senha ----------
     Nenhuma das três revela se o e-mail existe: a mensagem de sucesso é
     sempre a mesma, venha o cadastro de onde vier. */

  // Dispara o e-mail com o link de redefinição. Promise<{ ok, msg }>.
  FG.esqueciSenha = function (email) {
    return api('/auth/senha/esqueci', { method: 'POST', body: { email: email } })
      .then(function (d) { return { ok: true, msg: d.msg }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Não foi possível enviar agora.' }; });
  };

  // O link ainda vale? Promise<{ ok, nome?, email? (mascarado), msg? }>.
  FG.verificarTokenSenha = function (token) {
    return api('/auth/senha/verificar', { method: 'POST', body: { token: token } })
      .then(function (d) { return { ok: true, nome: d.nome, email: d.email }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Link inválido ou expirado.' }; });
  };

  // Grava a nova senha e queima o token. Promise<{ ok, msg }>.
  FG.redefinirSenha = function (token, senha) {
    return api('/auth/senha/redefinir', { method: 'POST', body: { token: token, senha: senha } })
      .then(function (d) { return { ok: true, msg: d.msg }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Não foi possível alterar a senha.' }; });
  };

  /* ---------- alteração de identidade (admin entra na conta do cliente) ----------
     O desenho antigo: o front copiava o token do admin para outra chave do
     localStorage e o restaurava na volta. Isso deixava DOIS tokens válidos
     largados num lugar que o JavaScript lê — o dobro do estrago num XSS — e
     confiava num backup do cliente para decidir quem o admin é.

     O desenho novo: o servidor carimba no token da identidade assumida o
     claim `imp` (o id do admin) e reemite a partir dele na volta, revalidando
     no banco. O front não guarda credencial nenhuma; guarda só um SINALIZADOR
     para saber que precisa desenhar a tarja.

     Por que o sinalizador ainda mora no localStorage, se a verdade está no
     `imp` do token: a tarja é obrigatória e precisa aparecer no primeiro
     quadro da página. A verdade vem do servidor (GET /auth/sessao), mas
     assíncrona; se dependêssemos só dela, cada navegação teria uma janela
     sem tarja em que o admin acha que está na própria conta. O localStorage
     dá a resposta instantânea e a API corrige logo em seguida — inclusive
     apagando a tarja se o sinalizador estiver velho. */
  var IMP_KEY = 'fullgas_imp_v1';

  // Chaves da era do localStorage. Não são mais escritas; só limpas.
  var ADMIN_TOKEN_KEY = 'fullgas_admin_token_v1';
  var ADMIN_SESS_KEY = 'fullgas_admin_sessao_v1';

  // Há identidade assumida? Devolve { adminId } ou null.
  FG.identidadeAssumida = function () {
    try { return JSON.parse(localStorage.getItem(IMP_KEY) || 'null'); }
    catch (e) { return null; }
  };

  function marcarImpersonacao(adminId) {
    try {
      if (adminId) localStorage.setItem(IMP_KEY, JSON.stringify({ adminId: adminId }));
      else localStorage.removeItem(IMP_KEY);
    } catch (e) {}
  }

  // Admin assume a identidade de um usuário. Promise<{ ok, msg? }>.
  // A resposta já troca os cookies de sessão; aqui só acertamos o que a tela
  // mostra. `imp` vem da própria resposta para a tarja subir já na primeira
  // renderização, sem esperar o GET /auth/sessao.
  FG.assumirIdentidade = function (id) {
    return api('/usuarios/' + encodeURIComponent(id) + '/identidade', { method: 'POST' })
      .then(function (d) {
        var eu = FG.session() || {};
        marcarImpersonacao(d.imp || eu.id || true);
        guardarPerfil(d.usuario);
        return { ok: true, usuario: d.usuario };
      }, function (e) {
        return { ok: false, msg: (e && e.message) || 'Não foi possível assumir a identidade.' };
      });
  };

  // Devolve o admin à própria conta. Agora é uma requisição, não uma
  // restauração local: o servidor reemite a sessão a partir do claim `imp` e
  // revalida o admin no banco. Um admin rebaixado ou bloqueado no meio-tempo
  // recebe 403 e cai no login — o desenho antigo restauraria alegremente o
  // token guardado e o devolveria a um painel que ele já não podia usar.
  FG.voltarIdentidade = function (destino) {
    return api('/auth/identidade/voltar', { method: 'POST' })
      .then(function (d) {
        marcarImpersonacao(null);
        guardarPerfil(d.usuario);
        location.href = destino || '/admin';
      }, function (e) {
        // Não dá para voltar (sessão vencida, admin desativado): sair é o
        // único caminho honesto — ficar na conta do cliente seria pior.
        marcarImpersonacao(null);
        FG.toast((e && e.message) || 'Não foi possível voltar para sua conta.', 'erro');
        setTimeout(function () { encerrarSessao('expirada'); }, 1500);
      });
  };

  // Tarja fixa de aviso, injetada em qualquer página enquanto houver identidade
  // assumida. Fica no adaptador (carregado em todas as telas) para não precisar
  // repetir o mesmo bloco em portal/loja/finder.
  function montarTarjaIdentidade() {
    var adm = FG.identidadeAssumida();
    if (!adm) { removerTarjaIdentidade(); return; }
    if (document.getElementById('fg-imp-bar')) return;
    var atual = FG.session() || {};
    var bar = document.createElement('div');
    bar.id = 'fg-imp-bar';
    bar.className = 'imp-bar';
    bar.innerHTML =
      '<span class="imp-ico" aria-hidden="true">👁</span>' +
      '<span class="imp-txt">Você está usando o portal como <b></b>' +
      '<span class="imp-emp"></span> — tudo o que fizer aqui vale como se fosse o cliente.</span>' +
      '<button type="button" class="imp-sair">Voltar para minha conta</button>';
    bar.querySelector('b').textContent = atual.nome || '—';
    bar.querySelector('.imp-emp').textContent = atual.empresa ? ' (' + atual.empresa + ')' : '';
    bar.querySelector('.imp-sair').addEventListener('click', function () { FG.voltarIdentidade(); });
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('com-imp-bar');
  }
  // Tira a tarja quando o servidor diz que não há mais identidade assumida —
  // o caso do sinalizador velho: o admin voltou para a própria conta em outra
  // aba, e esta aqui ainda desenharia a tarja para sempre.
  function removerTarjaIdentidade() {
    var bar = document.getElementById('fg-imp-bar');
    if (bar) bar.remove();
    document.body.classList.remove('com-imp-bar');
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', montarTarjaIdentidade);
  else montarTarjaIdentidade();

  // Sair. Passa pelo mesmo encerrarSessao do guardião — o servidor precisa
  // apagar o fg_sess httpOnly, que este arquivo não alcança. Sem `motivo`,
  // vai para a home limpa: sair por vontade própria não é um erro a explicar.
  FG.logout = function () { encerrarSessao(null, '/'); };

  // Produtos (admin) — gravações que atualizam o cache no fim. Após gravar,
  // recarrega também o rastreador de pré-venda (repor estoque muda o status
  // das peças de "Aguardando" para "Disponível").
  function aposGravarProduto(lista) {
    return recarregarPreVenda().then(function () { return lista; });
  }
  FG.apiCriarProduto = function (p) { return api('/produtos', { method: 'POST', body: p }).then(recarregarProdutos).then(aposGravarProduto); };
  FG.apiEditarProduto = function (sku, p) { return api('/produtos/' + encodeURIComponent(sku), { method: 'PUT', body: p }).then(recarregarProdutos).then(aposGravarProduto); };
  FG.apiExcluirProduto = function (sku) { return api('/produtos/' + encodeURIComponent(sku), { method: 'DELETE' }).then(recarregarProdutos).then(aposGravarProduto); };

  /* ---------- categorias (admin) ---------- */
  function recarregarCategorias() {
    return apiGet('/categorias').then(function (l) { if (l) CACHE.categories = l; return l; });
  }
  FG.recarregarCategorias = recarregarCategorias;

  // Cria categoria de topo ou subcategoria. `dados` = { nome, icone?, pai? }.
  FG.apiCriarCategoria = function (dados) {
    return req('POST', '/categorias', dados).then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };
  // Renomeia / troca o ícone. `dados` = { nome, icone? }.
  FG.apiEditarCategoria = function (codigo, dados) {
    return req('PUT', '/categorias/' + encodeURIComponent(codigo), dados).then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };
  FG.apiExcluirCategoria = function (codigo) {
    return req('DELETE', '/categorias/' + encodeURIComponent(codigo)).then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };
  // Foto da categoria (miniatura da grade da loja). Recarrega o cache no ok.
  FG.uploadImagemCategoria = function (codigo, file) {
    return uploadImagem('/categorias/' + encodeURIComponent(codigo) + '/imagem', file).then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };
  FG.removerImagemCategoria = function (codigo) {
    return req('DELETE', '/categorias/' + encodeURIComponent(codigo) + '/imagem').then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };

  /* ---------- pedidos ---------- */
  // Cria o pedido a partir da cesta atual. Devolve Promise<data|null>; em erro
  // avisa via toast e resolve null. Recarrega pedidos + produtos no sucesso.
  FG.createOrder = function () {
    var s = FG.session(); var cart = FG.cart();
    if (!s || !cart.length) return Promise.resolve(null);
    var itens = cart.map(function (i) { return { sku: i.artigo, quantidade: i.qtd }; });
    return api('/pedidos', { method: 'POST', body: { itens: itens } }).then(function (data) {
      FG.cartClear();
      return Promise.all([recarregarPedidos(), recarregarProdutos()]).then(function () { return data; });
    }, function (e) {
      FG.toast((e && e.message) || 'Não foi possível finalizar o pedido.');
      return null;
    });
  };

  // PUT de pedido que mexe em estoque/envio: recarrega pedidos + produtos no ok.
  // `metodo` existe para o POST da remessa: o efeito no cache é o mesmo (o
  // pedido e o estoque mudam), só o verbo é outro.
  function putPedido(path, body, metodo) {
    return req(metodo || 'PUT', path, body).then(function (r) {
      if (!r.ok) return r;
      return Promise.all([recarregarPedidos(), recarregarProdutos()]).then(function () { return r; });
    });
  }

  // Muda o status do pedido (admin). Promise<{ ok, ... }>.
  FG.setOrderStatus = function (id, status) {
    return putPedido('/pedidos/' + encodeURIComponent(id) + '/status', { status: status });
  };

  // Detalhe rico do pedido (itens com qtdEnviada/backorder/estoque, faturas
  // e progresso). Promise<detalhe|null>.
  FG.pedidoDetalhe = function (numero) {
    return apiGet('/pedidos/' + encodeURIComponent(numero));
  };

  // Fecha a remessa do pedido (admin): as peças marcadas como enviadas e ainda
  // não exportadas viram UM pedido no Tiny. Promise<{ ok, status, itens, parcial }>.
  FG.confirmarRemessa = function (numero) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/remessa', {}, 'POST');
  };

  // Envio segmentado por escopo: 'normal' | 'backorder' | 'tudo' (admin).
  FG.enviarPedidoEscopo = function (numero, escopo) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/status', { escopo: escopo });
  };

  // Ação "Enviado" de um item / do rastreador de pré-venda (admin). Recarrega
  // pedidos, produtos e o rastreador no fim.
  FG.setItemEnviado = function (numero, itemId, qtd) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/itens/' + itemId + '/enviado', { qtd: qtd })
      .then(function (r) {
        if (!r.ok) return r;
        return recarregarPreVenda().then(function () { return r; });
      });
  };

  /* ---------- veículos: substitui as ações inline do portal.js ---------- */
  // Registra venda do veículo (Status=Vendido + garantia). Recarrega o cache.
  // `dados` = { cliente, cpf, email, telefone, endereco }.
  FG.registrarVenda = function (niv, dados) {
    return req('POST', '/veiculos/' + encodeURIComponent(niv) + '/venda', dados || {}).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  // Ativa a garantia do veículo. Recarrega o cache em caso de sucesso.
  FG.ativarGarantia = function (niv) {
    return req('POST', '/veiculos/' + encodeURIComponent(niv) + '/garantia').then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  // Lista de concessionárias ativas (SÓ ADMIN) — alimenta o autocomplete de
  // atribuição/transferência de chassi. Cacheada após a primeira chamada.
  var _empresas = null;
  FG.empresas = function () {
    if (_empresas) return Promise.resolve(_empresas);
    return apiGet('/empresas').then(function (l) { _empresas = l || []; return _empresas; });
  };

  // Cadastra um chassi novo (SÓ ADMIN): { niv, modeloId, ano, empresaId? } — sem
  // empresaId ele nasce na Fábrica. Recarrega o cache de veículos no sucesso.
  FG.criarVeiculo = function (dados) {
    return req('POST', '/veiculos', dados).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  // Transfere o chassi para outra concessionária (SÓ ADMIN). `destino` pode
  // ser o NOME (string), { empresaId } vindo do autocomplete ou
  // { fabrica: true } para devolvê-lo à Fábrica. Recarrega o cache de
  // veículos no sucesso.
  FG.transferirVeiculo = function (niv, destino) {
    var body = typeof destino === 'object' ? destino : { empresa: destino };
    return req('PUT', '/veiculos/' + encodeURIComponent(niv) + '/transferir', body).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  // Corrige o ano de um chassi já cadastrado (admin). Promise<{ ok, ... }>.
  FG.editarAnoVeiculo = function (niv, ano) {
    return req('PUT', '/veiculos/' + encodeURIComponent(niv) + '/ano', { ano: ano }).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  /* ---------- histórico do veículo (linha do tempo do chassi) ---------- */
  // Busca sob demanda, sem entrar no cache geral: é uma lista por chassi, que
  // só interessa quando alguém abre aquele veículo. Resolve [] em erro para a
  // tela não quebrar por causa do histórico.
  FG.veiculoHistorico = function (niv) {
    return apiGet('/veiculos/' + encodeURIComponent(niv) + '/historico')
      .then(function (l) { return l || []; });
  };

  // As duas escritas devolvem o histórico JÁ ATUALIZADO (um array). Como o
  // req() carimba `ok` no que recebe, normalizamos para { ok, lista } — assim
  // a tela não precisa lidar com um array que também tem propriedade `ok`.
  function comLista(r) {
    if (!r.ok) return r;
    return { ok: true, lista: Array.prototype.slice.call(r) };
  }

  // Lança um registro manual no histórico (SÓ ADMIN). `dados` = { tipo:
  // 'recall'|'revisao'|'nota', titulo, detalhe?, referencia?, data? }.
  FG.registrarHistorico = function (niv, dados) {
    return req('POST', '/veiculos/' + encodeURIComponent(niv) + '/historico', dados).then(comLista);
  };

  // Apaga um registro MANUAL do histórico (SÓ ADMIN). Evento automático é
  // recusado pela API.
  FG.excluirHistorico = function (niv, id) {
    return req('DELETE', '/veiculos/' + encodeURIComponent(niv) + '/historico/' + encodeURIComponent(id))
      .then(comLista);
  };

  /* ---------- reivindicações ---------- */
  // Cria reivindicação. `dados` = { tipo, niv, descricao, status, pecas?,
  // dataDefeito?, horimetro?, quilometragem? }, onde pecas = [{ sku, quantidade }].
  // EmpresaId/UsuarioId vêm do token. As fotos sobem depois via
  // FG.uploadClaimFotos. Promise<claim|null>.
  FG.createClaim = function (dados) {
    return req('POST', '/reivindicacoes', {
      origem: dados.origem, numeroPedido: dados.numeroPedido,
      tipo: dados.tipo, niv: dados.niv, descricao: dados.descricao, status: dados.status,
      pecas: dados.pecas, dataDefeito: dados.dataDefeito,
      horimetro: dados.horimetro, quilometragem: dados.quilometragem
    }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível registrar a reivindicação.', 'erro'); return null; }
      return recarregarClaims().then(function () { return r; });
    });
  };

  // Sobe fotos para uma reivindicação (multipart). `files` = FileList/array de
  // File. Promise<{ ok, anexos?, msg? }>. NÃO define Content-Type (o browser
  // monta o boundary do multipart). Recarrega o cache de claims no sucesso.
  FG.uploadClaimFotos = function (numero, files) {
    if (!files || !files.length) return Promise.resolve({ ok: true, anexos: [] });
    var fd = new FormData();
    for (var i = 0; i < files.length; i++) fd.append('fotos', files[i]);
    return fetch(API_BASE + '/reivindicacoes/' + encodeURIComponent(numero) + '/anexos', {
      method: 'POST', headers: cabecalhos(), credentials: 'include', body: fd
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) return { ok: false, msg: data.erro || ('HTTP ' + resp.status) };
        data.ok = true;
        return recarregarClaims().then(function () { return data; });
      });
    }, function () { return { ok: false, msg: 'Falha no envio das fotos.' }; });
  };

  // Muda o status da reivindicação (admin). Promise<{ ok, ... }>.
  // Aprovar cria um pedido de garantia (e baixa estoque) — recarrega também
  // pedidos, produtos e o rastreador de pré-venda.
  FG.setClaimStatus = function (id, status) {
    return req('PUT', '/reivindicacoes/' + encodeURIComponent(id) + '/status', { status: status }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível atualizar o status.', 'erro'); return r; }
      var extras = status === 'Aprovada'
        ? [recarregarPedidos(), recarregarProdutos(), recarregarPreVenda()]
        : [];
      return Promise.all([recarregarClaims()].concat(extras)).then(function () { return r; });
    });
  };

  // Edita/reenvia uma reivindicação (cliente da própria empresa, ex.: após ser
  // devolvida). `dados` no mesmo formato de createClaim. Promise<claim|null>.
  FG.updateClaim = function (numero, dados) {
    return req('PUT', '/reivindicacoes/' + encodeURIComponent(numero), {
      origem: dados.origem, numeroPedido: dados.numeroPedido,
      tipo: dados.tipo, niv: dados.niv, descricao: dados.descricao,
      pecas: dados.pecas, dataDefeito: dados.dataDefeito,
      horimetro: dados.horimetro, quilometragem: dados.quilometragem
    }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível salvar as alterações.', 'erro'); return null; }
      return recarregarClaims().then(function () { return r; });
    });
  };

  // Devolve a reivindicação ao revendedor (admin), com o que falta (obrigatório).
  FG.devolverClaim = function (numero, faltaInformacao) {
    return req('PUT', '/reivindicacoes/' + encodeURIComponent(numero) + '/devolver',
      { faltaInformacao: faltaInformacao }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível devolver.', 'erro'); return r; }
      return recarregarClaims().then(function () { return r; });
    });
  };

  /* ---------- Parts Finder ---------- */
  // Upload multipart genérico (campo "imagem"). NÃO define Content-Type (o
  // browser monta o boundary). Devolve Promise<{ ok, imagem?, msg? }>.
  function uploadImagem(path, file, method) {
    var fd = new FormData();
    fd.append('imagem', file);
    return fetch(API_BASE + path, {
      method: method || 'POST', headers: cabecalhos(), credentials: 'include', body: fd
    })
      .then(function (resp) {
        return resp.json().catch(function () { return {}; }).then(function (data) {
          if (!resp.ok) return { ok: false, msg: data.erro || ('HTTP ' + resp.status) };
          data.ok = true;
          return data;
        });
      }, function () { return { ok: false, msg: 'Falha no envio da imagem.' }; });
  }

  // ---- leituras (REJEITAM em erro — as telas tratam com .catch) ----
  // Lista de modelos do finder (com árvore). admin + todos=true inclui inativos.
  FG.finderModelos = function (todos) {
    return api('/finder/modelos' + (todos ? '?todos=1' : ''));
  };
  // Modelo + seções agrupadas por lado ({ chassi: [...], engine: [...] }).
  FG.finderModelo = function (codigo) {
    return api('/finder/modelos/' + encodeURIComponent(codigo));
  };
  // Seção com peças + hotspots + vizinhos (anterior/próxima do mesmo lado).
  FG.finderSecao = function (secaoId) {
    return api('/finder/secoes/' + secaoId);
  };
  // Busca por VIN ou número de motor → { modelo, veiculo }. Loga no LogBusca.
  FG.finderBusca = function (filtro) {
    var qs = filtro.vin ? 'vin=' + encodeURIComponent(filtro.vin)
      : 'motor=' + encodeURIComponent(filtro.motor);
    return api('/finder/busca?' + qs);
  };
  // Usage list: seções que usam uma peça, por SKU e/ou descrição do artigo.
  FG.finderUso = function (sku, descricao) {
    var p = [];
    if (sku) p.push('sku=' + encodeURIComponent(sku));
    if (descricao) p.push('descricao=' + encodeURIComponent(descricao));
    return api('/finder/uso?' + p.join('&'));
  };

  // ---- mutações admin (resolvem { ok, ... } — nunca rejeitam) ----
  FG.finderCriarModelo = function (d) { return req('POST', '/finder/modelos', d); };
  FG.finderEditarModelo = function (codigo, d) { return req('PUT', '/finder/modelos/' + encodeURIComponent(codigo), d); };
  FG.finderExcluirModelo = function (codigo) { return req('DELETE', '/finder/modelos/' + encodeURIComponent(codigo)); };
  FG.finderUploadImagemModelo = function (codigo, file) { return uploadImagem('/finder/modelos/' + encodeURIComponent(codigo) + '/imagem', file); };
  FG.finderRemoverImagemModelo = function (codigo) { return req('DELETE', '/finder/modelos/' + encodeURIComponent(codigo) + '/imagem'); };

  FG.finderCriarSecao = function (codigo, d) { return req('POST', '/finder/modelos/' + encodeURIComponent(codigo) + '/secoes', d); };
  FG.finderEditarSecao = function (secaoId, d) { return req('PUT', '/finder/secoes/' + secaoId, d); };
  FG.finderExcluirSecao = function (secaoId) { return req('DELETE', '/finder/secoes/' + secaoId); };
  FG.finderOrdemSecoes = function (codigo, lado, ids) {
    return req('PUT', '/finder/modelos/' + encodeURIComponent(codigo) + '/secoes/ordem', { lado: lado, ids: ids });
  };
  FG.finderUploadImagemSecao = function (secaoId, file) { return uploadImagem('/finder/secoes/' + secaoId + '/imagem', file); };
  FG.finderRemoverImagemSecao = function (secaoId) { return req('DELETE', '/finder/secoes/' + secaoId + '/imagem'); };

  FG.finderAddPeca = function (secaoId, d) { return req('POST', '/finder/secoes/' + secaoId + '/pecas', d); };
  FG.finderEditarPeca = function (pecaId, d) { return req('PUT', '/finder/pecas/' + pecaId, d); };
  FG.finderExcluirPeca = function (pecaId) { return req('DELETE', '/finder/pecas/' + pecaId); };
  FG.finderOrdemPecas = function (secaoId, ids) { return req('PUT', '/finder/secoes/' + secaoId + '/pecas/ordem', { ids: ids }); };

  FG.finderSalvarHotspots = function (secaoId, lista) { return req('PUT', '/finder/secoes/' + secaoId + '/hotspots', { hotspots: lista }); };
  FG.finderAddHotspot = function (secaoId, d) { return req('POST', '/finder/secoes/' + secaoId + '/hotspots', d); };
  FG.finderEditarHotspot = function (hotspotId, d) { return req('PUT', '/finder/hotspots/' + hotspotId, d); };
  FG.finderExcluirHotspot = function (hotspotId) { return req('DELETE', '/finder/hotspots/' + hotspotId); };

  // Foto do produto (miniatura da peça no finder). Recarrega o cache no ok.
  FG.uploadImagemProduto = function (sku, file) {
    return uploadImagem('/produtos/' + encodeURIComponent(sku) + '/imagem', file).then(function (r) {
      if (!r.ok) return r;
      return recarregarProdutos().then(function () { return r; });
    });
  };
  FG.removerImagemProduto = function (sku) {
    return req('DELETE', '/produtos/' + encodeURIComponent(sku) + '/imagem').then(function (r) {
      if (!r.ok) return r;
      return recarregarProdutos().then(function () { return r; });
    });
  };

  /* ---------- integração Tiny ERP (admin) ---------- */
  // Lista paginada de produtos do Tiny com a situação local de cada um
  // (novo / sku-existe / importado). REJEITA em erro — a tela trata.
  FG.tinyProdutos = function (pagina, pesquisa) {
    return api('/tiny/produtos?pagina=' + (pagina || 1) +
      (pesquisa ? '&pesquisa=' + encodeURIComponent(pesquisa) : ''));
  };
  // Importa/vincula os produtos selecionados. Recarrega o catálogo no fim.
  FG.tinyImportar = function (tinyIds, categoria) {
    return req('POST', '/tiny/importar', { tinyIds: tinyIds, categoria: categoria }).then(function (r) {
      if (!r.ok) return r;
      return recarregarProdutos().then(function () { return r; });
    });
  };
  // Sincroniza um bloco de SKUs contra o Tiny (a tela envia em lotes e soma
  // os resumos). Recarrega o catálogo no fim.
  FG.tinySyncLote = function (skus) {
    return req('POST', '/tiny/sync-lote', { skus: skus }).then(function (r) {
      if (!r.ok) return r;
      return recarregarProdutos().then(function () { return r; });
    });
  };
  // Registros de sincronização de UM produto (o log fica no editor do produto).
  FG.tinyLog = function (sku, limite) {
    return api('/tiny/log?limite=' + (limite || 20) +
      (sku ? '&sku=' + encodeURIComponent(sku) : ''));
  };
  // Exportações ao Tiny de UM pedido (exibidas no detalhe da venda no admin).
  FG.tinyPedidos = function (pedido) {
    return api('/tiny/pedidos' + (pedido ? '?pedido=' + encodeURIComponent(pedido) : ''));
  };
  // Força nova tentativa de uma exportação com erro.
  FG.tinyReexportar = function (exportId) {
    return req('POST', '/tiny/pedidos/' + exportId + '/reexportar');
  };

  /* =======================================================================
     SUPORTE TÉCNICO (helpdesk por chamados)
     -----------------------------------------------------------------------
     Serve as duas janelas para os mesmos dados: o pop-up flutuante do canto
     da tela (js/suporte.js) e a aba "Suporte Técnico" do portal.

     Os chamados NÃO entram no CACHE que carrega junto com a página. O cache
     existe para o que a tela lê de forma síncrona ao montar (catálogo,
     pedidos, veículos); chamado é conversa, muda enquanto a página está
     aberta e é sempre buscado na hora — um cache aqui só mostraria resposta
     velha. O único número que circula fora do detalhe é o do badge, e ele tem
     rota própria e barata (/suporte/resumo).
     ======================================================================= */

  // POST multipart genérico do suporte (o anexo é opcional em toda mensagem).
  // Sem Content-Type de propósito: quem monta o boundary é o navegador.
  // cabecalhos() continua entregando o X-CSRF-Token — escrita por cookie
  // precisa provar a origem, upload inclusive.
  function postSuporte(path, campos, arquivo) {
    var fd = new FormData();
    Object.keys(campos || {}).forEach(function (k) {
      if (campos[k] !== undefined && campos[k] !== null) fd.append(k, campos[k]);
    });
    if (arquivo) fd.append('anexo', arquivo);
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: cabecalhos(),
      credentials: 'include',
      body: fd
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && temSessao()) encerrarSessao('expirada');
        if (!r.ok) return { ok: false, msg: data.erro || ('HTTP ' + r.status) };
        data.ok = true;
        return data;
      });
    }, function () { return { ok: false, msg: 'Sem conexão com a API.' }; });
  }

  // Categorias de ajuda. Só mudam com o deploy, então uma cópia por página
  // basta — o pop-up abre e fecha muitas vezes e não precisa perguntar toda vez.
  var categoriasSuporte = null;
  FG.suporteCategorias = function () {
    if (categoriasSuporte) return Promise.resolve(categoriasSuporte);
    return apiGet('/suporte/categorias').then(function (l) {
      categoriasSuporte = l || [];
      return categoriasSuporte;
    });
  };

  // Contadores do badge: { abertos, naoLidas }. Nunca rejeita — o pop-up não
  // pode quebrar a página por causa de um número.
  FG.suporteResumo = function () {
    return apiGet('/suporte/resumo').then(function (d) {
      return d || { abertos: 0, naoLidas: 0 };
    });
  };

  // Lista de chamados (cliente: os da sua concessionária; admin: todos).
  FG.suporteChamados = function (status) {
    return apiGet('/suporte/chamados' + (status ? '?status=' + encodeURIComponent(status) : ''))
      .then(function (l) { return l || []; });
  };

  // Detalhe com a conversa. Abrir MARCA COMO LIDAS as mensagens do outro lado
  // (é a API que faz isso), então quem chama deve atualizar o badge depois.
  FG.suporteChamado = function (id) {
    return apiGet('/suporte/chamados/' + encodeURIComponent(id));
  };

  // Abre um chamado. `dados` = { categoria, assunto, descricao, prioridade,
  // anexo? (File) }. Devolve Promise<{ ok, ...chamado } | { ok:false, msg }>.
  FG.suporteAbrir = function (dados) {
    return postSuporte('/suporte/chamados', {
      categoria: dados.categoria,
      assunto: dados.assunto,
      descricao: dados.descricao,
      prioridade: dados.prioridade || 'normal'
    }, dados.anexo);
  };

  // Responde num chamado existente. `dados` = { texto, anexo? (File) }.
  FG.suporteResponder = function (id, dados) {
    return postSuporte('/suporte/chamados/' + encodeURIComponent(id) + '/mensagens',
      { texto: dados.texto || '' }, dados.anexo);
  };

  // Muda o status. Cliente só encerra ('Fechado') ou reabre ('Aberto') —
  // a API recusa o resto com 403.
  FG.suporteStatus = function (id, status) {
    return req('PATCH', '/suporte/chamados/' + encodeURIComponent(id), { status: status });
  };

  /* ---------- o pulso (ver js/ao-vivo.js) ---------- */
  // Quatro números que dizem se algo mudou: { notificacoes, suporteAbertos,
  // suporteNaoLidas, ultimaMensagem }. É a requisição mais frequente do
  // portal (uma a cada 10s por aba), por isso não traz lista nenhuma — quem
  // percebe uma mudança é que vai buscar o conteúdo.
  //
  // NUNCA rejeita: uma falha de rede no meio de uma tarefa não pode virar erro
  // na tela por causa de um contador. Devolve null e o laço tenta de novo no
  // batimento seguinte.
  FG.pulso = function () {
    return apiGet('/pulso');
  };

  // Expõe helpers para depuração no console.
  FG._api = api;
  FG._cache = CACHE;

  /* =======================================================================
     SINCRONIZAÇÃO DA SESSÃO COM O SERVIDOR
     -----------------------------------------------------------------------
     Pergunta ao servidor quem somos, em vez de acreditar no perfil guardado.
     Ganha-se uma coisa que o desenho antigo não tinha: mudança de papel,
     status ou permissão feita pelo admin passa a valer na próxima página, e
     não só no próximo login. Antes, um usuário rebaixado continuava vendo a
     tela de admin até deslogar — as rotas o barravam, mas a interface mentia.

     É também aqui que o `imp` (identidade assumida) chega da fonte da
     verdade: o claim dentro do token assinado, e não um sinalizador do
     cliente que pode estar velho.

     Roda em PARALELO com o cache: são duas chamadas independentes, e
     enfileirá-las só somaria latência à abertura de cada página.
     ======================================================================= */
  function sincronizarSessao() {
    if (!temSessao()) return Promise.resolve(null);
    return api('/auth/sessao').then(function (d) {
      guardarPerfil(d.usuario);
      marcarImpersonacao(d.imp || null);
      montarTarjaIdentidade();     // sobe ou cai, conforme o servidor disser
      return d;
    }, function () {
      // Falha de rede não derruba a sessão: seguimos com o perfil guardado.
      // Se tiver sido 401, o api() já encerrou a sessão por conta própria.
      return null;
    });
  }
  FG.sincronizarSessao = sincronizarSessao;

  // Dispara sessão e cache assim que a página abre (se houver sessão).
  // FG.pronto resolve quando ambos terminaram — cada tela espera por ele
  // antes de montar o HTML, para nunca renderizar com dados vazios nem com
  // um perfil desatualizado.
  FG.pronto = Promise.all([sincronizarSessao(), carregarCache()])
    .then(function () { return CACHE; });
})();
