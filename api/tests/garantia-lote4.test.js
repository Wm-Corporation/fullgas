// Lote 4 (30/09/2026) — garantia ligada ao pedido.
//   • varejo: pedido cancelado não abre; só peça ENVIADA; teto = enviado −
//     já reclamado em outras reivindicações (fora as recusadas);
//   • aprovar exige no mínimo 3 fotos/vídeos (qualquer origem);
//   • tudo vai para o histórico do pedido (historico-pedido.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let pedido, itens, reclamado, fotos, eventos, dbFora;

function responder(texto, p) {
  const um = (linhas) => ({ recordset: linhas, rowsAffected: [linhas.length] });
  if (/SELECT PedidoId, Tipo, Status FROM dbo\.Pedido/.test(texto)) return um(pedido ? [pedido] : []);
  if (/SELECT Sku, NomeProduto, Quantidade, QuantidadeEnviada FROM dbo\.PedidoItem/.test(texto)) return um(itens);
  if (/FROM dbo\.ReivindicacaoPeca rp\s+JOIN dbo\.Reivindicacao r/.test(texto))
    return um(Object.entries(reclamado).map(([Sku, Qtd]) => ({ Sku, Qtd })));
  if (/INSERT INTO dbo\.Reivindicacao\b/.test(texto)) return um([{ ReivindicacaoId: 50 }]);
  return um([]);
}
class FakeRequest {
  constructor() { this.p = {}; }
  input(n, _t, v) { this.p[n] = v; return this; }
  async query(t) { return responder(t, this.p); }
}
class FakeTransaction { async begin() {} async commit() {} async rollback() {} }
const tipo = () => ({});
vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => {
    if (/INSERT INTO dbo\.PedidoHistorico/.test(texto)) {
      if (dbFora) throw new Error('banco fora do ar');
      eventos.push(p); return [];
    }
    if (/COUNT\(\*\) AS n FROM dbo\.ReivindicacaoAnexo/.test(texto)) return [{ n: fotos }];
    return responder(texto, p).recordset;
  },
  getPool: async () => ({}),
  sql: { Transaction: FakeTransaction, Request: FakeRequest, Int: tipo(), Bit: tipo(), VarChar: tipo, NVarChar: tipo, Char: tipo, Date: tipo(), Decimal: tipo, DateTime2: tipo() }
}));
vi.mock('../src/tiny-pedidos.js', () => ({
  exportacaoLigada: () => false, atualizarEstoqueCesta: async () => {}, inserirExportacao: async () => {},
  processarExportacoes: () => {}, cancelarExportacoesDoPedido: async () => {}
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { default: rotas, FOTOS_MINIMAS } = await import('../src/routes/reivindicacoes.routes.js');
const { registrarEventoPedido, resumoPecas } = await import('../src/historico-pedido.js');

const CLIENTE = { id: 3, email: 'carlos@motosul.com.br', papel: 'cliente', empresaId: 7, gestor: true, perm: null };
const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1, gestor: true, perm: null };
function app(user) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotas);
  return a;
}
const abrir = (qtd) => request(app(CLIENTE)).post('/api/reivindicacoes').send({
  origem: 'varejo', numeroPedido: '0005041900', descricao: 'arruela trincada',
  pecas: [{ sku: 'T4008016', quantidade: qtd }]
});

beforeEach(() => {
  pedido = { PedidoId: 10, Tipo: 'venda', Status: 'Enviado' };
  itens = [{ Sku: 'T4008016', NomeProduto: 'ARRUELA', Quantidade: 3, QuantidadeEnviada: 2 }];
  reclamado = {};
  fotos = 0;
  eventos = [];
  dbFora = false;
});

describe('garantia de varejo', () => {
  it('pedido cancelado não abre garantia', async () => {
    pedido.Status = 'Cancelado';
    const r = await abrir(1);
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/foi cancelado e não abre garantia/);
  });

  it('peça que ainda não saiu não entra (o caso do teste de 30/09: pedido Pendente)', async () => {
    pedido.Status = 'Pendente';
    itens[0].QuantidadeEnviada = 0;
    const r = await abrir(1);
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/ainda não foi enviada/);
  });

  it('o teto é o ENVIADO, não o comprado', async () => {
    const r = await abrir(3);                 // comprou 3, saíram 2
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/no máximo 2/);
  });

  it('desconta o que já está em outra reivindicação do pedido', async () => {
    reclamado = { T4008016: 1 };
    const r = await abrir(2);
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/1 já está\(ão\) em outra reivindicação.*no máximo 1/);
  });

  it('dentro do teto abre e registra no histórico do pedido', async () => {
    reclamado = { T4008016: 1 };
    const r = await abrir(1);
    expect(r.status).toBe(201);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ pid: 10, tipo: 'garantia' });
    expect(eventos[0].titulo).toMatch(/^Reivindicação \d{8} aberta$/);
    expect(eventos[0].detalhe).toMatch(/^1× T4008016/);
  });
});

describe('aprovação exige 3 fotos', () => {
  it('com menos de 3 fotos a aprovação é recusada', async () => {
    fotos = 2;
    const r = await request(app(ADMIN)).put('/api/reivindicacoes/12345678/status').send({ status: 'Aprovada' });
    expect(FOTOS_MINIMAS).toBe(3);
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/no mínimo 3 fotos.*\(tem 2\)/);
  });

  it('com 3 fotos passa da trava (segue para a aprovação)', async () => {
    fotos = 3;
    const r = await request(app(ADMIN)).put('/api/reivindicacoes/12345678/status').send({ status: 'Aprovada' });
    expect(r.body.erro || '').not.toMatch(/fotos/);
  });

  it('recusar não exige foto', async () => {
    fotos = 0;
    const r = await request(app(ADMIN)).put('/api/reivindicacoes/12345678/status').send({ status: 'Recusada' });
    expect(r.body.erro || '').not.toMatch(/fotos/);
  });
});

describe('histórico do pedido', () => {
  it('ação feita em identidade assumida sai marcada como da Fullgas', async () => {
    await registrarEventoPedido({ pedidoId: 10, tipo: 'envio', titulo: 'x', user: { id: 3, email: 'c@x.com', imp: 1 } });
    expect(eventos[0].unome).toBe('c@x.com (Fullgas, identidade assumida)');
  });

  it('falha ao gravar NÃO derruba a ação registrada', async () => {
    dbFora = true;
    await expect(registrarEventoPedido({ pedidoId: 10, tipo: 'envio', titulo: 'x' })).resolves.toBe(false);
  });

  it('evento incompleto é ignorado', async () => {
    expect(await registrarEventoPedido({ tipo: 'inventado', titulo: 'x', pedidoId: 1 })).toBe(false);
  });

  it('resumo das peças', () => {
    expect(resumoPecas([{ sku: 'A', qtd: 2 }, { sku: 'B', quantidade: 1 }])).toBe('2× A, 1× B');
  });
});
