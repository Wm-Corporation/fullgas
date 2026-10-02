// Listas de preço do Tiny por cliente (migration 048, 02/10/2026).
//  - % do Tiny: negativo = desconto (-20 → paga 80%).
//  - O espelho local acompanha o Tiny (novas, alteradas, sumidas).
//  - O checkout precifica pela lista da EMPRESA e grava lista/% no pedido.
//  - O pedido vai ao Tiny com id_lista_preco (só se a lista ainda existe).
//  - A lista vem do CONTATO no Tiny (id_lista_preco): no cadastro, no cron e
//    no botão "Buscar no Tiny". Sem lista lá, escolhe-se à mão uma das
//    listas existentes (origem 'manual'); "preço cheio" não é escolha.
//  - Aprovar exige que a empresa saia com lista.
//
// db.js é um dublê só: cada bloco troca o `responder`.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let responder = () => [];
let chamadas = [];
const um = (linhas) => ({ recordset: linhas, rowsAffected: [linhas.length] });

class FakeRequest {
  constructor() { this.p = {}; }
  input(nome, _tipo, valor) { this.p[nome] = valor === undefined ? _tipo : valor; return this; }
  async query(texto) {
    chamadas.push({ texto, p: { ...this.p } });
    const r = responder(texto, this.p);
    return r && r.recordset ? r : um(r || []);
  }
}
class FakeTransaction { async begin() {} async commit() {} async rollback() {} }
const tipo = () => ({});
vi.mock('../src/db.js', () => ({
  query: async (texto, p = {}) => {
    chamadas.push({ texto, p });
    const r = responder(texto, p);
    return r && r.recordset ? r.recordset : (r || []);
  },
  getPool: async () => ({ request: () => new FakeRequest() }),
  sql: { Transaction: FakeTransaction, Request: FakeRequest, Int: tipo(), Bit: tipo(), VarChar: tipo, NVarChar: tipo, Decimal: tipo, DateTime2: tipo() }
}));

let listasDoTiny = [], contatoTiny = null, alterados = [];
vi.mock('../src/tiny.js', async (orig) => ({
  ...(await orig()),
  listarListasPreco: async () => listasDoTiny,
  obterContato: async () => contatoTiny,
  pesquisarContatoPorCpfCnpj: async () => ({ id: 500, nome: 'MOTO SUL LTDA' }),
  incluirContato: async () => ({ id: 501 }),
  alterarContato: async (c) => { alterados.push(c); return { id: c.id }; }
}));
process.env.TINY_TOKEN = 'token-de-teste';
process.env.TINY_SINCRONIZAR_CLIENTES = '1';
vi.mock('../src/historico-pedido.js', () => ({
  registrarEventoPedido: async () => {}, historicoDoPedido: async () => [], resumoPecas: () => ''
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const lp = await import('../src/lista-preco.js');
const { default: rotasPedidos } = await import('../src/routes/pedidos.routes.js');
const { default: rotasUsuarios } = await import('../src/routes/usuarios.routes.js');
const { montarPayload } = await import('../src/tiny-pedidos.js');
const { default: rotasListas } = await import('../src/routes/listas-preco.routes.js');
const contatos = await import('../src/tiny-contatos.js');

beforeEach(() => { chamadas = []; responder = () => []; listasDoTiny = []; contatoTiny = null; alterados = []; });

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1, gestor: true, perm: null };
const CLIENTE = { id: 3, email: 'carlos@motosul.com.br', papel: 'cliente', empresaId: 7, gestor: true, perm: null };
function app(rotas, user) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotas);
  return a;
}

describe('aplicarPercentual', () => {
  it.each([
    [199.9, -20, 159.92],
    [100, 0, 100],
    [100, 5.5, 105.5],
    [33.33, -10, 30],       // 29.997 → centavo mais próximo
    [10, -12.5, 8.75]
  ])('preço %s com lista %s vira %s', (base, pct, esperado) => {
    expect(lp.aplicarPercentual(base, pct)).toBe(esperado);
  });

  it('admin vê o preço base, mesmo com empresa em lista', async () => {
    responder = () => [{ ListaPrecoId: 9, Descricao: 'X', Percentual: -30, Ativa: 1 }];
    expect(await lp.percentualDoUsuario(ADMIN)).toBe(0);
    expect(await lp.percentualDoUsuario(CLIENTE)).toBe(-30);
  });

  it('cliente sem lista = preço cheio', async () => {
    expect(await lp.percentualDoUsuario(CLIENTE)).toBe(0);
  });
});

