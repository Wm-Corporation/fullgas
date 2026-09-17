// Miniaturas das fotos de produto (17/09/2026). Ver src/miniaturas.js.
//
// O db.js é um dublê e o fetch é espionado: nada sai para a rede.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import express from 'express';
import request from 'supertest';

let linhasProduto = [];
vi.mock('../src/db.js', () => ({
  query: async (sqlTexto) => {
    if (/SELECT DISTINCT ImagemUrl/.test(sqlTexto)) return linhasProduto.map(r => ({ ImagemUrl: r.ImagemUrl }));
    if (/FROM dbo\.Produto p/.test(sqlTexto)) return linhasProduto;
    return [];
  }
}));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
// Pasta temporária: a limpeza de órfãs apagaria as miniaturas de verdade.
process.env.FULLGAS_MINIATURAS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-minis-'));

const mini = await import('../src/miniaturas.js');
const UPLOADS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
const PRODUTOS = path.join(UPLOADS, 'produtos');
fs.mkdirSync(PRODUTOS, { recursive: true });

// Foto de teste 800×600 gravada como upload local do admin.
const criados = [];
async function fotoLocal(nome) {
  const buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#e5b100' } }).png().toBuffer();
  fs.writeFileSync(path.join(PRODUTOS, nome), buf);
  criados.push(path.join(PRODUTOS, nome));
  return '/uploads/produtos/' + nome;
}
const arquivoDaMini = (url) => path.join(mini.PASTA_MINIATURAS, path.basename(url));

afterAll(() => {
  for (const f of criados) try { fs.unlinkSync(f); } catch { /* ok */ }
  fs.rmSync(mini.PASTA_MINIATURAS, { recursive: true, force: true });
});

let fetchEspiao;
beforeEach(() => {
  linhasProduto = [];
  fetchEspiao = vi.spyOn(globalThis, 'fetch');
  fetchEspiao.mockClear();
});

describe('gerarMiniatura', () => {
  it('gera WebP de no máximo 320 px e passa a responder em miniaturaDe', async () => {
    const origem = await fotoLocal('teste-mini-a.png');
    expect(mini.miniaturaDe(origem)).toBeNull();
    const url = await mini.gerarMiniatura(origem);
    expect(url).toMatch(/^\/uploads\/miniaturas\/[0-9a-f]{32}\.webp$/);
    expect(mini.miniaturaDe(origem)).toBe(url);
    const meta = await sharp(arquivoDaMini(url)).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width, meta.height)).toBe(320);
    expect(fs.statSync(arquivoDaMini(url)).size).toBeLessThan(20000);
  });

  it.each([
    'http://anexos.tiny.com.br/erp/x.jpg',          // sem https
    'https://127.0.0.1/segredo.png',                 // rede interna
    'https://evil.example.com/x.png',
    'https://s3.amazonaws.com/outro-bucket/x.png',   // bucket que não é o do Tiny
    'https://anexos.tiny.com.br.evil.com/x.png',
    '/uploads/produtos/../../../etc/passwd',         // caminho local fora da pasta
    'file:///etc/passwd'
  ])('recusa origem não permitida sem buscar nada: %s', async (origem) => {
    await expect(mini.gerarMiniatura(origem)).rejects.toThrow();
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it('busca com redirect bloqueado quando a origem é do Tiny', async () => {
    fetchEspiao.mockResolvedValueOnce(new Response('não é imagem', { status: 200 }));
    await expect(mini.gerarMiniatura('https://anexos.tiny.com.br/erp/abc/x.jpg')).rejects.toThrow();
    expect(fetchEspiao).toHaveBeenCalledTimes(1);
    expect(fetchEspiao.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
});

describe('prepararMiniaturas', () => {
  it('gera as que faltam, ignora as que falham e apaga as órfãs', async () => {
    const boa = await fotoLocal('teste-mini-b.png');
    const orfa = await mini.gerarMiniatura(await fotoLocal('teste-mini-c.png'));   // "produto excluído"
    linhasProduto = [{ ImagemUrl: boa }, { ImagemUrl: '/uploads/produtos/nao-existe.png' }];
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mini.prepararMiniaturas();
    aviso.mockRestore();
    expect(mini.miniaturaDe(boa)).not.toBeNull();
    expect(fs.existsSync(arquivoDaMini(orfa))).toBe(false);
  });
});

describe('GET /api/produtos', () => {
  it('traz a miniatura quando existe e null quando não', async () => {
    const com = await fotoLocal('teste-mini-d.png');
    await mini.gerarMiniatura(com);
    const base = { ProdutoId: 1, Nome: 'X', Descricao: '', Preco: 1, Estoque: 1, PrevisaoChegada: null, TinyAtivo: 0, TinySincronizadoEm: null, CategoriaCodigo: 'pecas' };
    linhasProduto = [
      { ...base, Sku: 'A1', ImagemUrl: com },
      { ...base, Sku: 'A2', ImagemUrl: 'https://anexos.tiny.com.br/erp/sem-mini.jpg' },
      { ...base, Sku: 'A3', ImagemUrl: null }
    ];
    const { default: rotas } = await import('../src/routes/produtos.routes.js');
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1, papel: 'admin' }; next(); });
    app.use('/api', rotas);
    const r = await request(app).get('/api/produtos');
    expect(r.status).toBe(200);
    const por = Object.fromEntries(r.body.map(p => [p.artigo, p]));
    expect(por.A1.miniatura).toMatch(/\/uploads\/miniaturas\/[0-9a-f]{32}\.webp$/);
    expect(por.A1.imagem).toMatch(/\/uploads\/produtos\/teste-mini-d\.png$/);
    expect(por.A2.miniatura).toBeNull();
    expect(por.A3.miniatura).toBeNull();
  });
});

describe('app.js: /uploads/miniaturas', () => {
  it('serve a miniatura com cache longo e responde 404 seco para a que não existe', async () => {
    const url = await mini.gerarMiniatura(await fotoLocal('teste-mini-e.png'));
    const { default: app } = await import('../src/app.js');
    const ok = await request(app).get(url);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/webp');
    expect(ok.headers['cache-control']).toBe('public, max-age=2592000, immutable');

    const erroLog = vi.spyOn(console, 'error');
    const falta = await request(app).get('/uploads/miniaturas/' + '0'.repeat(32) + '.webp');
    expect(falta.status).toBe(404);
    expect(falta.headers['cache-control'] || '').not.toMatch(/max-age=2592000/);
    expect(falta.text).toBe('');
    const trilha = await request(app).get('/uploads/miniaturas/..%2f..%2fsrc%2fapp.js');
    expect([400, 403, 404]).toContain(trilha.status);
    expect(trilha.text).not.toMatch(/import/);
    expect(erroLog).not.toHaveBeenCalled();
    erroLog.mockRestore();
  });
});
