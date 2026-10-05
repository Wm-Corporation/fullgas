// Ciclo do pedido desde 05/10/2026 (volta das remessas de 17/09): aprovar NÃO
// vai ao Tiny. O admin confere a prateleira, marca o que encontrou e clica em
// "Confirmar envio" (POST /remessa): só essas peças viram um pedido no Tiny.
// O que faltou sai numa remessa seguinte. Entregue só depois de Enviado; nada
// volta a Pendente depois de ir ao Tiny; cancelar devolve só o que não saiu.
//
// O db.js é um dublê — inclusive a transação, porque estas rotas gravam dentro
// de uma. O tiny-pedidos.js também, para espiar o que seria exportado.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- "banco" em memória -----------------------------------------------
let pedido, itens, exportacoes, transacoes, devolvido, cancelados, fatura;

function reset() {
  pedido = { PedidoId: 10, NumeroPedido: '0005041900', Status: 'Pendente', EmpresaId: 7, Total: 70 };
  itens = [
    { PedidoItemId: 1, ProdutoId: 100, Sku: 'A1', NomeProduto: 'PECA A', PrecoUnitario: 10, Quantidade: 3, QuantidadeEnviada: 0, QuantidadeExportada: 0, EmBackorder: 0 },
    { PedidoItemId: 2, ProdutoId: 200, Sku: 'B2', NomeProduto: 'PECA B', PrecoUnitario: 20, Quantidade: 2, QuantidadeEnviada: 0, QuantidadeExportada: 0, EmBackorder: 0 }
  ];
  exportacoes = [];
  transacoes = [];
  devolvido = {};      // ProdutoId -> quantidade que voltou ao estoque
  cancelados = [];     // chamadas a cancelarExportacoesDoPedido
  fatura = 'Emitida';
}

// Pedido aprovado entre 30/09 e 05/10/2026: já foi INTEIRO ao Tiny.
function pedidoQueFoiInteiro() {
  pedido.Status = 'Aprovado';
  itens.forEach(i => { i.QuantidadeExportada = i.Quantidade; });
  exportacoes.push({ pedidoId: 10, escopo: 'normal', itens: null });
}

const confirmada = i => (i.EmBackorder || i.QuantidadeEnviada < i.QuantidadeExportada)
  ? i.QuantidadeEnviada : i.QuantidadeExportada;

