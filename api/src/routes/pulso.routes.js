// ============================================================
// GET /api/pulso — o batimento que deixa o portal "ao vivo"
// ------------------------------------------------------------
// O front pergunta por esta rota a cada 10 segundos (ver frontend/js/ao-vivo.js)
// só para saber se ALGUMA COISA mudou. Antes dela, a única forma de o
// revendedor descobrir que o suporte havia respondido era recarregar a página:
// a carta ✉️ do topo e o badge 🎧 do pop-up eram calculados uma vez, na
// abertura, e ficavam parados.
//
// O que ela devolve é DELIBERADAMENTE minúsculo — quatro números:
//
//   notificacoes      não lidas na caixa ✉️ de quem perguntou
//   suporteAbertos    chamados ainda em andamento
//   suporteNaoLidas   mensagens do outro lado ainda não vistas (badge 🎧)
//   ultimaMensagem    maior MensagemId que este usuário alcança
//
// Por que quatro números e não a lista inteira: esta é a requisição mais
// frequente do sistema (uma a cada 10s por aba aberta). Se ela trouxesse as
// notificações e os chamados, o portal estaria baixando o mesmo conteúdo 360
// vezes por hora para descobrir que nada mudou. Aqui o corpo tem ~80 bytes e
// tudo cabe em UMA ida ao banco; a lista só é buscada QUANDO um dos números
// se mexe.
//
// `ultimaMensagem` existe porque os contadores não bastam: uma mudança de
// status entra na conversa como mensagem do 'sistema', e uma mensagem que o
// próprio usuário mandou de outra aba já nasce lida. Nos dois casos os
// contadores não mexem, mas o fio da conversa mudou — e a tela aberta precisa
// saber. Ele é um NÚMERO QUE SÓ CRESCE: o front guarda o anterior e compara.
//
// Nenhuma condição de visibilidade é reescrita aqui. VISIVEL_PARA, escopo e
// ladosDa são importados de quem já é dono deles; um contador que discordasse
// da tela que ele anuncia seria pior do que não ter contador.
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { VISIVEL_PARA, escopo } from './notificacoes.routes.js';
import { ladosDa, escopoSuporte } from './suporte.routes.js';

const router = Router();

router.get('/pulso', requireAuth, async (req, res, next) => {
  try {
    const lado = ladosDa(req.user);
    // O escopo das NOTIFICAÇÕES é por empresa (@eid); o dos CHAMADOS é por
    // dono (@dono, de escopoSuporte) — um chamado é da pessoa que o abriu, não
    // da concessionária dela. São dois recortes diferentes e cada consulta usa
    // o seu.
    const esc = escopo(req.user);

    // Não lida = NÃO EXISTE linha em NotificacaoLida para este usuário. É como
    // o PATCH .../lida trabalha (marcar insere a linha, desmarcar a APAGA), e
    // não como um LEFT JOIN em LidaEm faria supor.
    const rows = await query(
      `SELECT
         (SELECT COUNT(*)
            FROM dbo.Notificacao n
           WHERE ${VISIVEL_PARA}
             AND NOT EXISTS (SELECT 1 FROM dbo.NotificacaoLida l
                              WHERE l.NotificacaoId = n.NotificacaoId
                                AND l.UsuarioId = @uid)) AS Notificacoes,

         (SELECT COUNT(*) FROM dbo.SuporteChamado c
           WHERE (@dono IS NULL OR c.UsuarioId = @dono)
             AND c.Status NOT IN ('Resolvido', 'Fechado')) AS Abertos,

         (SELECT COUNT(*) FROM dbo.SuporteMensagem m
            JOIN dbo.SuporteChamado c ON c.ChamadoId = m.ChamadoId
           WHERE (@dono IS NULL OR c.UsuarioId = @dono)
             AND m.Autor <> '${lado.eu}'
             AND m.${lado.colunaLida} IS NULL) AS NaoLidas,

         (SELECT MAX(m.MensagemId) FROM dbo.SuporteMensagem m
            JOIN dbo.SuporteChamado c ON c.ChamadoId = m.ChamadoId
           WHERE (@dono IS NULL OR c.UsuarioId = @dono)) AS UltimaMensagem`,
      { uid: req.user.id, ...esc, ...escopoSuporte(req.user) }
    );

    const r = rows[0] || {};
    res.json({
      notificacoes: Number(r.Notificacoes || 0),
      suporteAbertos: Number(r.Abertos || 0),
      suporteNaoLidas: Number(r.NaoLidas || 0),
      ultimaMensagem: Number(r.UltimaMensagem || 0)
    });
  } catch (e) { next(e); }
});

export default router;
