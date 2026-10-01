// Lote 6 (30/09/2026): CPF com dígito verificador (G4) e troca da própria
// senha dentro do portal (E9).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';

let usuario, gravado;

vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => {
    if (/FROM dbo\.Usuario u WHERE u\.UsuarioId = @id/.test(texto)) return usuario ? [usuario] : [];
    if (/UPDATE dbo\.Usuario\s+SET SenhaHash = @hash, TokenVersion = TokenVersion \+ 1/.test(texto)) { gravado = p; return []; }
    return [];
  },
  getPool: async () => ({}),
  sql: {}
}));
vi.mock('../src/tiny-contatos.js', () => ({ vincularContatoTiny: async () => null }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { cpfValido } = await import('../src/validacao.js');
const { default: rotasAuth } = await import('../src/routes/auth.routes.js');

const HASH = bcrypt.hashSync('Senha-antiga-2026', 4);
const CLIENTE = { id: 12, email: 'artmotoracing@gmail.com', papel: 'cliente', empresaId: 3, gestor: true, perm: null };
function trocar(body, user = CLIENTE) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api/auth', rotasAuth);
  return request(a).post('/api/auth/senha/trocar').send(body);
}

beforeEach(() => {
  gravado = null;
  usuario = {
    UsuarioId: 12, Nome: 'CRISTIANO MOREIRA', Email: 'artmotoracing@gmail.com',
    SenhaHash: Buffer.from(HASH, 'utf8'), Papel: 'cliente', Status: 'aprovado',
    EmpresaId: 3, Gestor: 1, Permissoes: null, TokenVersion: 4
  };
});

describe('G4 — CPF do comprador', () => {
  it('confere os dígitos verificadores', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('529.982.247-26')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('123')).toBe(false);
  });
});

describe('E9 — trocar a própria senha', () => {
  it('troca com a senha atual certa, derruba as outras sessões e reemite a desta aba', async () => {
    const r = await trocar({ atual: 'Senha-antiga-2026', nova: 'Frase-nova-bem-longa-2026' });
    expect(r.status).toBe(200);
    expect(gravado.id).toBe(12);
    expect(await bcrypt.compare('Frase-nova-bem-longa-2026', gravado.hash.toString('utf8'))).toBe(true);
    expect(String(r.headers['set-cookie'])).toMatch(/fg_sess=/);
  });

  it('recusa senha atual errada', async () => {
    const r = await trocar({ atual: 'errada', nova: 'Frase-nova-bem-longa-2026' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Senha atual incorreta/);
    expect(gravado).toBeNull();
  });

  it('aplica a regra de senha (mínimo de 8)', async () => {
    const r = await trocar({ atual: 'Senha-antiga-2026', nova: 'curta' });
    expect(r.status).toBe(400);
    expect(gravado).toBeNull();
  });

  it('não vale em identidade assumida', async () => {
    const r = await trocar({ atual: 'Senha-antiga-2026', nova: 'Frase-nova-bem-longa-2026' }, { ...CLIENTE, imp: 1 });
    expect(r.status).toBe(403);
    expect(gravado).toBeNull();
  });
});