function responder(texto, p) {
  const um = (linhas) => ({ recordset: linhas, rowsAffected: [linhas.length] });
  if (/SELECT PedidoId, Status, EmpresaId, Total FROM dbo\.Pedido/.test(texto) ||
      /SELECT PedidoId, Status FROM dbo\.Pedido/.test(texto))
    return um(pedido.NumeroPedido === p.num ? [pedido] : []);
  // confirmarRemessa
  if (/QuantidadeEnviada - QuantidadeExportada AS Qtd/.test(texto))
    return um(itens.filter(i => !i.EmBackorder && i.QuantidadeEnviada > i.QuantidadeExportada)
      .map(i => ({ ...i, Qtd: i.QuantidadeEnviada - i.QuantidadeExportada })));
  if (/UPDATE dbo\.PedidoItem SET QuantidadeExportada = QuantidadeEnviada\s+WHERE PedidoId/.test(texto)) {
    const alvo = itens.filter(i => !i.EmBackorder && i.QuantidadeEnviada > i.QuantidadeExportada);
    alvo.forEach(i => { i.QuantidadeExportada = i.QuantidadeEnviada; });
    return um(alvo);
  }
  // enviadasSemConfirmar
  if (/SUM\(QuantidadeEnviada - QuantidadeExportada\), 0\) AS n/.test(texto))
    return um([{ n: itens.filter(i => !i.EmBackorder && i.QuantidadeEnviada > i.QuantidadeExportada)
      .reduce((s, i) => s + i.QuantidadeEnviada - i.QuantidadeExportada, 0) }]);
  // jaFoiAoTiny
  if (/QuantidadeExportada > 0\) \+/.test(texto))
    return um([{ n: itens.filter(i => i.QuantidadeExportada > 0).length + exportacoes.length }]);
  // cancelamento
  if (/ISNULL\(SUM\(QuantidadeEnviada\), 0\) AS n/.test(texto))
    return um([{ n: itens.reduce((s, i) => s + i.QuantidadeEnviada, 0) }]);
  if (/Escopo = 'normal' AND Status <> 'cancelado'/.test(texto))
    return um([{ n: exportacoes.filter(e => e.escopo === 'normal').length }]);
  if (/SET p\.Estoque = p\.Estoque \+ \(pi\.Quantidade - pi\.QuantidadeEnviada\)/.test(texto)) {
    const alvo = itens.filter(i => !i.EmBackorder && i.Quantidade > i.QuantidadeEnviada);
    alvo.forEach(i => { devolvido[i.ProdutoId] = (devolvido[i.ProdutoId] || 0) + i.Quantidade - i.QuantidadeEnviada; });
    return um(alvo);
  }
  if (/UPDATE f SET f\.Status = 'Anulada'/.test(texto)) { fatura = 'Anulada'; return um([]); }
  if (/SET Status = 'Cancelado'/.test(texto)) { pedido.Status = 'Cancelado'; return um([]); }
  if (/SET Status = N'Aprovado'/.test(texto)) { pedido.Status = 'Aprovado'; return um([]); }
  // statusPorEnvio (conta o que já saiu E está no Tiny)
  if (/AS Confirmada/.test(texto))
    return um([{
      totNormais: itens.filter(i => !i.EmBackorder).length,
      pendNormais: itens.filter(i => !i.EmBackorder && i.Quantidade > confirmada(i)).length,
      comEnvio: itens.filter(i => confirmada(i) > 0).length,
      pendTotal: itens.filter(i => i.Quantidade > confirmada(i)).length
    }]);
  // composição do envio em bloco
  if (/SUM\(CASE WHEN EmBackorder = 0 THEN 1 ELSE 0 END\) AS totNormais/.test(texto))
    return um([{
      totNormais: itens.filter(i => !i.EmBackorder).length,
      pendNormais: itens.filter(i => !i.EmBackorder && i.Quantidade > i.QuantidadeEnviada).length,
      pendTotal: itens.filter(i => i.Quantidade > i.QuantidadeEnviada).length
    }]);
  if (/UPDATE dbo\.Pedido SET Status = @st/.test(texto)) { pedido.Status = p.st; return um([]); }
  // envio por peça
  if (/SELECT pi\.PedidoId, pi\.PedidoItemId/.test(texto)) {
    const it = itens.find(i => i.PedidoItemId === p.iid);
    return um(it ? [{ ...it, Status: pedido.Status }] : []);
  }
  if (/UPDATE dbo\.PedidoItem SET QuantidadeEnviada = @q/.test(texto)) {
    itens.find(i => i.PedidoItemId === p.iid).QuantidadeEnviada = p.q;
    return um([]);
  }
  // envio em bloco (status 'Enviado')
  if (/SELECT pi\.PedidoItemId, pi\.ProdutoId, pi\.Quantidade/.test(texto))
    return um(itens.filter(i => i.Quantidade > i.QuantidadeEnviada && i.EmBackorder === (p.alvo ? 1 : 0)));
  if (/UPDATE dbo\.PedidoItem SET QuantidadeEnviada = Quantidade WHERE PedidoItemId/.test(texto)) {
    const it = itens.find(i => i.PedidoItemId === p.iid);
    it.QuantidadeEnviada = it.Quantidade;
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
  sql: { Transaction: FakeTransaction, Request: FakeRequest, Int: tipo(), Bit: tipo(), VarChar: tipo, NVarChar: tipo, Decimal: tipo, DateTime2: tipo() }
}));
vi.mock('../src/tiny-pedidos.js', () => ({
  exportacaoLigada: () => true,
  atualizarEstoqueCesta: async () => {},
  inserirExportacao: async (_tx, pedidoId, escopo, itensJson) => { exportacoes.push({ pedidoId, escopo, itens: itensJson }); },
  processarExportacoes: () => {},
  cancelarExportacoesDoPedido: async (pedidoId, opts) => { cancelados.push({ pedidoId, ...opts }); }
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
const mudar = (status) => request(app()).put(`/api/pedidos/${NUM}/status`).send({ status });
const enviar = (itemId, qtd) => request(app()).put(`/api/pedidos/${NUM}/itens/${itemId}/enviado`).send({ qtd });
const confirmar = () => request(app()).post(`/api/pedidos/${NUM}/remessa`).send({});

beforeEach(reset);

describe('aprovar NÃO vai ao Tiny', () => {
  it('aprovar só muda o status', async () => {
    const r = await mudar('Aprovado');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: 'Aprovado' });
    expect(exportacoes).toHaveLength(0);
    expect(itens.map(i => i.QuantidadeExportada)).toEqual([0, 0]);
  });

  it('aprovado ainda volta para Pendente enquanto nada foi ao Tiny', async () => {
    await mudar('Aprovado');
    const r = await mudar('Pendente');
    expect(r.status).toBe(200);
    expect(pedido.Status).toBe('Pendente');
  });

  it('não aprova duas vezes', async () => {
    await mudar('Aprovado');
    const r = await mudar('Aprovado');
    expect(r.status).toBe(409);
  });
});

describe('remessa ("Confirmar envio")', () => {
  it('pedido Pendente: marca só o encontrado, confirma, e o Tiny recebe só isso', async () => {
    await enviar(1, 1);                       // achou 1 de 3 peças A1; B2 não achou
    expect(exportacoes).toHaveLength(0);      // marcar não exporta
    expect(pedido.Status).toBe('Pendente');   // nem muda o status antes de confirmar

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
    expect(pedido.Status).toBe('Pendente');
    expect(transacoes).toContain('rollback');
  });

  it('recusa remessa em pedido já entregue', async () => {
    pedido.Status = 'Entregue';
    const r = await confirmar();
    expect(r.status).toBe(409);
    expect(exportacoes).toHaveLength(0);
  });

  it('depois de uma remessa o pedido não volta para Pendente', async () => {
    await enviar(1, 1);
    await confirmar();
    const r = await mudar('Pendente');
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/não volta para Pendente/);
  });

  it('"Enviado" no seletor marca o restante e já fecha a remessa dele', async () => {
    await enviar(1, 1);
    await confirmar();
    exportacoes.length = 0;

    const r = await mudar('Enviado');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'Enviado', remessa: 2 });
    expect(exportacoes).toEqual([{ pedidoId: 10, escopo: 'remessa', itens: [
      { sku: 'A1', nome: 'PECA A', preco: 10, qtd: 2 },
      { sku: 'B2', nome: 'PECA B', preco: 20, qtd: 2 }
    ] }]);
  });
});

