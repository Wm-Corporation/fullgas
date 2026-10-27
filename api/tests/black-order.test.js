// Black order: sem fila (o admin libera cada uma), reserva só do liberado no sync do Tiny, checkout dividido (estoque = pedido
// com fatura; resto = black order), compra pelo carrinho da black order, desistência e fatura.
// db.js é um dublê (cada teste troca o `responder`); tiny-pedidos e histórico também.
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
vi.mock('../src/tiny-pedidos.js', () => ({
  exportacaoLigada: () => true,
  atualizarEstoqueCesta: async (skus) => { recalculados.push(...skus); },
  inserirExportacao: async () => {},
  processarExportacoes: () => {},
  cancelarExportacoesDoPedido: async () => {}
}));
vi.mock('../src/historico-pedido.js', () => ({
  registrarEventoPedido: async () => {}, historicoDoPedido: async () => [], resumoPecas: () => ''
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const bo = await import('../src/black-order.js');
const tiny = await import('../src/tiny.js');
const { default: rotasPedidos } = await import('../src/routes/pedidos.routes.js');
const { default: rotasBO } = await import('../src/routes/blackorders.routes.js');
const { default: rotasFaturas } = await import('../src/routes/faturas.routes.js');

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1, gestor: true, perm: null };
const CLIENTE = { id: 3, email: 'carlos@motosul.com.br', papel: 'cliente', empresaId: 7, gestor: true, perm: null };
function app(rotas, user) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotas);
  return a;
}
const achar = (re) => chamadas.filter(c => re.test(c.texto));

beforeEach(() => { chamadas = []; transacoes = []; recalculados = []; responder = () => []; });

describe('statusDe', () => {
  it('fila, disponível, atendida e cancelada', () => {
    expect(bo.statusDe({ Quantidade: 5, QuantidadeReservada: 0, QuantidadeAtendida: 0, QuantidadeDescartada: 0 })).toBe('Fila');
    expect(bo.statusDe({ Quantidade: 5, QuantidadeReservada: 2, QuantidadeAtendida: 0, QuantidadeDescartada: 0 })).toBe('Disponivel');
    expect(bo.statusDe({ Quantidade: 5, QuantidadeReservada: 0, QuantidadeAtendida: 3, QuantidadeDescartada: 2 })).toBe('Atendida');
    expect(bo.statusDe({ Quantidade: 5, QuantidadeReservada: 0, QuantidadeAtendida: 0, QuantidadeDescartada: 5 })).toBe('Cancelada');
  });
});

// Produto 100: BO 1 (empresa 7, 5 un.) e BO 2 (empresa 9, 4 un.), nada liberado ainda.
function abertasProduto100() {
  return [
    { BlackOrderId: 1, ProdutoId: 100, EmpresaId: 7, NumeroPedido: '0005041900', Sku: 'A1', NomeProduto: 'PECA A', Quantidade: 5, QuantidadeReservada: 0, QuantidadeAtendida: 0, QuantidadeDescartada: 0, Status: 'Fila' },
    { BlackOrderId: 2, ProdutoId: 100, EmpresaId: 9, NumeroPedido: '0005041901', Sku: 'A1', NomeProduto: 'PECA A', Quantidade: 4, QuantidadeReservada: 0, QuantidadeAtendida: 0, QuantidadeDescartada: 0, Status: 'Fila' }
  ];
}

