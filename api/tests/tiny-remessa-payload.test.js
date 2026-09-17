// O que cada remessa leva ao Tiny: número único e observação que liga a
// remessa ao pedido original (17/09/2026). Ver src/tiny-pedidos.js.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let ordemNoPedido, faltam;

vi.mock('../src/db.js', () => ({
  query: async (texto) => {
    if (/FROM dbo\.Pedido p/.test(texto)) return [{
      PedidoId: 10, NumeroPedido: '0005041900', DataPedido: '2026-09-17T12:00:00Z',
      EmpresaId: 7, Tipo: 'venda', UsuarioEmail: 'carlos@motosul.com.br',
      RazaoSocial: 'MOTO SUL LTDA', NomeFantasia: 'MOTO SUL', Cnpj: '12345678000199',
      InscricaoEstadual: '123', EmpresaEmail: 'compras@motosul.com.br', Telefone: '4899999'
    }];
    if (/FROM dbo\.Endereco/.test(texto)) return [{ Logradouro: 'Rua A', Numero: '10', Bairro: 'Centro', Cidade: 'Jaraguá', Uf: 'SC', Cep: '89250000' }];
    if (/Escopo IN \('normal', 'remessa'\)/.test(texto)) return [{ n: ordemNoPedido }];
    if (/SUM\(Quantidade - QuantidadeEnviada\)/.test(texto)) return [{ n: faltam }];
    if (/FROM dbo\.PedidoItem/.test(texto)) return [{ Sku: 'A1', NomeProduto: 'PECA A', PrecoUnitario: 10, Quantidade: 3 }];
    return [];
  },
  sql: {}
}));
vi.mock('../src/tiny.js', () => ({
  incluirPedido: async () => {}, alterarSituacaoPedido: async () => {}, obterSaldoAtual: async () => 0,
  reservaPendente: async () => 0, obterSituacaoPedido: async () => null
}));
vi.mock('../src/tiny-contatos.js', () => ({ atualizarContatoTiny: async () => {}, clientesLigado: () => false }));

const { montarPayload } = await import('../src/tiny-pedidos.js');
const remessa = (itens, exportId = 50) => ({
  PedidoId: 10, ExportId: exportId, Escopo: 'remessa',
  ItensJson: JSON.stringify(itens), CriadoEm: '2026-09-17T12:00:00Z'
});

beforeEach(() => { ordemNoPedido = 1; faltam = 0; });

describe('montarPayload — remessa', () => {
  it('1ª remessa que fecha o pedido: número limpo e observação de envio concluído', async () => {
    const p = await montarPayload(remessa([{ sku: 'A1', nome: 'PECA A', preco: 10, qtd: 3 }]));
    expect(p.numero_pedido_ecommerce).toBe('0005041900');
    expect(p.obs).toMatch(/Remessa 1 do pedido Fullgas 0005041900/);
    expect(p.obs).toMatch(/envio conclu/i);
    expect(p.itens).toHaveLength(1);
    expect(p.itens[0].item).toMatchObject({ codigo: 'A1', quantidade: '3', valor_unitario: '10.00' });
  });

  it('1ª remessa parcial: avisa quantas peças ainda faltam', async () => {
    faltam = 2;
    const p = await montarPayload(remessa([{ sku: 'A1', nome: 'PECA A', preco: 10, qtd: 1 }]));
    expect(p.numero_pedido_ecommerce).toBe('0005041900');
    expect(p.obs).toMatch(/faltam 2 peça\(s\)/);
  });

  it('2ª remessa: número ganha -R2 e a observação cita o pedido original', async () => {
    ordemNoPedido = 2;
    const p = await montarPayload(remessa([{ sku: 'A1', nome: 'PECA A', preco: 10, qtd: 2 }]));
    expect(p.numero_pedido_ecommerce).toBe('0005041900-R2');
    expect(p.obs).toMatch(/Remessa 2 do pedido Fullgas 0005041900/);
    expect(p.obs).toMatch(/somente as peças enviadas nesta remessa/);
  });

  it('pré-venda continua com o sufixo -PV e texto próprio', async () => {
    const p = await montarPayload({
      PedidoId: 10, ExportId: 77, Escopo: 'backorder',
      ItensJson: JSON.stringify([{ sku: 'B2', nome: 'PECA B', preco: 20, qtd: 1 }]), CriadoEm: '2026-09-17T12:00:00Z'
    });
    expect(p.numero_pedido_ecommerce).toBe('0005041900-PV77');
    expect(p.obs).toMatch(/Pré-venda liberada do pedido Fullgas 0005041900/);
  });

  it('exportação antiga (escopo normal) segue com o número e o texto de antes', async () => {
    const p = await montarPayload({ PedidoId: 10, ExportId: 5, Escopo: 'normal', ItensJson: null, CriadoEm: '2026-09-10T12:00:00Z' });
    expect(p.numero_pedido_ecommerce).toBe('0005041900');
    expect(p.obs).toMatch(/^Pedido Fullgas 0005041900/);
  });
});