describe('sincronizarListasPreco', () => {
  it('cria as novas, atualiza as alteradas e desativa as que sumiram do Tiny', async () => {
    listasDoTiny = [
      { id: 1, descricao: 'Revenda A', percentual: -20 },   // igual: nada a fazer
      { id: 2, descricao: 'Revenda B', percentual: -15 },   // mudou o %
      { id: 4, descricao: 'Nova', percentual: -5 },         // nova
      { id: 5, descricao: 'Quebrada', percentual: -100 }    // fora da faixa: ignorada
    ];
    responder = (t) => /SELECT ListaPrecoId, Descricao, Percentual, Ativa FROM dbo\.ListaPreco/.test(t) ? [
      { ListaPrecoId: 1, Descricao: 'Revenda A', Percentual: -20, Ativa: true },
      { ListaPrecoId: 2, Descricao: 'Revenda B', Percentual: -10, Ativa: true },
      { ListaPrecoId: 3, Descricao: 'Antiga', Percentual: -30, Ativa: true }
    ] : [];
    const r = await lp.sincronizarListasPreco();
    expect(r).toEqual({ total: 3, novas: 1, alteradas: 1, desativadas: 1 });
    const escritas = chamadas.filter(c => /INSERT|UPDATE/.test(c.texto));
    expect(escritas.map(c => [c.texto.match(/INSERT|SET Ativa = 0|SET Descricao/)[0], c.p.id])).toEqual([
      ['SET Descricao', 2], ['INSERT', 4], ['SET Ativa = 0', 3]
    ]);
  });
});

describe('checkout pela lista da empresa', () => {
  const rotas = rotasPedidos;
  let pedidoIns, itensIns;
  beforeEach(() => {
    pedidoIns = null; itensIns = [];
  });
  function banco(lista) {
    return (t, p) => {
      if (/JOIN dbo\.ListaPreco l ON l\.ListaPrecoId = e\.ListaPrecoId/.test(t)) return lista ? [lista] : [];
      if (/UPDATE dbo\.Produto/.test(t)) return [{ ProdutoId: 100, Nome: 'PECA A', Preco: 199.9 }];
      if (/Seq_NumeroPedido/.test(t)) return [{ NumeroPedido: '0005041999', Agora: new Date('2026-10-02T12:00:00Z') }];
      if (/INSERT INTO dbo\.Pedido /.test(t)) { pedidoIns = p; return [{ PedidoId: 55 }]; }
      if (/INSERT INTO dbo\.PedidoItem/.test(t)) { itensIns.push(p); return []; }
      if (/INSERT INTO dbo\.Fatura/.test(t)) return [{ FaturaId: 1, NumeroFatura: '1' }];
      if (/SELECT RazaoSocial FROM dbo\.Empresa/.test(t)) return [{ RazaoSocial: 'MOTO SUL LTDA' }];
      return [];
    };
  }
  const comprar = () => request(app(rotas, CLIENTE)).post('/api/pedidos').send({ itens: [{ sku: 'A1', quantidade: 3 }] });

  it('lista -20%: item, total e pedido saem com o desconto e a lista fica gravada', async () => {
    responder = banco({ ListaPrecoId: 11, Descricao: 'Revenda A', Percentual: -20, Ativa: true });
    const r = await comprar();
    expect(r.status).toBe(201);
    expect(r.body.itens[0].preco).toBe(159.92);
    expect(r.body.total).toBe(479.76);
    expect(itensIns[0].preco).toBe(159.92);
    expect(pedidoIns).toMatchObject({ total: 479.76, lid: 11, lpct: -20 });
  });

  it('sem lista: preço cheio e pedido sem lista', async () => {
    responder = banco(null);
    const r = await comprar();
    expect(r.status).toBe(201);
    expect(r.body.itens[0].preco).toBe(199.9);
    expect(pedidoIns).toMatchObject({ lid: null, lpct: null });
  });
});