describe('admin libera a black order (sem fila)', () => {
  function banco(linhas, estoque) {
    return (t, p) => {
      if (/FROM dbo\.BlackOrder WHERE BlackOrderId IN/.test(t)) return linhas;
      if (/UPDATE dbo\.Produto SET Estoque = Estoque - @q/.test(t)) {
        if (estoque.v < p.q) return [];
        estoque.v -= p.q; return [{ Estoque: estoque.v }];
      }
      if (/UPDATE dbo\.BlackOrder/.test(t)) return [{ BlackOrderId: p.id }];
      return [];
    };
  }

  it('libera a segunda sem passar pela primeira: cada uma é atendida à parte', async () => {
    const estoque = { v: 4 };
    responder = banco(abertasProduto100(), estoque);
    const r = await request(app(rotasBO, ADMIN)).post('/api/blackorders/liberar').send({ itens: [{ id: 2 }] });
    expect(r.status).toBe(200);
    expect(r.body.liberadas).toEqual([{ id: 2, quantidade: 4 }]);
    expect(estoque.v).toBe(0);                               // saiu da loja: fica guardada para o cliente
    const upd = achar(/UPDATE dbo\.BlackOrder/)[0];
    expect(upd.p).toMatchObject({ id: 2, res: 4, st: 'Disponivel' });
    const notifs = achar(/INSERT INTO dbo\.Notificacao/);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].p).toMatchObject({ eid: 9, link: '#blackorder/carrinho', publico: 'cliente' });
    expect(notifs[0].p.texto).toMatch(/PECA A \(A1\): 4 un\./);
    expect(transacoes).toEqual(['begin', 'commit']);
  });

  it('sem estoque livre suficiente: recusa, não grava e não avisa', async () => {
    const estoque = { v: 3 };
    responder = banco(abertasProduto100(), estoque);
    const r = await request(app(rotasBO, ADMIN)).post('/api/blackorders/liberar').send({ itens: [{ id: 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/não tem 5 un\. livres/);
    expect(estoque.v).toBe(3);
    expect(achar(/UPDATE dbo\.BlackOrder/)).toHaveLength(0);
    expect(achar(/INSERT INTO dbo\.Notificacao/)).toHaveLength(0);
    expect(transacoes).toEqual(['begin', 'rollback']);
  });

  it('liberação parcial: o resto continua aguardando chegada', async () => {
    const estoque = { v: 10 };
    responder = banco(abertasProduto100(), estoque);
    const r = await request(app(rotasBO, ADMIN)).post('/api/blackorders/liberar').send({ itens: [{ id: 1, quantidade: 2 }] });
    expect(r.status).toBe(200);
    expect(achar(/UPDATE dbo\.BlackOrder/)[0].p).toMatchObject({ id: 1, res: 2, st: 'Disponivel' });
    expect(estoque.v).toBe(8);
  });

  it('cliente não libera', async () => {
    const r = await request(app(rotasBO, CLIENTE)).post('/api/blackorders/liberar').send({ itens: [{ id: 1 }] });
    expect(r.status).toBe(403);
  });
});

describe('sincronização do Tiny (aplicarAtualizacao)', () => {
  it('estoque = saldo − pedidos − o que foi liberado para black orders; nada é separado sozinho', async () => {
    responder = (t) => {
      if (/SELECT ProdutoId, Sku, TinyAtivo FROM dbo\.Produto WHERE TinyId/.test(t)) return [{ ProdutoId: 100, Sku: 'A1', TinyAtivo: 1 }];
      if (/SELECT Sku FROM dbo\.Produto WHERE ProdutoId/.test(t)) return [{ Sku: 'A1' }];
      if (/pi\.Quantidade - pi\.QuantidadeExportada/.test(t)) return [{ Reserva: 2 }];     // pedidos
      if (/AS Reserva\s+FROM dbo\.BlackOrder/.test(t)) return [{ Reserva: 5 }];         // liberado
      return [];
    };
    await tiny.aplicarAtualizacao('T1', { estoque: 10 }, 'cron');
    expect(achar(/UPDATE dbo\.Produto SET/)[0].p.est).toBe(3);
    expect(achar(/AS Reserva\s+FROM dbo\.BlackOrder/)[0].texto).toMatch(/Status = 'Disponivel'/);
    expect(achar(/UPDATE dbo\.BlackOrder/)).toHaveLength(0);
  });
});

describe('checkout: estoque vira pedido (fatura só na remessa); o que falta vira black order', () => {
  let estoque, pedidoIns, itensIns, boIns, fatura;
  beforeEach(() => { pedidoIns = null; itensIns = []; boIns = []; fatura = null; });
  function banco() {
    return (t, p) => {
      if (/JOIN dbo\.ListaPreco l ON l\.ListaPrecoId = e\.ListaPrecoId/.test(t)) return [];
      if (/UPDATE dbo\.Produto/.test(t)) {
        const antes = estoque[p.sku];
        estoque[p.sku] = Math.max(0, antes - Math.min(antes, p.qtd));
        return [{ ProdutoId: p.sku === 'A1' ? 100 : 200, Nome: 'PECA ' + p.sku, Preco: 10, EstoqueAntes: antes }];
      }
      if (/Seq_NumeroPedido/.test(t)) return [{ NumeroPedido: '0005041999', Agora: new Date('2026-10-26T12:00:00Z') }];
      if (/INSERT INTO dbo\.Pedido /.test(t)) { pedidoIns = p; return [{ PedidoId: 55 }]; }
      if (/INSERT INTO dbo\.PedidoItem/.test(t)) { itensIns.push(p); return []; }
      if (/INSERT INTO dbo\.Fatura/.test(t)) { fatura = p; return [{ FaturaId: 1, NumeroFatura: '1' }]; }
      if (/INSERT INTO dbo\.BlackOrder /.test(t)) { boIns.push(p); return [{ BlackOrderId: 900 + boIns.length }]; }
      if (/SELECT RazaoSocial FROM dbo\.Empresa/.test(t)) return [{ RazaoSocial: 'MOTO SUL LTDA' }];
      return [];
    };
  }
  const comprar = (itens) => request(app(rotasPedidos, CLIENTE)).post('/api/pedidos').send({ itens });

  it('pede 10 com 4 em estoque: pedido de 4 sem fatura ainda, black order de 6 com o mesmo número', async () => {
    estoque = { A1: 4 };
    responder = banco();
    const r = await comprar([{ sku: 'A1', quantidade: 10 }]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id: '0005041999', pedidoCriado: true, total: 40 });
    expect(r.body.itens).toEqual([{ artigo: 'A1', nome: 'PECA A1', preco: 10, qtd: 4 }]);
    expect(r.body.blackOrders).toEqual([{ id: 901, sku: 'A1', nome: 'PECA A1', quantidade: 6 }]);
    expect(itensIns.map(i => i.qtd)).toEqual([4]);
    expect(fatura).toBeNull();                             // a fatura sai na remessa exportada ao Tiny
    expect(pedidoIns).toMatchObject({ total: 40 });
    expect(achar(/INSERT INTO dbo\.Pedido /)[0].texto).toMatch(/FaturaNaRemessa\)[\s\S]*, 1\)/);
    expect(boIns[0]).toMatchObject({ num: '0005041999', pid: 55, eid: 7, uid: 3, prod: 100, qtd: 6 });
    expect(transacoes).toEqual(['begin', 'commit']);
  });

  it('nada em estoque: só black order, sem pedido e sem fatura', async () => {
    estoque = { A1: 0 };
    responder = banco();
    const r = await comprar([{ sku: 'A1', quantidade: 3 }]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ pedidoCriado: false, total: 0, status: null, itens: [] });
    expect(pedidoIns).toBeNull();
    expect(fatura).toBeNull();
    expect(boIns[0]).toMatchObject({ num: '0005041999', pid: null, qtd: 3 });
  });

  it('estoque de sobra: tudo no pedido e nenhuma black order', async () => {
    estoque = { A1: 50, B2: 1 };
    responder = banco();
    const r = await comprar([{ sku: 'A1', quantidade: 5 }, { sku: 'B2', quantidade: 1 }]);
    expect(r.body.blackOrders).toEqual([]);
    expect(itensIns.map(i => [i.sku, i.qtd])).toEqual([['A1', 5], ['B2', 1]]);
    expect(pedidoIns).toMatchObject({ total: 60 });
    expect(fatura).toBeNull();
  });

  it('a baixa leva só o que houver, numa instrução só (sem corrida entre ler e baixar)', async () => {
    estoque = { A1: 4 };
    responder = banco();
    await comprar([{ sku: 'A1', quantidade: 10 }]);
    const upd = achar(/UPDATE dbo\.Produto/)[0].texto;
    expect(upd).toMatch(/CASE WHEN Estoque >= @qtd THEN @qtd/);
    expect(upd).toMatch(/deleted\.Estoque AS EstoqueAntes/);
  });

  it('quantidade absurda ou quebrada é recusada', async () => {
    responder = banco();
    expect((await comprar([{ sku: 'A1', quantidade: 1.5 }])).status).toBe(400);
    expect((await comprar([{ sku: 'A1', quantidade: 100001 }])).status).toBe(400);
  });

  it('produto inexistente desfaz tudo', async () => {
    responder = (t) => (/UPDATE dbo\.Produto/.test(t) ? [] : []);
    const r = await comprar([{ sku: 'ZZ', quantidade: 1 }]);
    expect(r.status).toBe(400);
    expect(transacoes).toEqual(['begin', 'rollback']);
  });
});

