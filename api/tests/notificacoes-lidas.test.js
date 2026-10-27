// Abrir a caixa de notificações marca como lidas todas as que o usuário vê (sem botão por item). db.js é um dublê.
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const chamadas = [];
vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => { chamadas.push({ texto, p }); return /INSERT INTO dbo\.NotificacaoLida/.test(texto) ? [{ NotificacaoId: 1 }, { NotificacaoId: 2 }] : []; }
}));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { default: rotas } = await import('../src/routes/notificacoes.routes.js');

function app(user) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotas);
  return a;
}

describe('POST /api/notificacoes/lidas', () => {
  it('marca de uma vez só as visíveis ao usuário e ainda não lidas', async () => {
    const r = await request(app({ id: 3, papel: 'cliente', empresaId: 7, perm: null })).post('/api/notificacoes/lidas');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, marcadas: 2 });
    const c = chamadas.find(x => /INSERT INTO dbo\.NotificacaoLida/.test(x.texto));
    expect(c.texto).toMatch(/n\.Publico = 'cliente'/);          // mesma regra de visibilidade do GET
    expect(c.texto).toMatch(/NOT EXISTS \(SELECT 1 FROM dbo\.NotificacaoLida/);
    expect(c.p).toMatchObject({ uid: 3, admin: 0, eid: 7 });
  });
});
