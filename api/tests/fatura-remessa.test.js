// Fatura na remessa (051), peça não encontrada, saldo do Tiny sem o reservado e o vigia da black order.
// db.js é um dublê (o `responder` de cada teste decide o que o "banco" devolve).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let responder = () => [];
let chamadas = [];
const um = (linhas) => ({ recordset: linhas, rowsAffected: [linhas.length] });

class FakeRequest {
  constructor() { this.p = {}; }
  input(nome, _tipo, valor) { this.p[nome] = valor === undefined ? _tipo : valor; return this; }
  async query(texto) {
    chamadas.push({ texto, p: { ...this.p } });
    const r = responder(texto, this.p);
    return r && r.recordset ? r : um(r || []);
  }
}
let transacoes = [];
class FakeTransaction {
  async begin() { transacoes.push('begin'); }
  async commit() { transacoes.push('commit'); }
  async rollback() { transacoes.push('rollback'); }
}
const tipo = () => ({});
vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => {
    chamadas.push({ texto, p });
    const r = responder(texto, p);
    return r && r.recordset ? r.recordset : (r || []);
  },
  getPool: async () => ({}),
  sql: { Transaction: FakeTransaction, Request: FakeRequest, Int: tipo(), Bit: tipo(), VarChar: tipo, NVarChar: tipo, Decimal: tipo, DateTime2: tipo() }
}));
let recalculados = [];
let exportacoes = [];
vi.mock('../src/tiny-pedidos.js', () => ({
  exportacaoLigada: () => true,
  atualizarEstoqueCesta: async (skus) => { recalculados.push(...skus); },
  inserirExportacao: async (_tx, pedidoId, escopo, itens) => { exportacoes.push({ pedidoId, escopo, itens }); },
  processarExportacoes: () => {},
  cancelarExportacoesDoPedido: async () => {},
  sincronizarSituacaoPedidos: async () => {}
}));
vi.mock('../src/historico-pedido.js', () => ({
  registrarEventoPedido: async () => {}, historicoDoPedido: async () => [], resumoPecas: () => ''
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const tiny = await import('../src/tiny.js');
const { default: rotasPedidos } = await import('../src/routes/pedidos.routes.js');

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1, gestor: true, perm: null };
function app(user = ADMIN) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotasPedidos);
  return a;
}
const achar = (re) => chamadas.filter(c => re.test(c.texto));
beforeEach(() => { chamadas = []; transacoes = []; recalculados = []; exportacoes = []; responder = () => []; });

describe('saldo do Tiny: saldo − reservado', () => {
  it('pedido aprovado no Tiny reserva a peça sem tirar do saldo: não pode ir para a loja', () => {
    expect(tiny.saldoLivre({ saldo: 2, saldoReservado: 1 })).toBe(1);   // o caso do teste de 26/10
    expect(tiny.saldoLivre({ saldo: '5', saldoReservado: '5' })).toBe(0);
    expect(tiny.saldoLivre({ saldo: 3 })).toBe(3);
    expect(tiny.saldoLivre({ saldo: 1, saldoReservado: 4 })).toBe(0);    // nunca negativo
    expect(tiny.saldoLivre(null)).toBe(0);
  });
});

// Pedido 10 com dois itens: A1 3 un. (todas enviadas, nada exportado) e B2 2 un. (nada enviado).
function bancoRemessa({ faturaNaRemessa }) {
  const faturaItens = [];
  let fatura = null;
  const resp = (t, p) => {
    if (/SELECT PedidoId, Status FROM dbo\.Pedido WHERE NumeroPedido/.test(t)) return [{ PedidoId: 10, Status: 'Aprovado' }];
    if (/QuantidadeEnviada - QuantidadeExportada AS Qtd/.test(t))
      return [{ PedidoItemId: 1, Sku: 'A1', NomeProduto: 'PECA A', PrecoUnitario: 10, Qtd: 3 }];
    if (/SELECT EmpresaId, FaturaNaRemessa FROM dbo\.Pedido/.test(t)) return [{ EmpresaId: 7, FaturaNaRemessa: faturaNaRemessa }];
    if (/INSERT INTO dbo\.Fatura /.test(t)) { fatura = p; return [{ FaturaId: 33, NumeroFatura: '1033' }]; }
    if (/INSERT INTO dbo\.FaturaItem/.test(t)) { faturaItens.push(p); return []; }
    if (/AS Confirmada/.test(t)) return [{ totNormais: 2, pendNormais: 1, comEnvio: 1, pendTotal: 1 }];
    return [];
  };
  return { resp, faturaItens, get fatura() { return fatura; } };
}

