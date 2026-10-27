// ---- Notificações (admin → concessionárias) ----
//   GET    /notificacoes            caixa de quem pediu
//   POST   /notificacoes            admin envia (multipart, anexo opcional)
//   PATCH  /notificacoes/:id/lida   lida/não lida, por usuário
//   DELETE /notificacoes/:id        admin apaga (e o anexo)
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { EXT_IMAGEM, EXT_VIDEO, EXT_DOCUMENTO, nomeArquivo, filtroAnexo } from '../middlewares/upload-comum.js';

const router = Router();

// ---- Upload do anexo (multer → disco) --------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const NOTIF_DIR = path.join(UPLOADS_ROOT, 'notificacoes');
fs.mkdirSync(NOTIF_DIR, { recursive: true });
const URL_BASE = '/uploads/notificacoes/';

const EXT_ANEXO = [...EXT_IMAGEM, ...EXT_VIDEO, ...EXT_DOCUMENTO];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, NOTIF_DIR),
  filename: (_req, file, cb) => cb(null, nomeArquivo(file, EXT_ANEXO))
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },  // 60 MB (vídeos curtos)
  // Antes NÃO havia filtro nenhum aqui: qualquer tipo de arquivo entrava.
  fileFilter: filtroAnexo()
});

// Wrapper: erros do multer viram 400 com mensagem clara. O anexo é OPCIONAL.
function uploadAnexo(req, res, next) {
  upload.single('anexo')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Arquivo muito grande (máximo 60 MB).'
        : (err.message || 'Falha no upload.');
      return res.status(400).json({ erro: msg });
    }
    next();
  });
}

// Classifica o anexo para o front saber como exibir.
function tipoAnexo(file) {
  const mime = file.mimetype || '';
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  return 'arquivo';
}

