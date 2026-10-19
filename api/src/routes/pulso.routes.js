// GET /api/pulso — batimento do portal "ao vivo" (a cada 10 s, ver frontend/js/ao-vivo.js).
// Devolve só 4 números; o front busca a lista quando algum muda.
// ultimaMensagem só cresce: pega mensagens que não mexem nos contadores.
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { VISIVEL_PARA, escopo } from './notificacoes.routes.js';
import { ladosDa, escopoSuporte } from './suporte.routes.js';

const router = Router();

router.get('/pulso', requireAuth, async (req, res, next) => {
  try {
    const lado = ladosDa(req.user);
    // Notificações: escopo por empresa. Chamados: por dono.
    const esc = escopo(req.user);

    // Não lida = não existe linha em NotificacaoLida para o usuário.
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
