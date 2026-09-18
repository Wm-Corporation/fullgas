/* =========================================================
   FULLGAS B2B — autenticação (index.html)
   ========================================================= */
(function () {
  'use strict';

  var tabLogin = document.getElementById('tab-login');
  var tabCad = document.getElementById('tab-cad');
  var formLogin = document.getElementById('form-login');
  var formCad = document.getElementById('form-cad');
  var formEsq = document.getElementById('form-esq');
  var msg = document.getElementById('auth-msg');

  // se já existe sessão, vai direto para o portal
  if (FG.session()) { location.href = '/portal'; return; }

  // Cookie de sessão válido, mas sem o perfil no localStorage. Acontece quando
  // o perfil se perde e o cookie sobrevive — por exemplo, um logout cujo POST
  // não chegou ao servidor, ou uma limpeza de localStorage sem limpar cookies.
  // A sessão EXISTE; só o cache local da tela sumiu. O adaptador já refaz o
  // perfil pelo GET /auth/sessao no carregamento, então basta esperar e seguir
  // em frente, em vez de exigir uma senha de quem já está autenticado.
  FG.pronto.then(function () { if (FG.session()) location.href = '/portal'; });

  function showMsg(texto, tipo) {
    msg.textContent = texto || '';
    msg.className = 'auth-msg' + (texto ? ' ' + (tipo || 'err') : '');
  }

  // Se o guardião de sessão nos trouxe de volta ao login, explica o porquê.
  (function () {
    var m = new URLSearchParams(location.search).get('sessao');
    if (!m) return;
    showMsg(m === 'inatividade'
      ? 'Sua sessão foi encerrada por inatividade. Entre novamente para continuar.'
      : 'Sua sessão expirou. Entre novamente para continuar.', 'ok');
    // Limpa o parâmetro da URL para a mensagem não "grudar" num F5 seguinte.
    history.replaceState(null, '', location.pathname);
  })();

  // 'login' | 'cad' | 'esq'. "Esqueci minha senha" não tem aba própria: a
  // aba Entrar segue marcada, porque é para lá que o fluxo volta.
  function switchTab(qual) {
    tabLogin.classList.toggle('on', qual !== 'cad');
    tabCad.classList.toggle('on', qual === 'cad');
    formLogin.classList.toggle('hidden', qual !== 'login');
    formCad.classList.toggle('hidden', qual !== 'cad');
    formEsq.classList.toggle('hidden', qual !== 'esq');
    showMsg('');
  }

  tabLogin.addEventListener('click', function () { switchTab('login'); });
  tabCad.addEventListener('click', function () { switchTab('cad'); });

  /* ---------- esqueci minha senha ---------- */
  document.getElementById('lk-esqueci').addEventListener('click', function () {
    document.getElementById('es-email').value = document.getElementById('lg-email').value.trim();
    switchTab('esq');
    document.getElementById('es-email').focus();
  });
  document.getElementById('lk-voltar-login').addEventListener('click', function () { switchTab('login'); });

  async function doEsqueci() {
    var b = document.getElementById('btn-esq');
    var email = document.getElementById('es-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { showMsg('Informe um e-mail válido.'); return; }
    b.disabled = true; b.textContent = 'Enviando…';
    var r = await FG.esqueciSenha(email);
    b.disabled = false; b.textContent = 'Enviar link de recuperação';
    // A API responde igual exista ou não o e-mail — não confirmamos cadastro.
    if (!r.ok) { showMsg(r.msg || 'Não foi possível enviar agora.'); return; }
    switchTab('login');
    showMsg(r.msg, 'ok');
  }
  document.getElementById('btn-esq').addEventListener('click', doEsqueci);
  formEsq.addEventListener('keydown', function (e) { if (e.key === 'Enter') doEsqueci(); });

  /* ---------- verificação anti-robô ----------
     Três detalhes que decidem se isto funciona ou vira suporte:

     1. O script do provedor só é BAIXADO se houver chave configurada no NOSSO
        servidor. Sem chave, nenhuma requisição sai para fora e o bloco nem
        aparece — o desenvolvimento local segue sem depender de rede.

     2. Renderização EXPLÍCITA (render=explicit + turnstile.render), e não a
        automática por atributo `class="cf-turnstile"` no HTML. O motivo é o
        mesmo de antes: nada de configuração pendurada em atributo de
        marcação, para a CSP estrita continuar viável.

     3. O token vale UMA VEZ SÓ e expira. Por isso o widget é REINICIADO a
        cada tentativa que falha — sem isso, o segundo clique em "Entrar"
        reenviaria um token já queimado e o usuário ficaria preso num erro
        que não tem como entender. É o erro clássico desta integração.

     4. São DOIS widgets — um no login, outro no cadastro. Um token do
        Turnstile é de uso único, então não dá para desenhar um só e mandar o
        mesmo valor nas duas rotas. Cada formulário tem o seu, com o seu id. */
  var captchaId = null;      // widget do login, ou null se não há captcha
  var captchaIdCad = null;   // widget do cadastro, idem

  function iniciarCaptcha(siteKey) {
    var bloco = document.getElementById('captcha-bloco');
    var blocoCad = document.getElementById('captcha-bloco-cad');
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = function () {
      if (!window.turnstile) return;
      captchaId = turnstile.render('#captcha-widget', {
        sitekey: siteKey,
        language: 'pt-br',
        theme: 'dark',   // a tela de acesso é preta (css/acesso.css)
        // Expirou sozinho na tela parada: renova em silêncio, para o usuário
        // não descobrir só ao clicar em Entrar.
        'expired-callback': function () { turnstile.reset(captchaId); }
      });
      bloco.classList.remove('hidden');

      captchaIdCad = turnstile.render('#captcha-widget-cad', {
        sitekey: siteKey,
        language: 'pt-br',
        theme: 'dark',
        'expired-callback': function () { turnstile.reset(captchaIdCad); }
      });
      blocoCad.classList.remove('hidden');
    };
    // Provedor fora do ar ou bloqueado na rede do cliente: os blocos ficam
    // escondidos e login/cadastro continuam. O servidor também libera nesse caso.
    s.onerror = function () {
      bloco.classList.add('hidden');
      blocoCad.classList.add('hidden');
    };
    document.head.appendChild(s);
  }

  FG.captchaConfig().then(function (siteKey) { if (siteKey) iniciarCaptcha(siteKey); });

  /* ---------- login ---------- */
  async function doLogin() {
    var email = document.getElementById('lg-email').value.trim();
    var senha = document.getElementById('lg-senha').value;
    if (!email || !senha) { showMsg('Informe e-mail e senha.'); return; }

    var token = captchaId !== null ? turnstile.getResponse(captchaId) : '';
    if (captchaId !== null && !token) { showMsg('Confirme que você não é um robô.'); return; }

    var r = await FG.login(email, senha, token);
    if (!r.ok) {
      // Queima o token junto com a tentativa: ele não serve para a próxima.
      if (captchaId !== null) turnstile.reset(captchaId);
      showMsg(r.msg);
      return;
    }
    location.href = '/portal';
  }
  document.getElementById('btn-login').addEventListener('click', doLogin);
  formLogin.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });


  /* ---------- cadastro ---------- */
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

  /* ---------- máscaras (helpers em store.js — FG.mask*) ---------- */
  FG.bindMask('cd-cnpj', FG.maskCnpj);
  FG.bindMask('cd-ie', FG.maskIe);
  FG.bindMask('cd-telefone', FG.maskTelefone);
  FG.bindMask('cd-numero', FG.maskNumero);     // só dígitos
  FG.bindMask('cd-cidade', FG.maskCidade);     // sem números/caracteres especiais

  /* ---------- CEP: busca automática (ViaCEP) ----------
     Ao completar os 8 dígitos, preenche logradouro, bairro, cidade e UF —
     sobra só número e complemento para o cliente digitar. Os campos seguem
     editáveis (nem todo CEP devolve logradouro, ex.: cidades com CEP único). */
  var cepBuscado = '';
  function buscarCep(valor) {
    var dig = valor.replace(/\D/g, '');
    if (dig.length !== 8 || dig === cepBuscado) return;
    cepBuscado = dig;
    var cepEl = document.getElementById('cd-cep');
    cepEl.classList.add('buscando');
    fetch('https://viacep.com.br/ws/' + dig + '/json/')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.erro) { showMsg('CEP não encontrado — confira ou preencha o endereço manualmente.'); return; }
        if (d.logradouro) document.getElementById('cd-logradouro').value = d.logradouro;
        if (d.bairro) document.getElementById('cd-bairro').value = d.bairro;
        if (d.localidade) document.getElementById('cd-cidade').value = d.localidade;
        if (d.uf) document.getElementById('cd-uf').value = d.uf;
        showMsg('');
        document.getElementById('cd-numero').focus();
      })
      .catch(function () { /* sem internet p/ ViaCEP — segue manual */ })
      .then(function () { cepEl.classList.remove('buscando'); });
  }
  FG.bindMask('cd-cep', FG.maskCep, buscarCep);

  async function doRegister() {
    var dados = {
      nome: val('cd-nome'),
      empresa: val('cd-empresa'),
      email: val('cd-email'),
      senha: document.getElementById('cd-senha').value,
      cnpj: val('cd-cnpj'),
      inscricaoEstadual: val('cd-ie'),
      telefone: val('cd-telefone'),
      endereco: {
        cep: val('cd-cep'),
        logradouro: val('cd-logradouro'),
        numero: val('cd-numero'),
        complemento: val('cd-complemento'),
        bairro: val('cd-bairro'),
        cidade: val('cd-cidade'),
        uf: val('cd-uf').toUpperCase()
      }
    };
    if (!dados.nome || !dados.empresa || !dados.email || !dados.senha) {
      showMsg('Preencha nome, empresa, e-mail e senha.'); return;
    }
    if (dados.senha.length < 8) { showMsg('A senha precisa de ao menos 8 caracteres.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(dados.email)) { showMsg('E-mail inválido.'); return; }
    if (dados.cnpj.replace(/\D/g, '').length !== 14) { showMsg('CNPJ incompleto — use os 14 dígitos.'); return; }
    var telDig = dados.telefone.replace(/\D/g, '');
    if (telDig && (telDig.length < 10 || telDig.length > 11)) { showMsg('Telefone incompleto — informe DDD + número.'); return; }
    var e = dados.endereco;
    if (e.cep.replace(/\D/g, '').length !== 8) { showMsg('CEP incompleto — use os 8 dígitos.'); return; }
    if (!e.logradouro || !e.numero || !e.bairro || !e.cidade || !e.uf) {
      showMsg('Preencha o endereço: logradouro, número, bairro, cidade e UF.'); return;
    }
    if (!/^\d+$/.test(e.numero)) { showMsg('Número do endereço deve conter apenas dígitos.'); return; }
    if (/[^A-Za-zÀ-ÖØ-öø-ÿ'. -]/.test(e.cidade)) { showMsg('Cidade não pode conter números ou caracteres especiais.'); return; }

    // Anti-robô, no fim das validações: só faz sentido queimar o token depois
    // que o formulário está bom, senão o usuário perde a verificação a cada
    // campo errado.
    dados.captcha = captchaIdCad !== null ? turnstile.getResponse(captchaIdCad) : '';
    if (captchaIdCad !== null && !dados.captcha) { showMsg('Confirme que você não é um robô.'); return; }

    var r = await FG.register(dados);
    if (!r.ok) {
      // Token é de uso único: queima junto com a tentativa.
      if (captchaIdCad !== null) turnstile.reset(captchaIdCad);
      showMsg(r.msg);
      return;
    }
    switchTab('login');
    showMsg('Cadastro enviado! Assim que um administrador aprovar, você poderá entrar.', 'ok');
    document.getElementById('lg-email').value = dados.email;
  }
  document.getElementById('btn-cad').addEventListener('click', doRegister);
  formCad.addEventListener('keydown', function (e) { if (e.key === 'Enter') doRegister(); });

  /* ---------- easter egg: clicar no "F" do logo ----------
     Sem cursor:pointer nem qualquer pista visual — é para ser achado, não
     anunciado. O vídeo PAUSA e VOLTA AO INÍCIO ao fechar (currentTime = 0):
     sem isso, quem reabre encontra o vídeo do jeito que deixou, tocando ou
     parado no meio — o easter egg tem de recomeçar toda vez. */
  var eggBack = document.getElementById('egg-back');
  var eggVideo = document.getElementById('egg-video');

  function abrirEgg() {
    eggBack.classList.remove('hidden');
    eggVideo.play().catch(function () { /* autoplay bloqueado: controls cobrem */ });
  }
  function fecharEgg() {
    eggBack.classList.add('hidden');
    eggVideo.pause();
    eggVideo.currentTime = 0;
  }
  document.getElementById('logo-f').addEventListener('click', abrirEgg);
  document.getElementById('egg-x').addEventListener('click', fecharEgg);
  // Clique no fundo escuro fecha; clique DENTRO do vídeo não deve propagar
  // para o fundo (senão tocar/pausar pelo próprio player fecharia o modal).
  eggBack.addEventListener('click', function (e) { if (e.target === eggBack) fecharEgg(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !eggBack.classList.contains('hidden')) fecharEgg();
  });
})();
