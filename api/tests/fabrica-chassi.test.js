// Chassi e Fábrica (16/09/2026).
//
// Até aqui a empresa em que as contas de administrador ficam penduradas era
// tratada como mais uma concessionária: aparecia na lista de destino dos
// chassis e podia "receber" moto. A regra agora é: empresa com administrador é
// a Fábrica, e chassi sem concessionária está na Fábrica.
//
// O db.js é substituído por um dublê: estes testes não tocam SQL Server. Cada
// teste diz o que o "banco" responde para cada consulta.
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

// auth.js se recusa a carregar sem uma chave de sessão.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { default: rotas } = await import('../src/routes/veiculos.routes.js');
const { toEvento } = await import('../src/historico-veiculo.js');

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1 };

function app(user = ADMIN) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api', rotas);
  return a;
}

// Linha de veículo como o SELECT_VEIC devolve.
function linhaVeiculo(extra = {}) {
  return {
    VeiculoId: 50, Niv: 'VBFGA125XSM160872', Ano: 2025, Status: 'Disponível',
    EntradaEstoque: new Date('2026-09-01T12:00:00Z'), VendaData: null,
    GarantiaAtivaEm: null, EmpresaId: null, EmpresaNome: null,
    ModeloCodigo: 'fg125-2025', NaFabrica: true,
    // colunas que continuam no banco mas saíram da tela
    Cor: 'Vermelho', NumeroMotor: 'M123',
    ...extra
  };
}

const eventos = () => consultas.filter(c => /INSERT INTO dbo\.VeiculoHistorico/.test(c.sql));

beforeEach(() => { consultas = []; responder = () => []; });

describe('GET /api/empresas', () => {
  it('não lista a empresa dos administradores como concessionária', async () => {
    responder = () => [{ EmpresaId: 7, RazaoSocial: 'MOTO SUL', NomeFantasia: null }];
    const r = await request(app()).get('/api/empresas');
    expect(r.status).toBe(200);
    expect(consultas[0].sql).toMatch(/NOT EXISTS \(SELECT 1 FROM dbo\.Usuario fab_u[\s\S]*Papel = 'admin'\)/);
  });
});

describe('GET /api/veiculos', () => {
  it('chassi sem concessionária sai como Fábrica, sem cor nem nº do motor', async () => {
    responder = () => [linhaVeiculo()];
    const r = await request(app()).get('/api/veiculos');
    expect(r.body[0]).toMatchObject({ fabrica: true, empresa: null, empresaId: null });
    expect(r.body[0]).not.toHaveProperty('cor');
    expect(r.body[0]).not.toHaveProperty('numeroMotor');
    expect(r.body[0].ano).toBe(2025);
  });

  it('chassi preso à empresa de um admin (dado antigo) também é Fábrica', async () => {
    responder = () => [linhaVeiculo({ EmpresaId: 1, EmpresaNome: 'FULLGAS MOTOS', NaFabrica: true })];
    const r = await request(app()).get('/api/veiculos');
    expect(r.body[0]).toMatchObject({ fabrica: true, empresa: null, empresaId: null });
  });

  it('chassi em concessionária mostra a concessionária', async () => {
    responder = () => [linhaVeiculo({ EmpresaId: 7, EmpresaNome: 'MOTO SUL', NaFabrica: false })];
    const r = await request(app()).get('/api/veiculos');
    expect(r.body[0]).toMatchObject({ fabrica: false, empresa: 'MOTO SUL', empresaId: 7 });
  });
});

