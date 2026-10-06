// Ficha do veículo (06/10/2026): cada chassi chega ao front com a foto do
// modelo, os dados da concessionária e o período da garantia — é o que o
// portal mostra em "Ações do veículo", no estoque e nas reivindicações.
//
// O db.js é um dublê: estes testes não tocam SQL Server.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let consultas = [];
let responder = () => [];

vi.mock('../src/db.js', () => ({
  query: async (sqlTexto, params = {}) => {
    consultas.push({ sql: sqlTexto, params });
    return responder(sqlTexto, params);
  }
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { default: rotas } = await import('../src/routes/veiculos.routes.js');
const { GARANTIA_DIAS, fimDaGarantia } = await import('../src/utils/garantia.js');

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1 };
const LOJA = { id: 12, email: 'loja@moto.com', papel: 'cliente', empresaId: 7, perm: ['estoque', 'acoes'] };

function app(user = ADMIN) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotas);
  return a;
}

// Linha como o SELECT_VEIC devolve: chassi vendido numa concessionária.
function linha(extra = {}) {
  return {
    VeiculoId: 50, Niv: 'VBKGAM231TM245234', Ano: 2026, Status: 'Vendido',
    EntradaEstoque: new Date('2026-09-01T12:00:00Z'),
    VendaData: new Date('2026-10-01T15:00:00Z'), VendaCliente: 'JOAO DA SILVA',
    ClienteCpf: '529.982.247-25', ClienteEmail: 'joao@x.com', ClienteTelefone: '(12) 99999-0000',
    ClienteEndereco: 'Rua A, 1', GarantiaAtivaEm: new Date('2026-10-01T15:00:00Z'),
    EmpresaId: 7, VendaEmpresaId: 7, NaFabrica: false,
    ModeloCodigo: 'mc250-2026', ModeloNome: 'MC 250', ModeloAno: 2026,
    ModeloEtiqueta: 'MC 250 <2026><F0301Z0>', ModeloImagem: '/uploads/finder/mc250.png',
    EmpresaNome: 'POWER MOTORCYCLES', EmpresaFantasia: 'Power', EmpresaTelefone: '(12) 3333-4444',
    EmpresaEmail: 'contato@power.com',
    EndLogradouro: 'Estrada de Mira', EndNumero: '270', EndComplemento: 'Armazem 1',
    EndBairro: 'Centro', EndCidade: 'Taubate', EndUf: 'SP', EndCep: '12000-000',
    ...extra
  };
}

beforeEach(() => { consultas = []; responder = () => []; });