// Linha de black order como o SELECT do carrinho devolve.
function linhaBO(extra = {}) {
  return {
    BlackOrderId: 901, EmpresaId: 7, ProdutoId: 100, Sku: 'A1', NomeProduto: 'PECA A1', NumeroPedido: '0005041999',
    Quantidade: 6, QuantidadeReservada: 4, QuantidadeAtendida: 0, QuantidadeDescartada: 0, Status: 'Disponivel', ...extra
  };
}

describe('carrinho da black order (POST /api/blackorders/comprar)', () => {
  let boUpd, pedidoIns, atendIns, fatura;
  beforeEach(() => { boUpd = []; pedidoIns = null; atendIns = []; fatura = null; });
  function banco(linhas) {
    return (t, p) => {
      if (/FROM dbo\.BlackOrder\s+WHERE EmpresaId = @eid AND BlackOrderId IN/.test(t)) return linhas.filter(l => p.eid === 7);
      if (/JOIN dbo\.ListaPreco l ON l\.ListaPrecoId = e\.ListaPrecoId/.test(t)) return [];
      if (/UPDATE dbo\.BlackOrder/.test(t)) { boUpd.push(p); return [{ BlackOrderId: p.id }]; }
      if (/SELECT Preco FROM dbo\.Produto/.test(t)) return [{ Preco: 12.5 }];
      if (/Seq_NumeroPedido/.test(t)) return [{ NumeroPedido: '0005042000', Agora: new Date() }];
      if (/INSERT INTO dbo\.Pedido /.test(t)) { pedidoIns = p; return [{ PedidoId: 77 }]; }
      if (/INSERT INTO dbo\.Fatura/.test(t)) { fatura = p; return [{ FaturaId: 2, NumeroFatura: '2' }]; }
      if (/INSERT INTO dbo\.BlackOrderAtendimento/.test(t)) { atendIns.push(p); return []; }
      return [];
    };
  }
  const comprar = (itens, user = CLIENTE) => request(app(rotasBO, user)).post('/api/blackorders/comprar').send({ itens });

  it('compra tudo o que chegou (4 de 4): pedido no preço de hoje (fatura na remessa); o que não chegou segue aberto', async () => {
    responder = banco([linhaBO()]);
    const r = await comprar([{ id: 901, quantidade: 4 }]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id: '0005042000', total: 50, liberadas: [] });
    // 6 pedidas: 4 compradas, 2 seguem aguardando chegada.
    expect(boUpd[0]).toMatchObject({ id: 901, atd: 4, desc: 0, st: 'Fila', res: 4 });
    expect(pedidoIns).toMatchObject({ total: 50 });
    expect(fatura).toBeNull();
    expect(atendIns[0]).toMatchObject({ bo: 901, pid: 77, q: 4 });
    expect(recalculados).toEqual(['A1']);                 // só a checagem do Tiny antes de vender
  });

  it('compra menos do que chegou (3 de 4): é a necessidade final, a linha se encerra', async () => {
    responder = banco([linhaBO()]);
    const r = await comprar([{ id: 901, quantidade: 3 }]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ total: 37.5 });
    // 1 que chegou volta para a loja; as 2 que não chegaram são encerradas junto.
    expect(r.body.liberadas).toEqual([{ sku: 'A1', nome: 'PECA A1', quantidade: 1, encerrada: 2 }]);
    expect(boUpd[0]).toMatchObject({ id: 901, atd: 3, desc: 3, st: 'Atendida' });
    expect(recalculados).toEqual(['A1', 'A1']);           // antes de vender e depois, com a peça de volta na loja
    expect(achar(/SET Estoque = Estoque \+ @q/)[0].p).toMatchObject({ q: 1 });
  });

  it('mais do que o reservado é recusado sem gravar nada', async () => {
    responder = banco([linhaBO()]);
    const r = await comprar([{ id: 901, quantidade: 5 }]);
    expect(r.status).toBe(409);
    expect(r.body.disponivel).toBe(4);
    expect(boUpd).toHaveLength(0);
    expect(pedidoIns).toBeNull();
  });

  it('black order ainda não liberada (nada chegou) não pode ser comprada', async () => {
    responder = banco([linhaBO({ Status: 'Fila', QuantidadeReservada: 0 })]);
    expect((await comprar([{ id: 901, quantidade: 1 }])).status).toBe(409);
  });

  it('zero em tudo = não quer nada agora: sem pedido, reserva liberada', async () => {
    responder = banco([linhaBO()]);
    const r = await comprar([{ id: 901, quantidade: 0 }]);
    expect(r.status).toBe(201);
    expect(r.body.id).toBeNull();
    expect(pedidoIns).toBeNull();
    expect(boUpd[0]).toMatchObject({ atd: 0, desc: 6, st: 'Cancelada' });
  });

  it('black order de outra empresa não aparece (404)', async () => {
    responder = banco([]);
    expect((await comprar([{ id: 901, quantidade: 1 }])).status).toBe(404);
  });

  it('mudou entre a leitura e a gravação: 409 e nada fica pela metade', async () => {
    const b = banco([linhaBO()]);
    responder = (t, p) => (/UPDATE dbo\.BlackOrder/.test(t) ? [] : b(t, p));
    const r = await comprar([{ id: 901, quantidade: 2 }]);
    expect(r.status).toBe(409);
    expect(transacoes).toEqual(['begin', 'rollback']);
  });

  it('admin não compra black order', async () => {
    expect((await comprar([{ id: 901, quantidade: 1 }], ADMIN)).status).toBe(403);
  });
});