describe('POST /api/veiculos', () => {
  const corpo = { niv: 'VBFGA125XSM160872', modeloId: 'fg125-2025', ano: 2025 };

  it('sem concessionária nasce na Fábrica, e cor/motor não são gravados', async () => {
    responder = (s) => {
      if (/FROM dbo\.ModeloMoto WHERE Codigo/.test(s)) return [{ ModeloId: 3, Nome: 'FG 125', Ano: 2025, Etiqueta: null }];
      if (/SELECT 1 FROM dbo\.Veiculo WHERE Niv/.test(s)) return [];
      if (/FROM dbo\.Veiculo v/.test(s)) return [linhaVeiculo()];
      return [];
    };
    const r = await request(app()).post('/api/veiculos').send({ ...corpo, cor: 'Azul', numeroMotor: 'X9' });
    expect(r.status).toBe(201);
    expect(r.body.fabrica).toBe(true);

    const insert = consultas.find(c => /INSERT INTO dbo\.Veiculo /.test(c.sql));
    expect(insert.sql).not.toMatch(/\bCor\b|NumeroMotor/);
    expect(insert.params.eid).toBeNull();
    expect(insert.params.ano).toBe(2025);            // o ano é da unidade, não do modelo

    const ev = eventos();
    expect(ev).toHaveLength(1);                       // sem concessionária, sem atribuição
    expect(ev[0].params.titulo).toBe('Chassi cadastrado na Fábrica');
    expect(ev[0].params.eid).toBeNull();
    expect(ev[0].params.detalhe).toBe('FG 125 2025 · Ano 2025');  // nome do modelo, não o código
  });

  // O ano é digitado a cada chassi (migration 042). Sem ele o cadastro para
  // aqui: gravar um chassi sem ano deixaria a moto sem o dado que vale na nota
  // e na contagem de garantia.
  it.each([
    ['sem ano', {}],
    ['ano vazio', { ano: '' }],
    ['ano antigo demais', { ano: 1979 }],
    ['ano longe demais no futuro', { ano: new Date().getFullYear() + 3 }],
    ['ano com texto', { ano: 'dois mil' }]
  ])('recusa o cadastro %s', async (_nome, troca) => {
    const { ano, ...semAno } = corpo;
    const r = await request(app()).post('/api/veiculos').send({ ...semAno, ...troca });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Ano inválido/);
    expect(consultas.some(c => /INSERT INTO dbo\.Veiculo /.test(c.sql))).toBe(false);
  });

  it.each([1, 2])('aceita até dois anos-modelo à frente (a indústria já vende o ano-modelo +%i)', async (adiante) => {
    const ano = new Date().getFullYear() + adiante;
    responder = (s) => {
      if (/FROM dbo\.ModeloMoto WHERE Codigo/.test(s)) return [{ ModeloId: 3, Nome: 'FG 125', Ano: 2025, Etiqueta: null }];
      if (/SELECT 1 FROM dbo\.Veiculo WHERE Niv/.test(s)) return [];
      if (/FROM dbo\.Veiculo v/.test(s)) return [linhaVeiculo({ Ano: ano })];
      return [];
    };
    const r = await request(app()).post('/api/veiculos').send({ ...corpo, ano });
    expect(r.status).toBe(201);
    expect(r.body.ano).toBe(ano);
  });

  it('recusa a empresa da Fábrica como concessionária', async () => {
    responder = (s) => {
      if (/FROM dbo\.ModeloMoto WHERE Codigo/.test(s)) return [{ ModeloId: 3, Nome: 'FG 125', Ano: 2025 }];
      if (/FROM dbo\.Empresa e WHERE e\.EmpresaId = @eid/.test(s)) return [{ EhFabrica: true }];
      return [];
    };
    const r = await request(app()).post('/api/veiculos').send({ ...corpo, empresaId: 1 });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/é a Fábrica/);
    expect(consultas.some(c => /INSERT INTO dbo\.Veiculo /.test(c.sql))).toBe(false);
  });

  it('com concessionária registra o cadastro na Fábrica e a atribuição', async () => {
    responder = (s) => {
      if (/FROM dbo\.ModeloMoto WHERE Codigo/.test(s)) return [{ ModeloId: 3, Nome: 'FG 125', Ano: 2025 }];
      if (/FROM dbo\.Empresa e WHERE e\.EmpresaId = @eid/.test(s)) return [{ EhFabrica: false }];
      if (/FROM dbo\.Veiculo v/.test(s)) return [linhaVeiculo({ EmpresaId: 7, EmpresaNome: 'MOTO SUL', NaFabrica: false })];
      return [];
    };
    const r = await request(app()).post('/api/veiculos').send({ ...corpo, empresaId: 7 });
    expect(r.status).toBe(201);
    const ev = eventos().map(e => [e.params.tipo, e.params.eid]);
    expect(ev).toEqual([['cadastro', null], ['atribuicao', 7]]);
  });
});

