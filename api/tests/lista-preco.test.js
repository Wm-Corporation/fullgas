// Listas de preço do Tiny por cliente (migration 048, 02/10/2026).
//  - % do Tiny: negativo = desconto (-20 → paga 80%).
//  - O espelho local acompanha o Tiny (novas, alteradas, sumidas).
//  - O checkout precifica pela lista da EMPRESA e grava lista/% no pedido.
//  - O pedido vai ao Tiny com id_lista_preco (só se a lista ainda existe).
//  - Aprovar um cadastro de cliente EXIGE escolher a lista (ou preço cheio).
//
// db.js é um dublê só: cada bloco troca o `responder`.
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
class FakeTransaction { async begin() {} async commit() {} async rollback() {} }
const tipo = () => ({});
vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => {
    chamadas.push({ texto, p });
    const r = responder(texto, p);
    return r && r.recordset ? r.recordset : (r || []);
  },
  getPool: async () => ({ request: () => new FakeRequest() }),
  sql: { Transaction: FakeTransaction, Request: FakeRequest, Int: tipo(), Bit: tipo(), VarChar: tipo, NVarChar: tipo, Decimal: tipo, DateTime2: tipo() }
}));

let listasDoTiny = [];
vi.mock('../src/tiny.js', async (orig) => ({
  ...(await orig()),
  listarListasPreco: async () => listasDoTiny
}));
vi.mock('../src/historico-pedido.js', () => ({
  registrarEventoPedido: async () => {}, historicoDoPedido: async () => [], resumoPecas: () => ''
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const lp = await import('../src/lista-preco.js');
const { default: rotasPedidos } = await import('../src/routes/pedidos.routes.js');
const { default: rotasUsuarios } = await import('../src/routes/usuarios.routes.js');
const { montarPayload } = await import('../src/tiny-pedidos.js');

beforeEach(() => { chamadas = []; responder = () => []; listasDoTiny = []; });

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1, gestor: true, perm: null };
const CLIENTE = { id: 3, email: 'carlos@motosul.com.br', papel: 'cliente', empresaId: 7, gestor: true, perm: null };
function app(rotas, user) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotas);
  return a;
}

describe('aplicarPercentual', () => {
  it.each([
    [199.9, -20, 159.92],
    [100, 0, 100],
    [100, 5.5, 105.5],
    [33.33, -10, 30],       // 29.997 → centavo mais próximo
    [10, -12.5, 8.75]
  ])('preço %s com lista %s vira %s', (base, pct, esperado) => {
    expect(lp.aplicarPercentual(base, pct)).toBe(esperado);
  });

  it('admin vê o preço base, mesmo com empresa em lista', async () => {
    responder = () => [{ ListaPrecoId: 9, Descricao: 'X', Percentual: -30, Ativa: 1 }];
    expect(await lp.percentualDoUsuario(ADMIN)).toBe(0);
    expect(await lp.percentualDoUsuario(CLIENTE)).toBe(-30);
  });

  it('cliente sem lista = preço cheio', async () => {
    expect(await lp.percentualDoUsuario(CLIENTE)).toBe(0);
  });
});

describe('sincronizarListasPreco', () => {
  it('cria as novas, atualiza as alteradas e desativa as que sumiram do Tiny', async () => {
    listasDoTiny = [
      { id: 1, descricao: 'Revenda A', percentual: -20 },   // igual: nada a fazer
      { id: 2, descricao: 'Revenda B', percentual: -15 },   // mudou o %
      { id: 4, descricao: 'Nova', percentual: -5 },         // nova
      { id: 5, descricao: 'Quebrada', percentual: -100 }    // fora da faixa: ignorada
    ];
    responder = (t) => /SELECT ListaPrecoId, Descricao, Percentual, Ativa FROM dbo\.ListaPreco/.test(t) ? [
      { ListaPrecoId: 1, Descricao: 'Revenda A', Percentual: -20, Ativa: true },
      { ListaPrecoId: 2, Descricao: 'Revenda B', Percentual: -10, Ativa: true },
      { ListaPrecoId: 3, Descricao: 'Antiga', Percentual: -30, Ativa: true }
    ] : [];
    const r = await lp.sincronizarListasPreco();
    expect(r).toEqual({ total: 3, novas: 1, alteradas: 1, desativadas: 1 });
    const escritas = chamadas.filter(c => /INSERT|UPDATE/.test(c.texto));
    expect(escritas.map(c => [c.texto.match(/INSERT|SET Ativa = 0|SET Descricao/)[0], c.p.id])).toEqual([
      ['SET Descricao', 2], ['INSERT', 4], ['SET Ativa = 0', 3]
    ]);
  });
});

