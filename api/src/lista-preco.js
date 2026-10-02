// ============================================================
// Listas de preço por cliente (migration 048, 02/10/2026)
// ------------------------------------------------------------
// O B2B atende mais de um tipo de revendedor. Cada tipo é uma
// "lista de preços" do Tiny com um % geral sobre o preço base:
// negativo = desconto, positivo = acréscimo (-20 = 20% off).
//
//   - dbo.ListaPreco espelha as listas do Tiny. Quem atualiza é o
//     cron (a cada rodada) e o botão "Atualizar do Tiny" do painel —
//     mudar o % de uma lista no Tiny vale para todos os clientes dela.
//   - Empresa.ListaPrecoId é escolhida pelo admin AO APROVAR o
//     cadastro (PATCH /usuarios/:id) e pode ser trocada depois
//     (PUT /empresas/:id/lista-preco). NULL = preço cheio.
//   - O cliente vê e compra pelo preço da lista; o admin vê sempre o
//     preço base (é o que ele cadastra e edita no catálogo).
//
// Só o % geral: exceções por produto da lista NÃO são lidas (decisão
// do usuário — as listas da casa não usam exceção).
// ============================================================
import { query } from './db.js';
import { listarListasPreco } from './tiny.js';

// Limites do CHECK da tabela: -100% zeraria o preço; acima de +1000% é
// quase certo erro de digitação no Tiny. Fora disso a lista é ignorada.
const PCT_MIN = -100, PCT_MAX = 1000;
export function percentualValido(p) {
  return Number.isFinite(p) && p > PCT_MIN && p <= PCT_MAX;
}

// Preço base → preço da lista, em centavos inteiros (evita 159.92000001).
export function aplicarPercentual(preco, percentual) {
  const base = Number(preco) || 0;
  const pct = Number(percentual) || 0;
  if (!pct) return base;
  return Math.max(0, Math.round(base * (100 + pct)) / 100);
}

// Lista da empresa: { id, descricao, percentual, ativa } ou null (preço cheio).
// Lista que sumiu do Tiny (ativa = false) continua valendo com o último %
// conhecido — o painel avisa, e o cliente não muda de preço de surpresa.
export async function listaDaEmpresa(empresaId) {
  if (!empresaId) return null;
  const r = (await query(
    `SELECT l.ListaPrecoId, l.Descricao, l.Percentual, l.Ativa
       FROM dbo.Empresa e
       JOIN dbo.ListaPreco l ON l.ListaPrecoId = e.ListaPrecoId
      WHERE e.EmpresaId = @eid`, { eid: empresaId }))[0];
  return r ? { id: r.ListaPrecoId, descricao: r.Descricao, percentual: Number(r.Percentual), ativa: !!r.Ativa } : null;
}

// O % que vale para quem está pedindo. Admin vê o preço base (0). Durante
// "Entrar na conta", req.user é o cliente — e o admin vê o preço DELE.
export async function percentualDoUsuario(user) {
  if (!user || user.papel === 'admin') return 0;
  return (await listaDaEmpresa(user.empresaId))?.percentual || 0;
}

// Linha do banco → formato do painel.
export function toLista(r) {
  return {
    id: r.ListaPrecoId,
    descricao: r.Descricao,
    percentual: Number(r.Percentual),
    ativa: !!r.Ativa,
    atualizadoEm: r.AtualizadoEm || null,
    empresas: r.Empresas !== undefined ? Number(r.Empresas) : undefined
  };
}

export async function listarListas() {
  const rows = await query(
    `SELECT l.ListaPrecoId, l.Descricao, l.Percentual, l.Ativa, l.AtualizadoEm,
            (SELECT COUNT(*) FROM dbo.Empresa e WHERE e.ListaPrecoId = l.ListaPrecoId) AS Empresas
       FROM dbo.ListaPreco l
      ORDER BY l.Ativa DESC, l.Percentual, l.Descricao`);
  return rows.map(toLista);
}

// Traz as listas do Tiny para dbo.ListaPreco: cria as novas, atualiza nome
// e %, e marca Ativa = 0 as que sumiram de lá. Devolve um resumo.
// Lança se o Tiny falhar — quem chama decide se isso é fatal.
export async function sincronizarListasPreco() {
  const doTiny = (await listarListasPreco()).filter(l => percentualValido(l.percentual));
  const locais = new Map((await query(
    'SELECT ListaPrecoId, Descricao, Percentual, Ativa FROM dbo.ListaPreco'
  )).map(r => [r.ListaPrecoId, r]));

  const resumo = { total: doTiny.length, novas: 0, alteradas: 0, desativadas: 0 };
  for (const l of doTiny) {
    const atual = locais.get(l.id);
    locais.delete(l.id);
    if (!atual) {
      await query(
        `INSERT INTO dbo.ListaPreco (ListaPrecoId, Descricao, Percentual) VALUES (@id, @d, @p)`,
        { id: l.id, d: l.descricao, p: l.percentual });
      resumo.novas++;
    } else if (atual.Descricao !== l.descricao || Number(atual.Percentual) !== l.percentual || !atual.Ativa) {
      await query(
        `UPDATE dbo.ListaPreco SET Descricao = @d, Percentual = @p, Ativa = 1, AtualizadoEm = SYSUTCDATETIME()
          WHERE ListaPrecoId = @id`,
        { id: l.id, d: l.descricao, p: l.percentual });
      resumo.alteradas++;
    }
  }
  // O que sobrou no mapa não existe mais no Tiny.
  for (const [id, r] of locais) {
    if (!r.Ativa) continue;
    await query(
      'UPDATE dbo.ListaPreco SET Ativa = 0, AtualizadoEm = SYSUTCDATETIME() WHERE ListaPrecoId = @id', { id });
    resumo.desativadas++;
  }
  return resumo;
}

// Valida a escolha do painel (`listaPrecoId` do corpo da requisição):
// null ou '' = preço cheio; número = lista ATIVA do espelho.
// Devolve { lista } (lista null = preço cheio) ou { erro }.
export async function resolverListaEscolhida(valor) {
  if (valor === null || valor === '') return { lista: null };
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) return { erro: 'Lista de preço inválida.' };
  const r = (await query(
    'SELECT ListaPrecoId, Descricao, Percentual, Ativa, AtualizadoEm FROM dbo.ListaPreco WHERE ListaPrecoId = @id',
    { id }))[0];
  if (!r) return { erro: 'Lista de preço não encontrada. Atualize as listas do Tiny e tente de novo.' };
  if (!r.Ativa) return { erro: 'A lista "' + r.Descricao + '" não existe mais no Tiny. Escolha outra.' };
  return { lista: toLista(r) };
}

// "Revenda A (-20%)" / "preço cheio" — para trilha de auditoria e histórico.
export function rotuloLista(l) {
  if (!l) return 'preço cheio';
  return l.descricao + ' (' + (l.percentual > 0 ? '+' : '') + l.percentual + '%)';
}
