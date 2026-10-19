// Revogação de sessão (migration 037 + revalidarSessao). Sem banco: a consulta é injetada.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';

let jwt, auth;
beforeAll(async () => {
  jwt = (await import('jsonwebtoken')).default;
  auth = await import('../src/auth.js');
});

// Linha que a consulta injetada devolve (os testes a alteram).
let linhaBanco;
let consultas;

beforeEach(() => {
  linhaBanco = { Papel: 'cliente', Status: 'aprovado', Gestor: 0, Permissoes: null, TokenVersion: 0 };
  consultas = 0;
  auth.configurarRevalidacao(async () => { consultas++; return linhaBanco; });
  auth.invalidarCacheSessao(7);
});

const USUARIO = {
  UsuarioId: 7, Email: 'a@b.com', Papel: 'cliente',
  EmpresaId: 10, Gestor: 0, Permissoes: null, TokenVersion: 0
};

function res() {
  const r = { apagados: [], clearCookie(n) { r.apagados.push(n); } };
  return r;
}

// Roda carregarSessao + revalidarSessao como o app.js os encadeia.
async function sessao(token) {
  const req = { cookies: { fg_sess: token }, headers: {}, method: 'GET', path: '/api/x' };
  const resposta = res();
  auth.carregarSessao(req, resposta, () => {});
  await new Promise(ok => auth.revalidarSessao(req, resposta, ok));
  return { req, resposta };
}

describe('signToken', () => {
  it('carrega o TokenVersion do banco no claim tv', () => {
    const t = jwt.decode(auth.signToken({ ...USUARIO, TokenVersion: 5 }));
    expect(t.tv).toBe(5);
  });

  it('usuario sem a coluna (token legado) vira tv 0, nao undefined', () => {
    const { TokenVersion, ...semColuna } = USUARIO;
    expect(jwt.decode(auth.signToken(semColuna)).tv).toBe(0);
  });
});

describe('revalidarSessao', () => {
  it('mantem a sessao quando nada mudou', async () => {
    const { req } = await sessao(auth.signToken(USUARIO));
    expect(req.user).toBeTruthy();
    expect(req.user.id).toBe(7);
  });

  it('DERRUBA quando o TokenVersion do banco avancou (troca de senha)', async () => {
    const token = auth.signToken(USUARIO);          // tv = 0
    linhaBanco.TokenVersion = 1;                     // senha redefinida depois
    const { req, resposta } = await sessao(token);
    expect(req.user).toBe(null);
    expect(req.tokenInvalido).toBe(true);
    expect(resposta.apagados).toContain('fg_sess'); // cookies limpos
  });

  it('DERRUBA usuario bloqueado', async () => {
    const token = auth.signToken(USUARIO);
    linhaBanco.Status = 'bloqueado';
    const { req } = await sessao(token);
    expect(req.user).toBe(null);
  });

  it('DERRUBA usuario excluido (linha some do banco)', async () => {
    const token = auth.signToken(USUARIO);
    auth.configurarRevalidacao(async () => null);
    const { req } = await sessao(token);
    expect(req.user).toBe(null);
  });

  it('rebaixar admin a cliente vale na requisicao seguinte', async () => {
    // Token emitido enquanto era admin...
    const token = auth.signToken({ ...USUARIO, Papel: 'admin' });
    expect(jwt.decode(token).papel).toBe('admin');
    // ...mas o banco ja diz cliente.
    linhaBanco.Papel = 'cliente';
    const { req } = await sessao(token);
    expect(req.user.papel).toBe('cliente');

    // E o requireAdmin passa a barrar, que e' o ponto.
    let passou = false;
    auth.requireAdmin(req, { status: () => ({ json: () => {} }) }, () => { passou = true; });
    expect(passou).toBe(false);
  });

  it('tirar uma area do sub-dealer vale sem novo login', async () => {
    const token = auth.signToken({ ...USUARIO, Permissoes: JSON.stringify(['loja', 'pedidos']) });
    linhaBanco.Permissoes = JSON.stringify(['loja']);   // gestor tirou 'pedidos'
    const { req } = await sessao(token);
    expect(req.user.perm).toEqual(['loja']);
  });

  it('banco fora do ar NAO desloga todo mundo (segue com o token)', async () => {
    const token = auth.signToken(USUARIO);
    auth.configurarRevalidacao(async () => { throw new Error('DB offline'); });
    const { req } = await sessao(token);
    expect(req.user).toBeTruthy();   // disponibilidade preservada
  });

  it('usa cache: duas requisicoes seguidas nao viram duas consultas', async () => {
    const token = auth.signToken(USUARIO);
    await sessao(token);
    await sessao(token);
    expect(consultas).toBe(1);
  });

  it('invalidarCacheSessao faz a revogacao valer na hora', async () => {
    const token = auth.signToken(USUARIO);
    await sessao(token);                 // popula o cache
    linhaBanco.TokenVersion = 1;         // admin bloqueia/reseta
    auth.invalidarCacheSessao(7);        // como fazem as rotas
    const { req } = await sessao(token);
    expect(req.user).toBe(null);
  });

  it('sem sessao passa direto, sem consultar o banco', async () => {
    const req = { cookies: {}, headers: {}, method: 'GET', path: '/api/health' };
    await new Promise(ok => auth.revalidarSessao(req, res(), ok));
    expect(consultas).toBe(0);
  });
});
