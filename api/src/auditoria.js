// Trilha de auditoria das ações privilegiadas (migration 038).
// Regra: auditar NUNCA derruba a operação auditada; a falha só vai para o log.
import { query } from './db.js';

// Vocabulário fechado de ações, para a tabela poder ser consultada depois.
export const ACOES = {
  IMPERSONAR_INICIO: 'impersonar_inicio',
  IMPERSONAR_FIM: 'impersonar_fim',
  ADMIN_CRIADO: 'admin_criado',
  PAPEL_ALTERADO: 'papel_alterado',
  STATUS_ALTERADO: 'status_alterado',
  USUARIO_EXCLUIDO: 'usuario_excluido',
  // Preço que a concessionária paga (migration 048).
  LISTA_PRECO_ALTERADA: 'lista_preco_alterada'
};

// Grava uma linha na trilha. Pode ser chamada sem await.
export async function auditar({
  req, acao, alvoId = null, alvoEmail = null, alvoEmpresaId = null, detalhe = null
}) {
  try {
    // Quem agiu vem da sessão, nunca do corpo. Em identidade assumida, o autor é o admin (imp).
    const adminId = req?.user?.imp ?? req?.user?.id ?? null;
    const adminEmail = req?.user?.imp ? null : (req?.user?.email ?? null);

    await query(
      `INSERT INTO dbo.AuditoriaAcesso
         (AdminId, AdminEmail, AlvoUsuarioId, AlvoEmail, AlvoEmpresaId, Acao, DetalheJson, Ip)
       VALUES (@adminId, @adminEmail, @alvoId, @alvoEmail, @alvoEmpresaId, @acao, @detalhe, @ip)`,
      {
        adminId, adminEmail, alvoId, alvoEmail, alvoEmpresaId,
        acao,
        detalhe: detalhe ? JSON.stringify(detalhe).slice(0, 4000) : null,
        // req.ip já é o IP real (trust proxy + Nginx).
        ip: (req?.ip || '').slice(0, 64) || null
      }
    );
  } catch (e) {
    console.error(`⚠ Falha ao gravar auditoria (${acao}):`, e.message);
  }
}
