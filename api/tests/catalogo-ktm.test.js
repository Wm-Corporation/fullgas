// Catálogo de peças KTM: leitura do HTML do SparePartsFinder, rotas só de admin e peças fora do Tiny
// escondidas de clientes. db.js e o fetch do site são dublês (nada vai à internet nem ao banco).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';

let consultas = [];
let responder = () => [];
vi.mock('../src/db.js', () => ({
  query: async (sqlTexto, params = {}) => { consultas.push({ sql: sqlTexto, params }); return responder(sqlTexto, params); },
  getPool: async () => { throw new Error('não usado'); },
  sql: {}
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const cat = await import('../src/catalogo-ktm.js');
const { default: rotas } = await import('../src/routes/catalogo-ktm.routes.js');
const produtoCtl = await import('../src/controllers/produto.controller.js');
const categoriaCtl = await import('../src/controllers/categoria.controller.js');

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1 };
const CLIENTE = { id: 9, email: 'c@loja.com', papel: 'cliente', empresaId: 7 };

// ---- trechos reais (encurtados) das páginas da KTM ----
const HOME = `<script>var confirmMsg = "x";
  $(function() { var treeSettings = {"TreeElements":[{"id":"1","text":"GasGas","state":{"disabled":true},"children":[
    {"id":"2","text":"Offroad","children":[{"id":"3","text":"MC 250F","children":[
      {"id":"4","text":"MC 250F 2025","children":[
        {"id":"1003420981","text":"MC 250F            2025 <2025><F0201Y5>","state":{"disabled":false}},
        {"id":"1003420982","text":"MC 250F US  2025 <2025><US><F0275Y5>","state":{"disabled":false}}]},
      {"id":"5","text":"MC 250F 2027","children":[],"state":{"disabled":true}}]}]}]}],"UseAsSingleSelect":true}; });
  var outra = { "a": "}" };</script>`;

const RESULTADO = `<tbody><tr><td>01</td><td>FRONT FORK, TRIPLE CLAMP</td><td><div><a class="grid-click-no-edit" href="/ComponentGroupTemplate/Index/72726?modelidentifier=1003420981&isEngine=False"><i></i></a></div></td><td style="display:none"><img class="component-group-template-preview-image" src="/Images/maps/24A5400110.png"/></td></tr>
<tr class="k-alt"><td>02</td><td>HANDLEBAR, CONTROLS</td><td><div><a href="/ComponentGroupTemplate/Index/67002?modelidentifier=1003420981&isEngine=False"></a></div></td><td style="display:none"><img class="component-group-template-preview-image" src="/Images/maps/24A5410210.png"/></td></tr></tbody>
<a href="/Result/ExecuteSearch?modelIdentification=1003420981&amp;isEngine=True">Switch</a>
<div id="ResultsVehicleModelModal" style="display:none"><div> <img src="https://azwestraccwebprod1.z6.web.core.windows.net/PHO_BIKE_90_RE_GASGAS-2025_%23V1.png" class="k-loading-image" /></div></div>`;

const GRUPO = `<div id="componentGroupTemplateImage" style="width: 547px; height: 792px; background: Url(/Images/maps/24A5400110.png) no-repeat;">
  <a data-article-number="SPNO" class="point" style="bottom: 617px; left: 271px;"></a>
  <a data-article-number="0025080256" class="point" style="bottom: 751px; left: 500px;"></a>
  <a data-article-number="\${articleNumber}" class="point"></a></div>`;

const PECAS = { Data: [
  { ArticleNumber: 'SPNO', SequenceNumber: 1, ArticleDescription: 'Non orderable part', Quantity: 1, IsNew: false, ArticleAdditionalText: 'A460C105Y406000' },
  { ArticleNumber: '0025080256', SequenceNumber: 3, ArticleDescription: 'HH collar  screw M8x25', Quantity: 4, IsNew: true, ArticleAdditionalText: '' }
], Total: 2 };

describe('leitura das páginas da KTM', () => {
  it('árvore: só folhas habilitadas, com ano, mercado e código', () => {
    const m = cat.lerArvore(HOME);
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ id: '1003420981', nome: 'MC 250F 2025', caminho: ['GasGas', 'Offroad', 'MC 250F'], ano: 2025, mercado: null, codigo: 'F0201Y5' });
    expect(m[1]).toMatchObject({ mercado: 'US', codigo: 'F0275Y5' });
  });

  it('árvore ausente vira erro claro', () => {
    expect(() => cat.lerArvore('<html></html>')).toThrow(/árvore de modelos/);
  });

  it('grupos, foto da moto e modelo do resultado', () => {
    expect(cat.lerGrupos(RESULTADO)).toEqual([
      { id: 72726, numero: '01', nome: 'FRONT FORK, TRIPLE CLAMP', mapa: '24A5400110.png' },
      { id: 67002, numero: '02', nome: 'HANDLEBAR, CONTROLS', mapa: '24A5410210.png' }
    ]);
    expect(cat.lerFotoModelo(RESULTADO)).toMatch(/^https:\/\/azwestraccwebprod1\.z6\.web\.core\.windows\.net\//);
    expect(cat.modeloDoResultado(RESULTADO)).toBe('1003420981');
  });

  it('foto só de origem da KTM', () => {
    expect(cat.origemFotoPermitida('https://x.z6.web.core.windows.net/a.png')).toBe(true);
    expect(cat.origemFotoPermitida('https://sparepartsfinder.gasgas.com/a.png')).toBe(true);
    expect(cat.origemFotoPermitida('http://x.z6.web.core.windows.net/a.png')).toBe(false);
    expect(cat.origemFotoPermitida('https://evil.example/a.png')).toBe(false);
  });

  it('pontos: canto inferior esquerdo vira topo-esquerda; ignora o modelo do template JS', () => {
    const g = cat.lerPaginaGrupo(GRUPO);
    expect(g).toMatchObject({ mapa: '24A5400110.png', largura: 547, altura: 792 });
    expect(g.pontos).toEqual([
      { sku: 'SPNO', x: 271, y: 792 - 617 - 28, w: 28, h: 28 },
      { sku: '0025080256', x: 500, y: 792 - 751 - 28, w: 28, h: 28 }
    ]);
  });

  it('peças: SPNO não é pedível; espaços normalizados', () => {
    const p = cat.lerPecas(PECAS);
    expect(p[0]).toMatchObject({ sku: 'SPNO', pedivel: false, adicional: 'A460C105Y406000' });
    expect(p[1]).toEqual({ seq: 3, sku: '0025080256', nome: 'HH collar screw M8x25', quantidade: 4, adicional: '', novo: true, pedivel: true });
  });

  it('nome de prancha estranho é recusado', () => {
    expect(cat.arquivoMapa('../../etc/passwd')).toBeNull();
    expect(cat.arquivoMapa('24A5400110.png')).toBe('24A5400110.png');
  });
});

// ---- rotas ----
function app(user) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotas);
  a.get('/api/produtos', produtoCtl.listar);
  a.get('/api/produtos/:sku', produtoCtl.obter);
  a.get('/api/categorias', categoriaCtl.listar);
  return a;
}

