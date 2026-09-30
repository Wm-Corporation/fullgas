// Reserva de estoque (tiny.js → reservaPendente): o que foi vendido no Fullgas
// e ainda não chegou ao Tiny. Sem ela o cron regravava o estoque cheio e a
// mesma peça era vendida duas vezes (achado de 30/09/2026: a venda de 2
// arruelas "sumiu" no cron seguinte, 33 → 35).
import { describe, it, expect, beforeEach, vi } from 'vitest';

let produto, fase1, exportacoesAbertas, itensDoPedido;

vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => {
    if (/SELECT Sku FROM dbo\.Produto WHERE ProdutoId/.test(texto)) return produto ? [produto] : [];
    if (/Quantidade - pi\.QuantidadeExportada/.test(texto)) return [{ Reserva: fase1 }];
    if (/FROM dbo\.TinyPedidoExport\s+WHERE Status IN \('pendente', 'erro'\)/.test(texto)) return exportacoesAbertas.map(l => ({ ...l }));
    if (/SELECT Sku, Quantidade FROM dbo\.PedidoItem/.test(texto)) return itensDoPedido[p.pid] || [];
    return [];
  },
  sql: {}
}));
vi.mock('../src/miniaturas.js', () => ({ prepararMiniaturas: () => {} }));

const { reservaPendente, somarReservaExportacoes } = await import('../src/tiny.js');

beforeEach(() => {
  produto = { Sku: 'T4008016' };
  fase1 = 0;
  exportacoesAbertas = [];
  itensDoPedido = {};
});

describe('reservaPendente', () => {
  it('pedido Pendente (ainda não exportado) segura o estoque — o caso que falhava', async () => {
    fase1 = 2;
    expect(await reservaPendente(1)).toBe(2);
  });

  it('exportação ainda não confirmada pelo Tiny também segura, pelo ItensJson', async () => {
    exportacoesAbertas = [
      { ExportId: 9, PedidoId: 11, ItensJson: JSON.stringify([{ sku: 'T4008016', qtd: 1 }, { sku: 'OUTRO', qtd: 5 }]) }
    ];
    expect(await reservaPendente(1)).toBe(1);
  });

  it('soma as duas fases', async () => {
    fase1 = 3;
    exportacoesAbertas = [{ ExportId: 9, PedidoId: 11, ItensJson: JSON.stringify([{ sku: 'T4008016', qtd: 2 }]) }];
    expect(await reservaPendente(1)).toBe(5);
  });

  it('linha antiga sem ItensJson usa os itens do pedido', async () => {
    exportacoesAbertas = [{ ExportId: 3, PedidoId: 5, ItensJson: null }];
    itensDoPedido[5] = [{ Sku: 'T4008016', Quantidade: 4 }];
    expect(await reservaPendente(1)).toBe(4);
  });

  it('produto inexistente não reserva nada', async () => {
    produto = null;
    expect(await reservaPendente(1)).toBe(0);
  });
});

describe('somarReservaExportacoes', () => {
  it('ignora outros SKUs e ItensJson quebrado', () => {
    expect(somarReservaExportacoes('A', [
      { ItensJson: JSON.stringify([{ sku: 'A', qtd: 1 }, { sku: 'B', qtd: 9 }]) },
      { ItensJson: '{quebrado' },
      { ItensJson: JSON.stringify([{ sku: 'A', qtd: 2 }]) }
    ])).toBe(3);
  });
});