describe('fatura na remessa ("Confirmar envio")', () => {
  it('pedido novo: a remessa gera a fatura só das peças que saíram nela', async () => {
    const b = bancoRemessa({ faturaNaRemessa: 1 });
    responder = b.resp;
    const r = await request(app()).post('/api/pedidos/0005041900/remessa').send({});
    expect(r.status).toBe(200);
    expect(r.body.fatura).toEqual({ numero: '1033', total: 30 });
    expect(b.fatura).toMatchObject({ eid: 7, val: 30 });                  // 3 × 10 (B2 ainda não saiu)
    expect(b.faturaItens).toEqual([{ fid: 33, sku: 'A1', nome: 'PECA A', preco: 10, qtd: 3 }]);
    expect(achar(/INSERT INTO dbo\.PedidoFatura/)[0].p).toMatchObject({ pid: 10, fid: 33 });
    expect(exportacoes).toHaveLength(1);                                  // e vai ao Tiny junto
    expect(transacoes).toEqual(['begin', 'commit']);
  });

  it('pedido antigo (fatura cheia no checkout): a remessa não gera outra', async () => {
    const b = bancoRemessa({ faturaNaRemessa: 0 });
    responder = b.resp;
    const r = await request(app()).post('/api/pedidos/0005041900/remessa').send({});
    expect(r.status).toBe(200);
    expect(r.body.fatura).toBeNull();
    expect(b.fatura).toBeNull();
  });
});

// Item 5: B2, 4 pedidas, 1 enviada; pedido 0005041900 da empresa 7 (usuário 3).
function bancoNaoEncontrada(extra = {}) {
  const st = { item: null, total: null, bo: null };
  const resp = (t, p) => {
    if (/pi\.QuantidadeEnviada, pi\.EmBackorder,\s+p\.NumeroPedido/.test(t))
      return [{ PedidoId: 10, PedidoItemId: 5, ProdutoId: 200, Sku: 'B2', NomeProduto: 'PECA B', PrecoUnitario: 20,
        Quantidade: 4, QuantidadeEnviada: 1, EmBackorder: 0, NumeroPedido: '0005041900', Status: 'Pendente',
        EmpresaId: 7, UsuarioId: 3, FaturaNaRemessa: 1, ...extra }];
    if (/SET Quantidade = Quantidade - @q/.test(t)) { st.item = p; return []; }
    if (/SET Total = Total - @v/.test(t)) { st.total = p; return []; }
    if (/INSERT INTO dbo\.BlackOrder /.test(t)) { st.bo = p; return [{ BlackOrderId: 950 }]; }
    if (/SELECT ISNULL\(SUM\(Quantidade\), 0\) AS n FROM dbo\.PedidoItem/.test(t)) return [{ n: st.resto ?? 1 }];
    if (/AS Confirmada/.test(t)) return [{ totNormais: 1, pendNormais: 0, comEnvio: 1, pendTotal: 0 }];
    return [];
  };
  return { resp, st };
}
const marcar = (body) => request(app()).post('/api/pedidos/0005041900/itens/5/nao-encontrada').send(body);

