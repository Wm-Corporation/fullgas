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

// Tiny falso: a lista de produtos (para o índice e a pesquisa) e a importação.
let tinyLista = [];
let tinyPesquisas = [];
let importacoes = [];
let listarTrava = null;          // Promise que segura a listagem (simula o índice ainda montando)
let aoImportar = () => ({ status: 'ok', msg: 'Importado.' });
vi.mock('../src/tiny.js', () => ({
  listarProdutos: async (pagina, pesquisa = '') => {
    if (listarTrava) await listarTrava;
    if (pesquisa) tinyPesquisas.push(pesquisa);
    const produtos = tinyLista.filter(p => !pesquisa || p.sku.startsWith(pesquisa.toUpperCase()));
    return { pagina, totalPaginas: 1, produtos };
  },
  importarProduto: async (tinyId, categoriaId, opts) => {
    importacoes.push({ tinyId, categoriaId, opts });
    const t = tinyLista.find(p => p.tinyId === tinyId);
    return { tinyId, sku: t?.sku, ...aoImportar(t) };
  }
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const cat = await import('../src/catalogo-ktm.js');
const indice = await import('../src/tiny-indice.js');
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
      { sku: 'SPNO', x: 271, y: 792 - 617 - 22, w: 22, h: 22 },
      { sku: '0025080256', x: 500, y: 792 - 751 - 22, w: 22, h: 22 }
    ]);
  });

  it('pontos do cache antigo (28 px) ganham o tamanho da KTM sem mudar o canto inferior', () => {
    expect(cat.corrigirPontos([{ sku: 'A', x: 10, y: 100, w: 28, h: 28 }, { sku: 'B', x: 5, y: 50, w: 22, h: 22 }]))
      .toEqual([{ sku: 'A', x: 10, y: 106, w: 22, h: 22 }, { sku: 'B', x: 5, y: 50, w: 22, h: 22 }]);
  });

  it('só EU de cada modelo e ano; sem EU, a versão sem mercado; só outros mercados sai', () => {
    const M = (id, nome, mercado) => ({ id, nome, mercado });
    const l = cat.soEU([
      M('1', 'EC 250 2025', 'EU'), M('2', 'EC 250 2025', 'US'), M('3', 'EC 250 2025', null),
      M('4', 'MC 250F 2025', null), M('5', 'MC 250F 2025', 'US'),
      M('6', '125 XC 2025', 'US'), M('7', '690 SMC R 2025', 'EU, US'), M('8', '1290 SA 2023', 'EU/GB'),
      M('9', 'FE 350 2025', 'EU'), M('10', 'FE 350 2025', 'BR')
    ]);
    expect(l.map(m => m.id)).toEqual(['1', '4', '7', '8', '9']);
  });

  it('kit de pistão com classe no código é pedível; espaço solto não', () => {
    expect(cat.pedivel('55430007000 I')).toBe(true);
    expect(cat.pedivel('A44030007010 II')).toBe(true);
    expect(cat.pedivel('SPNO')).toBe(false);
    expect(cat.pedivel('ABC DEF')).toBe(false);
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
  // VIN: chassi "…US…" é da versão americana (1003420982); os outros, da versão sem mercado.
  if (url.endsWith('/Result')) return ok(RESULTADO.replace(/1003420981/g, /US/.test(String(opts.body)) ? '1003420982' : '1003420981'));
  if (url.includes('/ComponentGroupTemplate/Index/')) return ok(GRUPO);
  if (url.includes('ComponentGroupTemplateArticles_Read')) return ok(PECAS, 'application/json');
  return new Response('nao', { status: 404 });
});

const T = (tinyId, sku, preco = 10) => ({ tinyId, sku, nome: 'PECA ' + sku, preco, situacao: 'A' });

