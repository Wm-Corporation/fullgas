// Corpo inválido vira erro do cliente (4xx) com mensagem em português, nunca 500. db.js é um dublê.
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/db.js', () => ({ query: async () => [] }));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';

const app = (await import('../src/app.js')).default;
const post = () => request(app).post('/api/auth/login').set('Content-Type', 'application/json');

describe('corpo inválido em /api', () => {
  it('JSON quebrado → 400 com mensagem clara', async () => {
    const r = await post().send('{"email":');
    expect(r.status).toBe(400);
    expect(r.body.erro).toBe('JSON inválido no corpo da requisição.');
  });

  it('JSON quebrado não vaza o texto interno do parser', async () => {
    const r = await post().send('{"email": oops}');
    expect(JSON.stringify(r.body)).not.toMatch(/Unexpected|position|SyntaxError/);
  });

  it('corpo acima do limite continua 413', async () => {
    const r = await post().send(JSON.stringify({ x: 'a'.repeat(1.2 * 1024 * 1024) }));
    expect(r.status).toBe(413);
    expect(r.body.erro).toBe('Conteúdo grande demais.');
  });

  it('charset não suportado → 415', async () => {
    const r = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json; charset=iso-8859-1').send('{}');
    expect(r.status).toBe(415);
  });

  it('JSON válido segue o fluxo normal (não é barrado pelo tratador)', async () => {
    const r = await post().send(JSON.stringify({ email: 'a@b.c', senha: 'x' }));
    expect(r.status).not.toBe(500);
    expect(r.body.erro).not.toBe('JSON inválido no corpo da requisição.');
  });
});