describe('peça não encontrada', () => {
  it('retirar do pedido: baixa a quantidade, guarda o motivo, desconta do total e avisa o cliente', async () => {
    const b = bancoNaoEncontrada();
    responder = b.resp;
    const r = await marcar({ quantidade: 3, motivo: 'Estoque incorreto', destino: 'remover' });
    expect(r.status).toBe(200);
    expect(b.st.item).toMatchObject({ iid: 5, q: 3, mot: 'Estoque incorreto' });
    expect(b.st.total).toMatchObject({ pid: 10, v: 60 });
    expect(b.st.bo).toBeNull();
    expect(r.body.status).toBe('Enviado');                     // o que restou já saiu
    const n = achar(/INSERT INTO dbo\.Notificacao/)[0];
    expect(n.p).toMatchObject({ eid: 7, link: '#pedido/0005041900' });
    expect(n.p.texto).toMatch(/O que aconteceu: Estoque incorreto\.[\s\S]*retiradas do pedido e não serão cobradas/);
    expect(recalculados).toEqual(['B2']);
    expect(r.body.aviso).toMatch(/Tiny/);
  });

  it('mandar para a black order: cria a linha no fim da fila, com o mesmo número e dono', async () => {
    const b = bancoNaoEncontrada();
    responder = b.resp;
    const r = await marcar({ quantidade: 2, motivo: 'Não foi encontrado', destino: 'blackorder' });
    expect(r.status).toBe(200);
    expect(b.st.bo).toMatchObject({ num: '0005041900', pid: 10, eid: 7, uid: 3, prod: 200, sku: 'B2', qtd: 2 });
    expect(r.body.blackOrder).toMatchObject({ id: 950, quantidade: 2 });
    expect(achar(/INSERT INTO dbo\.Notificacao/)[0].p.texto).toMatch(/foram para a sua black order/);
  });

  it('motivo pronto + descrição viram um texto só; "Outro" usa só a descrição', async () => {
    let b = bancoNaoEncontrada(); responder = b.resp;
    await request(app()).post('/api/pedidos/0005041900/itens/5/retirar')
      .send({ quantidade: 1, motivo: 'Peça danificada', descricao: 'caixa amassada na prateleira', destino: 'remover' });
    expect(b.st.item.mot).toBe('Peça danificada — caixa amassada na prateleira');
    b = bancoNaoEncontrada(); responder = b.resp;
    await request(app()).post('/api/pedidos/0005041900/itens/5/retirar')
      .send({ quantidade: 1, motivo: 'Outro', descricao: 'cliente pediu para tirar', destino: 'remover' });
    expect(b.st.item.mot).toBe('cliente pediu para tirar');
    b = bancoNaoEncontrada(); responder = b.resp;
    const r = await request(app()).post('/api/pedidos/0005041900/itens/5/retirar')
      .send({ quantidade: 1, motivo: 'Outro', descricao: '', destino: 'remover' });
    expect(r.status).toBe(400);
  });

  it('retirou todas as peças: o pedido é cancelado e o cliente sabe', async () => {
    const b = bancoNaoEncontrada(); b.st.resto = 0; responder = b.resp;
    const r = await request(app()).post('/api/pedidos/0005041900/itens/5/retirar')
      .send({ quantidade: 3, motivo: 'Não foi encontrado', destino: 'remover' });
    expect(r.body.status).toBe('Cancelado');
    expect(achar(/UPDATE dbo\.Pedido SET Status = @st/)[0].p.st).toBe('Cancelado');
    expect(achar(/INSERT INTO dbo\.Notificacao/)[0].p.texto).toMatch(/o pedido foi cancelado/);
  });

  it('mais do que ainda não saiu: recusado sem gravar', async () => {
    const b = bancoNaoEncontrada();
    responder = b.resp;
    const r = await marcar({ quantidade: 4, motivo: 'Não foi encontrado', destino: 'remover' });
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/Só 3 un\./);
    expect(b.st.item).toBeNull();
    expect(transacoes).toEqual(['begin', 'rollback']);
  });

  it.each(['Aprovado', 'Parcial', 'Enviado'])('pedido %s: as peças já foram conferidas, não dá para retirar', async (st) => {
    const b = bancoNaoEncontrada({ Status: st });
    responder = b.resp;
    const r = await marcar({ quantidade: 1, motivo: 'Não foi encontrado', destino: 'remover' });
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/não podem mais ser retiradas/);
    expect(b.st.item).toBeNull();
    expect(transacoes).toEqual(['begin', 'rollback']);
  });

  it('pedido antigo (fatura cheia) não aceita: a fatura não seria corrigida', async () => {
    const b = bancoNaoEncontrada({ FaturaNaRemessa: 0 });
    responder = b.resp;
    expect((await marcar({ quantidade: 1, motivo: 'Não foi encontrado', destino: 'remover' })).status).toBe(409);
  });

  it('sem motivo, sem destino ou quantidade inválida: 400', async () => {
    responder = bancoNaoEncontrada().resp;
    expect((await marcar({ quantidade: 1, destino: 'remover' })).status).toBe(400);
    expect((await marcar({ quantidade: 1, motivo: 'X' })).status).toBe(400);
    expect((await marcar({ quantidade: 0, motivo: 'X', destino: 'remover' })).status).toBe(400);
  });

  it('cliente não marca', async () => {
    responder = bancoNaoEncontrada().resp;
    const cli = { id: 3, email: 'c@x.com', papel: 'cliente', empresaId: 7, gestor: true, perm: null };
    const r = await request(app(cli)).post('/api/pedidos/0005041900/itens/5/nao-encontrada')
      .send({ quantidade: 1, motivo: 'X', destino: 'remover' });
    expect(r.status).toBe(403);
  });
});