describe('PUT /api/veiculos/:niv/transferir', () => {
  const url = '/api/veiculos/VBFGA125XSM160872/transferir';

  it('devolve à Fábrica: tira a concessionária e registra de onde saiu', async () => {
    let devolvido = false;
    responder = (s) => {
      if (/UPDATE dbo\.Veiculo[\s\S]*SET EmpresaId = NULL/.test(s)) { devolvido = true; return []; }
      if (/FROM dbo\.Veiculo v/.test(s)) {
        return [devolvido ? linhaVeiculo()
          : linhaVeiculo({ EmpresaId: 7, EmpresaNome: 'MOTO SUL', NaFabrica: false })];
      }
      return [];
    };
    const r = await request(app()).put(url).send({ fabrica: true });
    expect(r.status).toBe(200);
    expect(r.body.fabrica).toBe(true);
    const ev = eventos();
    expect(ev).toHaveLength(1);
    expect(ev[0].params).toMatchObject({
      tipo: 'transferencia', titulo: 'Devolvido à Fábrica',
      detalhe: 'Concessionária anterior: MOTO SUL', eid: null
    });
  });

  it('não devolve o que já está na Fábrica', async () => {
    responder = (s) => (/FROM dbo\.Veiculo v/.test(s) ? [linhaVeiculo()] : []);
    const r = await request(app()).put(url).send({ fabrica: true });
    expect(r.status).toBe(409);
    expect(consultas.some(c => /UPDATE dbo\.Veiculo/.test(c.sql))).toBe(false);
  });

  it('recusa a Fábrica como concessionária de destino', async () => {
    responder = (s) => {
      if (/FROM dbo\.Veiculo v/.test(s)) return [linhaVeiculo({ EmpresaId: 7, EmpresaNome: 'MOTO SUL', NaFabrica: false })];
      if (/FROM dbo\.Empresa e WHERE e\.Ativo = 1 AND e\.EmpresaId/.test(s)) return [{ EmpresaId: 1, RazaoSocial: 'FULLGAS MOTOS', EhFabrica: true }];
      return [];
    };
    const r = await request(app()).put(url).send({ empresaId: 1 });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/é a Fábrica/);
    expect(consultas.some(c => /UPDATE dbo\.Veiculo/.test(c.sql))).toBe(false);
  });

  it('sair da Fábrica é ATRIBUIÇÃO, mesmo com dado antigo apontando para a empresa do admin', async () => {
    responder = (s) => {
      if (/FROM dbo\.Veiculo v/.test(s)) return [linhaVeiculo({ EmpresaId: 1, EmpresaNome: 'FULLGAS MOTOS', NaFabrica: true })];
      if (/FROM dbo\.Empresa e WHERE e\.Ativo = 1 AND e\.EmpresaId/.test(s)) return [{ EmpresaId: 7, RazaoSocial: 'MOTO SUL', EhFabrica: false }];
      return [];
    };
    const r = await request(app()).put(url).send({ empresaId: 7 });
    expect(r.status).toBe(200);
    expect(eventos()[0].params).toMatchObject({ tipo: 'atribuicao', titulo: 'Atribuído a MOTO SUL', detalhe: null });
  });

  it('entre concessionárias continua sendo TRANSFERÊNCIA', async () => {
    responder = (s) => {
      if (/FROM dbo\.Veiculo v/.test(s)) return [linhaVeiculo({ EmpresaId: 7, EmpresaNome: 'MOTO SUL', NaFabrica: false })];
      if (/FROM dbo\.Empresa e WHERE e\.Ativo = 1 AND e\.EmpresaId/.test(s)) return [{ EmpresaId: 8, RazaoSocial: 'MOTO NORTE', EhFabrica: false }];
      return [];
    };
    const r = await request(app()).put(url).send({ empresaId: 8 });
    expect(r.status).toBe(200);
    expect(eventos()[0].params).toMatchObject({ tipo: 'transferencia', detalhe: 'Concessionária anterior: MOTO SUL' });
  });

  // A entrada no estoque conta desde a chegada NAQUELA conta (migration 043):
  // quem recebe a moto hoje não a vê "em estoque desde" o cadastro na Fábrica.
  it('mudar de dono reinicia a entrada no estoque', async () => {
    responder = (s) => {
      if (/FROM dbo\.Empresa e WHERE e\.Ativo = 1 AND e\.EmpresaId/.test(s))
        return [{ EmpresaId: 7, RazaoSocial: 'MOTO SUL', EhFabrica: false }];
      if (/FROM dbo\.Veiculo v/.test(s)) return [linhaVeiculo()];
      return [];
    };
    const r = await request(app()).put(url).send({ empresaId: 7 });
    expect(r.status).toBe(200);
    const upd = consultas.find(c => /UPDATE dbo\.Veiculo/.test(c.sql));
    expect(upd.sql).toMatch(/EntradaEstoque = SYSUTCDATETIME\(\)/);
  });

  it('devolver à Fábrica também reinicia a entrada no estoque', async () => {
    let devolvido = false;
    responder = (s) => {
      if (/UPDATE dbo\.Veiculo[\s\S]*SET EmpresaId = NULL/.test(s)) { devolvido = true; return []; }
      if (/FROM dbo\.Veiculo v/.test(s)) {
        return [devolvido ? linhaVeiculo()
          : linhaVeiculo({ EmpresaId: 7, EmpresaNome: 'MOTO SUL', NaFabrica: false })];
      }
      return [];
    };
    const r = await request(app()).put(url).send({ fabrica: true });
    expect(r.status).toBe(200);
    const upd = consultas.find(c => /UPDATE dbo\.Veiculo/.test(c.sql));
    expect(upd.sql).toMatch(/EntradaEstoque = SYSUTCDATETIME\(\)/);
  });

  it('continua exigindo um destino', async () => {
    const r = await request(app()).put(url).send({});
    expect(r.status).toBe(400);
  });
});