describe('pedido ao Tiny', () => {
  const exp = { PedidoId: 10, ExportId: 50, Escopo: 'normal', ItensJson: JSON.stringify([{ sku: 'A1', nome: 'A', preco: 159.92, qtd: 1 }]) };
  function banco(ListaPrecoId, ListaAtiva) {
    return (t) => /FROM dbo\.Pedido p/.test(t) ? [{
      PedidoId: 10, NumeroPedido: '0005041999', DataPedido: '2026-10-02T12:00:00Z', EmpresaId: 7, Tipo: 'venda',
      UsuarioEmail: 'carlos@motosul.com.br', RazaoSocial: 'MOTO SUL LTDA', Cnpj: '12345678000199',
      ListaPrecoId, ListaAtiva
    }] : [];
  }

  it('leva id_lista_preco e o valor unitário já com desconto', async () => {
    responder = banco(11, true);
    const p = await montarPayload(exp);
    expect(p.id_lista_preco).toBe(11);
    expect(p.itens[0].item.valor_unitario).toBe('159.92');
  });

  it('lista que sumiu do Tiny não vai (o Tiny recusaria o pedido)', async () => {
    responder = banco(11, false);
    expect((await montarPayload(exp)).id_lista_preco).toBeUndefined();
  });

  it('pedido sem lista não leva o campo', async () => {
    responder = banco(null, null);
    expect((await montarPayload(exp)).id_lista_preco).toBeUndefined();
  });
});

describe('aprovar cadastro exige que a empresa saia com lista', () => {
  const rotas = rotasUsuarios;
  let usuario, empresa, listas;
  beforeEach(() => {
    usuario = { Status: 'pendente', Papel: 'cliente', EmpresaId: 7 };
    empresa = { ListaPrecoId: null, ListaPrecoOrigem: null };
    listas = { 11: { ListaPrecoId: 11, Descricao: 'Revenda A', Percentual: -20, Ativa: true },
               12: { ListaPrecoId: 12, Descricao: 'Velha', Percentual: -5, Ativa: false } };
    responder = (t, p) => {
      if (/SELECT Status, Papel, EmpresaId FROM dbo\.Usuario/.test(t)) return [usuario];
      if (/SELECT ListaPrecoId, ListaPrecoOrigem FROM dbo\.Empresa/.test(t)) return [empresa];
      if (/FROM dbo\.ListaPreco WHERE ListaPrecoId = @id/.test(t)) return listas[p.id] ? [listas[p.id]] : [];
      if (/UPDATE dbo\.Usuario/.test(t)) return { recordset: [], rowsAffected: /UPDATE dbo\.Empresa/.test(t) ? [1, 1] : [1] };
      return [];
    };
  });
  const aprovar = (corpo) => request(app(rotas, ADMIN)).patch('/api/usuarios/3').send({ status: 'aprovado', ...corpo });
  const lote = () => chamadas.find(c => /UPDATE dbo\.Usuario/.test(c.texto));

  it('contato sem lista no Tiny e nada escolhido: 400 e nada é gravado', async () => {
    const r = await aprovar({});
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/não tem lista de preço no Tiny/);
    expect(lote()).toBeUndefined();
  });

  it('escolhendo uma lista: grava como manual, junto com o status, em transação', async () => {
    const r = await aprovar({ listaPrecoId: 11 });
    expect(r.status).toBe(200);
    expect(lote().texto).toMatch(/BEGIN TRAN[\s\S]*SET ListaPrecoId = @lid, ListaPrecoOrigem = 'manual'[\s\S]*UPDATE dbo\.Usuario[\s\S]*COMMIT/);
    expect(lote().p).toMatchObject({ eid: 7, lid: 11, status: 'aprovado' });
  });

  it('"preço cheio" (null) não é mais uma escolha', async () => {
    const r = await aprovar({ listaPrecoId: null });
    expect(r.status).toBe(400);
    expect(lote()).toBeUndefined();
  });

  it('lista que veio do Tiny: aprova sem escolher e não mexe na lista', async () => {
    empresa = { ListaPrecoId: 11, ListaPrecoOrigem: 'tiny' };
    const r = await aprovar({});
    expect(r.status).toBe(200);
    expect(lote().texto).not.toMatch(/dbo\.Empresa/);
  });

  it('lista inexistente ou que sumiu do Tiny: 400', async () => {
    expect((await aprovar({ listaPrecoId: 99 })).status).toBe(400);
    const r = await aprovar({ listaPrecoId: 12 });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/não existe mais no Tiny/);
  });

  it('desbloquear quem já era aprovado não pede lista', async () => {
    usuario.Status = 'bloqueado';
    const r = await aprovar({});
    expect(r.status).toBe(200);
    expect(lote().texto).not.toMatch(/dbo\.Empresa/);
  });
});