// Apaga do disco um anexo por URL relativa (só dentro de /uploads).
function apagarAnexo(rel) {
  if (!rel || !String(rel).startsWith('/uploads/')) return;
  const abs = path.resolve(UPLOADS_ROOT, String(rel).replace(/^\/uploads\//, ''));
  if (!abs.startsWith(path.resolve(UPLOADS_ROOT))) return;
  try { fs.unlinkSync(abs); } catch { /* já não existe */ }
}

// URL relativa → absoluta (o front pode rodar em outra origem que a API).
function urlAbs(req, rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

function toNotif(req, r) {
  return {
    id: r.NotificacaoId,
    titulo: r.Titulo,
    texto: r.Texto || '',
    tipo: r.Tipo,                                  // 'info' | 'critica'
    data: r.CriadoEm,
    lida: !!r.LidaEm,
    anexo: urlAbs(req, r.AnexoUrl),
    anexoTipo: r.AnexoTipo || null,
    empresaId: r.EmpresaId || null,
    empresa: r.EmpresaNome || null,                // null = todas
    origem: r.Origem || 'admin',                   // 'admin' (à mão) | 'suporte' | 'blackorder'
    chamadoId: r.ChamadoId || null,                // preenchido: veio de um chamado
    link: r.Link || null                           // rota do portal (ex.: carrinho da black order)
  };
}

// Quem vê o quê: cliente vê o que é para cliente (geral ou da empresa);
// admin vê o que é para o suporte e o que ele mesmo escreveu.
// Usada também pelo /api/pulso, para o contador bater com a caixa.
export const VISIVEL_PARA = `(
  (@admin = 1 AND (n.Publico = 'admin' OR n.Origem = 'admin'))
  OR
  (@admin = 0 AND n.Publico = 'cliente' AND (n.EmpresaId IS NULL OR n.EmpresaId = @eid)
   AND (n.ChamadoId IS NULL
        OR EXISTS (SELECT 1 FROM dbo.SuporteChamado c
                    WHERE c.ChamadoId = n.ChamadoId AND c.UsuarioId = @uid)))
)`;

// Aviso de chamado só vai para o dono do chamado (leva prévia da conversa).

// Parâmetros que a condição acima exige.
export function escopo(user) {
  const admin = user.papel === 'admin';
  return { admin: admin ? 1 : 0, eid: admin ? null : user.empresaId, uid: user.id };
}

// GET /api/notificacoes — `lida` é por usuário.
router.get('/notificacoes', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT n.NotificacaoId, n.EmpresaId, n.Titulo, n.Texto, n.Tipo,
              n.AnexoUrl, n.AnexoTipo, n.CriadoEm, n.Origem, n.ChamadoId, n.Link,
              e.RazaoSocial AS EmpresaNome, l.LidaEm
         FROM dbo.Notificacao n
         LEFT JOIN dbo.Empresa e ON e.EmpresaId = n.EmpresaId
         LEFT JOIN dbo.NotificacaoLida l
           ON l.NotificacaoId = n.NotificacaoId AND l.UsuarioId = @uid
        WHERE ${VISIVEL_PARA}
        ORDER BY n.CriadoEm DESC`,
      { uid: req.user.id, ...escopo(req.user) }
    );
    res.json(rows.map(r => toNotif(req, r)));
  } catch (e) { next(e); }
});

// POST /api/notificacoes (admin) — multipart: titulo*, texto, tipo, empresaId (vazio = todas), anexo
router.post('/notificacoes', requireAuth, requireAdmin, uploadAnexo, async (req, res, next) => {
  try {
    const titulo = String(req.body?.titulo || '').trim().slice(0, 160);
    const texto = String(req.body?.texto || '').trim().slice(0, 2000);
    const tipo = req.body?.tipo === 'critica' ? 'critica' : 'info';
    const empresaId = req.body?.empresaId ? Number(req.body.empresaId) : null;

    if (!titulo && !texto && !req.file) {
      if (req.file) apagarAnexo(URL_BASE + req.file.filename);
      return res.status(400).json({ erro: 'Escreva a mensagem (ou anexe um arquivo).' });
    }
    if (empresaId) {
      const emp = (await query(
        'SELECT 1 FROM dbo.Empresa WHERE EmpresaId = @eid AND Ativo = 1', { eid: empresaId })).length;
      if (!emp) {
        if (req.file) apagarAnexo(URL_BASE + req.file.filename);
        return res.status(400).json({ erro: 'Concessionária não encontrada.' });
      }
    }

    const anexoUrl = req.file ? URL_BASE + req.file.filename : null;
    const rows = await query(
      `INSERT INTO dbo.Notificacao (EmpresaId, Titulo, Texto, Tipo, AnexoUrl, AnexoTipo, CriadoPor)
       OUTPUT INSERTED.NotificacaoId
       VALUES (@eid, @titulo, @texto, @tipo, @anexo, @anexoTipo, @uid)`,
      {
        eid: empresaId,
        titulo: titulo || '(sem título)',
        texto: texto || null,
        tipo,
        anexo: anexoUrl,
        anexoTipo: req.file ? tipoAnexo(req.file) : null,
        uid: req.user.id
      }
    );
    res.status(201).json({ sucesso: true, id: rows[0].NotificacaoId });
  } catch (e) { next(e); }
});

// POST /api/notificacoes/lidas — abriu a caixa: marca como lidas todas as que este usuário vê.
router.post('/notificacoes/lidas', requireAuth, async (req, res, next) => {
  try {
    const r = await query(
      `INSERT INTO dbo.NotificacaoLida (NotificacaoId, UsuarioId)
       OUTPUT inserted.NotificacaoId
       SELECT n.NotificacaoId, @uid
         FROM dbo.Notificacao n
        WHERE ${VISIVEL_PARA}
          AND NOT EXISTS (SELECT 1 FROM dbo.NotificacaoLida l
                           WHERE l.NotificacaoId = n.NotificacaoId AND l.UsuarioId = @uid)`,
      { uid: req.user.id, ...escopo(req.user) }
    );
    res.json({ ok: true, marcadas: r.length });
  } catch (e) { next(e); }
});

// PATCH /api/notificacoes/:id/lida  { lida: true|false } — estado por usuário.
router.patch('/notificacoes/:id/lida', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    // Só notificações visíveis a este usuário (mesma condição do GET).
    const vis = (await query(
      `SELECT 1 FROM dbo.Notificacao n
        WHERE n.NotificacaoId = @id AND ${VISIVEL_PARA}`,
      { id, ...escopo(req.user) })).length;
    if (!vis) return res.status(404).json({ erro: 'Notificação não encontrada.' });

    if (req.body?.lida) {
      await query(
        `IF NOT EXISTS (SELECT 1 FROM dbo.NotificacaoLida WHERE NotificacaoId = @id AND UsuarioId = @uid)
           INSERT INTO dbo.NotificacaoLida (NotificacaoId, UsuarioId) VALUES (@id, @uid)`,
        { id, uid: req.user.id });
    } else {
      await query(
        'DELETE FROM dbo.NotificacaoLida WHERE NotificacaoId = @id AND UsuarioId = @uid',
        { id, uid: req.user.id });
    }
    res.json({ sucesso: true });
  } catch (e) { next(e); }
});

// DELETE /api/notificacoes/:id (SÓ ADMIN) — apaga a notificação e o anexo.
router.delete('/notificacoes/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const n = (await query(
      'SELECT AnexoUrl FROM dbo.Notificacao WHERE NotificacaoId = @id', { id }))[0];
    if (!n) return res.status(404).json({ erro: 'Notificação não encontrada.' });
    await query('DELETE FROM dbo.Notificacao WHERE NotificacaoId = @id', { id });
    apagarAnexo(n.AnexoUrl);
    res.json({ sucesso: true });
  } catch (e) { next(e); }
});

export default router;
