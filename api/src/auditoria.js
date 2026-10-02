// ============================================================
// Trilha de auditoria das ações privilegiadas (migration 038).
// ------------------------------------------------------------
// Antes disto, o único registro de um admin assumir a identidade de um
// cliente era um console.log. Existia enquanto o journald guardasse, sumia na
// rotação e não dava para consultar. Para uma ação em que um funcionário da
// Fullgas passa a operar a conta de um revendedor — e em que TODO o dado de
// negócio gerado fica gravado no nome do revendedor —, isso é pouco: nem
// serve para investigar ("quem mexeu neste pedido?"), nem para proteger o
// admin de uma acusação injusta.
//
// REGRA DE OURO DESTE MÓDULO: auditar NUNCA derruba a operação auditada.
// Se o INSERT falhar, o erro vai para o log e a requisição segue. O contrário
// — deixar uma falha de escrita na trilha impedir o admin de trabalhar —
// transformaria a auditoria numa fonte de indisponibilidade, e a primeira
// reação de quem estivesse de plantão seria arrancá-la fora.
// ============================================================
import { query } from './db.js';

// Vocabulário fechado. Manter aqui (e não espalhado em strings pelas rotas)
// é o que permite consultar a tabela depois sem adivinhar como cada evento
// foi escrito.
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

// Grava uma linha na trilha. NÃO devolve promessa que valha a pena aguardar
// no caminho crítico — chame sem await quando a resposta ao usuário não
// depende disto (é o caso de todos os usos atuais).
export async function auditar({
  req, acao, alvoId = null, alvoEmail = null, alvoEmpresaId = null, detalhe = null
}) {
  try {
    // Quem agiu vem SEMPRE da sessão, nunca do corpo da requisição — senão a
    // própria trilha viraria um campo que o cliente escolhe.
    //
    // Durante uma impersonação, req.user é o ALVO e req.user.imp é o admin de
    // verdade. Preferir o `imp` é o que impede a trilha de registrar o cliente
    // como autor das ações do admin — exatamente o problema que ela existe
    // para resolver.
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
        // req.ip já é o IP real do cliente: o Express resolve pelo
        // `trust proxy` e o Nginx traduz o CF-Connecting-IP da Cloudflare.
        ip: (req?.ip || '').slice(0, 64) || null
      }
    );
  } catch (e) {
    console.error(`⚠ Falha ao gravar auditoria (${acao}):`, e.message);
  }
}
