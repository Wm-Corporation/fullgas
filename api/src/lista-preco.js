// Listas de preço por cliente (migrations 048/049).
// Cada lista do Tiny é um % sobre o preço base (-20 = 20% off). A lista da empresa vem do contato
// no Tiny; sem lista lá, o admin escolhe uma manualmente. Cliente vê o preço da lista; admin, o base.
import { query } from './db.js';
import { listarListasPreco, registrarLog } from './tiny.js';

// Fora desta faixa a lista é ignorada (provável erro de digitação no Tiny).
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

// Lista da empresa ({ id, descricao, percentual, ativa, origem }) ou null = preço cheio.
export async function listaDaEmpresa(empresaId) {
  if (!empresaId) return null;
  const r = (await query(
    `SELECT l.ListaPrecoId, l.Descricao, l.Percentual, l.Ativa, e.ListaPrecoOrigem
       FROM dbo.Empresa e
       JOIN dbo.ListaPreco l ON l.ListaPrecoId = e.ListaPrecoId
      WHERE e.EmpresaId = @eid`, { eid: empresaId }))[0];
  return r ? {
    id: r.ListaPrecoId, descricao: r.Descricao, percentual: Number(r.Percentual),
    ativa: !!r.Ativa, origem: r.ListaPrecoOrigem || 'manual'
  } : null;
}

// % de quem está pedindo. Admin = 0; em "Entrar na conta" vale o % do cliente.
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

// Espelha as listas do Tiny em dbo.ListaPreco. Lança se o Tiny falhar.
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

// Valida a lista escolhida no painel (precisa estar ativa). Devolve { lista } ou { erro }.
export async function resolverListaEscolhida(valor) {
  if (valor === null || valor === undefined || valor === '')
    return { erro: 'Escolha uma das listas de preço do Tiny.' };
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

// Aplica na empresa a lista do contato no Tiny.
// Devolve 'aplicada' | 'igual' | 'sem-lista' (nada muda) | 'desconhecida'.
export async function aplicarListaDoTiny(empresaId, idListaTiny, contatoId = null) {
  const id = Number(idListaTiny);
  if (!Number.isInteger(id) || id <= 0) return 'sem-lista';

  const buscar = async () => (await query(
    'SELECT ListaPrecoId, Descricao, Percentual, Ativa FROM dbo.ListaPreco WHERE ListaPrecoId = @id', { id }))[0];
  let lista = await buscar();
  if (!lista || !lista.Ativa) {
    try { await sincronizarListasPreco(); lista = await buscar(); }
    catch { /* Tiny fora: decide com o que o espelho tem */ }
  }
  if (!lista || !lista.Ativa) {
    await registrarLog(contatoId, null, 'contato', 'erro',
      `Empresa ${empresaId}: o contato no Tiny usa a lista de preço ${id}, que não foi encontrada.`);
    return 'desconhecida';
  }

  const emp = (await query(
    'SELECT RazaoSocial, ListaPrecoId, ListaPrecoOrigem FROM dbo.Empresa WHERE EmpresaId = @eid',
    { eid: empresaId }))[0];
  if (!emp) return 'desconhecida';
  if (emp.ListaPrecoId === id && emp.ListaPrecoOrigem === 'tiny') return 'igual';

  await query(
    `UPDATE dbo.Empresa SET ListaPrecoId = @lid, ListaPrecoOrigem = 'tiny', AtualizadoEm = SYSUTCDATETIME()
      WHERE EmpresaId = @eid`, { eid: empresaId, lid: id });
  await registrarLog(contatoId, null, 'contato', 'ok',
    `Empresa "${emp.RazaoSocial}": lista de preço "${lista.Descricao}" (${Number(lista.Percentual)}%) ` +
    'aplicada a partir do contato no Tiny.');
  return 'aplicada';
}