describe('índice de códigos do Tiny', () => {
  beforeEach(() => { indice._limpar(); listarTrava = null; });

  it('separa a classe do kit de pistão', () => {
    expect(indice.separarClasse('55430007000 I')).toEqual({ base: '55430007000', classe: 'I' });
    expect(indice.separarClasse('55430007000 ii')).toEqual({ base: '55430007000', classe: 'II' });
    expect(indice.separarClasse('A46001035001')).toEqual({ base: 'A46001035001', classe: null });
  });

  it('monta pelas páginas do Tiny, ignora inativos e acha pelo código da KTM', async () => {
    const paginas = {
      1: { totalPaginas: 2, produtos: [T('1', '0025080256'), T('2', '55430007000 II'), { ...T('3', 'VELHO'), situacao: 'I' }] },
      2: { totalPaginas: 2, produtos: [T('4', '55430007000 I')] }
    };
    const ix = await indice.montar(p => paginas[p]);
    expect(ix.total).toBe(3);
    expect(indice.buscar('0025080256', ix).map(t => t.tinyId)).toEqual(['1']);
    expect(indice.buscar('55430007000', ix).map(t => t.sku)).toEqual(['55430007000 I', '55430007000 II']);
    expect(indice.buscar('VELHO', ix)).toEqual([]);
    expect(indice.buscar('NAOEXISTE', ix)).toEqual([]);
  });

  it('sem índice, buscar devolve null (ainda não sabe)', () => {
    expect(indice.buscar('0025080256', null)).toBeNull();
  });
});

