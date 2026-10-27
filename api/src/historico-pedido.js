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
// `cliente` (EmpresaId de quem vê, não admin): só o que é da conta dele (ver paraCliente).
export async function historicoDoPedido(pedidoId, { cliente = null } = {}) {
  const rows = await query(
    `SELECT h.HistoricoId, h.Tipo, h.Titulo, h.Detalhe, h.UsuarioNome, h.Referencia, h.DataEvento,
            u.EmpresaId AS EmpresaDoAutor
       FROM dbo.PedidoHistorico h
       LEFT JOIN dbo.Usuario u ON u.UsuarioId = h.UsuarioId
      WHERE h.PedidoId = @pid
      ORDER BY h.DataEvento DESC, h.HistoricoId DESC`,
    { pid: pedidoId }
  );
  const lista = rows.map(r => ({
    id: r.HistoricoId, tipo: r.Tipo, titulo: r.Titulo, detalhe: r.Detalhe || '',
    usuario: r.UsuarioNome || '', referencia: r.Referencia || '',
    data: r.DataEvento instanceof Date ? r.DataEvento.toISOString() : r.DataEvento,
    empresaDoAutor: r.EmpresaDoAutor ?? null
  }));
  return lista.map(ev => cliente == null ? semAutor(ev) : paraCliente(ev, cliente)).filter(Boolean);
}

function semAutor({ empresaDoAutor, ...ev }) { return ev; }

// Visão do revendedor: sem Tiny (exportação, falhas, avisos), sem conferência interna e sem
// quem da Fullgas fez (aparece "Fullgas"). Vale também para os registros antigos.
const RE_INTERNO = /tiny|confira se|revise no painel|identidade assumida/i;
export function paraCliente(ev, empresaId) {
  if (ev.tipo === 'tiny' || (ev.tipo === 'aviso' && RE_INTERNO.test(ev.titulo + ' ' + ev.detalhe))) return null;
  const doCliente = ev.empresaDoAutor === empresaId && !/identidade assumida/i.test(ev.usuario);
  const detalhe = ev.tipo === 'cancelado' && ev.titulo === 'Pedido cancelado' ? '' : ev.detalhe;
  return {
    ...semAutor(ev),
    detalhe: RE_INTERNO.test(detalhe) ? '' : detalhe,
    usuario: doCliente ? ev.usuario : (ev.usuario && ev.usuario !== 'Sistema' ? 'Fullgas' : ''),
    referencia: ev.tipo === 'garantia' ? ev.referencia : ''
  };
}

// "2× T4008016, 1× A1" — resumo curto das peças para o detalhe do evento.
export function resumoPecas(itens) {
  return (itens || []).map(i => `${i.qtd ?? i.quantidade}× ${i.sku}`).join(', ');
}
