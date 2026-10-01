// Lote 3 (30/09/2026): cadastro da concessionária no Tiny.
//   E2  edição do portal que não chegou ao Tiny não é desfeita pelo cron —
//       o cron re-tenta o envio;
//   E3  o painel mostra só o problema ATUAL (último registro, e erro recente).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let empresas, updates, chamadas, alterarFalha, painel;

vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => {
    if (/FROM dbo\.Empresa e\s+OUTER APPLY \(\s+SELECT TOP 1 d\.EnderecoId/.test(texto)) return empresas;
    if (/FROM dbo\.Empresa e\s+OUTER APPLY \(\s+SELECT TOP 1 en\.EnderecoId|OUTER APPLY \(\s+SELECT TOP 1 en\./.test(texto))
      return empresas.filter(e => e.EmpresaId === p.eid);
    if (/SET TinyContatoAlterado = 0/.test(texto)) { updates.push({ limpa: p.eid }); return []; }
    if (/FROM dbo\.TinySyncLog l/.test(texto)) return painel;
    return [];
  }
}));
vi.mock('../src/tiny.js', () => ({
  pesquisarContatoPorCpfCnpj: async () => ({ id: '714643632' }),
  incluirContato: async () => ({ id: 'novo' }),
  alterarContato: async (c) => {
    chamadas.push('alterar:' + c.id);
    if (alterarFalha) { const e = new Error('Tiny: Registro em duplicidade'); e.codigo = '31'; throw e; }
    return { id: c.id };
  },
  obterContato: async (id) => { chamadas.push('obter:' + id); return { cpf_cnpj: '08.794.609/0001-91', complemento: 'VELHO' }; },
  registrarLog: async () => {},
  listarProdutos: async () => ({}), obterProdutoCompleto: async () => ({}), sincronizarLote: async () => [],
  aplicarAtualizacao: async () => ({})
}));
vi.mock('../src/miniaturas.js', () => ({ prepararMiniaturas: () => {} }));
vi.mock('../src/tiny-pedidos.js', () => ({ exportarPedido: async () => 'enviado' }));

process.env.TINY_TOKEN = 'x';
process.env.TINY_SINCRONIZAR_CLIENTES = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { sincronizarContatosDoTiny, atualizarContatoTiny } = await import('../src/tiny-contatos.js');
const { default: rotasTiny } = await import('../src/routes/tiny.routes.js');

const EMP = {
  EmpresaId: 3, RazaoSocial: 'C MOREIRA DA SILVA ART MOTO RACING', Cnpj: '08.794.609/0001-91',
  TinyContatoId: '714643632', EnderecoId: 5, Logradouro: 'Avenida Perseu', Numero: '950',
  Complemento: 'NOVO (editado no portal)', Cidade: 'São José dos Campos', Uf: 'SP'
};

beforeEach(() => {
  empresas = []; updates = []; chamadas = []; alterarFalha = false; painel = [];
});

describe('E2 — edição do portal não é desfeita pelo cron', () => {
  it('com edição pendente, o cron ENVIA de novo e não traz o contato do Tiny', async () => {
    empresas = [{ ...EMP, TinyContatoAlterado: true }];
    await sincronizarContatosDoTiny();
    // Lê o contato só para preservar a observação, e ENVIA — o último passo é
    // o alterar; nada do Tiny é aplicado no cadastro local.
    expect(chamadas).toEqual(['obter:714643632', 'alterar:714643632']);
  });

  it('o envio que dá certo limpa a marca', async () => {
    empresas = [{ ...EMP, TinyContatoAlterado: true }];
    await atualizarContatoTiny(3);
    expect(updates).toEqual([{ limpa: 3 }]);
  });

  it('o envio que falha mantém a marca (o próximo cron tenta de novo)', async () => {
    empresas = [{ ...EMP, TinyContatoAlterado: true }];
    alterarFalha = true;
    await atualizarContatoTiny(3);
    expect(updates).toHaveLength(0);
  });

  it('sem edição pendente, o cron traz o contato do Tiny como antes', async () => {
    empresas = [{ ...EMP, TinyContatoAlterado: false }];
    await sincronizarContatosDoTiny();
    expect(chamadas).toEqual(['obter:714643632']);
  });
});

describe('E3 — quadro "Cadastros de clientes com problema no Tiny"', () => {
  const ADMIN = { id: 1, papel: 'admin', empresaId: 1, gestor: true, perm: null };
  const buscar = () => {
    const a = express();
    a.use((req, _res, next) => { req.user = ADMIN; next(); });
    a.use('/api', rotasTiny);
    return request(a).get('/api/tiny/contatos');
  };
  const linha = (extra) => ({
    EmpresaId: 1, RazaoSocial: 'X', Cnpj: '', TinyContatoId: '1', TinyContatoPendente: false,
    TinyContatoAlterado: false, UltimoStatus: 'ok', UltimaMensagem: null, UltimaData: new Date(), ...extra
  });

  it('erro recente é problema; erro velho (já superado pelo tempo) não', async () => {
    painel = [
      linha({ EmpresaId: 1, UltimoStatus: 'erro', UltimaData: new Date(Date.now() - 10 * 60 * 1000) }),
      linha({ EmpresaId: 2, UltimoStatus: 'erro', UltimaData: new Date('2026-08-13T10:30:29Z') }),
      linha({ EmpresaId: 3, UltimoStatus: 'ok' })
    ];
    const r = await buscar();
    expect(r.body.map(x => x.problema)).toEqual([true, false, false]);
  });

  it('edição pendente e empresa sem vínculo aparecem como problema', async () => {
    painel = [
      linha({ EmpresaId: 1, TinyContatoAlterado: true }),
      linha({ EmpresaId: 2, TinyContatoId: null, TinyContatoPendente: true })
    ];
    const r = await buscar();
    expect(r.body.map(x => [x.alterado, x.pendente, x.problema])).toEqual([[true, false, true], [false, true, true]]);
  });
});