describe('rotas do catálogo KTM', () => {
  beforeEach(async () => {
    consultas = []; pedidas.length = 0; importacoes = []; tinyPesquisas = [];
    fs.rmSync(cat.PASTA + '/gasgas', { recursive: true, force: true });
    responder = () => [];
    listarTrava = null;
    aoImportar = () => ({ status: 'ok', msg: 'Importado.' });
    tinyLista = [];
    indice._limpar();
    await indice.atualizar({ forcar: true });
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

  it('modelos: lê uma vez e serve do cache depois; a versão US sai', async () => {
    const a = app(ADMIN);
    const l = (await request(a).get('/api/catalogo-ktm/gasgas/modelos')).body;
    expect(l.map(m => m.id)).toEqual(['1003420981']);              // MC 250F sem mercado (motocross)
    expect((await request(a).get('/api/catalogo-ktm/gasgas/modelos')).body).toHaveLength(1);
    expect(pedidas).toHaveLength(1);
  });

  it('chassi de moto de outro mercado abre a versão do catálogo com o mesmo nome e ano', async () => {
    const r = await request(app(ADMIN)).get('/api/catalogo-ktm/gasgas/vin/VBKUS1234567890AB');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: '1003420981' });
  });

  it('modelo de outro mercado não abre', async () => {
    const r = await request(app(ADMIN)).get('/api/catalogo-ktm/gasgas/modelos/1003420982/chassi');
    expect(r.status).toBe(404);
  });

  it('grupo: peça no portal mostra estoque e preço; cookie da sessão volta ao site', async () => {
    tinyLista = [T('99', '0025080256')];
    await indice.atualizar({ forcar: true });
    responder = (s) => /FROM dbo\.Produto p JOIN dbo\.Categoria/.test(s)
      ? [{ Sku: '0025080256', Nome: 'Parafuso', Preco: 12.5, Estoque: 3, TinyId: '99', ImagemUrl: null, Categoria: 'pecas' }]
      : [];
    const r = await request(app(ADMIN)).get('/api/catalogo-ktm/gasgas/modelos/1003420981/chassi/grupos/72726');
    expect(r.status).toBe(200);
    expect(r.body.vizinhos).toEqual({ anterior: null, proxima: 67002 });
    expect(r.body.mapa).toEqual({ arquivo: '24A5400110.png', largura: 547, altura: 792 });
    expect(r.body.indiceTiny).toMatchObject({ pronto: true, produtos: 1 });
    expect(r.body.pecas[0].loja).toBeNull();
    expect(r.body.pecas[1].loja).toMatchObject({
      origem: 'portal', opcoes: [{ artigo: '0025080256', noPortal: true, estoque: 3, preco: 12.5 }]
    });
    expect(r.body.pecas[1]).toMatchObject({ nome: 'Parafuso', nomeKtm: 'HH collar screw M8x25' });
    expect(r.body.pontos[1]).toEqual({ sku: '0025080256', x: 500, y: 792 - 751 - 22, w: 22, h: 22 });
    expect(pedidas.slice(1).every(p => /ASP\.NET_SessionId=abc/.test(p.opts.headers.Cookie || ''))).toBe(true);
  });

  it('grupo: peça só no Tiny aparece como "tiny", com o preço do Tiny', async () => {
    tinyLista = [T('77', '0025080256', 4.9)];
    await indice.atualizar({ forcar: true });
    const r = await request(app(ADMIN)).get('/api/catalogo-ktm/gasgas/modelos/1003420981/chassi/grupos/72726');
    expect(r.body.pecas[1].loja).toEqual({
      origem: 'tiny',
      opcoes: [{ artigo: '0025080256', classe: null, tinyId: '77', noPortal: false, estoque: null, preco: 4.9, foto: null, miniatura: null }]
    });
    expect(r.body.pecas[1].nome).toBe('PECA 0025080256');           // nome do Tiny
  });

  it('grupo: em nenhum lugar = "fora"; índice montando = "verificar"', async () => {
    let r = await request(app(ADMIN)).get('/api/catalogo-ktm/gasgas/modelos/1003420981/chassi/grupos/72726');
    expect(r.body.pecas[1].loja.origem).toBe('fora');
    expect(r.body.pecas[1].nome).toBe('PARAFUSO SEXTAVADO FLANGEADO M8X25');   // fora do Tiny: dicionário
    expect(r.body.grupo).toMatchObject({ nome: 'SUSPENSÃO DIANTEIRA, MESAS', nomeKtm: 'FRONT FORK, TRIPLE CLAMP' });
    indice._limpar();
    let soltar; listarTrava = new Promise(s => { soltar = s; });
    r = await request(app(ADMIN)).get('/api/catalogo-ktm/gasgas/modelos/1003420981/chassi/grupos/72726');
    expect(r.body.pecas[1].loja.origem).toBe('verificar');
    expect(r.body.indiceTiny).toMatchObject({ pronto: false, montando: true });
    soltar();
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
    expect(r.body.importados).toBe(0);
    expect(r.body.pecas[0]).toMatchObject({ sku: 'A46001035001', artigo: 'A46001035001', foraDoTiny: true, preco: null });
    expect(importacoes).toHaveLength(0);
    const ins = consultas.find(c => /INSERT INTO dbo\.Produto/.test(c.sql));
    expect(ins.sql).toMatch(/SELECT @sku, @nome, @cat, @desc, 0, 0/);
    expect(ins.params).toMatchObject({ sku: 'A46001035001', cat: 42 });
  });

  // Banco falso em que a importação "acontece": depois dela o produto aparece ligado ao Tiny.
  function bancoComImportacao(linhaImportada) {
    let importou = false;
    aoImportar = () => { importou = true; return { status: 'ok', msg: 'Importado.' }; };
    responder = (s) => {
      if (/IF NOT EXISTS \(SELECT 1 FROM dbo\.Categoria/.test(s)) return [{ CategoriaId: 42 }];
      if (/FROM dbo\.Produto p JOIN dbo\.Categoria/.test(s)) return importou ? [linhaImportada] : [];
      return [];
    };
  }

  it('peça só no Tiny: é importada (prioritária, categoria do catálogo) e volta com estoque real', async () => {
    tinyLista = [T('77', '0025080256', 4.9)];
    await indice.atualizar({ forcar: true });
    bancoComImportacao({ Sku: '0025080256', Nome: 'PARAFUSO', Preco: 4.9, Estoque: 30, TinyId: '77', ImagemUrl: null, Categoria: 'catalogo-ktm' });
    const r = await request(app(ADMIN)).post('/api/catalogo-ktm/pecas')
      .send({ marca: 'gasgas', itens: [{ sku: '0025080256', nome: 'Screw', artigo: '0025080256' }] });
    expect(r.status).toBe(200);
    expect(importacoes).toEqual([{ tinyId: '77', categoriaId: 42, opts: { prioritario: true } }]);
    expect(r.body).toMatchObject({ importados: 1, criados: 0, erros: [] });
    expect(r.body.pecas[0]).toMatchObject({ sku: '0025080256', artigo: '0025080256', noPortal: true, estoque: 30, foraDoTiny: false });
    expect(consultas.some(c => /INSERT INTO dbo\.Produto/.test(c.sql))).toBe(false);
  });

  it('kit de pistão: sem a classe escolhida não importa; com a classe, importa a certa', async () => {
    tinyLista = [T('8', '55430007000 I'), T('9', '55430007000 II')];
    await indice.atualizar({ forcar: true });
    let r = await request(app(ADMIN)).post('/api/catalogo-ktm/pecas')
      .send({ marca: 'gasgas', itens: [{ sku: '55430007000', nome: 'Kit pistão' }] });
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/escolha a classe \(I ou II\)/);
    expect(importacoes).toHaveLength(0);

    bancoComImportacao({ Sku: '55430007000 II', Nome: 'KIT PISTAO B', Preco: 900, Estoque: 2, TinyId: '9', ImagemUrl: null, Categoria: 'catalogo-ktm' });
    r = await request(app(ADMIN)).post('/api/catalogo-ktm/pecas')
      .send({ marca: 'gasgas', itens: [{ sku: '55430007000', nome: 'Kit pistão', artigo: '55430007000 II' }] });
    expect(r.status).toBe(200);
    expect(importacoes.map(i => i.tinyId)).toEqual(['9']);
    expect(r.body.pecas[0]).toMatchObject({ artigo: '55430007000 II', estoque: 2, noPortal: true });
  });

  it('KTM já diz a classe ("… II"): só a classe certa do Tiny, sem pedir escolha', async () => {
    tinyLista = [T('8', '55430007000 I'), T('9', '55430007000 II')];
    await indice.atualizar({ forcar: true });
    expect(indice.buscar('55430007000 II').map(t => t.tinyId)).toEqual(['9']);
    bancoComImportacao({ Sku: '55430007000 II', Nome: 'KIT PISTAO B', Preco: 900, Estoque: 2, TinyId: '9', ImagemUrl: null, Categoria: 'catalogo-ktm' });
    const r = await request(app(ADMIN)).post('/api/catalogo-ktm/pecas')
      .send({ marca: 'gasgas', itens: [{ sku: '55430007000 II', nome: 'Piston cpl. II' }] });
    expect(r.status).toBe(200);
    expect(importacoes.map(i => i.tinyId)).toEqual(['9']);
  });

  it('índice ainda montando: pesquisa a peça direto no Tiny antes de decidir', async () => {
    tinyLista = [T('77', '0025080256')];
    indice._limpar();
    let soltar; listarTrava = new Promise(s => { soltar = s; });
    indice.atualizar();                       // montagem presa
    listarTrava = null;                       // a pesquisa direta não fica presa
    bancoComImportacao({ Sku: '0025080256', Nome: 'P', Preco: 5, Estoque: 1, TinyId: '77', ImagemUrl: null, Categoria: 'catalogo-ktm' });
    const r = await request(app(ADMIN)).post('/api/catalogo-ktm/pecas')
      .send({ marca: 'gasgas', itens: [{ sku: '0025080256', nome: 'Screw' }] });
    expect(r.status).toBe(200);
    expect(tinyPesquisas).toContain('0025080256');
    expect(importacoes.map(i => i.tinyId)).toEqual(['77']);
    soltar();
  });

  it('Tiny recusou a importação: avisa e não cadastra fora do Tiny', async () => {
    tinyLista = [T('77', '0025080256')];
    await indice.atualizar({ forcar: true });
    aoImportar = () => ({ status: 'erro', msg: 'Tiny respondeu HTTP 500.' });
    responder = (s) => (/IF NOT EXISTS \(SELECT 1 FROM dbo\.Categoria/.test(s) ? [{ CategoriaId: 42 }] : []);
    const r = await request(app(ADMIN)).post('/api/catalogo-ktm/pecas')
      .send({ marca: 'gasgas', itens: [{ sku: '0025080256', nome: 'Screw' }] });
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/o Tiny não importou — Tiny respondeu HTTP 500/);
    expect(consultas.some(c => /INSERT INTO dbo\.Produto/.test(c.sql))).toBe(false);
  });

  it('peça já no portal e ligada ao Tiny: nada a importar nem criar', async () => {
    responder = (s) => /FROM dbo\.Produto p JOIN dbo\.Categoria/.test(s)
      ? [{ Sku: '0025080256', Nome: 'P', Preco: 5, Estoque: 9, TinyId: '77', ImagemUrl: null, Categoria: 'pecas' }] : [];
    const r = await request(app(ADMIN)).post('/api/catalogo-ktm/pecas')
      .send({ marca: 'gasgas', itens: [{ sku: '0025080256', nome: 'Screw' }] });
    expect(r.body).toMatchObject({ importados: 0, criados: 0 });
    expect(r.body.pecas[0]).toMatchObject({ estoque: 9, noPortal: true });
    expect(importacoes).toHaveLength(0);
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