describe('checkout pela lista da empresa', () => {
  const rotas = rotasPedidos;
  let pedidoIns, itensIns;
  beforeEach(() => {
    pedidoIns = null; itensIns = [];
  });
  function banco(lista) {
    return (t, p) => {
      if (/JOIN dbo\.ListaPreco l ON l\.ListaPrecoId = e\.ListaPrecoId/.test(t)) return lista ? [lista] : [];
      if (/UPDATE dbo\.Produto/.test(t)) return [{ ProdutoId: 100, Nome: 'PECA A', Preco: 199.9 }];
      if (/Seq_NumeroPedido/.test(t)) return [{ NumeroPedido: '0005041999', Agora: new Date('2026-10-02T12:00:00Z') }];
      if (/INSERT INTO dbo\.Pedido /.test(t)) { pedidoIns = p; return [{ PedidoId: 55 }]; }
      if (/INSERT INTO dbo\.PedidoItem/.test(t)) { itensIns.push(p); return []; }
      if (/INSERT INTO dbo\.Fatura/.test(t)) return [{ FaturaId: 1, NumeroFatura: '1' }];
      if (/SELECT RazaoSocial FROM dbo\.Empresa/.test(t)) return [{ RazaoSocial: 'MOTO SUL LTDA' }];
      return [];
    };
  }
  const comprar = () => request(app(rotas, CLIENTE)).post('/api/pedidos').send({ itens: [{ sku: 'A1', quantidade: 3 }] });

  it('lista -20%: item, total e pedido saem com o desconto e a lista fica gravada', async () => {
    responder = banco({ ListaPrecoId: 11, Descricao: 'Revenda A', Percentual: -20, Ativa: true });
    const r = await comprar();
    expect(r.status).toBe(201);
    expect(r.body.itens[0].preco).toBe(159.92);
    expect(r.body.total).toBe(479.76);
    expect(itensIns[0].preco).toBe(159.92);
    expect(pedidoIns).toMatchObject({ total: 479.76, lid: 11, lpct: -20 });
  });

  it('sem lista: preço cheio e pedido sem lista', async () => {
    responder = banco(null);
    const r = await comprar();
    expect(r.status).toBe(201);
    expect(r.body.itens[0].preco).toBe(199.9);
    expect(pedidoIns).toMatchObject({ lid: null, lpct: null });
  });
});

describe('pedido ao Tiny', () => {
  const exp = { PedidoId: 10, ExportId: 50, Escopo: 'normal', ItensJson: JSON.stringify([{ sku: 'A1', nome: 'A', preco: 159.92, qtd: 1 }]) };
  function banco(ListaPrecoId, ListaAtiva) {
    return (t) => /FROM dbo\.Pedido p/.test(t) ? [{
      PedidoId: 10, NumeroPedido: '0005041999', DataPedido: '2026-10-02T12:00:00Z', EmpresaId: 7, Tipo: 'venda',
      UsuarioEmail: 'carlos@motosul.com.br', RazaoSocial: 'MOTO SUL LTDA', Cnpj: '12345678000199',
      ListaPrecoId, ListaAtiva
    }] : [];
  }

  it('leva id_lista_preco e o valor unitário já com desconto', async () => {
    responder = banco(11, true);
    const p = await montarPayload(exp);
    expect(p.id_lista_preco).toBe(11);
    expect(p.itens[0].item.valor_unitario).toBe('159.92');
  });

  it('lista que sumiu do Tiny não vai (o Tiny recusaria o pedido)', async () => {
    responder = banco(11, false);
    expect((await montarPayload(exp)).id_lista_preco).toBeUndefined();
  });

  it('pedido sem lista não leva o campo', async () => {
    responder = banco(null, null);
    expect((await montarPayload(exp)).id_lista_preco).toBeUndefined();
  });
});

describe('aprovar cadastro exige a lista de preço', () => {
  const rotas = rotasUsuarios;
  let usuario, listas;
  beforeEach(() => {
    usuario = { Status: 'pendente', Papel: 'cliente', EmpresaId: 7 };
    listas = { 11: { ListaPrecoId: 11, Descricao: 'Revenda A', Percentual: -20, Ativa: true },
               12: { ListaPrecoId: 12, Descricao: 'Velha', Percentual: -5, Ativa: false } };
    responder = (t, p) => {
      if (/SELECT Status, Papel, EmpresaId FROM dbo\.Usuario/.test(t)) return [usuario];
      if (/FROM dbo\.ListaPreco WHERE ListaPrecoId = @id/.test(t)) return listas[p.id] ? [listas[p.id]] : [];
      if (/UPDATE dbo\.Usuario/.test(t)) return { recordset: [], rowsAffected: /UPDATE dbo\.Empresa/.test(t) ? [1, 1] : [1] };
      return [];
    };
  });
  const aprovar = (corpo) => request(app(rotas, ADMIN)).patch('/api/usuarios/3').send({ status: 'aprovado', ...corpo });
  const lote = () => chamadas.find(c => /UPDATE dbo\.Usuario/.test(c.texto));

  it('sem escolher: 400 e nada é gravado', async () => {
    const r = await aprovar({});
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/lista de preço/);
    expect(lote()).toBeUndefined();
  });

  it('com lista: grava a lista da empresa e o status no mesmo lote, em transação', async () => {
    const r = await aprovar({ listaPrecoId: 11 });
    expect(r.status).toBe(200);
    expect(lote().texto).toMatch(/BEGIN TRAN[\s\S]*UPDATE dbo\.Empresa SET ListaPrecoId = @lid[\s\S]*UPDATE dbo\.Usuario[\s\S]*COMMIT/);
    expect(lote().p).toMatchObject({ eid: 7, lid: 11, status: 'aprovado' });
  });

  it('preço cheio (null) também é uma escolha válida', async () => {
    const r = await aprovar({ listaPrecoId: null });
    expect(r.status).toBe(200);
    expect(lote().p).toMatchObject({ eid: 7, lid: null });
  });

  it('lista inexistente ou que sumiu do Tiny: 400', async () => {
    expect((await aprovar({ listaPrecoId: 99 })).status).toBe(400);
    const r = await aprovar({ listaPrecoId: 12 });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/não existe mais no Tiny/);
  });

  it('desbloquear quem já era aprovado não pede lista', async () => {
    usuario.Status = 'bloqueado';
    const r = await aprovar({});
    expect(r.status).toBe(200);
    expect(lote().texto).not.toMatch(/dbo\.Empresa/);
  });
});