describe('desistir / cancelar', () => {
  it('cliente desiste do que falta; o que estava guardado volta para a loja', async () => {
    let upd = null;
    responder = (t, p) => {
      if (/FROM dbo\.BlackOrder WHERE BlackOrderId = @id AND \(@eid IS NULL OR EmpresaId = @eid\)/.test(t))
        return p.eid === 7 ? [linhaBO({ QuantidadeAtendida: 1 })] : [];
      if (/UPDATE dbo\.BlackOrder/.test(t)) { upd = p; return [{ BlackOrderId: 901 }]; }
      return [];
    };
    const r = await request(app(rotasBO, CLIENTE)).post('/api/blackorders/901/desistir').send({});
    expect(r.status).toBe(200);
    expect(upd).toMatchObject({ desc: 5, st: 'Atendida', obs: null });
    expect(achar(/SET Estoque = Estoque \+ @q/)[0].p).toMatchObject({ q: 4 });   // as 4 guardadas voltam para a loja
    expect(recalculados).toEqual(['A1']);
    expect(achar(/INSERT INTO dbo\.Notificacao/)).toHaveLength(0);
  });

  it('admin cancela com motivo e o cliente é avisado', async () => {
    let upd = null;
    responder = (t, p) => {
      if (/FROM dbo\.BlackOrder WHERE BlackOrderId = @id/.test(t)) return [linhaBO({ QuantidadeReservada: 0, Status: 'Fila' })];
      if (/UPDATE dbo\.BlackOrder/.test(t)) { upd = p; return [{ BlackOrderId: 901 }]; }
      return [];
    };
    const r = await request(app(rotasBO, ADMIN)).post('/api/blackorders/901/desistir').send({ motivo: 'Peça descontinuada' });
    expect(r.status).toBe(200);
    expect(upd).toMatchObject({ desc: 6, st: 'Cancelada', obs: 'Cancelada pela Fullgas: Peça descontinuada' });
    const n = achar(/INSERT INTO dbo\.Notificacao/)[0];
    expect(n.p).toMatchObject({ eid: 7, origem: 'blackorder' });
    expect(n.p.texto).toMatch(/Motivo: Peça descontinuada/);
  });

  it('black order encerrada não pode ser cancelada de novo', async () => {
    responder = (t) => (/FROM dbo\.BlackOrder WHERE BlackOrderId/.test(t) ? [linhaBO({ Status: 'Atendida' })] : []);
    expect((await request(app(rotasBO, CLIENTE)).post('/api/blackorders/901/desistir').send({})).status).toBe(409);
  });
});