// Banco mínimo para a lista que vem do contato: espelho + uma empresa.
function bancoDoContato(estado) {
  return (t, p) => {
    if (/SELECT ListaPrecoId, Descricao, Percentual, Ativa FROM dbo\.ListaPreco WHERE/.test(t))
      return estado.espelho[p.id] ? [estado.espelho[p.id]] : [];
    if (/SELECT ListaPrecoId, Descricao, Percentual, Ativa FROM dbo\.ListaPreco$/.test(t.trim()))
      return Object.values(estado.espelho);
    if (/INSERT INTO dbo\.ListaPreco/.test(t)) {
      estado.espelho[p.id] = { ListaPrecoId: p.id, Descricao: p.d, Percentual: p.p, Ativa: true }; return [];
    }
    if (/SELECT RazaoSocial, ListaPrecoId, ListaPrecoOrigem FROM dbo\.Empresa/.test(t)) return [estado.empresa];
    if (/SET ListaPrecoId = @lid, ListaPrecoOrigem = 'tiny'/.test(t)) {
      estado.empresa.ListaPrecoId = p.lid; estado.empresa.ListaPrecoOrigem = 'tiny'; return [];
    }
    return estado.extra ? estado.extra(t, p) || [] : [];
  };
}

describe('aplicarListaDoTiny — lista do contato', () => {
  let estado;
  beforeEach(() => {
    estado = {
      espelho: { 11: { ListaPrecoId: 11, Descricao: 'Revenda A', Percentual: -20, Ativa: true } },
      empresa: { RazaoSocial: 'MOTO SUL LTDA', ListaPrecoId: null, ListaPrecoOrigem: null }
    };
    responder = bancoDoContato(estado);
  });

  it('contato com lista: a empresa passa a usá-la, com origem tiny', async () => {
    expect(await lp.aplicarListaDoTiny(7, '11', 500)).toBe('aplicada');
    expect(estado.empresa).toMatchObject({ ListaPrecoId: 11, ListaPrecoOrigem: 'tiny' });
    expect(await lp.aplicarListaDoTiny(7, 11, 500)).toBe('igual');
  });

  it('o Tiny manda: sobrepõe uma lista escolhida à mão', async () => {
    estado.empresa = { RazaoSocial: 'X', ListaPrecoId: 99, ListaPrecoOrigem: 'manual' };
    expect(await lp.aplicarListaDoTiny(7, 11)).toBe('aplicada');
    expect(estado.empresa).toMatchObject({ ListaPrecoId: 11, ListaPrecoOrigem: 'tiny' });
  });

  it.each([[null], [''], ['0'], [0]])('contato sem lista (%s): nada muda — a manual continua', async (v) => {
    estado.empresa = { RazaoSocial: 'X', ListaPrecoId: 99, ListaPrecoOrigem: 'manual' };
    expect(await lp.aplicarListaDoTiny(7, v)).toBe('sem-lista');
    expect(estado.empresa.ListaPrecoId).toBe(99);
    expect(chamadas.some(c => /UPDATE dbo\.Empresa/.test(c.texto))).toBe(false);
  });

  it('lista nova no Tiny ainda fora do espelho: traz as listas e aplica', async () => {
    listasDoTiny = [{ id: 11, descricao: 'Revenda A', percentual: -20 }, { id: 14, descricao: 'Revenda C', percentual: -8 }];
    expect(await lp.aplicarListaDoTiny(7, 14)).toBe('aplicada');
    expect(estado.empresa.ListaPrecoId).toBe(14);
  });

  it('lista que não existe nem no Tiny: não grava e registra o problema', async () => {
    listasDoTiny = [{ id: 11, descricao: 'Revenda A', percentual: -20 }];
    expect(await lp.aplicarListaDoTiny(7, 77, 500)).toBe('desconhecida');
    expect(estado.empresa.ListaPrecoId).toBe(null);
    expect(chamadas.some(c => /INSERT INTO dbo\.TinySyncLog/.test(c.texto) && /77/.test(JSON.stringify(c.p)))).toBe(true);
  });
});

