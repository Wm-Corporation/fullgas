// Lote 2 da varredura de 30/09/2026 — segurança.
//   F1  garantia de moto só no chassi da própria concessionária
//   E6  cadastro público não entra em empresa que já tem usuário
//   E4  CNPJ travado para o cliente em "Minha conta"
//   E7  CNPJ com dígito verificador e formato único
//   G2  comprador de moto transferida não aparece para a nova concessionária
//
// O db.js é um dublê em memória: estes testes não tocam SQL Server.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- estado do dublê ---------------------------------------------------
let veiculo, produtoExiste, empresaExistente, cnpjAtual, veiculoLista;

function responder(texto) {
  const um = (linhas) => ({ recordset: linhas, rowsAffected: [linhas.length] });
  if (/FROM dbo\.Veiculo WHERE Niv = @niv/.test(texto)) return um(veiculo ? [veiculo] : []);
  if (/FROM dbo\.Produto WHERE Sku = @sku/.test(texto)) return um(produtoExiste ? [{ ProdutoId: 1, Nome: 'PECA' }] : []);
  if (/FROM dbo\.Empresa e\s+WHERE REPLACE/.test(texto)) return um(empresaExistente ? [empresaExistente] : []);
  return um([]);
}
class FakeRequest {
  input() { return this; }
  async query(texto) { return responder(texto); }
}
class FakeTransaction {
  async begin() {} async commit() {} async rollback() {}
}
const tipo = () => ({});
vi.mock('../src/db.js', () => ({
  query: async (texto) => {
    if (/SELECT 1 FROM dbo\.Usuario WHERE Email/.test(texto)) return [];
    if (/SELECT Cnpj FROM dbo\.Empresa WHERE EmpresaId/.test(texto)) return [{ Cnpj: cnpjAtual }];
    if (/FROM dbo\.Veiculo v/.test(texto)) return veiculoLista;
    return responder(texto).recordset;
  },
  getPool: async () => ({ request: () => new FakeRequest() }),
  sql: { Transaction: FakeTransaction, Request: FakeRequest, Int: tipo(), Bit: tipo(), VarChar: tipo, NVarChar: tipo, Char: tipo, Date: tipo(), VarBinary: tipo, Decimal: tipo, DateTime2: tipo() }
}));
vi.mock('../src/tiny-contatos.js', () => ({
  vincularContatoTiny: async () => null, atualizarContatoTiny: async () => null, clientesLigado: () => false
}));
vi.mock('../src/tiny-pedidos.js', () => ({
  exportacaoLigada: () => false, atualizarEstoqueCesta: async () => {}, inserirExportacao: async () => {},
  processarExportacoes: () => {}, cancelarExportacoesDoPedido: async () => {}
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
delete process.env.TURNSTILE_SITE_KEY;
delete process.env.TURNSTILE_SECRET_KEY;
const { cnpjValido, formatarCnpj, erroCnpj } = await import('../src/validacao.js');
const { default: rotasReiv } = await import('../src/routes/reivindicacoes.routes.js');
const { default: rotasAuth } = await import('../src/routes/auth.routes.js');
const { default: rotasConta } = await import('../src/routes/conta.routes.js');
const { default: rotasVeic } = await import('../src/routes/veiculos.routes.js');

const CLIENTE = { id: 3, email: 'carlos@motosul.com.br', papel: 'cliente', empresaId: 7, gestor: true, perm: null };
function app(rotas, user, base = '/api') {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { if (user) req.user = user; next(); });
  a.use(base, rotas);
  return a;
}

beforeEach(() => {
  veiculo = null; produtoExiste = true; empresaExistente = null;
  cnpjAtual = '08.794.609/0001-91'; veiculoLista = [];
});

describe('E7 — CNPJ', () => {
  it('confere os dígitos verificadores', () => {
    expect(cnpjValido('08.794.609/0001-91')).toBe(true);
    expect(cnpjValido('08794609000191')).toBe(true);
    expect(cnpjValido('08.794.609/0001-92')).toBe(false);
    expect(cnpjValido('11.111.111/1111-11')).toBe(false);
    expect(erroCnpj('123')).toMatch(/14 dígitos/);
  });
  it('grava sempre no mesmo formato', () => {
    expect(formatarCnpj('08794609000191')).toBe('08.794.609/0001-91');
  });
});

describe('F1 — garantia de moto só no chassi da concessionária', () => {
  const abrir = (user = CLIENTE) => request(app(rotasReiv, user)).post('/api/reivindicacoes').send({
    origem: 'veiculo', tipo: 'Manufacturer', niv: '979MX1000V40D3009', descricao: 'defeito',
    dataDefeito: '2026-09-01', pecas: [{ sku: 'A1', quantidade: 1 }]
  });

  it('chassi de OUTRA concessionária é recusado com a mesma mensagem de inexistente', async () => {
    veiculo = { VeiculoId: 1, GarantiaAtivaEm: new Date(), EmpresaId: 99 };
    const outra = await abrir();
    veiculo = null;
    const inexistente = await abrir();
    expect(outra.status).toBe(400);
    expect(outra.body.erro).toBe(inexistente.body.erro);
    expect(outra.body.erro).toMatch(/não encontrado no estoque da sua concessionária/);
  });

  it('chassi na Fábrica (sem concessionária) também é recusado', async () => {
    veiculo = { VeiculoId: 1, GarantiaAtivaEm: new Date(), EmpresaId: null };
    const r = await abrir();
    expect(r.body.erro).toMatch(/não encontrado no estoque/);
  });

  it('chassi da própria concessionária passa da checagem do dono', async () => {
    veiculo = { VeiculoId: 1, GarantiaAtivaEm: new Date(), EmpresaId: 7 };
    produtoExiste = false;   // para no passo seguinte, que prova que passou
    const r = await abrir();
    expect(r.body.erro).toMatch(/Peça não encontrada no catálogo/);
  });

  it('o admin abre em nome de qualquer concessionária', async () => {
    veiculo = { VeiculoId: 1, GarantiaAtivaEm: new Date(), EmpresaId: 99 };
    produtoExiste = false;
    const r = await abrir({ ...CLIENTE, papel: 'admin', empresaId: 1 });
    expect(r.body.erro).toMatch(/Peça não encontrada no catálogo/);
  });
});

describe('E6 — cadastro público', () => {
  const cadastro = (cnpj) => request(app(rotasAuth, null, '/api/auth')).post('/api/auth/register').send({
    nome: 'Fulano de Tal', empresa: 'Loja Nova', email: 'fulano@lojanova.com.br', senha: 'Frase-longa-2026!',
    cnpj, telefone: '(12) 99999-9999',
    endereco: { cep: '12230-470', logradouro: 'Av Perseu', numero: '950', bairro: 'Centro', cidade: 'São José dos Campos', uf: 'SP' }
  });

  it('recusa CNPJ com dígito errado', async () => {
    const r = await cadastro('08.794.609/0001-92');
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/CNPJ inválido/);
  });

  it('recusa entrar em empresa que já tem usuário no portal', async () => {
    empresaExistente = { EmpresaId: 3, Usuarios: 2 };
    const r = await cadastro('08794609000191');
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/já tem cadastro no portal/);
  });
});

