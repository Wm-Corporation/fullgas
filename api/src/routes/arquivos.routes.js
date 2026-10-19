// Entrega de arquivos sensíveis (garantia, notificação, suporte) só para o dono.
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

// Pastas permitidas (o nome vem da URL).
const PASTAS = new Set(['reivindicacoes', 'notificacoes', 'suporte']);

// Só nome simples: sem barra, '..' ou dois-pontos.
const NOME_OK = /^[A-Za-z0-9._-]{1,120}$/;

// O arquivo é de quem pediu? Admin vê tudo.
async function podeVer(tipo, nome, user) {
  const ehAdmin = user.papel === 'admin';
  const url = `/uploads/${tipo}/${nome}`;

  if (tipo === 'reivindicacoes') {
    // O anexo pertence a uma reivindicação, que pertence a uma empresa.
    const rows = await query(
      `SELECT TOP 1 r.EmpresaId
         FROM dbo.ReivindicacaoAnexo a
         JOIN dbo.Reivindicacao r ON r.ReivindicacaoId = a.ReivindicacaoId
        WHERE a.Url = @url`,
      { url }
    );
    if (!rows.length) return false;
    return ehAdmin || rows[0].EmpresaId === user.empresaId;
  }

  if (tipo === 'suporte') {
    // Anexo de chamado: só o dono do chamado (não a empresa toda) e o admin.
    const rows = await query(
      `SELECT TOP 1 c.UsuarioId
         FROM dbo.SuporteMensagem m
         JOIN dbo.SuporteChamado c ON c.ChamadoId = m.ChamadoId
        WHERE m.AnexoUrl = @url`,
      { url }
    );
    if (!rows.length) return false;
    return ehAdmin || rows[0].UsuarioId === user.id;
  }

  if (tipo === 'notificacoes') {
    // Notificação com EmpresaId NULL é global (vale para todos os revendedores).
    const rows = await query(
      'SELECT TOP 1 EmpresaId FROM dbo.Notificacao WHERE AnexoUrl = @url',
      { url }
    );
    if (!rows.length) return false;
    const dona = rows[0].EmpresaId;
    return ehAdmin || dona === null || dona === user.empresaId;
  }

  return false;
}

// GET /api/arquivos/:tipo/:nome
router.get('/arquivos/:tipo/:nome', requireAuth, async (req, res, next) => {
  try {
    const { tipo, nome } = req.params;
    if (!PASTAS.has(tipo) || !NOME_OK.test(nome)) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }

    // Mesma resposta para "não existe" e "não é seu".
    if (!(await podeVer(tipo, nome, req.user))) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }

    const caminho = path.join(UPLOADS_ROOT, tipo, nome);
    // Garante que o caminho não escapou da pasta.
    if (!caminho.startsWith(path.join(UPLOADS_ROOT, tipo) + path.sep)) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }
    if (!fs.existsSync(caminho)) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }

    // Privado: nunca em cache compartilhado.
    res.set('Cache-Control', 'private, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(caminho);
  } catch (e) { next(e); }
});

export default router;
