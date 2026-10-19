// Notificações geradas pelo sistema (as manuais ficam em routes/notificacoes.routes.js).
// Regra: notificar NUNCA derruba a ação notificada.
import { query } from './db.js';

// Limites das colunas (migration 024).
const MAX_TITULO = 160;
const MAX_TEXTO = 2000;

// Grava uma notificação automática. Vai sempre para o lado oposto de quem escreveu.
// publico: 'cliente' | 'admin'. Devolve true se gravou.
export async function criarNotificacao(n) {
  try {
    const titulo = String(n.titulo || '').trim().slice(0, MAX_TITULO) || '(sem título)';
    const texto = String(n.texto || '').trim().slice(0, MAX_TEXTO) || null;
    const publico = n.publico === 'admin' ? 'admin' : 'cliente';

    await query(
      `INSERT INTO dbo.Notificacao
         (EmpresaId, Titulo, Texto, Tipo, CriadoPor, Publico, Origem, ChamadoId)
       VALUES (@eid, @titulo, @texto, @tipo, @uid, @publico, 'suporte', @cid)`,
      {
        eid: n.empresaId || null,
        titulo,
        texto,
        tipo: n.tipo === 'critica' ? 'critica' : 'info',
        uid: n.criadoPor || null,
        publico,
        cid: n.chamadoId || null
      }
    );
    return true;
  } catch (e) {
    console.error('Falha ao criar notificação (a ação principal seguiu):', e.message);
    return false;
  }
}

// Marca como lidas, para um usuário, as notificações de um chamado (ao abrir o chamado).
export async function marcarNotificacoesDoChamadoLidas(chamadoId, publico, usuarioId) {
  try {
    await query(
      `INSERT INTO dbo.NotificacaoLida (NotificacaoId, UsuarioId)
       SELECT n.NotificacaoId, @uid
         FROM dbo.Notificacao n
        WHERE n.ChamadoId = @cid
          AND n.Publico = @publico
          AND NOT EXISTS (SELECT 1 FROM dbo.NotificacaoLida l
                           WHERE l.NotificacaoId = n.NotificacaoId AND l.UsuarioId = @uid)`,
      { cid: chamadoId, publico: publico === 'admin' ? 'admin' : 'cliente', uid: usuarioId }
    );
    return true;
  } catch (e) {
    console.error('Falha ao marcar notificações do chamado como lidas:', e.message);
    return false;
  }
}
