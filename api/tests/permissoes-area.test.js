// Gate de área das contas internas (sub-dealers), no servidor. Sem banco.
import { describe, it, expect, beforeAll } from 'vitest';

// A auth.js encerra o processo se JWT_SECRET faltar. Definimos antes do import.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';

let auth;
beforeAll(async () => {
  auth = await import('../src/auth.js');
});

function res() {
  const r = {
    codigo: null, corpo: null,
    status(c) { r.codigo = c; return r; },
    json(o) { r.corpo = o; return r; }
  };
  return r;
}

// Roda o middleware e devolve { passou, resposta }.
function corre(mw, user) {
  const resposta = res();
  let passou = false;
  mw({ user }, resposta, () => { passou = true; });
  return { passou, resposta };
}

// Perfis, do mais ao menos privilegiado.
const ADMIN = { papel: 'admin', gestor: false, perm: ['loja'] };
const GESTOR = { papel: 'cliente', gestor: true, perm: ['loja'] };
const SEM_LISTA = { papel: 'cliente', gestor: false, perm: null };
const SO_LOJA = { papel: 'cliente', gestor: false, perm: ['loja'] };
const LOJA_E_PEDIDOS = { papel: 'cliente', gestor: false, perm: ['loja', 'pedidos'] };

describe('requireArea', () => {
  it('deixa passar quem tem a area', () => {
    expect(corre(auth.requireArea('loja'), SO_LOJA).passou).toBe(true);
  });

  it('barra com 403 quem NAO tem a area', () => {
    const { passou, resposta } = corre(auth.requireArea('pedidos'), SO_LOJA);
    expect(passou).toBe(false);
    expect(resposta.codigo).toBe(403);
    expect(resposta.corpo.erro).toMatch(/nao tem acesso|não tem acesso/i);
  });

  // Os três casos de acesso total.
  it('admin passa em qualquer area, mesmo fora da propria lista', () => {
    expect(corre(auth.requireArea('financeiro'), ADMIN).passou).toBe(true);
  });

  it('gestor passa em qualquer area', () => {
    expect(corre(auth.requireArea('financeiro'), GESTOR).passou).toBe(true);
  });

  it('perm null (acesso total) passa em qualquer area', () => {
    // E o padrao de quem foi criado antes de as areas existirem.
    expect(corre(auth.requireArea('reivindicacoes'), SEM_LISTA).passou).toBe(true);
  });

  it('nao explode com req.user ausente (rota mal montada, sem requireAuth antes)', () => {
    const resposta = res();
    let passou = false;
    auth.requireArea('loja')({}, resposta, () => { passou = true; });
    expect(passou).toBe(false);
    expect(resposta.codigo).toBe(403);
  });
});

describe('requireAreaAny', () => {
  it('basta UMA das areas da lista', () => {
    expect(corre(auth.requireAreaAny(['loja', 'pedidos']), SO_LOJA).passou).toBe(true);
  });

  it('barra quem nao tem NENHUMA delas', () => {
    const { passou, resposta } = corre(auth.requireAreaAny(['estoque', 'acoes']), SO_LOJA);
    expect(passou).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('passa quem tem as duas', () => {
    expect(corre(auth.requireAreaAny(['loja', 'pedidos']), LOJA_E_PEDIDOS).passou).toBe(true);
  });

  it('acesso total ignora a lista', () => {
    expect(corre(auth.requireAreaAny(['estoque']), ADMIN).passou).toBe(true);
    expect(corre(auth.requireAreaAny(['estoque']), GESTOR).passou).toBe(true);
    expect(corre(auth.requireAreaAny(['estoque']), SEM_LISTA).passou).toBe(true);
  });
});

describe('parsePermissoes — a lista que alimenta os gates', () => {
  it('descarta area inventada que nao existe no sistema', () => {
    // Impede que um valor estranho no banco vire uma permissao valida.
    expect(auth.parsePermissoes('["loja","superusuario"]')).toEqual(['loja']);
  });

  it('JSON ilegivel vira null (acesso total) em vez de derrubar o login', () => {
    expect(auth.parsePermissoes('{quebrado')).toBe(null);
  });

  it('null continua null', () => {
    expect(auth.parsePermissoes(null)).toBe(null);
  });
});
