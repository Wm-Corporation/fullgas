// Cancelamento entre Fullgas e Tiny (30/09/2026):
//  - cancelar no Fullgas com peça já enviada NÃO cancela sozinho no Tiny
//    (devolveria ao estoque de lá peças que já foram embora) — deixa aviso;
//  - pedido cancelado ou EXCLUÍDO direto no Tiny vira aviso na exportação,
//    em vez de seguir "Enviado" com a fatura em aberto sem ninguém saber.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let exportacoes, chamadasTiny, situacao, updates;

vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => {
    if (/SELECT ExportId, TinyPedidoId FROM dbo\.TinyPedidoExport/.test(texto))
      return exportacoes.filter(e => e.Status !== 'cancelado');
    if (/UPDATE dbo\.TinyPedidoExport SET Status = 'cancelado', UltimoErro = @msg/.test(texto)) {
      const e = exportacoes.find(x => x.ExportId === p.id); e.Status = 'cancelado'; e.UltimoErro = p.msg; return [];
    }
    if (/SELECT e\.ExportId, e\.TinyPedidoId, p\.PedidoId/.test(texto))
      return exportacoes.filter(e => e.Status === 'enviado').map(e => ({ ...e, NumeroPedido: '0005041888', Status: 'Enviado', TemPendente: 0 }));
    if (/SET UltimoErro = @msg\s+OUTPUT/.test(texto)) {
      const e = exportacoes.find(x => x.ExportId === p.id);
      if (e.UltimoErro) return [];
      e.UltimoErro = p.msg; return [{ ExportId: e.ExportId }];
    }
    if (/UPDATE dbo\.Pedido SET Status = @st/.test(texto)) { updates.push(p.st); return []; }
    return [];
  },
  sql: {}
}));
vi.mock('../src/tiny.js', () => ({
  incluirPedido: async () => {}, obterSaldoAtual: async () => 0, reservaPendente: async () => 0,
  alterarSituacaoPedido: async (id, sit) => { chamadasTiny.push({ id, sit }); },
  obterSituacaoPedido: async () => {
    if (situacao instanceof Error) throw situacao;
    return situacao;
  }
}));
vi.mock('../src/tiny-contatos.js', () => ({ atualizarContatoTiny: async () => {}, clientesLigado: () => false }));

process.env.TINY_TOKEN = 'x';
process.env.TINY_EXPORTAR_PEDIDOS = '1';
const { cancelarExportacoesDoPedido, sincronizarSituacaoPedidos } = await import('../src/tiny-pedidos.js');

beforeEach(() => {
  exportacoes = [{ ExportId: 9, TinyPedidoId: '761800492', Status: 'enviado', UltimoErro: null }];
  chamadasTiny = [];
  situacao = 'aprovado';
  updates = [];
});

describe('cancelar no Fullgas', () => {
  it('nada enviado: cancela no Tiny', async () => {
    await cancelarExportacoesDoPedido(11, { pecasEnviadas: 0 });
    expect(chamadasTiny).toEqual([{ id: '761800492', sit: 'cancelado' }]);
    expect(exportacoes[0]).toMatchObject({ Status: 'cancelado', UltimoErro: null });
  });

  it('com peça enviada: NÃO mexe no Tiny e deixa o aviso de ajuste manual', async () => {
    await cancelarExportacoesDoPedido(11, { pecasEnviadas: 1 });
    expect(chamadasTiny).toHaveLength(0);
    expect(exportacoes[0].Status).toBe('cancelado');
    expect(exportacoes[0].UltimoErro).toMatch(/1 peça\(s\) já enviada\(s\).*ajuste o pedido 761800492/);
  });
});

describe('Tiny → Fullgas', () => {
  it('pedido cancelado no Tiny vira aviso (e não muda o status aqui)', async () => {
    situacao = 'cancelado';
    await sincronizarSituacaoPedidos();
    expect(exportacoes[0].UltimoErro).toMatch(/^Cancelado no Tiny — o pedido 0005041888 segue 'Enviado'/);
    expect(updates).toHaveLength(0);
  });

  it('pedido excluído do Tiny ("não localizado") também vira aviso', async () => {
    situacao = new Error('Tiny: Pedido não localizado');
    await sincronizarSituacaoPedidos();
    expect(exportacoes[0].UltimoErro).toMatch(/^Excluído do Tiny/);
  });

  it('o aviso é gravado uma vez só', async () => {
    situacao = 'cancelado';
    await sincronizarSituacaoPedidos();
    const primeiro = exportacoes[0].UltimoErro;
    situacao = new Error('Tiny: Pedido não localizado');
    await sincronizarSituacaoPedidos();
    expect(exportacoes[0].UltimoErro).toBe(primeiro);
  });

  it('entregue no Tiny continua refletindo como Entregue', async () => {
    situacao = 'entregue';
    await sincronizarSituacaoPedidos();
    expect(updates).toEqual(['Entregue']);
  });
});