describe('cadastro, cron e edição puxam/preservam a lista do contato', () => {
  let estado;
  const EMPRESA = {
    EmpresaId: 7, RazaoSocial: 'MOTO SUL LTDA', Cnpj: '12345678000199', TinyContatoId: null,
    TinyContatoAlterado: 0, Ativo: 1
  };
  beforeEach(() => {
    estado = {
      espelho: { 11: { ListaPrecoId: 11, Descricao: 'Revenda A', Percentual: -20, Ativa: true } },
      empresa: { RazaoSocial: 'MOTO SUL LTDA', ListaPrecoId: null, ListaPrecoOrigem: null },
      extra: (t) => {
        if (/FROM dbo\.Empresa e\s+OUTER APPLY/.test(t)) return [{ ...EMPRESA, ...estado.dadosEmpresa }];
        if (/SELECT TinyContatoAlterado FROM dbo\.Empresa/.test(t)) return [{ TinyContatoAlterado: 0 }];
        return [];
      },
      dadosEmpresa: {}
    };
    responder = bancoDoContato(estado);
  });

  it('cadastro com contato existente no Tiny: já sai com a lista dele', async () => {
    contatoTiny = { id: 500, cpf_cnpj: '12345678000199', id_lista_preco: '11' };
    expect(await contatos.vincularContatoTiny(7)).toBe(500);
    expect(estado.empresa).toMatchObject({ ListaPrecoId: 11, ListaPrecoOrigem: 'tiny' });
  });

  it('contato existente sem lista no Tiny: empresa fica sem lista (vermelho)', async () => {
    contatoTiny = { id: 500, cpf_cnpj: '12345678000199', id_lista_preco: '0' };
    await contatos.vincularContatoTiny(7);
    expect(estado.empresa.ListaPrecoId).toBe(null);
  });

  it('cron: lista trocada no contato do Tiny chega à empresa', async () => {
    estado.dadosEmpresa = { TinyContatoId: 500 };
    estado.empresa = { RazaoSocial: 'MOTO SUL LTDA', ListaPrecoId: 99, ListaPrecoOrigem: 'manual' };
    contatoTiny = { id: 500, cpf_cnpj: '12345678000199', id_lista_preco: 11 };
    await contatos.sincronizarContatosDoTiny();
    expect(estado.empresa).toMatchObject({ ListaPrecoId: 11, ListaPrecoOrigem: 'tiny' });
  });

  it('edição do cadastro reenvia a lista que o contato já tem (o alterar substitui o registro)', async () => {
    estado.dadosEmpresa = { TinyContatoId: 500 };
    contatoTiny = { id: 500, cpf_cnpj: '12345678000199', id_lista_preco: '11', obs: 'nota de lá' };
    await contatos.atualizarContatoTiny(7);
    expect(alterados).toHaveLength(1);
    expect(alterados[0]).toMatchObject({ id: '500', id_lista_preco: '11', obs: 'nota de lá' });
  });

  it('contato sem lista: o alterar não inventa uma', async () => {
    estado.dadosEmpresa = { TinyContatoId: 500 };
    contatoTiny = { id: 500, cpf_cnpj: '12345678000199', id_lista_preco: '0' };
    await contatos.atualizarContatoTiny(7);
    expect(alterados[0].id_lista_preco).toBeUndefined();
  });
});