// Site da KTM falso: responde pelas URLs que o módulo pede.
const pedidas = [];
cat._trocarFetch(async (url, opts) => {
  pedidas.push({ url, opts });
  const ok = (corpo, tipo = 'text/html') => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    { status: 200, headers: { 'content-type': tipo, 'set-cookie': 'ASP.NET_SessionId=abc; path=/' } });
  if (url.endsWith('.gasgas.com/')) return ok(HOME);
  if (url.includes('/Result/ExecuteSearch')) return ok(RESULTADO);
  if (url.includes('/ComponentGroupTemplate/Index/')) return ok(GRUPO);
  if (url.includes('ComponentGroupTemplateArticles_Read')) return ok(PECAS, 'application/json');
  return new Response('nao', { status: 404 });
});

describe('rotas do catálogo KTM', () => {
  beforeEach(() => {
    consultas = []; pedidas.length = 0;
    fs.rmSync(cat.PASTA + '/gasgas', { recursive: true, force: true });
    responder = () => [];
  });

  it('cliente não entra (403)', async () => {
    const r = await request(app(CLIENTE)).get('/api/catalogo-ktm/gasgas/modelos');
    expect(r.status).toBe(403);
    expect(pedidas).toHaveLength(0);
  });

  it('marca desconhecida = 404, sem ir ao site', async () => {
    const r = await request(app(ADMIN)).get('/api/catalogo-ktm/yamaha/modelos');
    expect(r.status).toBe(404);
    expect(pedidas).toHaveLength(0);
  });

  it('modelos: lê uma vez e serve do cache depois', async () => {
    const a = app(ADMIN);
    expect((await request(a).get('/api/catalogo-ktm/gasgas/modelos')).body).toHaveLength(2);
    expect((await request(a).get('/api/catalogo-ktm/gasgas/modelos')).body).toHaveLength(2);
    expect(pedidas).toHaveLength(1);
  });

  it('grupo: cruza peças com o Produto; cookie da sessão volta ao site', async () => {
    responder = (s) => /FROM dbo\.Produto p JOIN dbo\.Categoria/.test(s)
      ? [{ Sku: '0025080256', Nome: 'Parafuso', Preco: 12.5, Estoque: 3, TinyId: '99', ImagemUrl: null, Categoria: 'pecas' }]
      : [];
    const r = await request(app(ADMIN)).get('/api/catalogo-ktm/gasgas/modelos/1003420981/chassi/grupos/72726');
    expect(r.status).toBe(200);
    expect(r.body.vizinhos).toEqual({ anterior: null, proxima: 67002 });
    expect(r.body.mapa).toEqual({ arquivo: '24A5400110.png', largura: 547, altura: 792 });
    expect(r.body.pecas[0].loja).toBeNull();
    expect(r.body.pecas[1].loja).toMatchObject({ existe: true, foraDoTiny: false, estoque: 3, preco: 12.5 });
    expect(pedidas.slice(1).every(p => /ASP\.NET_SessionId=abc/.test(p.opts.headers.Cookie || ''))).toBe(true);
  });

  it('grupo de outro modelo = 404', async () => {
    const r = await request(app(ADMIN)).get('/api/catalogo-ktm/gasgas/modelos/1003420981/chassi/grupos/11111');
    expect(r.status).toBe(404);
  });

  it('peças novas entram fora do Tiny (preço 0, estoque 0, categoria do catálogo)', async () => {
    let criadas = false;
    responder = (s) => {
      if (/IF NOT EXISTS \(SELECT 1 FROM dbo\.Categoria/.test(s)) return [{ CategoriaId: 42 }];
      if (/INSERT INTO dbo\.Produto/.test(s)) { criadas = true; return [{ ProdutoId: 5 }]; }
      if (/FROM dbo\.Produto p JOIN dbo\.Categoria/.test(s)) return criadas
        ? [{ Sku: 'A46001035001', Nome: 'Rubber bushing', Preco: 0, Estoque: 0, TinyId: null, ImagemUrl: null, Categoria: 'catalogo-ktm' }]
        : [];
      return [];
    };
    const r = await request(app(ADMIN)).post('/api/catalogo-ktm/pecas')
      .send({ marca: 'gasgas', itens: [{ sku: 'a46001035001', nome: 'Rubber bushing' }] });
    expect(r.status).toBe(200);
    expect(r.body.criados).toBe(1);
    expect(r.body.pecas[0]).toMatchObject({ sku: 'A46001035001', existe: true, foraDoTiny: true, preco: null });
    const ins = consultas.find(c => /INSERT INTO dbo\.Produto/.test(c.sql));
    expect(ins.sql).toMatch(/SELECT @sku, @nome, @cat, @desc, 0, 0/);
    expect(ins.params).toMatchObject({ sku: 'A46001035001', cat: 42 });
  });

  it('SPNO e código inválido são recusados', async () => {
    const a = app(ADMIN);
    expect((await request(a).post('/api/catalogo-ktm/pecas').send({ marca: 'gasgas', itens: [{ sku: 'SPNO' }] })).status).toBe(400);
    expect((await request(a).post('/api/catalogo-ktm/pecas').send({ marca: 'gasgas', itens: [{ sku: 'a b' }] })).status).toBe(400);
  });
});

describe('peças fora do Tiny ficam escondidas de clientes', () => {
  const linhas = [
    { Sku: 'FG1', Nome: 'Normal', Preco: 10, Estoque: 1, CategoriaCodigo: 'pecas' },
    { Sku: 'A46001035001', Nome: 'Do catálogo', Preco: 0, Estoque: 0, CategoriaCodigo: 'catalogo-ktm' }
  ];
  beforeEach(() => {
    responder = (s) => {
      if (/FROM dbo\.Produto p\s+JOIN dbo\.Categoria c/.test(s)) return /WHERE p\.Sku = @sku/.test(s) ? [linhas[1]] : linhas;
      if (/FROM dbo\.Categoria c/.test(s)) return [{ id: 'pecas', nome: 'Peças' }, { id: 'catalogo-ktm', nome: 'Catálogo KTM' }];
      return [];
    };
  });

  it('lista da loja', async () => {
    expect((await request(app(CLIENTE)).get('/api/produtos')).body.map(p => p.artigo)).toEqual(['FG1']);
    expect((await request(app(ADMIN)).get('/api/produtos')).body.map(p => p.artigo)).toEqual(['FG1', 'A46001035001']);
  });

  it('produto pelo SKU', async () => {
    expect((await request(app(CLIENTE)).get('/api/produtos/A46001035001')).status).toBe(404);
    expect((await request(app(ADMIN)).get('/api/produtos/A46001035001')).status).toBe(200);
  });

  it('categorias', async () => {
    expect((await request(app(CLIENTE)).get('/api/categorias')).body.map(c => c.id)).toEqual(['pecas']);
    expect((await request(app(ADMIN)).get('/api/categorias')).body.map(c => c.id)).toEqual(['pecas', 'catalogo-ktm']);
  });
});