describe('ficha do veículo — GET /api/veiculos/:niv', () => {
  it('traz a foto do modelo em URL absoluta e o nome do modelo', async () => {
    responder = () => [linha()];
    const r = await request(app()).get('/api/veiculos/VBKGAM231TM245234');
    expect(r.status).toBe(200);
    expect(r.body.foto).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/uploads\/finder\/mc250\.png$/);
    // Miniatura ainda não gerada: null, e o front usa a foto original.
    expect(r.body.miniatura).toBeNull();
    expect(r.body.modelo).toBe('MC 250 <2026><F0301Z0>');
    expect(consultas[0].sql).toMatch(/m\.ImagemUrl AS ModeloImagem/);
  });

  it('modelo sem etiqueta usa nome + ano; sem foto, foto null', async () => {
    responder = () => [linha({ ModeloEtiqueta: null, ModeloImagem: null })];
    const r = await request(app()).get('/api/veiculos/VBKGAM231TM245234');
    expect(r.body.modelo).toBe('MC 250 2026');
    expect(r.body.foto).toBeNull();
    expect(r.body.miniatura).toBeNull();
  });

  it('mostra a concessionária com o endereço principal montado', async () => {
    responder = () => [linha()];
    const r = await request(app()).get('/api/veiculos/VBKGAM231TM245234');
    expect(r.body.concessionaria).toEqual({
      nome: 'POWER MOTORCYCLES', fantasia: 'Power',
      telefone: '(12) 3333-4444', email: 'contato@power.com',
      endereco: 'Estrada de Mira, 270 - Armazem 1 — Centro',
      cidade: 'Taubate/SP', cep: '12000-000'
    });
    // O endereço vem do endereço principal da empresa (OUTER APPLY).
    expect(consultas[0].sql).toMatch(/OUTER APPLY[\s\S]*FROM dbo\.Endereco d[\s\S]*ORDER BY d\.Principal DESC/);
  });

  it('concessionária sem endereço cadastrado não quebra a ficha', async () => {
    responder = () => [linha({
      EndLogradouro: null, EndNumero: null, EndComplemento: null, EndBairro: null,
      EndCidade: null, EndUf: null, EndCep: null
    })];
    const r = await request(app()).get('/api/veiculos/VBKGAM231TM245234');
    expect(r.body.concessionaria).toMatchObject({ endereco: '', cidade: '', cep: '' });
  });

  it('na Fábrica não há concessionária', async () => {
    responder = () => [linha({ EmpresaId: null, NaFabrica: true, Status: 'Disponível', VendaData: null, GarantiaAtivaEm: null })];
    const r = await request(app()).get('/api/veiculos/VBKGAM231TM245234');
    expect(r.body.fabrica).toBe(true);
    expect(r.body.concessionaria).toBeNull();
  });

  it('período da garantia: início na venda e fim 90 dias depois', async () => {
    responder = () => [linha()];
    const r = await request(app()).get('/api/veiculos/VBKGAM231TM245234');
    expect(r.body.garantiaDias).toBe(90);
    expect(r.body.garantia).toBe('2026-10-01T15:00:00.000Z');
    expect(r.body.garantiaFim).toBe('2026-12-30T15:00:00.000Z');
  });

  it('sem venda, sem início nem fim de garantia', async () => {
    responder = () => [linha({ Status: 'Disponível', VendaData: null, GarantiaAtivaEm: null })];
    const r = await request(app()).get('/api/veiculos/VBKGAM231TM245234');
    expect(r.body).not.toHaveProperty('garantia');
    expect(r.body).not.toHaveProperty('garantiaFim');
    expect(r.body.garantiaDias).toBe(90);
  });

  it('o comprador continua escondido de quem não registrou a venda', async () => {
    // Vendida pela empresa 9 e depois transferida para a 7 (quem olha).
    responder = () => [linha({ VendaEmpresaId: 9 })];
    const r = await request(app(LOJA)).get('/api/veiculos/VBKGAM231TM245234');
    expect(r.status).toBe(200);
    expect(r.body.venda.outraConcessionaria).toBe(true);
    expect(r.body.venda.cpf).toBe('');
    // A concessionária de hoje é a de quem olha: ela vê o próprio endereço.
    expect(r.body.concessionaria.nome).toBe('POWER MOTORCYCLES');
  });
});

describe('GET /api/veiculos/modelos', () => {
  it('cada modelo traz a foto (absoluta) e a miniatura', async () => {
    responder = () => [
      { id: 'mc250-2026', nome: 'MC 250', ano: 2026, label: null, ImagemUrl: '/uploads/finder/mc250.png' },
      { id: 'fg125-2025', nome: 'FG 125', ano: 2025, label: 'FG 125 2025', ImagemUrl: null }
    ];
    const r = await request(app()).get('/api/veiculos/modelos');
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ id: 'mc250-2026', label: 'MC 250 2026', miniatura: null });
    expect(r.body[0].imagem).toMatch(/\/uploads\/finder\/mc250\.png$/);
    expect(r.body[1].imagem).toBeNull();
    // Só modelos ativos (é a lista da loja e do cadastro de chassi).
    expect(consultas[0].sql).toMatch(/WHERE Ativo = 1/);
  });
});

describe('utils/garantia', () => {
  it('fim = início + 90 dias; sem início, null', () => {
    expect(GARANTIA_DIAS).toBe(90);
    expect(fimDaGarantia('2026-01-01T00:00:00Z').toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(fimDaGarantia(null)).toBeNull();
    expect(fimDaGarantia('não é data')).toBeNull();
  });
});