describe('E4 — CNPJ travado em "Minha conta"', () => {
  const salvar = (user, cnpj) => request(app(rotasConta, user)).put('/api/conta/empresa').send({
    cnpj, telefone: '(12) 99999-9999', email: 'carlos@motosul.com.br',
    endereco: { cep: '12230-470', logradouro: 'Av Perseu', numero: '950', bairro: 'Centro', cidade: 'São José dos Campos', uf: 'SP' }
  });

  it('o cliente não troca o CNPJ', async () => {
    const r = await salvar(CLIENTE, '46.176.143/0001-50');
    expect(r.status).toBe(403);
    expect(r.body.erro).toMatch(/só pode ser alterado pela Fullgas/);
  });

  it('o mesmo CNPJ sem máscara não conta como troca', async () => {
    const r = await salvar(CLIENTE, '08794609000191');
    expect(r.status).not.toBe(403);
  });

  it('o admin na identidade assumida troca, mas só por CNPJ válido', async () => {
    const r = await salvar({ ...CLIENTE, imp: 1 }, '46.176.143/0001-51');
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/CNPJ inválido/);
  });
});

describe('G2 — comprador de moto transferida', () => {
  const linha = {
    VeiculoId: 1, Niv: '979MX1000V40D3009', Ano: 2027, Status: 'Vendido', EntradaEstoque: '2026-09-01',
    VendaData: '2026-09-10', VendaCliente: 'JOAO DA SILVA', ClienteCpf: '123.456.789-09',
    ClienteEmail: 'joao@x.com', ClienteTelefone: '12 9999', ClienteEndereco: 'Rua A',
    EmpresaId: 7, VendaEmpresaId: 9, ModeloCodigo: 'mx1-2027', EmpresaNome: 'MOTO SUL', NaFabrica: 0
  };

  it('a concessionária que recebeu a moto não vê os dados do comprador', async () => {
    veiculoLista = [linha];
    const r = await request(app(rotasVeic, CLIENTE)).get('/api/veiculos');
    expect(r.body[0].venda).toMatchObject({ cpf: '', email: '', outraConcessionaria: true });
    expect(JSON.stringify(r.body)).not.toMatch(/JOAO|123\.456/);
  });

  it('quem registrou a venda e o admin veem', async () => {
    veiculoLista = [{ ...linha, VendaEmpresaId: 7 }];
    let r = await request(app(rotasVeic, CLIENTE)).get('/api/veiculos');
    expect(r.body[0].venda.cpf).toBe('123.456.789-09');
    veiculoLista = [linha];
    r = await request(app(rotasVeic, { ...CLIENTE, papel: 'admin' })).get('/api/veiculos');
    expect(r.body[0].venda.cliente).toBe('JOAO DA SILVA');
  });
});
