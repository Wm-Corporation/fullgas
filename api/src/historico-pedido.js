// Histórico do pedido: compra, Tiny, envios, entregas, cancelamento e reivindicações.
// Regra: registrar NUNCA derruba a ação registrada.
import { query } from './db.js';

// Espelham o CHECK da tabela (migration 047).
export const TIPOS_PEDIDO = ['criado', 'aprovado', 'tiny', 'envio', 'entregue', 'cancelado', 'garantia', 'aviso'];

// Grava um evento no histórico do pedido (por pedidoId ou numeroPedido). Nunca lança.
export async function registrarEventoPedido(ev) {
  try {
    if ((!ev?.pedidoId && !ev?.numeroPedido) || !TIPOS_PEDIDO.includes(ev.tipo) || !ev.titulo) {
      console.warn('⚠ Histórico do pedido ignorado — evento incompleto:', JSON.stringify(ev));
      return false;
    }
    await query(
      `INSERT INTO dbo.PedidoHistorico (PedidoId, Tipo, Titulo, Detalhe, UsuarioId, UsuarioNome, Referencia)
       SELECT p.PedidoId, @tipo, @titulo, @detalhe, @uid, @unome, @ref
         FROM dbo.Pedido p
        WHERE (@pid IS NOT NULL AND p.PedidoId = @pid) OR (@pid IS NULL AND p.NumeroPedido = @num)`,
      {
        pid: ev.pedidoId ?? null,
        num: ev.numeroPedido ?? null,
        tipo: ev.tipo,
        titulo: String(ev.titulo).slice(0, 200),
        detalhe: ev.detalhe ? String(ev.detalhe).slice(0, 1000) : null,
        uid: ev.user?.id ?? null,
        // Ação de admin em identidade assumida sai marcada.
        unome: ev.user
          ? (String(ev.user.email || '') + (ev.user.imp ? ' (Fullgas, identidade assumida)' : '')).slice(0, 160)
          : 'Sistema',
        ref: ev.referencia ? String(ev.referencia).slice(0, 40) : null
      }
    );
    return true;
  } catch (e) {
    console.error('✗ Não foi possível gravar o histórico do pedido:', e.message);
    return false;
  }
}

// Linha do tempo de um pedido, do mais recente para o mais antigo.
export async function historicoDoPedido(pedidoId) {
  const rows = await query(
    `SELECT HistoricoId, Tipo, Titulo, Detalhe, UsuarioNome, Referencia, DataEvento
       FROM dbo.PedidoHistorico
      WHERE PedidoId = @pid
      ORDER BY DataEvento DESC, HistoricoId DESC`,
    { pid: pedidoId }
  );
  return rows.map(r => ({
    id: r.HistoricoId, tipo: r.Tipo, titulo: r.Titulo, detalhe: r.Detalhe || '',
    usuario: r.UsuarioNome || '', referencia: r.Referencia || '',
    data: r.DataEvento instanceof Date ? r.DataEvento.toISOString() : r.DataEvento
  }));
}

// "2× T4008016, 1× A1" — resumo curto das peças para o detalhe do evento.
export function resumoPecas(itens) {
  return (itens || []).map(i => `${i.qtd ?? i.quantidade}× ${i.sku}`).join(', ');
}
