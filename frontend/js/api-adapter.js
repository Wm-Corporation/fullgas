/* =========================================================
   FULLGAS B2B — Adaptador de API (inclua DEPOIS de js/store.js)
   Troca o localStorage do store.js pela API. As telas leem do cache em memória
   (FG.all) e esperam FG.pronto antes de renderizar.
   ========================================================= */
(function () {
  'use strict';

  // Ajuste para a URL onde a API está publicada.
  var API_BASE = window.FULLGAS_API_BASE || 'http://localhost:3000/api';

  /* ---- Sessão ----
     O token fica no cookie httpOnly fg_sess (o JS não lê). Cookies legíveis:
     fg_exp = validade (segundos UNIX) · fg_csrf = valor do header X-CSRF-Token. */
  function cookie(nome) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + nome + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  // O `path` precisa ser o mesmo da gravação.
  function apagarCookie(nome) {
    document.cookie = nome + '=; path=/; max-age=0';
  }

  // Palpite para renderizar; quem decide é a API.
  function temSessao() { return !!cookie('fg_exp'); }

  // Cabeçalhos de toda chamada (X-CSRF-Token; nunca Authorization).
  function cabecalhos(extra) {
    var h = extra || {};
    h['ngrok-skip-browser-warning'] = '1';
    var c = cookie('fg_csrf');
    if (c) h['X-CSRF-Token'] = c;
    return h;
  }

  /* ---- Guardião de sessão ----
     Encerra por: token vencido (fg_exp), inatividade (carimbo no localStorage,
     vale entre páginas) ou resposta 401 da API. */
  var INATIVIDADE_MS = 4 * 60 * 60 * 1000;      // 4 h sem interação
  var ATIVIDADE_KEY  = 'fullgas_ultima_atividade';
  var CHECAGEM_MS    = 30 * 1000;               // varredura periódica
  var encerrando     = false;                   // trava anti-loop de redirect

  // Validade da sessão em ms (cookie fg_exp); 0 = sem sessão.
  function tokenExpiraEm() {
    var exp = parseInt(cookie('fg_exp'), 10);
    return exp ? exp * 1000 : 0;
  }

  function marcarAtividade() {
    try { localStorage.setItem(ATIVIDADE_KEY, String(Date.now())); } catch (e) {}
  }

  // 'expirada' | 'inatividade' | null
  function motivoEncerramento() {
    if (!temSessao()) return null;              // não há sessão a encerrar
    var exp = tokenExpiraEm();
    if (exp && Date.now() >= exp) return 'expirada';
    var ultima = parseInt(localStorage.getItem(ATIVIDADE_KEY) || '0', 10);
    if (ultima && (Date.now() - ultima) >= INATIVIDADE_MS) return 'inatividade';
    return null;
  }

  // Limpa o lado do cliente (as três primeiras chaves são legado do localStorage).
  function limparLocal() {
    try {
      localStorage.removeItem('fullgas_token_v1');
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(ADMIN_SESS_KEY);
      localStorage.removeItem('fullgas_session_v1');
      localStorage.removeItem(IMP_KEY);
      localStorage.removeItem(ATIVIDADE_KEY);
      // Cesta e cópia de dados saem junto (computador compartilhado).
      localStorage.removeItem(CESTA_KEY);
      localStorage.removeItem(CESTA_DONO_KEY);
      localStorage.removeItem(DADOS_LEGADO_KEY);
    } catch (e) {}
  }

  /* ---- O que não fica no navegador ----
     fullgas_db_v1: FG.save vira no-op e a chave é apagada.
     Cesta: tem dono (id da sessão) e é descartada quando muda quem está logado. */
  var CESTA_KEY = 'fullgas_cart_v1';
  var CESTA_DONO_KEY = 'fullgas_cart_dono';
  var DADOS_LEGADO_KEY = 'fullgas_db_v1';

  try { localStorage.removeItem(DADOS_LEGADO_KEY); } catch (e) {}
  FG.save = function () { /* com API, nada é persistido no navegador */ };

  function garantirDonoDaCesta() {
    try {
      var s = FG.session();
      var id = s && s.id != null ? String(s.id) : '';
      if (localStorage.getItem(CESTA_DONO_KEY) !== id) {
        localStorage.removeItem(CESTA_KEY);
        if (id) localStorage.setItem(CESTA_DONO_KEY, id);
        else localStorage.removeItem(CESTA_DONO_KEY);
      }
    } catch (e) {}
  }
  garantirDonoDaCesta();

  // Encerra a sessão e vai para `destino`. Só o servidor apaga o fg_sess (httpOnly).
  // Redireciona mesmo se a chamada falhar.
  function encerrarSessao(motivo, destino) {
    if (encerrando) return;                     // trava anti-loop de redirect
    encerrando = true;
    limparLocal();
    // Apaga os cookies legíveis já, para não voltar em círculo se a rede falhar.
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
      // Manda o cookie também em origem cruzada (dev).
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          // 401 com sessão no front: encerra e volta ao login.
          if (r.status === 401 && temSessao()) encerrarSessao('expirada');
          throw new Error(data.erro || ('HTTP ' + r.status));
        }
        return data;
      });
    }, function (e) {
      // Queda de rede: o navegador diz "Failed to fetch", que ninguém entende.
      throw new Error('Sem conexão com o servidor. Confira sua internet e tente de novo.');
    });
  }

  // GET resiliente para o cache: resolve com os dados ou null (nunca rejeita).
  function apiGet(path) {
    return api(path).then(function (d) { return d; }, function () { return null; });
  }

  /* ---- Arquivos protegidos (garantia, notificação, suporte) ----
     <img>/<a> não autenticam: busca por fetch e troca por blob. O HTML usa data-arquivo. */
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

  // Resolve os data-arquivo de `raiz`: href em <a>, src nos demais.
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
                notifications: [], users: [], searches: [], blackorders: [] };

  // De onde vem cada lista do cache.
  var FONTES = [
    ['products', '/produtos'],
    ['categories', '/categorias'],
    ['orders', '/pedidos'],
    ['models', '/veiculos/modelos'],
    ['vehicles', '/veiculos'],
    ['invoices', '/faturas'],
    ['blackorders', '/blackorders'],
    ['claims', '/reivindicacoes'],
    ['users', '/usuarios'],   // só admin recebe; cliente resolve null
    ['notifications', '/notificacoes']
  ];

  // Listas que a página usa (<body data-cache="...">). "" = nenhuma; sem o atributo, todas.
  function listasDaPagina() {
    var attr = document.body ? document.body.getAttribute('data-cache') : null;
    return attr == null ? null : attr.split(/\s+/).filter(Boolean);
  }
  var LISTAS_DA_PAGINA = listasDaPagina();

  // Carrega o cache da página em paralelo. Sem sessão, resolve vazio.
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


  function recarregarBlackOrders() {
    return apiGet('/blackorders').then(function (l) { if (l) CACHE.blackorders = l; return l; });
  }
  FG.recarregarBlackOrders = recarregarBlackOrders;

  function recarregarVeiculos() {
    return apiGet('/veiculos').then(function (l) { if (l) CACHE.vehicles = l; return l; });
  }
  FG.recarregarVeiculos = recarregarVeiculos;

  // Foto de modelo mudou: recarrega modelos e veículos.
  FG.recarregarModelosEVeiculos = function () {
    return Promise.all([
      apiGet('/veiculos/modelos').then(function (l) { if (l) CACHE.models = l; return l; }),
      recarregarVeiculos()
    ]);
  };

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

  // Abriu a caixa de notificações: todas viram lidas (uma chamada só).
  FG.marcarNotifsLidas = function () {
    CACHE.notifications.forEach(function (n) { n.lida = true; });   // otimista
    return req('POST', '/notificacoes/lidas', {});
  };

  // Admin envia notificação: { titulo, texto, tipo, empresaId?, anexo? }. Promise<{ ok, msg? }>.
  FG.notifEnviar = function (dados) {
    var fd = new FormData();
    fd.append('titulo', dados.titulo || '');
    fd.append('texto', dados.texto || '');
    fd.append('tipo', dados.tipo || 'info');
    if (dados.empresaId) fd.append('empresaId', dados.empresaId);
    if (dados.anexo) fd.append('anexo', dados.anexo);
    // Sem Content-Type (o navegador monta o multipart); o X-CSRF-Token vai junto.
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
  // Promise<{ empresa, endereco, areas, usuarios } | null>
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

  // Acesso à área? Admin, gestor e sem lista = acesso total.
  FG.temArea = function (sess, area) {
    if (!sess) return false;
    if (sess.papel === 'admin' || sess.gestor || !Array.isArray(sess.permissoes)) return true;
    return sess.permissoes.indexOf(area) !== -1;
  };

  // Admin: aprova / bloqueia / muda papel. Promise<{ ok, msg? }>.
  FG.setUser = function (id, patch) {
    return req('PATCH', '/usuarios/' + encodeURIComponent(id), patch).then(function (r) {
      if (!r.ok) return r;
      var u = CACHE.users.find(function (x) { return String(x.id) === String(id); });
      if (u) Object.keys(patch).forEach(function (k) { u[k] = patch[k]; });
      return r;
    });
  };

  // Admin cria administrador: { nome, email, senha }. Promise<{ ok, msg? }>.
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

  // Admin exclui usuário. Promise<{ ok, msg? }>.
  FG.delUser = function (id) {
    return req('DELETE', '/usuarios/' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) return r;
      CACHE.users = CACHE.users.filter(function (x) { return String(x.id) !== String(id); });
      return r;
    });
  };

  // ---- Listas de preço (admin) ----
  // Promise<[{ id, descricao, percentual, ativa, empresas }]> ([] se falhar).
  FG.listasPreco = function () {
    return apiGet('/listas-preco').then(function (l) { return l || []; });
  };
  // Traz as listas do Tiny agora. Promise<{ ok, listas?, resumo?, msg? }>.
  FG.sincronizarListasPreco = function () { return req('POST', '/listas-preco/sincronizar'); };
  // Escolha manual da lista. Promise<{ ok, msg? }>.
  FG.definirListaPreco = function (empresaId, listaPrecoId) {
    return req('PUT', '/empresas/' + encodeURIComponent(empresaId) + '/lista-preco', { listaPrecoId: listaPrecoId });
  };
  // Relê a lista no Tiny. Promise<{ ok, resultado?, lista?, msg? }>.
  FG.buscarListaNoTiny = function (empresaId) {
    return req('POST', '/empresas/' + encodeURIComponent(empresaId) + '/lista-preco/tiny');
  };
  // % do Tiny → texto: -20 → "20% de desconto"; 5 → "5% de acréscimo".
  FG.textoPercentual = function (p) {
    p = Number(p) || 0;
    if (!p) return 'sem desconto';
    var n = String(Math.abs(p)).replace('.', ',') + '%';
    return p < 0 ? n + ' de desconto' : n + ' de acréscimo';
  };

  function recarregarProdutos() {
    return apiGet('/produtos').then(function (l) { if (l) CACHE.products = l; return l; });
  }

  /* ---------- sobrescreve a camada de dados do FG ---------- */
  // Leituras continuam SÍNCRONAS, lendo do cache em memória.
  FG.db = function () { return CACHE; };
  // Avisa no console quando a página pede uma lista que não declarou.
  var avisadas = {};
  FG.all = function (col) {
    if (LISTAS_DA_PAGINA && LISTAS_DA_PAGINA.indexOf(col) < 0 && !avisadas[col] &&
        FONTES.some(function (f) { return f[0] === col; }) && !CACHE[col].length) {
      avisadas[col] = true;
      console.warn('[Fullgas] FG.all("' + col + '") numa página que não declarou essa lista em <body data-cache>.');
    }
    return CACHE[col] || [];
  };

  // Requisição que nunca rejeita: { ok: true, ... } ou { ok: false, msg }.
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

  // Perfil de exibição no localStorage (não é credencial; o token nunca vai para lá).
  function guardarPerfil(u) {
    try {
      localStorage.setItem('fullgas_session_v1', JSON.stringify({
        id: u.id, nome: u.nome, email: u.email,
        papel: u.papel, empresa: u.empresa, empresaId: u.empresaId,
        gestor: !!u.gestor,
        permissoes: u.permissoes || null      // null = acesso total
      }));
    } catch (e) {}
    // Mudou quem está logado: descarta a cesta anterior.
    garantirDonoDaCesta();
  }

  // Site key do anti-robô, ou ''.
  FG.captchaConfig = function () {
    return api('/auth/captcha/config').then(function (d) { return (d && d.siteKey) || ''; },
                                            function () { return ''; });
  };

  // Login. Promise<{ ok, msg? }>. A sessão chega por Set-Cookie. `captcha` pode ser vazio.
  FG.login = function (email, senha, captcha) {
    return api('/auth/login', { method: 'POST', body: { email: email, senha: senha, captcha: captcha || '' } })
      .then(function (data) {
        guardarPerfil(data.usuario);
        return { ok: true };
      }, function (e) {
        return { ok: false, msg: (e && e.message) || 'Falha no login.' };
      });
  };

  // Cadastro. Promise<{ ok, msg? }>.
  FG.register = function (dados) {
    return api('/auth/register', { method: 'POST', body: dados })
      .then(function () { return { ok: true }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Falha no cadastro.' }; });
  };

  // Troca a própria senha. Promise<{ ok, msg }>.
  FG.trocarSenha = function (atual, nova) {
    return req('POST', '/auth/senha/trocar', { atual: atual, nova: nova });
  };

  /* ---------- esqueci minha senha ---------- */

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

  /* ---------- identidade assumida (admin na conta do cliente) ----------
     O servidor guarda o admin no claim `imp`. Aqui só um sinalizador no localStorage,
     para a tarja aparecer já no primeiro quadro (a API corrige depois). */
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

  // Admin assume a identidade. Promise<{ ok, msg? }>.
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

  // Volta à conta do admin (o servidor revalida). Falhou: sai.
  FG.voltarIdentidade = function (destino) {
    return api('/auth/identidade/voltar', { method: 'POST' })
      .then(function (d) {
        marcarImpersonacao(null);
        guardarPerfil(d.usuario);
        location.href = destino || '/admin';
      }, function (e) {
        // Não dá para voltar: sair.
        marcarImpersonacao(null);
        FG.toast((e && e.message) || 'Não foi possível voltar para sua conta.', 'erro');
        setTimeout(function () { encerrarSessao('expirada'); }, 1500);
      });
  };

  // Tarja de aviso em qualquer página.
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
    bar.querySelector('.imp-sair').addEventListener('click', function () {
      // Trava o botão até a volta terminar.
      this.disabled = true; this.textContent = 'Voltando…';
      FG.voltarIdentidade();
    });
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('com-imp-bar');
  }
  // Tira a tarja quando o servidor diz que não há identidade assumida.
  function removerTarjaIdentidade() {
    var bar = document.getElementById('fg-imp-bar');
    if (bar) bar.remove();
    document.body.classList.remove('com-imp-bar');
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', montarTarjaIdentidade);
  else montarTarjaIdentidade();

  // Sair. Em identidade assumida, volta à conta do admin.
  FG.logout = function () {
    if (FG.identidadeAssumida()) { FG.voltarIdentidade(); return; }
    encerrarSessao(null, '/');
  };

  FG.apiCriarProduto = function (p) { return api('/produtos', { method: 'POST', body: p }).then(recarregarProdutos); };
  FG.apiEditarProduto = function (sku, p) { return api('/produtos/' + encodeURIComponent(sku), { method: 'PUT', body: p }).then(recarregarProdutos); };
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
  // Cria o pedido da cesta. Promise<data|null> (erro vira toast).
  FG.createOrder = function () {
    var s = FG.session(); var cart = FG.cart();
    if (!s || !cart.length) return Promise.resolve(null);
    var itens = cart.map(function (i) { return { sku: i.artigo, quantidade: i.qtd }; });
    return api('/pedidos', { method: 'POST', body: { itens: itens } }).then(function (data) {
      FG.cartClear();
      return Promise.all([recarregarPedidos(), recarregarProdutos(), recarregarBlackOrders()]).then(function () { return data; });
    }, function (e) {
      FG.toast((e && e.message) || 'Não foi possível finalizar o pedido.');
      return null;
    });
  };

  // ---- Black order ----
  // Carrinho da black order: [{ id, quantidade }] → Promise<{ ok, id, total, itens, liberadas } | { ok:false, msg }>.
  FG.boComprar = function (itens) {
    return req('POST', '/blackorders/comprar', { itens: itens }).then(function (r) {
      return Promise.all([recarregarBlackOrders(), recarregarPedidos(), recarregarFaturas()])
        .then(function () { return r; }, function () { return r; });
    });
  };
  // Cliente desiste do que falta; admin cancela (com motivo).
  FG.boDesistir = function (id, motivo) {
    return req('POST', '/blackorders/' + encodeURIComponent(id) + '/desistir', { motivo: motivo || '' }).then(function (r) {
      return recarregarBlackOrders().then(function () { return r; }, function () { return r; });
    });
  };
  // Admin: { ids, situacao?, previsao?, observacao?, avisar? }.
  FG.boAtualizar = function (dados) {
    return req('PATCH', '/blackorders', dados).then(function (r) {
      return recarregarBlackOrders().then(function () { return r; }, function () { return r; });
    });
  };

  // Gravação de pedido que mexe em estoque: recarrega pedidos e produtos.
  function putPedido(path, body, metodo) {
    return req(metodo || 'PUT', path, body).then(function (r) {
      if (!r.ok) return r;
      return Promise.all([recarregarPedidos(), recarregarProdutos()]).then(function () { return r; });
    });
  }

  // Peça não encontrada (admin): { quantidade, motivo, destino: 'remover' | 'blackorder' }.
  FG.marcarNaoEncontrada = function (numero, itemId, dados) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/itens/' + encodeURIComponent(itemId) + '/nao-encontrada', dados, 'POST')
      .then(function (r) { return r.ok && FG.recarregarBlackOrders ? FG.recarregarBlackOrders().then(function () { return r; }, function () { return r; }) : r; });
  };

  // "Confirmar envio" (admin). Promise<{ ok, status, itens, parcial, fatura }>.
  FG.confirmarRemessa = function (numero) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/remessa', {}, 'POST');
  };

  // Muda o status do pedido (admin). Promise<{ ok, ... }>.
  FG.setOrderStatus = function (id, status) {
    return putPedido('/pedidos/' + encodeURIComponent(id) + '/status', { status: status });
  };

  // SKUs de um modelo no Finder (filtro da loja), com cache. [] em erro.
  var skusDoModelo = {};
  FG.artigosDoModelo = function (codigo) {
    if (skusDoModelo[codigo]) return skusDoModelo[codigo];
    skusDoModelo[codigo] = api('/finder/modelos/' + encodeURIComponent(codigo)).then(function (m) {
      var secoes = [].concat(m.chassi || [], m.engine || []);
      return Promise.all(secoes.map(function (s) {
        return api('/finder/secoes/' + s.id).then(function (d) {
          return (d.pecas || []).map(function (p) { return p.sku || p.artigo; });
        }, function () { return []; });
      })).then(function (listas) {
        var set = {};
        listas.forEach(function (l) { l.forEach(function (k) { if (k) set[k] = true; }); });
        return Object.keys(set);
      });
    }).catch(function () { delete skusDoModelo[codigo]; return []; });
    return skusDoModelo[codigo];
  };

  // Linha do tempo do pedido (HTML), igual à do chassi.
  var HIST_PEDIDO_ICONE = { criado: '🛒', aprovado: '✔', tiny: '⇄', envio: '📦', entregue: '🏁',
    cancelado: '✖', garantia: '🛡', aviso: '⚠' };
  FG.historicoPedidoHTML = function (lista) {
    if (!lista || !lista.length)
      return '<p class="muted">Nenhum registro ainda. O que acontecer com este pedido aparece aqui.</p>';
    return '<div class="hist-lista">' + lista.map(function (h) {
      return '<div class="hist-item hist-' + FG.esc(h.tipo) + '">' +
        '<div class="hist-ico">' + (HIST_PEDIDO_ICONE[h.tipo] || '•') + '</div>' +
        '<div class="hist-corpo"><div class="hist-linha1"><b>' + FG.esc(h.titulo) + '</b>' +
        '<span class="hist-data">' + FG.fmtDateTime(h.data) + '</span></div>' +
        (h.detalhe ? '<div class="hist-detalhe">' + FG.esc(h.detalhe) + '</div>' : '') +
        (h.usuario ? '<div class="hist-rodape">' + FG.esc(h.usuario) + '</div>' : '') +
        '</div></div>';
    }).join('') + '</div>';
  };

  // Detalhe do pedido (itens, faturas, progresso e histórico). Promise<detalhe|null>.
  FG.pedidoDetalhe = function (numero) {
    return apiGet('/pedidos/' + encodeURIComponent(numero));
  };

  // Envio segmentado por escopo: 'normal' | 'backorder' | 'tudo' (admin).
  FG.enviarPedidoEscopo = function (numero, escopo) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/status', { escopo: escopo });
  };

  // "Enviado" de um item (admin). Recarrega pedidos e produtos.
  FG.setItemEnviado = function (numero, itemId, qtd) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/itens/' + itemId + '/enviado', { qtd: qtd });
  };

  /* ---------- veículos: substitui as ações inline do portal.js ---------- */
  // Registra a venda: { cliente, cpf, email, telefone, endereco }.
  FG.registrarVenda = function (niv, dados) {
    return req('POST', '/veiculos/' + encodeURIComponent(niv) + '/venda', dados || {}).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  // Concessionárias ativas (admin), com cache.
  var _empresas = null;
  FG.empresas = function () {
    if (_empresas) return Promise.resolve(_empresas);
    return apiGet('/empresas').then(function (l) { _empresas = l || []; return _empresas; });
  };

  // Cadastra chassi (admin): { niv, modeloId, ano, empresaId? }.
  FG.criarVeiculo = function (dados) {
    return req('POST', '/veiculos', dados).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  // Transfere o chassi (admin). destino: nome | { empresaId } | { fabrica: true }.
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
  // Histórico do chassi, sob demanda. [] em erro.
  FG.veiculoHistorico = function (niv) {
    return apiGet('/veiculos/' + encodeURIComponent(niv) + '/historico')
      .then(function (l) { return l || []; });
  };

  // Normaliza a resposta (array) para { ok, lista }.
  function comLista(r) {
    if (!r.ok) return r;
    return { ok: true, lista: Array.prototype.slice.call(r) };
  }

  // Lançamento manual (admin): { tipo: 'recall'|'revisao'|'nota', titulo, detalhe?, referencia?, data? }.
  FG.registrarHistorico = function (niv, dados) {
    return req('POST', '/veiculos/' + encodeURIComponent(niv) + '/historico', dados).then(comLista);
  };

  // Apaga lançamento manual (admin).
  FG.excluirHistorico = function (niv, id) {
    return req('DELETE', '/veiculos/' + encodeURIComponent(niv) + '/historico/' + encodeURIComponent(id))
      .then(comLista);
  };

  /* ---------- reivindicações ---------- */
  // Cria reivindicação: { tipo, niv, descricao, status, pecas?: [{ sku, quantidade }], dataDefeito?, horimetro?, quilometragem? }.
  // Fotos sobem depois (FG.uploadClaimFotos). Promise<claim|null>.
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

  // Sobe fotos da reivindicação (multipart, sem Content-Type). Promise<{ ok, anexos?, msg? }>.
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

  // Muda o status (admin). Aprovar cria pedido de garantia: recarrega pedidos e produtos.
  FG.setClaimStatus = function (id, status) {
    return req('PUT', '/reivindicacoes/' + encodeURIComponent(id) + '/status', { status: status }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível atualizar o status.', 'erro'); return r; }
      var extras = status === 'Aprovada'
        ? [recarregarPedidos(), recarregarProdutos()]
        : [];
      return Promise.all([recarregarClaims()].concat(extras)).then(function () { return r; });
    });
  };

  // Edita/reenvia reivindicação devolvida. Promise<claim|null>.
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
  // Upload multipart (campo "imagem"). Promise<{ ok, imagem?, msg? }>.
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

  // ---- Leituras do Finder (rejeitam em erro) ----
  // Modelos com árvore. todos=true (admin) inclui inativos.
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
  // Produtos do Tiny com a situação local. Rejeita em erro.
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
  // Sincroniza um bloco de SKUs. Recarrega o catálogo.
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
  // Cadastro das concessionárias no Tiny. Rejeita em erro.
  FG.tinyContatos = function () {
    return api('/tiny/contatos');
  };
  // Força nova tentativa de uma exportação com erro.
  FG.tinyReexportar = function (exportId) {
    return req('POST', '/tiny/pedidos/' + exportId + '/reexportar');
  };

  /* ---- Suporte Técnico ----
     Chamados não entram no cache (mudam com a página aberta); sempre buscados na hora. */

  // POST multipart do suporte (anexo opcional, sem Content-Type).
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

  // Categorias: uma cópia por página.
  var categoriasSuporte = null;
  FG.suporteCategorias = function () {
    if (categoriasSuporte) return Promise.resolve(categoriasSuporte);
    return apiGet('/suporte/categorias').then(function (l) {
      categoriasSuporte = l || [];
      return categoriasSuporte;
    });
  };

  // { abertos, naoLidas }. Nunca rejeita.
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

  // Detalhe com a conversa. A API marca como lidas: atualize o badge depois.
  FG.suporteChamado = function (id) {
    return apiGet('/suporte/chamados/' + encodeURIComponent(id));
  };

  // Abre chamado: { categoria, assunto, descricao, prioridade, anexo? }.
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

  // Muda o status. Cliente só fecha ou reabre.
  FG.suporteStatus = function (id, status) {
    return req('PATCH', '/suporte/chamados/' + encodeURIComponent(id), { status: status });
  };

  /* ---------- o pulso (ver js/ao-vivo.js) ---------- */
  // { notificacoes, suporteAbertos, suporteNaoLidas, ultimaMensagem }. Nunca rejeita (null em falha).
  FG.pulso = function () {
    return apiGet('/pulso');
  };

  // Expõe helpers para depuração no console.
  FG._api = api;
  FG._cache = CACHE;

  // Perfil atual do servidor (papel, permissões, `imp`). Roda em paralelo com o cache.
  function sincronizarSessao() {
    if (!temSessao()) return Promise.resolve(null);
    return api('/auth/sessao').then(function (d) {
      guardarPerfil(d.usuario);
      marcarImpersonacao(d.imp || null);
      montarTarjaIdentidade();     // sobe ou cai, conforme o servidor disser
      return d;
    }, function () {
      // Falha de rede: segue com o perfil guardado (401 já encerrou no api()).
      return null;
    });
  }
  FG.sincronizarSessao = sincronizarSessao;

  // Sessão e cache ao abrir a página; as telas esperam FG.pronto.
  FG.pronto = Promise.all([sincronizarSessao(), carregarCache()])
    .then(function () { return CACHE; });
})();
