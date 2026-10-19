// Histórico do veículo: cadastro, transferências, venda, garantia, recalls e notas.
// Regra: registrar NUNCA derruba a ação registrada (erro vai para o log).
import { query } from './db.js';
import { FABRICA, sqlNaFabrica } from './fabrica.js';

// Tipos aceitos — espelham o CHECK da tabela (migração 033).
export const TIPOS_HISTORICO = [
  'cadastro', 'atribuicao', 'transferencia', 'venda', 'garantia',
  'reivindicacao', 'recall', 'revisao', 'nota'
];

// Tipos que uma pessoa pode lançar à mão pelo painel.
export const TIPOS_MANUAIS = ['recall', 'revisao', 'nota'];

// Grava um evento no histórico do chassi. Devolve true se gravou.
export async function registrarEvento(ev) {
  try {
    if (!ev?.veiculoId || !TIPOS_HISTORICO.includes(ev.tipo) || !ev.titulo) {
      console.warn('⚠ Histórico do veículo ignorado — evento incompleto:', JSON.stringify(ev));
      return false;
    }
    await query(
      `INSERT INTO dbo.VeiculoHistorico
         (VeiculoId, Tipo, Titulo, Detalhe, UsuarioId, UsuarioNome,
          EmpresaId, EmpresaNome, Referencia, Manual, DataEvento)
       VALUES (@vid, @tipo, @titulo, @detalhe, @uid, @unome,
               @eid, @enome, @ref, @manual, COALESCE(@data, SYSUTCDATETIME()))`,
      {
        vid: ev.veiculoId,
        tipo: ev.tipo,
        titulo: String(ev.titulo).slice(0, 160),
        detalhe: ev.detalhe ? String(ev.detalhe).slice(0, 1000) : null,
        uid: ev.user?.id ?? null,
        unome: (ev.usuarioNome || ev.user?.email || '').slice(0, 120) || null,
        eid: ev.empresaId ?? null,
        enome: ev.empresaNome ? String(ev.empresaNome).slice(0, 160) : null,
        ref: ev.referencia ? String(ev.referencia).slice(0, 40) : null,
        manual: ev.manual ? 1 : 0,
        data: ev.dataEvento ?? null
      }
    );
    return true;
  } catch (e) {
    // Ver o comentário do topo: falha aqui não pode virar falha da operação.
    console.error('✗ Não foi possível gravar o histórico do veículo:', e.message);
    return false;
  }
}

// VeiculoId a partir do NIV (null se não existe).
export async function veiculoIdPorNiv(niv) {
  const rows = await query('SELECT VeiculoId FROM dbo.Veiculo WHERE Niv = @niv', { niv });
  return rows[0]?.VeiculoId ?? null;
}

// Linha do banco → JSON do front. Sem empresa ou empresa de admin = Fábrica.
export function toEvento(r) {
  const fabrica = !!r.NaFabrica;
  return {
    id: r.HistoricoId,
    tipo: r.Tipo,
    titulo: r.Titulo,
    detalhe: r.Detalhe || '',
    usuario: r.UsuarioNome || '',
    fabrica,
    empresa: fabrica ? FABRICA : (r.EmpresaNome || ''),
    referencia: r.Referencia || '',
    manual: !!r.Manual,
    data: r.DataEvento
  };
}

// Histórico do chassi, do mais recente ao mais antigo.
// Para outra concessionária, o detalhe da venda (dados do comprador) sai vazio.
export async function historicoDoVeiculo(veiculoId, user) {
  const rows = await query(
    `SELECT h.HistoricoId, h.Tipo, h.Titulo, h.Detalhe, h.UsuarioNome, h.EmpresaNome,
            h.Referencia, h.Manual, h.DataEvento, h.EmpresaId,
            ${sqlNaFabrica('h.EmpresaId')} AS NaFabrica
       FROM dbo.VeiculoHistorico h
      WHERE h.VeiculoId = @vid
      ORDER BY h.DataEvento DESC, h.HistoricoId DESC`,
    { vid: veiculoId }
  );
  const restrito = user && user.papel !== 'admin';
  return rows.map(r => {
    const ev = toEvento(r);
    if (restrito && r.Tipo === 'venda' && r.EmpresaId !== user.empresaId) ev.detalhe = '';
    return ev;
  });
}
