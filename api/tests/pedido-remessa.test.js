// Remessas: o pedido vai ao Tiny NO ENVIO, não mais na aprovação (17/09/2026).
//
// O db.js é um dublê — inclusive a transação, porque estas rotas gravam dentro
// de uma. O tiny-pedidos.js também, para espiar o que seria exportado.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- "banco" em memória -----------------------------------------------
let pedido, itens, exportacoes, transacoes;

function reset() {
  pedido = { PedidoId: 10, NumeroPedido: '0005041900', Status: 'Em separação', EmpresaId: 7, Total: 300 };
  itens = [
    { PedidoItemId: 1, ProdutoId: 100, Sku: 'A1', NomeProduto: 'PECA A', PrecoUnitario: 10, Quantidade: 3, QuantidadeEnviada: 0, QuantidadeExportada: 0, EmBackorder: 0 },
    { PedidoItemId: 2, ProdutoId: 200, Sku: 'B2', NomeProduto: 'PECA B', PrecoUnitario: 20, Quantidade: 2, QuantidadeEnviada: 0, QuantidadeExportada: 0, EmBackorder: 0 }
  ];
  exportacoes = [];
  transacoes = [];
}

function responder(texto, p) {
  const um = (linhas) => ({ recordset: linhas, rowsAffected: [linhas.length] });
  if (/SELECT PedidoId, Status FROM dbo\.Pedido/.test(texto) || /SELECT PedidoId, Status, EmpresaId/.test(texto))
    return um(pedido.NumeroPedido === p.num ? [pedido] : []);
  if (/SELECT PedidoId, Status, EmpresaId, Total FROM dbo\.Pedido|SELECT PedidoId, Status, EmpresaId/.test(texto))
    return um([pedido]);
  if (/QuantidadeEnviada - QuantidadeExportada AS Qtd/.test(texto))
    return um(itens.filter(i => !i.EmBackorder && i.QuantidadeEnviada > i.QuantidadeExportada)
      .map(i => ({ ...i, Qtd: i.QuantidadeEnviada - i.QuantidadeExportada })));
  if (/UPDATE dbo\.PedidoItem SET QuantidadeExportada = QuantidadeEnviada\s+WHERE PedidoId/.test(texto)) {
    const alvo = itens.filter(i => !i.EmBackorder && i.QuantidadeEnviada > i.QuantidadeExportada);
    alvo.forEach(i => { i.QuantidadeExportada = i.QuantidadeEnviada; });
    return um(alvo);
  }
  if (/SUM\(CASE WHEN EmBackorder = 0 THEN 1 ELSE 0 END\) AS totNormais/.test(texto))
    return um([{
      totNormais: itens.filter(i => !i.EmBackorder).length,
      pendNormais: itens.filter(i => !i.EmBackorder && i.Quantidade > i.QuantidadeEnviada).length,
      comEnvio: itens.filter(i => i.QuantidadeEnviada > 0).length,
      pendTotal: itens.filter(i => i.Quantidade > i.QuantidadeEnviada).length
    }]);
  if (/UPDATE dbo\.Pedido SET Status = @st/.test(texto)) { pedido.Status = p.st; return um([]); }
  if (/SELECT pi\.PedidoId, pi\.PedidoItemId/.test(texto)) {
    const it = itens.find(i => i.PedidoItemId === p.iid);
    return um(it ? [{ ...it, Status: pedido.Status }] : []);
  }
  if (/UPDATE dbo\.PedidoItem SET QuantidadeEnviada = @q/.test(texto)) {
    itens.find(i => i.PedidoItemId === p.iid).QuantidadeEnviada = p.q;
    return um([]);
  }
  return um([]);
}

class FakeRequest {
  constructor() { this.p = {}; }
  input(nome, _tipo, valor) { this.p[nome] = valor; return this; }
  async query(texto) { return responder(texto, this.p); }
}
class FakeTransaction {
  async begin() { transacoes.push('begin'); }
  async commit() { transacoes.push('commit'); }
  async rollback() { transacoes.push('rollback'); }
}
const tipo = () => ({});
vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => responder(texto, p).recordset,
  getPool: async () => ({}),
  sql: { Transaction: FakeTransaction, Request: FakeRequest, Int: tipo(), Bit: tipo(), VarChar: tipo, NVarChar: tipo }
}));
vi.mock('../src/tiny-pedidos.js', () => ({
  exportacaoLigada: () => true,
  atualizarEstoqueCesta: async () => {},
  inserirExportacao: async (_tx, pedidoId, escopo, itensJson) => { exportacoes.push({ pedidoId, escopo, itens: itensJson }); },
  processarExportacoes: () => {},
  cancelarExportacoesDoPedido: async () => {}
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { default: rotas } = await import('../src/routes/pedidos.routes.js');

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1, gestor: true, perm: null };
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = ADMIN; next(); });
  a.use('/api', rotas);
  return a;
}
const NUM = '0005041900';
const enviar = (itemId, qtd) => request(app()).put(`/api/pedidos/${NUM}/itens/${itemId}/enviado`).send({ qtd });
const confirmar = () => request(app()).post(`/api/pedidos/${NUM}/remessa`).send({});

beforeEach(reset);

describe('confirmar remessa', () => {
  it('exporta só o que foi marcado e deixa o pedido Parcial', async () => {
    await enviar(1, 1);                       // 1 de 3 peças do item A1
    expect(exportacoes).toHaveLength(0);      // marcar não exporta

    const r = await confirmar();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: 'Parcial', parcial: true });
    expect(exportacoes).toEqual([{ pedidoId: 10, escopo: 'remessa', itens: [{ sku: 'A1', nome: 'PECA A', preco: 10, qtd: 1 }] }]);
    expect(pedido.Status).toBe('Parcial');
  });

  it('a segunda remessa leva só o restante e fecha o pedido como Enviado', async () => {
    await enviar(1, 1);
    await confirmar();
    exportacoes.length = 0;

    await enviar(1, 3);   // completa o A1
    await enviar(2, 2);   // e manda o B2 inteiro
    const r = await confirmar();
    expect(r.body.status).toBe('Enviado');
    expect(exportacoes[0].itens).toEqual([
      { sku: 'A1', nome: 'PECA A', preco: 10, qtd: 2 },   // só o que faltava
      { sku: 'B2', nome: 'PECA B', preco: 20, qtd: 2 }
    ]);
  });

  it('recusa confirmar sem nada novo, sem exportar nem mudar o status', async () => {
    const r = await confirmar();
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/Nada novo para enviar/);
    expect(exportacoes).toHaveLength(0);
    expect(pedido.Status).toBe('Em separação');
    expect(transacoes).toContain('rollback');
  });

  it('recusa remessa em pedido já entregue', async () => {
    pedido.Status = 'Entregue';
    await enviar(1, 1).catch(() => {});
    const r = await confirmar();
    expect(r.status).toBe(409);
    expect(exportacoes).toHaveLength(0);
  });
});

describe('aprovação', () => {
  it('tirar o pedido de Pendente NÃO exporta mais nada', async () => {
    pedido.Status = 'Pendente';
    const r = await request(app()).put(`/api/pedidos/${NUM}/status`).send({ status: 'Em separação' });
    expect(r.status).toBe(200);
    expect(exportacoes).toHaveLength(0);
  });
});
