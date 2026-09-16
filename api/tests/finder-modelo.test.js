// Parts Finder: código e árvore de seleção saem dos campos do modelo
// (16/09/2026).
//
// Antes, o código era digitado uma vez e nunca mais mudava, e a árvore era um
// texto livre que não acompanhava as edições. Agora os dois são derivados:
//   código = nome + ano;  árvore = Marca › Modalidade › Categoria › Nome › Ano.
//
// O db.js é substituído por um dublê: estes testes não tocam SQL Server.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugModelo, arvoreModelo } from '../src/utils/modelo-moto.js';
import { sqlEhFabrica } from '../src/fabrica.js';

let consultas = [];
let responder = () => [];

vi.mock('../src/db.js', () => ({
  query: async (sqlTexto, params = {}) => {
    consultas.push({ sql: sqlTexto, params });
    return responder(sqlTexto, params);
  },
  getPool: async () => { throw new Error('não usado nestes testes'); },
  sql: {}
}));

// auth.js se recusa a carregar sem uma chave de sessão.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';
const { default: rotas } = await import('../src/routes/finder.routes.js');

const ADMIN = { id: 1, email: 'adm@fullgas.com.br', papel: 'admin', empresaId: 1 };
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = ADMIN; next(); });
  a.use('/api', rotas);
  return a;
}

// Linha de ModeloMoto como o SELECT_MODELO devolve.
function linhaModelo(extra = {}) {
  return {
    ModeloId: 3, Codigo: 'fg125-2025', Marca: 'Fullgas', Modalidade: 'Off-road',
    Categoria: 'Enduro', Nome: 'FG 125', Ano: 2025, Etiqueta: null,
    ImagemUrl: null, DocTecnicaUrl: null, Cilindrada: '125', TipoMotor: '2 tempos', Ativo: true,
    ...extra
  };
}

beforeEach(() => { consultas = []; responder = () => []; });

describe('slugModelo (código do modelo)', () => {
  it('segue o formato dos modelos já cadastrados', () => {
    expect(slugModelo('FG 125', 2025)).toBe('fg125-2025');
    expect(slugModelo('FG 450F', 2025)).toBe('fg450f-2025');
    expect(slugModelo('FG 300', 2026)).toBe('fg300-2026');
  });

  it('tira acento e troca símbolo por hífen', () => {
    expect(slugModelo('Ênduro Pró', 2026)).toBe('enduropro-2026');
    expect(slugModelo('XC/300 + Rally', 2026)).toBe('xc-300-rally-2026');
    expect(slugModelo('  --FG 250--  ', 2024)).toBe('fg250-2024');
  });

  it('nome sem letra nem número não gera código', () => {
    expect(slugModelo('', 2025)).toBe('');
    expect(slugModelo('  ***  ', 2025)).toBe('');
  });

  it('cabe na coluna (40) e não termina em hífen antes do ano', () => {
    const c = slugModelo('A'.repeat(33) + ' / ' + 'B'.repeat(30), 2025);
    expect(c.length).toBeLessThanOrEqual(40);
    expect(c).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]-2025$/);
    expect(c).not.toMatch(/--/);
  });

  it('a cópia do admin.js (prévia do modal) dá o mesmo resultado', () => {
    const raiz = path.dirname(fileURLToPath(import.meta.url));
    const admin = fs.readFileSync(path.join(raiz, '..', '..', 'frontend', 'js', 'admin.js'), 'utf-8');
    const trecho = admin.match(/function slugModelo\(nome, ano\) \{[\s\S]*?\n  \}/);
    expect(trecho, 'slugModelo sumiu do admin.js').not.toBeNull();
    const slugFront = new Function(trecho[0] + '; return slugModelo;')();
    for (const [nome, ano] of [['FG 125', 2025], ['Ênduro Pró', 2026], ['XC/300 + Rally', 2026],
      ['', 2025], ['A'.repeat(33) + ' / ' + 'B'.repeat(30), 2025], ['  --FG 250--  ', '2024']]) {
      expect(slugFront(nome, ano)).toBe(slugModelo(nome, ano));
    }
  });
});

describe('arvoreModelo', () => {
  it('Marca › Modalidade › Categoria › Nome › Ano — sem cilindrada nem tipo de motor', () => {
    expect(arvoreModelo({
      marca: 'Fullgas', modalidade: 'Off-road', categoria: 'Enduro', nome: 'FG 125', ano: 2025,
      cilindrada: '125', tipoMotor: '2 tempos'
    })).toEqual(['Fullgas', 'Off-road', 'Enduro', 'FG 125', '2025']);
  });

  it('nível vazio fica de fora', () => {
    expect(arvoreModelo({ marca: 'Fullgas', modalidade: 'Off-road', categoria: null, nome: 'FG 125', ano: 2025 }))
      .toEqual(['Fullgas', 'Off-road', 'FG 125', '2025']);
  });
});

describe('sqlEhFabrica', () => {
  it('recusa coluna sem apelido (viraria "toda empresa é Fábrica")', () => {
    expect(() => sqlEhFabrica('EmpresaId')).toThrow(/apelido/);
    expect(sqlEhFabrica('e.EmpresaId')).toContain('fab_u.EmpresaId = e.EmpresaId');
  });
});

