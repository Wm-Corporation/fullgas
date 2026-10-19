// Sessão: o cookie é a única credencial, e quando o CSRF barra. Sem banco.
import { describe, it, expect, beforeAll } from 'vitest';

// A auth.js encerra o processo se JWT_SECRET faltar. Definimos antes do import.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';

let jwt, auth;
beforeAll(async () => {
  jwt = (await import('jsonwebtoken')).default;
  auth = await import('../src/auth.js');
});

// req falso no formato que o Express entrega aos middlewares.
function req({ metodo = 'POST', caminho = '/api/pedidos', cookies = {}, headers = {} } = {}) {
  return { method: metodo, path: caminho, cookies, headers };
}

// res falso que registra o que foi respondido e os cookies gravados.
function res() {
  const r = {
    codigo: null, corpo: null, cookies: {}, apagados: [],
    status(c) { r.codigo = c; return r; },
    json(o) { r.corpo = o; return r; },
    cookie(nome, valor, opts) { r.cookies[nome] = { valor, opts }; },
    clearCookie(nome, opts) { r.apagados.push({ nome, opts }); }
  };
  return r;
}

function corre(mw, requisicao, resposta) {
  let passou = false;
  mw(requisicao, resposta, () => { passou = true; });
  return passou;
}

const USUARIO = {
  UsuarioId: 1, Email: 'a@b.com', Papel: 'cliente',
  EmpresaId: 10, Gestor: 1, Permissoes: null
};

describe('signToken', () => {
  it('inclui um segredo csrf novo a cada token', () => {
    const a = jwt.decode(auth.signToken(USUARIO));
    const b = jwt.decode(auth.signToken(USUARIO));
    expect(a.csrf).toMatch(/^[0-9a-f]{32}$/);
    expect(a.csrf).not.toBe(b.csrf);
  });

  it('nao deixa `extra` sobrescrever o csrf', () => {
    // Se desse para escolher o proprio csrf, a protecao seria contornavel.
    const t = jwt.decode(auth.signToken(USUARIO, { csrf: 'valor-escolhido' }));
    expect(t.csrf).not.toBe('valor-escolhido');
  });
});