describe('admin atualiza o envio da Europa (PATCH /api/blackorders)', () => {
  it('atualiza em lote só as abertas e avisa cada empresa uma vez', async () => {
    responder = (t) => (/UPDATE dbo\.BlackOrder SET/.test(t)
      ? [{ BlackOrderId: 1, EmpresaId: 7, Sku: 'A1', NomeProduto: 'PECA A', NumeroPedido: '0005041900', SituacaoEnvio: 'Em trânsito' },
         { BlackOrderId: 2, EmpresaId: 7, Sku: 'B2', NomeProduto: 'PECA B', NumeroPedido: '0005041900', SituacaoEnvio: 'Em trânsito' }]
      : []);
    const r = await request(app(rotasBO, ADMIN)).patch('/api/blackorders')
      .send({ ids: [1, 2], situacao: 'Em trânsito', previsao: '20/11/26', avisar: true });   // previsão não existe mais: ignorada
    expect(r.status).toBe(200);
    const upd = achar(/UPDATE dbo\.BlackOrder SET/)[0];
    expect(upd.texto).toMatch(/Status IN \('Fila', 'Disponivel'\)/);
    expect(upd.p).toMatchObject({ SituacaoEnvio: 'Em trânsito' });
    expect(upd.texto).not.toMatch(/PrevisaoChegada/);
    const notifs = achar(/INSERT INTO dbo\.Notificacao/);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].p.texto).toMatch(/PECA B \(B2\).*Em trânsito$/);
  });

  it('situação fora da lista e cliente tentando: recusados', async () => {
    expect((await request(app(rotasBO, ADMIN)).patch('/api/blackorders').send({ ids: [1], situacao: 'Qualquer' })).status).toBe(400);
    expect((await request(app(rotasBO, CLIENTE)).patch('/api/blackorders').send({ ids: [1], situacao: 'Em trânsito' })).status).toBe(403);
  });
});