describe('GET /api/finder/modelos', () => {
  it('a árvore sai dos campos, não da coluna Arvore antiga', async () => {
    responder = () => [linhaModelo({ Arvore: 'Fullgas > Offroad > Enduro > E1 > 2 tempos > FG 125 > FG 125 2025' })];
    const r = await request(app()).get('/api/finder/modelos');
    expect(r.body[0].arvore).toEqual(['Fullgas', 'Off-road', 'Enduro', 'FG 125', '2025']);
    expect(r.body[0]).toMatchObject({ marca: 'Fullgas', modalidade: 'Off-road', categoria: 'Enduro' });
    expect(consultas[0].sql).not.toMatch(/Arvore/);
  });
});

describe('POST /api/finder/modelos', () => {
  const corpo = { nome: 'FG 250', ano: 2026, categoria: 'Cross-country' };

  it('gera o código do nome e do ano (ignora código enviado) e aplica marca/modalidade padrão', async () => {
    responder = (s) => (/WHERE ModeloId = @id/.test(s)
      ? [linhaModelo({ Codigo: 'fg250-2026', Nome: 'FG 250', Ano: 2026, Categoria: 'Cross-country' })]
      : /OUTPUT inserted\.ModeloId/.test(s) ? [{ ModeloId: 9 }] : []);
    const r = await request(app()).post('/api/finder/modelos').send({ ...corpo, codigo: 'qualquer-coisa' });
    expect(r.status).toBe(201);
    const ins = consultas.find(c => /INSERT INTO dbo\.ModeloMoto/.test(c.sql));
    expect(ins.params).toMatchObject({ cod: 'fg250-2026', marca: 'Fullgas', modal: 'Off-road', cat: 'Cross-country' });
    expect(ins.sql).not.toMatch(/Arvore/);
    expect(r.body.id).toBe('fg250-2026');
  });

  it('exige categoria — é o nível que separa os modelos no finder', async () => {
    const r = await request(app()).post('/api/finder/modelos').send({ nome: 'FG 250', ano: 2026 });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/categoria/i);
  });

  it('mesmo nome e ano de outro modelo é conflito', async () => {
    responder = (s) => (/WHERE Codigo = @cod AND ModeloId <> @id/.test(s) ? [{ Nome: 'FG 250', Ano: 2026 }] : []);
    const r = await request(app()).post('/api/finder/modelos').send(corpo);
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/fg250-2026/);
    expect(consultas.some(c => /INSERT INTO dbo\.ModeloMoto/.test(c.sql))).toBe(false);
  });
});

describe('PUT /api/finder/modelos/:codigo', () => {
  it('renomear o modelo troca o código e devolve o novo', async () => {
    let salvo = false;
    responder = (s) => {
      if (/UPDATE dbo\.ModeloMoto/.test(s)) { salvo = true; return []; }
      if (/WHERE Codigo = @cod AND ModeloId <> @id/.test(s)) return [];
      if (/WHERE Codigo = @cod/.test(s)) return [linhaModelo()];
      if (/WHERE ModeloId = @id/.test(s)) {
        return [salvo ? linhaModelo({ Codigo: 'fg125r-2025', Nome: 'FG 125R', Categoria: 'Cross-country' }) : linhaModelo()];
      }
      return [];
    };
    const r = await request(app()).put('/api/finder/modelos/fg125-2025')
      .send({ nome: 'FG 125R', ano: 2025, categoria: 'Cross-country', marca: 'Fullgas', modalidade: 'Off-road' });
    expect(r.status).toBe(200);
    const upd = consultas.find(c => /UPDATE dbo\.ModeloMoto/.test(c.sql));
    expect(upd.sql).toMatch(/Codigo=@cod/);
    expect(upd.params).toMatchObject({ cod: 'fg125r-2025', cat: 'Cross-country', id: 3 });
    expect(r.body.id).toBe('fg125r-2025');
    expect(r.body.arvore).toEqual(['Fullgas', 'Off-road', 'Cross-country', 'FG 125R', '2025']);
  });

  it('manter nome e ano não é conflito com o próprio modelo', async () => {
    responder = (s) => {
      if (/WHERE Codigo = @cod AND ModeloId <> @id/.test(s)) return [];
      if (/WHERE Codigo = @cod|WHERE ModeloId = @id/.test(s)) return [linhaModelo()];
      return [];
    };
    const r = await request(app()).put('/api/finder/modelos/fg125-2025')
      .send({ nome: 'FG 125', ano: 2025, categoria: 'Enduro' });
    expect(r.status).toBe(200);
    const conf = consultas.find(c => /ModeloId <> @id/.test(c.sql));
    expect(conf.params).toEqual({ cod: 'fg125-2025', id: 3 });
  });

  it('não deixa renomear para o nome e ano de outro modelo', async () => {
    responder = (s) => {
      if (/WHERE Codigo = @cod AND ModeloId <> @id/.test(s)) return [{ Nome: 'FG 300', Ano: 2026 }];
      if (/WHERE Codigo = @cod/.test(s)) return [linhaModelo()];
      return [];
    };
    const r = await request(app()).put('/api/finder/modelos/fg125-2025')
      .send({ nome: 'FG 300', ano: 2026, categoria: 'Enduro' });
    expect(r.status).toBe(409);
    expect(consultas.some(c => /UPDATE dbo\.ModeloMoto/.test(c.sql))).toBe(false);
  });
});
