// ============================================================
// Entrega de arquivos SENSÍVEIS com verificação de posse.
// ------------------------------------------------------------
// Antes disto, tudo em /uploads era servido estaticamente e sem autenticação:
// as fotos e vídeos de reivindicação de garantia de TODAS as concessionárias
// ficavam legíveis para quem tivesse (ou adivinhasse) a URL. Nada impedia uma
// concessionária de ver o material da outra.
//
// Aqui cada arquivo só sai depois de conferir, no banco, que ele pertence à
// empresa de quem pediu. As imagens de catálogo (produtos, categorias, finder)
// continuam no estático de /uploads — são o mesmo conteúdo para todo mundo.
// ============================================================
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

// Pastas que esta rota entrega. O nome vem da URL, então é obrigatório validar
// contra esta lista: sem isso, `tipo` viraria caminho livre no disco.
const PASTAS = new Set(['reivindicacoes', 'notificacoes', 'suporte']);

// Só nome de arquivo simples: sem barra, sem '..', sem dois-pontos. Os nomes
// são gerados pela API (data + aleatório + extensão), nunca vêm do usuário.
const NOME_OK = /^[A-Za-z0-9._-]{1,120}$/;

// Confere no banco se o arquivo pertence a quem está pedindo.
// Devolve true/false. Admin enxerga tudo.
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
    // O anexo pertence a uma mensagem de chamado, e o chamado pertence a QUEM
    // O ABRIU — não à empresa dele. Vale para os dois sentidos: a foto que o
    // revendedor mandou e o arquivo que o suporte respondeu só são visíveis
    // para o dono do chamado (e para o administrador, que atende).
    // Conferir aqui não é redundância: o anexo sai por uma URL própria, que
    // circula fora da tela do chamado.
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

    // Resposta idêntica para "não existe" e "não é seu": quem não tem acesso
    // não descobre se o arquivo existe.
    if (!(await podeVer(tipo, nome, req.user))) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }

    const caminho = path.join(UPLOADS_ROOT, tipo, nome);
    // Cinto e suspensório: mesmo com o nome já validado, garante que o caminho
    // resolvido não escapou da pasta de uploads.
    if (!caminho.startsWith(path.join(UPLOADS_ROOT, tipo) + path.sep)) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }
    if (!fs.existsSync(caminho)) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }

    // Conteúdo privado: não pode ficar em cache compartilhado (Cloudflare,
    // proxy da empresa), senão o arquivo de uma concessionária poderia ser
    // entregue a outra.
    res.set('Cache-Control', 'private, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(caminho);
  } catch (e) { next(e); }
});

export default router;
