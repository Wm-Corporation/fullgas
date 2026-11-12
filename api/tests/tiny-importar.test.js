// importarProduto (tiny.js): o mesmo caminho do botão "Importar do Tiny" e do catálogo de peças KTM.
// db.js e a API do Tiny são dublês.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let consultas = [];
let responder = () => [];
vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => { consultas.push({ texto, p }); return responder(texto, p); },
  getPool: async () => ({}),
  sql: {}
}));
vi.mock('../src/miniaturas.js', () => ({ prepararMiniaturas: () => {}, miniaturaDe: () => null }));

process.env.TINY_TOKEN = 'token-de-teste';
const chamadasTiny = [];
let produtoTiny = { id: '77', codigo: '0025080256', nome: 'PARAFUSO GASGAS M8X25', preco: '4.90', anexos: [] };
vi.stubGlobal('fetch', async (url, opts) => {
  const endpoint = url.split('/').pop();
  chamadasTiny.push(endpoint);
  const retorno = endpoint === 'produto.obter.estoque.php'
    ? { status: 'OK', produto: { saldo: 32, saldoReservado: 2 } }
    : { status: 'OK', produto: produtoTiny };
  return new Response(JSON.stringify({ retorno }), { status: 200 });
});

const { importarProduto } = await import('../src/tiny.js');
const { erroSku } = await import('../src/validacao.js');

beforeEach(() => { consultas = []; chamadasTiny.length = 0; responder = () => []; });
const achar = (re) => consultas.filter(c => re.test(c.texto));

describe('importarProduto', () => {
  it('produto novo: entra na categoria pedida com preço e saldo livre do Tiny', async () => {
    responder = (t) => (/SELECT ProdutoId, Sku, TinyAtivo FROM dbo\.Produto WHERE TinyId/.test(t)
      ? [{ ProdutoId: 5, Sku: '0025080256', TinyAtivo: 1 }] : []);
    const r = await importarProduto('77', 42);
    expect(r).toEqual({ tinyId: '77', sku: '0025080256', status: 'ok', msg: 'Importado.' });
    const ins = achar(/INSERT INTO dbo\.Produto/)[0];
    expect(ins.p).toMatchObject({ sku: '0025080256', catId: 42, preco: 4.9, est: 30, tid: '77' });
    expect(chamadasTiny).toEqual(['produto.obter.php', 'produto.obter.estoque.php']);
  });

  it('SKU já existe no portal (ex.: cadastrado fora do Tiny): só vincula, mantendo a categoria', async () => {
    responder = (t) => {
      if (/WHERE Sku = @sku/.test(t)) return [{ ProdutoId: 9 }];
      if (/WHERE TinyId = @tid/.test(t) && /TinyAtivo/.test(t)) return [{ ProdutoId: 9, Sku: '0025080256', TinyAtivo: 1 }];
      return [];
    };
    const r = await importarProduto('77', 42);
    expect(r.msg).toBe('SKU já existia — vinculado ao Tiny.');
    expect(achar(/UPDATE dbo\.Produto SET TinyId = @tid, TinyAtivo = 1/)[0].p).toEqual({ tid: '77', pid: 9 });
    expect(achar(/INSERT INTO dbo\.Produto/)).toHaveLength(0);
  });

  it('já importado: não chama o Tiny', async () => {
    responder = (t) => (/SELECT Sku FROM dbo\.Produto WHERE TinyId = @tid/.test(t) ? [{ Sku: '0025080256' }] : []);
    const r = await importarProduto('77', 42);
    expect(r).toMatchObject({ status: 'ignorado', msg: 'Já importado.' });
    expect(chamadasTiny).toHaveLength(0);
  });

  it('kit de pistão com classe no código ("… I") agora importa', async () => {
    produtoTiny = { ...produtoTiny, codigo: '55430007000 I', nome: 'KIT PISTAO A' };
    const r = await importarProduto('8', 42);
    expect(r.status).not.toBe('erro');
    expect(achar(/INSERT INTO dbo\.Produto/)[0].p.sku).toBe('55430007000 I');
    produtoTiny = { ...produtoTiny, codigo: '0025080256' };
  });
});

describe('SKU: classe do kit de pistão', () => {
  it('aceita só espaço + I, II, III ou IV no fim; mantém o limite de 40', () => {
    expect(erroSku('55430007000 I')).toBeNull();
    expect(erroSku('55430007000 II')).toBeNull();
    expect(erroSku('A590C163X401000')).toBeNull();
    expect(erroSku('a'.repeat(40))).toBeNull();
    expect(erroSku('a'.repeat(41))).toMatch(/muito longo/);
    expect(erroSku('abc def')).toMatch(/inválido/);
    expect(erroSku('55430007000  I')).toMatch(/inválido/);
    expect(erroSku('55430007000 V')).toMatch(/inválido/);
  });
});