describe('pedido que já foi inteiro ao Tiny (aprovado entre 30/09 e 05/10)', () => {
  it('o envio peça a peça move o status e não exporta de novo', async () => {
    pedidoQueFoiInteiro();
    let r = await enviar(1, 1);
    expect(r.body.status).toBe('Parcial');
    await enviar(1, 3);
    r = await enviar(2, 2);
    expect(r.body.status).toBe('Enviado');
    expect(exportacoes.filter(e => e.escopo === 'remessa')).toHaveLength(0);
  });

  it('desfazer o envio volta para Aprovado (e não fica "Parcial" com 0 enviadas)', async () => {
    pedidoQueFoiInteiro();
    await enviar(1, 1);
    const r = await enviar(1, 0);
    expect(r.body.status).toBe('Aprovado');
  });
});

describe('Entregue só depois de Enviado', () => {
  it('recusa Pendente → Entregue', async () => {
    const r = await mudar('Entregue');
    expect(r.status).toBe(409);
    expect(pedido.Status).toBe('Pendente');
  });

  it('recusa Aprovado → Entregue', async () => {
    await mudar('Aprovado');
    const r = await mudar('Entregue');
    expect(r.status).toBe(409);
  });

  it('aceita Enviado → Entregue', async () => {
    await mudar('Enviado');
    const r = await mudar('Entregue');
    expect(r.status).toBe(200);
    expect(pedido.Status).toBe('Entregue');
  });
});

describe('cancelar devolve só o que não saiu', () => {
  it('nada enviado: devolve tudo e manda cancelar no Tiny', async () => {
    await mudar('Aprovado');
    const r = await mudar('Cancelado');
    expect(r.status).toBe(200);
    expect(devolvido).toEqual({ 100: 3, 200: 2 });
    expect(fatura).toBe('Anulada');
    expect(cancelados).toEqual([{ pedidoId: 10, pecasEnviadas: 0 }]);
    expect(r.body.aviso).toBeNull();
  });

  it('Parcial por remessa: só o restante volta e não há ajuste manual (a remessa já está certa)', async () => {
    await enviar(1, 2);                     // 2 das 3 peças A1 saíram
    await confirmar();
    const r = await mudar('Cancelado');
    expect(r.status).toBe(200);
    expect(devolvido).toEqual({ 100: 1, 200: 2 });
    expect(cancelados).toEqual([{ pedidoId: 10, pecasEnviadas: 2 }]);
    expect(r.body.aviso).toBeNull();
  });

  it('pedido que foi inteiro ao Tiny com peça enviada: aviso de ajuste manual', async () => {
    pedidoQueFoiInteiro();
    await enviar(1, 2);
    const r = await mudar('Cancelado');
    expect(devolvido).toEqual({ 100: 1, 200: 2 });
    expect(r.body.aviso).toMatch(/2 peça\(s\) já tinham saído.*ajuste manual/);
  });

  it('peça marcada como enviada sem "Confirmar envio" bloqueia o cancelamento', async () => {
    await enviar(1, 2);
    const r = await mudar('Cancelado');
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/2 peça\(s\) marcadas como enviadas ainda não foram confirmadas/);
    expect(pedido.Status).toBe('Pendente');
    expect(devolvido).toEqual({});
    expect(cancelados).toHaveLength(0);
  });
});
