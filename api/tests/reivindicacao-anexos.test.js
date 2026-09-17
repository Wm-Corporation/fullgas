// Fotos e vídeos da reivindicação: no máximo 5 por envio (16/09/2026).
//
// Eram 10. O formulário do portal agora trava em 5 (veículo e varejo), e a API
// confere o mesmo teto — o formulário é só a primeira barreira.
//
// O db.js é substituído por um dublê: estes testes não tocam SQL Server.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let inseridos = [];

vi.mock('../src/db.js', () => ({
  query: async (sqlTexto, params = {}) => {
    if (/SELECT ReivindicacaoId FROM dbo\.Reivindicacao/.test(sqlTexto)) return [{ ReivindicacaoId: 42 }];
    if (/INSERT INTO dbo\.ReivindicacaoAnexo/.test(sqlTexto)) { inseridos.push(params); return []; }
    return [];
  }
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { default: rotas } = await import('../src/routes/reivindicacoes.routes.js');

const PASTA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'reivindicacoes');
const CLIENTE = { id: 3, email: 'carlos@motosul.com.br', papel: 'cliente', empresaId: 7, gestor: true, perm: null };

function app() {
  const a = express();
  a.use((req, _res, next) => { req.user = CLIENTE; next(); });
  a.use('/api', rotas);
  return a;
}

// Um PNG mínimo válido basta: o filtro confere extensão e família do mime.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

function enviar(qtd) {
  let r = request(app()).post('/api/reivindicacoes/99282720/anexos');
  for (let i = 1; i <= qtd; i++) r = r.attach('fotos', PNG, { filename: `foto${i}.png`, contentType: 'image/png' });
  return r;
}

let antes;
beforeEach(() => {
  inseridos = [];
  antes = new Set(fs.existsSync(PASTA) ? fs.readdirSync(PASTA) : []);
});
// Apaga do disco só o que o teste criou.
afterEach(() => {
  for (const f of fs.readdirSync(PASTA)) if (!antes.has(f)) fs.unlinkSync(path.join(PASTA, f));
});
const novosNoDisco = () => fs.readdirSync(PASTA).filter(f => !antes.has(f));

describe('POST /api/reivindicacoes/:numero/anexos', () => {
  it('aceita 5 arquivos num envio', async () => {
    const r = await enviar(5);
    expect(r.status).toBe(201);
    expect(inseridos).toHaveLength(5);
    expect(novosNoDisco()).toHaveLength(5);
  });

  it('recusa o 6º arquivo com mensagem clara e não deixa nada gravado', async () => {
    const r = await enviar(6);
    expect(r.status).toBe(400);
    expect(r.body.erro).toBe('Máximo de 5 fotos ou vídeos por envio.');
    expect(inseridos).toHaveLength(0);
    expect(novosNoDisco()).toHaveLength(0);
  });
});
