// Histórico do pedido na visão do revendedor (sem o interno da Fullgas) e fatura de pedido cancelado.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let responder = () => [];
let consultas = [];
vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => { consultas.push(texto); return responder(texto, p); },
  getPool: async () => ({}),
  sql: {}
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { historicoDoPedido, paraCliente } = await import('../src/historico-pedido.js');
const { default: rotasFaturas } = await import('../src/routes/faturas.routes.js');

const ev = (o) => ({ id: 1, tipo: 'aviso', titulo: 't', detalhe: '', usuario: 'adm@fullgas.com.br',
  referencia: '', data: '2026-10-27T10:00:00Z', empresaDoAutor: 1, ...o });

beforeEach(() => { responder = () => []; consultas = []; });

describe('histórico do pedido na visão do cliente', () => {
  it('some o que é do Tiny: exportação, falhas e cancelado/excluído lá', () => {
    expect(paraCliente(ev({ tipo: 'tiny', titulo: 'Remessa criada e aprovada no Tiny' }), 7)).toBeNull();
    expect(paraCliente(ev({ titulo: 'Falha ao enviar ao Tiny — o sistema vai tentar de novo' }), 7)).toBeNull();
    expect(paraCliente(ev({ titulo: 'Cancelado no Tiny', detalhe: 'segue Aprovado no Fullgas' }), 7)).toBeNull();
    expect(paraCliente(ev({ titulo: 'Cancele o pedido manualmente no Tiny' }), 7)).toBeNull();
  });

  it('cancelamento: fica o fato, sem a conferência interna; quem fez vira "Fullgas"', () => {
    const r = paraCliente(ev({ tipo: 'cancelado', titulo: 'Pedido cancelado',
      detalhe: 'Cancelado também no Tiny (o estoque volta lá) e faturas anuladas. 2 peça(s) já tinham sido enviadas: confira se voltaram fisicamente.' }), 7);
    expect(r).toMatchObject({ titulo: 'Pedido cancelado', detalhe: '', usuario: 'Fullgas' });
    expect(r).not.toHaveProperty('empresaDoAutor');
  });

  it('o cliente vê o próprio nome; identidade assumida aparece como Fullgas', () => {
    expect(paraCliente(ev({ tipo: 'criado', titulo: 'Pedido criado', usuario: 'carlos@motosul.com.br', empresaDoAutor: 7 }), 7).usuario)
      .toBe('carlos@motosul.com.br');
    expect(paraCliente(ev({ tipo: 'criado', titulo: 'Pedido criado', empresaDoAutor: 7,
      usuario: 'carlos@motosul.com.br (Fullgas, identidade assumida)' }), 7).usuario).toBe('Fullgas');
    expect(paraCliente(ev({ tipo: 'envio', titulo: 'x', usuario: 'Sistema', empresaDoAutor: null }), 7).usuario).toBe('');
  });

  it('envio e aprovação seguem visíveis, sem a referência do Tiny', () => {
    const r = paraCliente(ev({ tipo: 'envio', titulo: 'Remessa confirmada — envio concluído', detalhe: '2× A1 · status do pedido: Enviado', referencia: '998877' }), 7);
    expect(r).toMatchObject({ detalhe: '2× A1 · status do pedido: Enviado', referencia: '' });
    expect(paraCliente(ev({ tipo: 'garantia', titulo: 'Reivindicação R1 aberta', referencia: 'R1' }), 7).referencia).toBe('R1');
  });

  it('historicoDoPedido: admin vê tudo; cliente, filtrado', async () => {
    responder = () => [
      { HistoricoId: 2, Tipo: 'tiny', Titulo: 'Remessa criada e aprovada no Tiny', Detalhe: 'O estoque do Tiny foi descontado.', UsuarioNome: 'Sistema', EmpresaDoAutor: null, DataEvento: new Date() },
      { HistoricoId: 1, Tipo: 'criado', Titulo: 'Pedido criado', Detalhe: '1× A1', UsuarioNome: 'carlos@motosul.com.br', EmpresaDoAutor: 7, DataEvento: new Date() }
    ];
    const adm = await historicoDoPedido(10);
    expect(adm.map(e => e.tipo)).toEqual(['tiny', 'criado']);
    expect(adm[0]).not.toHaveProperty('empresaDoAutor');
    const cli = await historicoDoPedido(10, { cliente: 7 });
    expect(cli.map(e => e.tipo)).toEqual(['criado']);
  });
});

describe('fatura de pedido cancelado', () => {
  it('GET /faturas calcula o status: pedido(s) todos cancelados = Anulada (não soma no total)', async () => {
    let sqlFaturas = '';
    responder = (t, p) => {
      if (/FROM dbo\.Fatura f\s+WHERE f\.Tipo = 'Fatura'/.test(t)) {
        sqlFaturas = t;
        expect(p).toMatchObject({ eid: 7 });
        return [{ FaturaId: 5, NumeroFatura: '1726017701', Tipo: 'Fatura', DataEmissao: new Date(), Valor: 80,
          Moeda: 'Real (R$)', Status: 'Anulada', EmpresaId: 7 }];
      }
      return [];
    };
    const a = express();
    a.use((req, _res, next) => { req.user = { id: 3, papel: 'cliente', empresaId: 7, gestor: true, perm: null }; next(); });
    a.use('/api', rotasFaturas);
    const r = await request(a).get('/api/faturas');
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ numero: '1726017701', status: 'Anulada' });
    expect(sqlFaturas).toMatch(/CASE WHEN f\.Status = 'Emitida'[\s\S]*p\.Status <> N'Cancelado'[\s\S]*THEN 'Anulada' ELSE f\.Status END AS Status/);
  });
});