describe('painel: escolher à mão e "Buscar no Tiny"', () => {
  let empresa;
  beforeEach(() => {
    empresa = { RazaoSocial: 'MOTO SUL LTDA', TinyContatoId: 500, ListaPrecoId: null, ListaPrecoOrigem: null };
    const espelho = { 11: { ListaPrecoId: 11, Descricao: 'Revenda A', Percentual: -20, Ativa: true, AtualizadoEm: null },
                      12: { ListaPrecoId: 12, Descricao: 'Revenda B', Percentual: -10, Ativa: true, AtualizadoEm: null } };
    responder = (t, p) => {
      if (/SELECT RazaoSocial FROM dbo\.Empresa/.test(t)) return [empresa];
      if (/SELECT TinyContatoId FROM dbo\.Empresa/.test(t)) return [empresa];
      if (/SELECT RazaoSocial, ListaPrecoId, ListaPrecoOrigem FROM dbo\.Empresa/.test(t)) return [empresa];
      if (/JOIN dbo\.ListaPreco l ON l\.ListaPrecoId = e\.ListaPrecoId/.test(t))
        return empresa.ListaPrecoId ? [{ ...espelho[empresa.ListaPrecoId], ListaPrecoOrigem: empresa.ListaPrecoOrigem }] : [];
      if (/FROM dbo\.ListaPreco WHERE ListaPrecoId = @id/.test(t)) return espelho[p.id] ? [espelho[p.id]] : [];
      if (/FROM dbo\.ListaPreco l\s/.test(t)) return Object.values(espelho);
      if (/SELECT ListaPrecoId, Descricao, Percentual, Ativa FROM dbo\.ListaPreco$/.test(t.trim())) return Object.values(espelho);
      if (/ListaPrecoOrigem = 'manual'/.test(t)) { empresa.ListaPrecoId = p.lid; empresa.ListaPrecoOrigem = 'manual'; return []; }
      if (/ListaPrecoOrigem = 'tiny'/.test(t)) { empresa.ListaPrecoId = p.lid; empresa.ListaPrecoOrigem = 'tiny'; return []; }
      return [];
    };
  });
  const definir = (listaPrecoId) => request(app(rotasListas, ADMIN)).put('/api/empresas/7/lista-preco').send({ listaPrecoId });
  const buscar = () => request(app(rotasListas, ADMIN)).post('/api/empresas/7/lista-preco/tiny');

  it('sem lista: escolhe uma existente e fica manual', async () => {
    const r = await definir(12);
    expect(r.status).toBe(200);
    expect(empresa).toMatchObject({ ListaPrecoId: 12, ListaPrecoOrigem: 'manual' });
  });

  it('"preço cheio" (null) é recusado', async () => {
    expect((await definir(null)).status).toBe(400);
  });

  it('lista vinda do Tiny não se troca no painel (o cron desfaria)', async () => {
    empresa.ListaPrecoId = 11; empresa.ListaPrecoOrigem = 'tiny';
    const r = await definir(12);
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/contato no Tiny/);
    expect(empresa.ListaPrecoId).toBe(11);
  });

  it('"Buscar no Tiny" aplica a lista que o contato tem lá', async () => {
    contatoTiny = { id: 500, id_lista_preco: '11' };
    listasDoTiny = [{ id: 11, descricao: 'Revenda A', percentual: -20 }, { id: 12, descricao: 'Revenda B', percentual: -10 }];
    const r = await buscar();
    expect(r.status).toBe(200);
    expect(r.body.resultado).toBe('aplicada');
    expect(empresa).toMatchObject({ ListaPrecoId: 11, ListaPrecoOrigem: 'tiny' });
  });

  it('"Buscar no Tiny" com contato sem lista avisa e não mexe', async () => {
    contatoTiny = { id: 500, id_lista_preco: '' };
    const r = await buscar();
    expect(r.body.resultado).toBe('sem-lista');
    expect(empresa.ListaPrecoId).toBe(null);
  });
});