describe('carregarSessao', () => {
  it('le a sessao do cookie', () => {
    const r = req({ cookies: { fg_sess: auth.signToken(USUARIO) } });
    corre(auth.carregarSessao, r, res());
    expect(r.user.email).toBe('a@b.com');
  });

  it('IGNORA o header Bearer — o cookie e a unica credencial', () => {
    const r = req({ headers: { authorization: 'Bearer ' + auth.signToken(USUARIO) } });
    corre(auth.carregarSessao, r, res());
    expect(r.user).toBeUndefined();
  });

  it('Bearer nao sobrepoe nem complementa o cookie', () => {
    const outro = auth.signToken({ ...USUARIO, UsuarioId: 99, Email: 'velho@b.com' });
    const r = req({ cookies: { fg_sess: auth.signToken(USUARIO) }, headers: { authorization: 'Bearer ' + outro } });
    corre(auth.carregarSessao, r, res());
    expect(r.user.email).toBe('a@b.com');
  });

  it('sessao por cookie SEM X-CSRF-Token nao escapa mais pelo caminho do Bearer', () => {
    // Bearer aceito seria um jeito de contornar o CSRF.
    const resposta = res();
    const r = req({
      cookies: { fg_sess: auth.signToken(USUARIO) },
      headers: { authorization: 'Bearer ' + auth.signToken(USUARIO) }
    });
    corre(auth.carregarSessao, r, res());
    expect(corre(auth.csrfProtect, r, resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('NUNCA responde 401 — so marca o problema e segue', () => {
    const resposta = res();
    const r = req({ cookies: { fg_sess: 'lixo.que.nao.e.jwt' } });
    expect(corre(auth.carregarSessao, r, resposta)).toBe(true);
    expect(resposta.codigo).toBeNull();
    expect(r.user).toBeUndefined();
    expect(r.tokenInvalido).toBe(true);
  });

  it('recusa token assinado com outra chave', () => {
    const forjado = jwt.sign({ id: 1, papel: 'admin' }, 'chave-errada-mas-longa-o-suficiente!!');
    const r = req({ cookies: { fg_sess: forjado } });
    corre(auth.carregarSessao, r, res());
    expect(r.user).toBeUndefined();
  });
});

describe('csrfProtect', () => {
  // Monta uma requisicao ja autenticada por cookie.
  function comCookie(headerCsrf) {
    const token = auth.signToken(USUARIO);
    const r = req({
      cookies: { fg_sess: token },
      headers: headerCsrf === undefined ? {} : { 'x-csrf-token': headerCsrf }
    });
    corre(auth.carregarSessao, r, res());
    return r;
  }

  it('BLOQUEIA escrita por cookie sem o header', () => {
    const resposta = res();
    expect(corre(auth.csrfProtect, comCookie(undefined), resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('BLOQUEIA escrita por cookie com header errado', () => {
    const resposta = res();
    expect(corre(auth.csrfProtect, comCookie('a'.repeat(32)), resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('libera escrita por cookie com o header correto', () => {
    const r = comCookie(undefined);
    r.headers['x-csrf-token'] = r.user.csrf;
    expect(corre(auth.csrfProtect, r, res())).toBe(true);
  });

  it('libera leitura (GET) sem header', () => {
    const r = comCookie(undefined);
    r.method = 'GET';
    expect(corre(auth.csrfProtect, r, res())).toBe(true);
  });

  it('libera rota publica (sem sessao)', () => {
    expect(corre(auth.csrfProtect, req(), res())).toBe(true);
  });

  it('responde 403 (nao quebra) com header de caracteres multibyte', () => {
    // 32 caracteres acentuados = 64 bytes.
    const resposta = res();
    expect(corre(auth.csrfProtect, comCookie('é'.repeat(32)), resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('deixa sair e entrar mesmo sem o fg_csrf (rotas isentas)', () => {
    // Sem a isenção, quem perdesse o fg_csrf ficaria preso.
    for (const caminho of ['/api/auth/logout', '/api/auth/login', '/api/auth/senha/redefinir']) {
      const r = req({ caminho, cookies: { fg_sess: auth.signToken(USUARIO) } });
      corre(auth.carregarSessao, r, res());
      expect(corre(auth.csrfProtect, r, res()), caminho).toBe(true);
    }
  });

  it('a isencao NAO vaza para rotas de dado do cliente', () => {
    const resposta = res();
    const r = req({ caminho: '/api/auth/identidade/voltar', cookies: { fg_sess: auth.signToken(USUARIO) } });
    corre(auth.carregarSessao, r, res());
    expect(corre(auth.csrfProtect, r, resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('nao aceita cookie fg_csrf plantado — o valor vale e o do JWT', () => {
    // Cookie plantado pelo atacante não bate com o claim assinado.
    const r = comCookie('valor-plantado-pelo-atacante');
    r.cookies.fg_csrf = 'valor-plantado-pelo-atacante';
    const resposta = res();
    expect(corre(auth.csrfProtect, r, resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });
});

describe('abrirSessao / fecharSessao', () => {
  it('grava os tres cookies, so o de sessao com httpOnly', () => {
    const resposta = res();
    auth.abrirSessao(resposta, auth.signToken(USUARIO));
    expect(resposta.cookies.fg_sess.opts.httpOnly).toBe(true);
    expect(resposta.cookies.fg_csrf.opts.httpOnly).toBe(false);
    expect(resposta.cookies.fg_exp.opts.httpOnly).toBe(false);
  });

  it('fg_csrf espelha o claim do token e fg_exp traz a validade', () => {
    const token = auth.signToken(USUARIO);
    const p = jwt.decode(token);
    const resposta = res();
    auth.abrirSessao(resposta, token);
    expect(resposta.cookies.fg_csrf.valor).toBe(p.csrf);
    expect(resposta.cookies.fg_exp.valor).toBe(String(p.exp));
  });

  it('usa SameSite=Lax', () => {
    const resposta = res();
    auth.abrirSessao(resposta, auth.signToken(USUARIO));
    expect(resposta.cookies.fg_sess.opts.sameSite).toBe('lax');
  });

  it('fecharSessao apaga os tres repetindo os atributos', () => {
    // Atributos diferentes = o navegador ignora a remoção.
    const resposta = res();
    auth.fecharSessao(resposta);
    expect(resposta.apagados.map(a => a.nome).sort()).toEqual(['fg_csrf', 'fg_exp', 'fg_sess']);
    for (const a of resposta.apagados) {
      expect(a.opts.path).toBe('/');
      expect(a.opts.sameSite).toBe('lax');
    }
  });
});
