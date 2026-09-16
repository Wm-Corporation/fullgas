// ============================================================
// Histórico do veículo — registro dos eventos da vida do chassi
// ------------------------------------------------------------
// Um lugar só para gravar o que acontece com uma moto: cadastro, atribuição e
// transferências entre concessionárias, venda, garantia, reivindicações,
// recalls e anotações. Quem chama não precisa saber a forma da tabela.
//
// REGRA CENTRAL: registrar o histórico NUNCA pode derrubar a ação que ele está
// registrando. Se a gravação falhar, o erro vai para o log e a venda (ou a
// transferência, ou a aprovação da garantia) segue seu curso normalmente — o
// contrário seria deixar uma funcionalidade de auditoria decidir se o negócio
// acontece. Por isso `registrarEvento` engole o próprio erro e devolve
// true/false, em vez de propagar.
// ============================================================
import { query } from './db.js';
import { FABRICA, sqlNaFabrica } from './fabrica.js';

// Tipos aceitos — espelham o CHECK da tabela (migração 033).
export const TIPOS_HISTORICO = [
  'cadastro', 'atribuicao', 'transferencia', 'venda', 'garantia',
  'reivindicacao', 'recall', 'revisao', 'nota'
];

// Tipos que uma PESSOA pode lançar pelo painel. Os demais são gravados pelo
// próprio sistema quando a ação correspondente acontece — deixar alguém
// escrever "venda registrada" à mão tornaria o histórico não confiável.
export const TIPOS_MANUAIS = ['recall', 'revisao', 'nota'];

/**
 * Grava um evento no histórico de um chassi.
 *
 * @param {object} ev
 * @param {number} ev.veiculoId   obrigatório
 * @param {string} ev.tipo        um de TIPOS_HISTORICO
 * @param {string} ev.titulo      linha principal ("Venda registrada")
 * @param {string} [ev.detalhe]   complemento livre
 * @param {object} [ev.user]      req.user — de onde saem id e e-mail
 * @param {string} [ev.usuarioNome] nome já resolvido (senão usa o e-mail)
 * @param {number} [ev.empresaId]   dono do chassi no momento; null = Fábrica
 * @param {string} [ev.empresaNome]
 * @param {string} [ev.referencia] nº da reivindicação/pedido/campanha
 * @param {boolean} [ev.manual]   lançado à mão pelo painel
 * @param {Date|string} [ev.dataEvento] quando aconteceu (padrão: agora)
 * @returns {Promise<boolean>} true se gravou
 */
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

// Resolve o VeiculoId a partir do NIV. Devolve null quando não existe —
// usado pelos pontos que só têm o número do chassi em mãos.
export async function veiculoIdPorNiv(niv) {
  const rows = await query('SELECT VeiculoId FROM dbo.Veiculo WHERE Niv = @niv', { niv });
  return rows[0]?.VeiculoId ?? null;
}

// Linha do banco → JSON do front. Evento gravado sem concessionária, ou com a
// empresa de um administrador, aconteceu na Fábrica — e é assim que aparece,
// mesmo nos registros antigos que guardaram o nome da empresa do admin.
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

// Histórico de um chassi, do mais recente para o mais antigo. Empate na data
// (backfill gravou vários eventos com o mesmo carimbo) cai no id, que preserva
// a ordem de inserção.
export async function historicoDoVeiculo(veiculoId) {
  const rows = await query(
    `SELECT h.HistoricoId, h.Tipo, h.Titulo, h.Detalhe, h.UsuarioNome, h.EmpresaNome,
            h.Referencia, h.Manual, h.DataEvento,
            ${sqlNaFabrica('h.EmpresaId')} AS NaFabrica
       FROM dbo.VeiculoHistorico h
      WHERE h.VeiculoId = @vid
      ORDER BY h.DataEvento DESC, h.HistoricoId DESC`,
    { vid: veiculoId }
  );
  return rows.map(toEvento);
}