describe('fatura completa', () => {
  it('traz comprador, lista, contato da empresa e as peças em black order', async () => {
    responder = (t) => {
      if (/FROM dbo\.Fatura f/.test(t)) return [{ FaturaId: 1, NumeroFatura: '1', Tipo: 'Fatura', DataEmissao: new Date('2026-10-26T12:00:00Z'), Valor: 40, Moeda: 'BRL', Status: 'Emitida', EmpresaId: 7 }];
      if (/pi\.Sku, pi\.NomeProduto, pi\.PrecoUnitario/.test(t)) return [{ FaturaId: 1, NumeroPedido: '0005041999', Sku: 'A1', NomeProduto: 'PECA A1', PrecoUnitario: 10, Quantidade: 4, Subtotal: 40 }];
      if (/FROM dbo\.Empresa e/.test(t)) return [{ EmpresaId: 7, RazaoSocial: 'MOTO SUL LTDA', NomeFantasia: 'Moto Sul', Cnpj: '00.000.000/0001-00', Pais: 'Brasil', InscricaoEstadual: '123', Telefone: '(12) 3333-4444', Email: 'compras@motosul.com.br' }];
      if (/u\.Nome AS CompradorNome/.test(t)) return [{ FaturaId: 1, NumeroPedido: '0005041999', DataPedido: new Date('2026-10-26T12:00:00Z'), ListaPrecoPercentual: -10, ListaNome: 'Revenda', CompradorNome: 'CARLOS SUL', CompradorEmail: 'carlos@motosul.com.br' }];
      if (/JOIN dbo\.BlackOrder bo ON bo\.PedidoId = pf\.PedidoId/.test(t)) return [{ FaturaId: 1, Sku: 'A1', NomeProduto: 'PECA A1', Quantidade: 6 }];
      return [];
    };
    const r = await request(app(rotasFaturas, CLIENTE)).get('/api/faturas');
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({
      valor: 40, fantasia: 'Moto Sul', ie: '123', telefone: '(12) 3333-4444', email: 'compras@motosul.com.br',
      compra: { comprador: 'CARLOS SUL', lista: 'Revenda', listaPercentual: -10 },
      blackOrders: [{ sku: 'A1', nome: 'PECA A1', qtd: 6 }]
    });
    expect(r.body[0].itens).toEqual([{ sku: 'A1', nome: 'PECA A1', preco: 10, qtd: 4, subtotal: 40 }]);
  });
});