describe('PUT /api/veiculos/:niv/ano', () => {
  const url = '/api/veiculos/VBFGA125XSM160872/ano';

  it('corrige o ano e registra uma nota no histórico', async () => {
    responder = (s) => {
      if (/FROM dbo\.Veiculo v/.test(s)) return [linhaVeiculo({ Ano: 2026, EmpresaId: 7, EmpresaNome: 'MOTO SUL' })];
      return [];
    };
    const r = await request(app()).put(url).send({ ano: 2027 });
    expect(r.status).toBe(200);

    const upd = consultas.find(c => /UPDATE dbo\.Veiculo SET Ano/.test(c.sql));
    expect(upd.params).toMatchObject({ ano: 2027, id: 50 });

    const ev = eventos();
    expect(ev).toHaveLength(1);
    expect(ev[0].params).toMatchObject({
      tipo: 'nota', titulo: 'Ano corrigido', detalhe: 'De 2026 para 2027',
      eid: 7, enome: 'MOTO SUL', manual: 1
    });
  });

  it('recusa quando o ano já é esse', async () => {
    responder = (s) => (/FROM dbo\.Veiculo v/.test(s) ? [linhaVeiculo({ Ano: 2027 })] : []);
    const r = await request(app()).put(url).send({ ano: 2027 });
    expect(r.status).toBe(409);
    expect(consultas.some(c => /UPDATE dbo\.Veiculo SET Ano/.test(c.sql))).toBe(false);
  });

  it('recusa ano fora da faixa, na mesma regra do cadastro', async () => {
    const foraDaFaixa = new Date().getFullYear() + 3;
    const r = await request(app()).put(url).send({ ano: foraDaFaixa });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Ano inválido/);
  });

  it('404 para chassi inexistente', async () => {
    responder = () => [];
    const r = await request(app()).put(url).send({ ano: 2027 });
    expect(r.status).toBe(404);
  });

  it('só admin corrige o ano', async () => {
    const cliente = { id: 9, email: 'c@motosul.com.br', papel: 'cliente', empresaId: 7 };
    const r = await request(app(cliente)).put(url).send({ ano: 2027 });
    expect(r.status).toBe(403);
  });
});

describe('histórico do veículo', () => {
  const base = { HistoricoId: 1, Tipo: 'cadastro', Titulo: 'Chassi cadastrado', Manual: false, DataEvento: new Date() };

  it('evento na Fábrica aparece como Fábrica, mesmo se gravou o nome da empresa do admin', () => {
    const ev = toEvento({ ...base, EmpresaNome: 'FULLGAS MOTOS', NaFabrica: true });
    expect(ev).toMatchObject({ fabrica: true, empresa: 'Fábrica' });
  });

  it('evento em concessionária mantém o nome gravado', () => {
    const ev = toEvento({ ...base, EmpresaNome: 'MOTO SUL', NaFabrica: false });
    expect(ev).toMatchObject({ fabrica: false, empresa: 'MOTO SUL' });
  });
});
