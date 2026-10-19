/* =========================================================
   FULLGAS B2B — nova senha pelo link do e-mail (redefinir.html)
   Confere o token antes de pedir a senha e tira o token da URL.
   ========================================================= */
(function () {
  'use strict';

  var msg = document.getElementById('auth-msg');
  var carregando = document.getElementById('rd-carregando');
  var form = document.getElementById('rd-form');
  var invalido = document.getElementById('rd-invalido');

  function showMsg(texto, tipo) {
    msg.textContent = texto || '';
    msg.className = 'auth-msg' + (texto ? ' ' + (tipo || 'err') : '');
  }

  var token = new URLSearchParams(location.search).get('token') || '';
  // Guardamos o token só em memória e tiramos da barra de endereços.
  if (token) history.replaceState(null, '', location.pathname);

  function mostrarInvalido(texto) {
    carregando.classList.add('hidden');
    form.classList.add('hidden');
    invalido.classList.remove('hidden');
    if (texto) showMsg(texto);
  }

  if (!token) { mostrarInvalido('Link sem token — abra o link exatamente como chegou no e-mail.'); return; }

  FG.verificarTokenSenha(token).then(function (r) {
    if (!r.ok) { mostrarInvalido(r.msg); return; }
    carregando.classList.add('hidden');
    form.classList.remove('hidden');
    document.getElementById('rd-quem').textContent = r.nome + ' (' + r.email + ')';
    document.getElementById('rd-senha').focus();
  });

  async function salvar() {
    var b = document.getElementById('btn-rd');
    var s1 = document.getElementById('rd-senha').value;
    var s2 = document.getElementById('rd-senha2').value;
    if (s1.length < 8) { showMsg('A senha precisa de ao menos 8 caracteres.'); return; }
    if (s1 !== s2) { showMsg('As duas senhas não são iguais.'); return; }

    b.disabled = true; b.textContent = 'Salvando…';
    var r = await FG.redefinirSenha(token, s1);
    b.disabled = false; b.textContent = 'Salvar nova senha';
    if (!r.ok) { showMsg(r.msg); return; }

    form.classList.add('hidden');
    showMsg('Senha alterada! Redirecionando para o login…', 'ok');
    setTimeout(function () { location.href = '/'; }, 1800);
  }
  document.getElementById('btn-rd').addEventListener('click', salvar);
  form.addEventListener('keydown', function (e) { if (e.key === 'Enter') salvar(); });
})();