describe('cancelamento', () => {
  it('anula todas as faturas (tudo é cancelado no Tiny) e recalcula o estoque pela fila depois', async () => {
    responder = (t) => {
      if (/SELECT PedidoId, Status, EmpresaId, Total FROM dbo\.Pedido/.test(t)) return [{ PedidoId: 10, Status: 'Parcial', EmpresaId: 7, Total: 70 }];
      if (/SELECT DISTINCT Sku FROM dbo\.PedidoItem/.test(t)) return [{ Sku: 'A1' }, { Sku: 'B2' }];
      return [{ n: 0 }];
    };
    const r = await request(app()).put('/api/pedidos/0005041900/status').send({ status: 'Cancelado' });
    expect(r.status).toBe(200);
    expect(achar(/UPDATE f SET f\.Status = 'Anulada'/)[0].texto).not.toMatch(/FaturaNaRemessa/);
    await new Promise(r => setTimeout(r, 20));              // o recálculo vem depois do cancelamento no Tiny
    expect(recalculados).toEqual(['A1', 'B2']);
  });
});

describe('estoque alterado no Tiny (lido a cada 1 min)', () => {
  it('data no formato do Tiny, no horário de Brasília', () => {
    expect(tiny.dataTiny(new Date('2026-10-27T12:05:09Z'))).toBe('27/10/2026 09:05:09');
    expect(tiny.dataTiny(new Date('2026-10-27T03:00:00Z'))).toBe('27/10/2026 00:00:00');
  });

  it('lista as páginas até o fim, já com saldo − reservado; nada mudou (erro 20) = lista vazia', async () => {
    process.env.TINY_TOKEN = 'teste';
    const corpos = [];
    const respostas = [
      { retorno: { status: 'OK', numero_paginas: 2, produtos: [{ produto: { id: 1, saldo: 10, saldoReservado: 3 } }] } },
      { retorno: { status: 'OK', numero_paginas: 2, produtos: [{ produto: { id: 2, saldo: 4, saldoReservado: 0 } }] } },
      { retorno: { status: 'Erro', codigo_erro: 20, erros: [{ erro: 'A consulta não retornou registros' }] } }
    ];
    vi.stubGlobal('fetch', async (url, opt) => {
      corpos.push(String(url) + '?' + opt.body);
      return { ok: true, status: 200, json: async () => respostas.shift() };
    });
    try {
      const l = await tiny.listarEstoquesAlterados(new Date('2026-10-27T12:00:00Z'));
      expect(l).toEqual([{ tinyId: '1', saldo: 7 }, { tinyId: '2', saldo: 4 }]);
      expect(corpos[0]).toMatch(/lista\.atualizacoes\.estoque\.php\?.*dataAlteracao=27%2F10%2F2026\+09%3A00%3A00.*pagina=1/);
      expect(corpos[1]).toMatch(/pagina=2/);
      expect(await tiny.listarEstoquesAlterados(new Date())).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  }, 15000);

  it('aplica só nos produtos importados e ligados (o resto do Tiny é ignorado)', async () => {
    responder = (t, p) => {
      if (/SELECT TinyId FROM dbo\.Produto WHERE TinyAtivo = 1 AND TinyId IN/.test(t)) return [{ TinyId: '1' }];
      if (/SELECT ProdutoId, Sku, TinyAtivo FROM dbo\.Produto WHERE TinyId/.test(t)) return p.tid === '1' ? [{ ProdutoId: 4, Sku: 'A1', TinyAtivo: 1 }] : [];
      return [];
    };
    const r = await tiny.aplicarSaldosAlterados([{ tinyId: '1', saldo: 7 }, { tinyId: '999', saldo: 2 }]);
    expect(r.map(x => x.sku)).toEqual(['A1']);
    expect(achar(/UPDATE dbo\.Produto SET/)[0].p).toMatchObject({ pid: 4, est: 7 });
    expect(achar(/TinySyncLog/).some(c => c.p.sku === undefined && /ignorado/.test(JSON.stringify(c.p)))).toBe(false);
  });
});
