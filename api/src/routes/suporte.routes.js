// ============================================================
// Rotas do Suporte Técnico (helpdesk por chamados)
//   - GET   /suporte/categorias              lista de categorias de ajuda
//   - GET   /suporte/resumo                  contadores do pop-up flutuante
//   - GET   /suporte/chamados                lista (cliente: os que ele mesmo
//                                            abriu; admin: os de todos)
//   - POST  /suporte/chamados                revendedor abre (multipart, anexo
//                                            opcional)
//   - GET   /suporte/chamados/:id            detalhe + conversa (marca como
//                                            lidas as mensagens do outro lado)
//   - POST  /suporte/chamados/:id/mensagens  responde (multipart)
//   - PATCH /suporte/chamados/:id            muda o status
//
// Continua sendo um HELPDESK, não uma sala de chat: não há presença ("fulano
// está digitando"), o chamado tem número e sobrevive a todo mundo fechar o
// navegador. O que mudou é só a ENTREGA — desde o /api/pulso (pulso.routes.js)
// a mensagem aparece do outro lado em até 10 segundos, sem recarregar a
// página. Ver docs/11-suporte-tecnico.md, seção "Ao vivo".
// O pop-up do canto da tela e a aba "Suporte Técnico" são duas janelas para
// estes mesmos dados.
//
// Anexos vão para /uploads/suporte (multer → disco) e o banco guarda a URL
// RELATIVA. Eles NÃO são servidos pelo estático: material de cliente sai por
// /api/arquivos/suporte/:nome, que confere de quem é (ver arquivos.routes.js).
// ============================================================
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, getPool, sql } from '../db.js';
import { requireAuth } from '../auth.js';
import { limiteChamado } from '../middlewares/rate-limit.js';
import { criarNotificacao, marcarNotificacoesDoChamadoLidas } from '../notificacoes.js';
import { EXT_IMAGEM, EXT_VIDEO, EXT_DOCUMENTO, nomeArquivo, filtroAnexo } from '../middlewares/upload-comum.js';
import {
  CATEGORIAS, categoriaValida, nomeCategoria, prioridadeValida,
  statusValido, podeReceberMensagem, statusAposResposta, clientePodeMudarStatus,
  numeroChamado
} from '../utils/suporte.js';

const router = Router();

// ---- Upload do anexo (multer → disco) --------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const SUPORTE_DIR = path.join(UPLOADS_ROOT, 'suporte');
fs.mkdirSync(SUPORTE_DIR, { recursive: true });
const URL_BASE = '/uploads/suporte/';

const EXT_ANEXO = [...EXT_IMAGEM, ...EXT_VIDEO, ...EXT_DOCUMENTO];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SUPORTE_DIR),
  filename: (_req, file, cb) => cb(null, nomeArquivo(file, EXT_ANEXO))
});
// 60 MB é o mesmo teto das notificações e das reivindicações — e o mesmo que o
// Nginx da produção aceita no corpo. Passar disso aqui só trocaria uma mensagem
// clara por um 413 seco do servidor.
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
  fileFilter: filtroAnexo()
});

// Wrapper: erro do multer vira 400 com mensagem legível. O anexo é OPCIONAL.
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

function tipoAnexo(file) {
  const mime = file.mimetype || '';
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  return 'arquivo';
}

// Apaga do disco um anexo já gravado (só dentro de /uploads). Usado quando a
// validação falha DEPOIS do multer ter salvado o arquivo — sem isto a pasta
// acumula anexo de chamado que nunca existiu.
function apagarAnexo(rel) {
  if (!rel || !String(rel).startsWith('/uploads/')) return;
  const abs = path.resolve(UPLOADS_ROOT, String(rel).replace(/^\/uploads\//, ''));
  if (!abs.startsWith(path.resolve(UPLOADS_ROOT))) return;
  try { fs.unlinkSync(abs); } catch { /* já não existe */ }
}

function urlAbs(req, rel) {
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

function toIso(d) { return d instanceof Date ? d.toISOString() : (d || null); }

/* ------------------------------------------------------------------
   OS DOIS LADOS DA CONVERSA
   ------------------------------------------------------------------
   Tudo que é "não lido" e "quem falou por último" depende de quem está
   perguntando. Esta função devolve o lado de quem chama e o lado oposto — é o
   oposto que interessa para contar não lidas (o revendedor tem interesse na
   resposta do suporte, não na própria mensagem).

   As mensagens de autor 'sistema' (mudança de status) contam para o outro
   lado como qualquer resposta: "seu chamado foi resolvido" merece o aviso.

   `colunaLida` entra em SQL por interpolação, e isso é seguro: o valor sai
   DESTE objeto, nunca do pedido. Nome de coluna não pode ser parâmetro.
   ------------------------------------------------------------------ */
/* ------------------------------------------------------------------
   DE QUEM É O CHAMADO
   ------------------------------------------------------------------
   Um chamado de suporte pertence à PESSOA que o abriu, não à
   concessionária dela. Duas contas da mesma empresa — inclusive a conta
   interna/gestora — não enxergam a conversa uma da outra: o que se fala com o
   suporte pode ser sobre cobrança, acesso ou a própria equipe.

   `dono` é o UsuarioId de quem está pedindo, ou null para o administrador da
   Fullgas — que precisa ver todos os chamados para conseguir atendê-los. É o
   mesmo formato de antes (null = "sem filtro"), então as consultas continuam
   com um parâmetro só.

   A empresa continua gravada no chamado (EmpresaId): ela dá o nome na fila do
   atendente e o vínculo do protocolo. O que deixou de fazer é dar ACESSO.
   ------------------------------------------------------------------ */
export function escopoSuporte(user) {
  return { dono: user.papel === 'admin' ? null : user.id };
}

// Exportado: o /api/pulso (pulso.routes.js) conta as mesmas mensagens não
// lidas de 10 em 10 segundos. Duas cópias desta escolha de coluna dariam dois
// contadores discordando sobre o mesmo chamado.
export function ladosDa(user) {
  return user.papel === 'admin'
    ? { eu: 'admin', colunaLida: 'LidaAdminEm', colunaLidaOutro: 'LidaClienteEm' }
    : { eu: 'cliente', colunaLida: 'LidaClienteEm', colunaLidaOutro: 'LidaAdminEm' };
}

// Colunas do chamado + os agregados que as listas mostram (nº de mensagens,
// não lidas para quem pediu, e a última mensagem em uma linha).
function selectChamados(lado) {
  return `
    SELECT c.ChamadoId, c.EmpresaId, c.UsuarioId, c.Categoria, c.Assunto,
           c.Prioridade, c.Status, c.AtendenteId, c.CriadoEm, c.AtualizadoEm, c.FechadoEm,
           u.Nome AS AutorNome, u.Email AS AutorEmail,
           e.RazaoSocial AS EmpresaNome, e.NomeFantasia AS EmpresaFantasia,
           a.Nome AS AtendenteNome,
           (SELECT COUNT(*) FROM dbo.SuporteMensagem m
             WHERE m.ChamadoId = c.ChamadoId) AS Mensagens,
           (SELECT COUNT(*) FROM dbo.SuporteMensagem m
             WHERE m.ChamadoId = c.ChamadoId
               AND m.Autor <> '${lado.eu}'
               AND m.${lado.colunaLida} IS NULL) AS NaoLidas,
           (SELECT TOP 1 m.Texto FROM dbo.SuporteMensagem m
             WHERE m.ChamadoId = c.ChamadoId
             ORDER BY m.CriadoEm DESC, m.MensagemId DESC) AS UltimoTexto,
           (SELECT TOP 1 m.Autor FROM dbo.SuporteMensagem m
             WHERE m.ChamadoId = c.ChamadoId
             ORDER BY m.CriadoEm DESC, m.MensagemId DESC) AS UltimoAutor
      FROM dbo.SuporteChamado c
      JOIN dbo.Usuario u ON u.UsuarioId = c.UsuarioId
      JOIN dbo.Empresa e ON e.EmpresaId = c.EmpresaId
      LEFT JOIN dbo.Usuario a ON a.UsuarioId = c.AtendenteId`;
}

function toChamado(r) {
  return {
    id: r.ChamadoId,
    numero: numeroChamado(r.ChamadoId),
    categoria: r.Categoria,
    categoriaNome: nomeCategoria(r.Categoria),
    assunto: r.Assunto,
    prioridade: r.Prioridade,
    status: r.Status,
    criadoEm: toIso(r.CriadoEm),
    atualizadoEm: toIso(r.AtualizadoEm),
    fechadoEm: toIso(r.FechadoEm),
    autor: r.AutorNome || '',
    autorEmail: r.AutorEmail || '',
    atendente: r.AtendenteNome || null,
    empresaId: r.EmpresaId,
    empresa: r.EmpresaFantasia || r.EmpresaNome || '',
    mensagens: Number(r.Mensagens || 0),
    naoLidas: Number(r.NaoLidas || 0),
    ultimaMensagem: r.UltimoTexto || '',
    ultimoAutor: r.UltimoAutor || null
  };
}

function toMensagem(req, r) {
  return {
    id: r.MensagemId,
    autor: r.Autor,                            // 'cliente' | 'admin' | 'sistema'
    autorNome: r.AutorNome || (r.Autor === 'sistema' ? 'Sistema' : ''),
    texto: r.Texto || '',
    anexo: urlAbs(req, r.AnexoUrl),
    anexoTipo: r.AnexoTipo || null,
    criadoEm: toIso(r.CriadoEm)
  };
}

/* ------------------------------------------------------------------
   O AVISO NA CAIXA DE NOTIFICAÇÕES
   ------------------------------------------------------------------
   O badge do pop-up 🎧 só aparece para quem está com o portal aberto. A carta
   ✉️ do topo é onde o revendedor já procura recado da Fullgas — e onde o
   administrador procura o que chegou. Toda mensagem de chamado passa por aqui.

   O aviso vai SEMPRE para o lado oposto ao de quem falou; ninguém é notificado
   da própria mensagem. E ele é automático (Origem='suporte'), o que o mantém
   fora da tabela "Enviadas" do painel — que é a caixa de saída do
   administrador, não um log de eventos.
   ------------------------------------------------------------------ */
function previa(texto, temAnexo) {
  const t = String(texto || '').trim();
  if (t) return t;
  return temAnexo ? '(mensagem com anexo)' : '';
}

// `c` é a linha crua do chamado (a do selectChamados).
function avisarMensagem(c, autor, texto, temAnexo, user) {
  const numero = numeroChamado(c.ChamadoId);
  const empresa = c.EmpresaFantasia || c.EmpresaNome || 'a concessionária';
  const corpo = previa(texto, temAnexo);

  // Não damos `await`: o aviso não pode segurar (nem derrubar) a resposta que
  // o usuário acabou de enviar. A função já engole o próprio erro.
  return criarNotificacao(autor === 'admin'
    ? {
      publico: 'cliente',
      empresaId: c.EmpresaId,
      chamadoId: c.ChamadoId,
      titulo: 'Resposta do suporte no chamado ' + numero,
      texto: c.Assunto + '\n\n' + corpo,
      criadoPor: user.id
    }
    : {
      publico: 'admin',
      empresaId: c.EmpresaId,
      chamadoId: c.ChamadoId,
      titulo: 'Nova mensagem no chamado ' + numero,
      texto: empresa + ' — ' + c.Assunto + '\n\n' + corpo,
      criadoPor: user.id
    });
}

// Busca o chamado conferindo o escopo: cliente só alcança os que ELE abriu;
// admin alcança todos. Devolve a linha crua ou null.
async function buscarChamado(id, user) {
  const rows = await query(
    selectChamados(ladosDa(user)) +
    ' WHERE c.ChamadoId = @id AND (@dono IS NULL OR c.UsuarioId = @dono)',
    { id, ...escopoSuporte(user) }
  );
  return rows[0] || null;
}

// GET /api/suporte/categorias — as áreas de ajuda que o pop-up oferece.
router.get('/suporte/categorias', requireAuth, (_req, res) => {
  res.json(CATEGORIAS);
});

// GET /api/suporte/resumo — números do badge do pop-up flutuante.
//   abertos   chamados ainda em andamento (não resolvidos nem fechados)
//   naoLidas  mensagens do outro lado que este lado ainda não viu
router.get('/suporte/resumo', requireAuth, async (req, res, next) => {
  try {
    const lado = ladosDa(req.user);
    const rows = await query(
      `SELECT
         (SELECT COUNT(*) FROM dbo.SuporteChamado c
           WHERE (@dono IS NULL OR c.UsuarioId = @dono)
             AND c.Status NOT IN ('Resolvido', 'Fechado')) AS Abertos,
         (SELECT COUNT(*) FROM dbo.SuporteMensagem m
            JOIN dbo.SuporteChamado c ON c.ChamadoId = m.ChamadoId
           WHERE (@dono IS NULL OR c.UsuarioId = @dono)
             AND m.Autor <> '${lado.eu}'
             AND m.${lado.colunaLida} IS NULL) AS NaoLidas`,
      escopoSuporte(req.user)
    );
    res.json({
      abertos: Number(rows[0]?.Abertos || 0),
      naoLidas: Number(rows[0]?.NaoLidas || 0)
    });
  } catch (e) { next(e); }
});

// GET /api/suporte/chamados[?status=] — cliente vê os chamados que ELE abriu;
// admin vê os de todo mundo. Ordem: o que se mexeu por último vem primeiro.
router.get('/suporte/chamados', requireAuth, async (req, res, next) => {
  try {
    const status = statusValido(req.query.status) ? req.query.status : null;
    const rows = await query(
      selectChamados(ladosDa(req.user)) +
      ` WHERE (@dono IS NULL OR c.UsuarioId = @dono)
           AND (@status IS NULL OR c.Status = @status)
         ORDER BY c.AtualizadoEm DESC, c.ChamadoId DESC`,
      { status, ...escopoSuporte(req.user) }
    );
    res.json(rows.map(toChamado));
  } catch (e) { next(e); }
});

// GET /api/suporte/chamados/:id — detalhe com a conversa inteira.
//
// Abrir o chamado é o que marca como lidas as mensagens do outro lado: é o
// gesto que significa "eu vi". Por isso o badge do pop-up zera aqui, e não numa
// chamada separada.
router.get('/suporte/chamados/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    const c = await buscarChamado(id, req.user);
    if (!c) return res.status(404).json({ erro: 'Chamado não encontrado.' });

    const lado = ladosDa(req.user);
    await query(
      `UPDATE dbo.SuporteMensagem
          SET ${lado.colunaLida} = SYSUTCDATETIME()
        WHERE ChamadoId = @id AND Autor <> '${lado.eu}' AND ${lado.colunaLida} IS NULL`,
      { id }
    );

    // Quem leu a conversa não pode ficar com a carta ✉️ acesa por causa dela:
    // as notificações deste chamado destinadas a este lado saem como lidas
    // junto com as mensagens. Os dois contadores contam a mesma coisa e
    // precisam zerar no mesmo gesto.
    await marcarNotificacoesDoChamadoLidas(id, lado.eu, req.user.id);

    const msgs = await query(
      `SELECT m.MensagemId, m.Autor, m.Texto, m.AnexoUrl, m.AnexoTipo, m.CriadoEm,
              u.Nome AS AutorNome
         FROM dbo.SuporteMensagem m
         LEFT JOIN dbo.Usuario u ON u.UsuarioId = m.UsuarioId
        WHERE m.ChamadoId = @id
        ORDER BY m.CriadoEm, m.MensagemId`,
      { id }
    );

    // O chamado sai com naoLidas = 0: acabaram de ser marcadas acima, e devolver
    // o número velho faria o badge do front piscar de volta.
    res.json({ ...toChamado(c), naoLidas: 0, conversa: msgs.map(m => toMensagem(req, m)) });
  } catch (e) { next(e); }
});

// POST /api/suporte/chamados — o revendedor abre um chamado.
// multipart/form-data: categoria*, assunto*, descricao*, prioridade, anexo?
//
// Chamado e primeira mensagem nascem na MESMA transação: um chamado sem a
// descrição que o originou seria um protocolo vazio na fila do atendente.
router.post('/suporte/chamados', requireAuth, limiteChamado, uploadAnexo, async (req, res, next) => {
  const anexoUrl = req.file ? URL_BASE + req.file.filename : null;
  const recusar = (status, erro) => {
    if (anexoUrl) apagarAnexo(anexoUrl);
    return res.status(status).json({ erro });
  };

  try {
    // O helpdesk é o canal DO REVENDEDOR. O administrador responde pelo painel;
    // se ele também abrisse chamados, apareceria na própria fila como cliente.
    if (req.user.papel === 'admin') {
      return recusar(403, 'Chamados são abertos pelas concessionárias. O administrador responde pelo painel.');
    }
    if (!req.user.empresaId) {
      return recusar(400, 'Sua conta não está ligada a uma concessionária.');
    }

    const categoria = String(req.body?.categoria || '').trim();
    const assunto = String(req.body?.assunto || '').trim().slice(0, 160);
    const descricao = String(req.body?.descricao || '').trim().slice(0, 4000);
    const prioridade = String(req.body?.prioridade || 'normal').trim();

    if (!categoriaValida(categoria)) return recusar(400, 'Escolha a categoria da ajuda.');
    if (!assunto) return recusar(400, 'Escreva um assunto para o chamado.');
    if (!descricao) return recusar(400, 'Descreva o que está acontecendo.');
    if (!prioridadeValida(prioridade)) return recusar(400, 'Prioridade inválida.');

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      const ins = await new sql.Request(tx)
        .input('eid', sql.Int, req.user.empresaId)
        .input('uid', sql.Int, req.user.id)
        .input('cat', sql.VarChar(30), categoria)
        .input('assunto', sql.NVarChar(160), assunto)
        .input('prio', sql.VarChar(10), prioridade)
        .query(`INSERT INTO dbo.SuporteChamado
                  (EmpresaId, UsuarioId, Categoria, Assunto, Prioridade, Status)
                OUTPUT inserted.ChamadoId
                VALUES (@eid, @uid, @cat, @assunto, @prio, 'Aberto')`);
      const chamadoId = ins.recordset[0].ChamadoId;

      await new sql.Request(tx)
        .input('cid', sql.Int, chamadoId)
        .input('uid', sql.Int, req.user.id)
        .input('texto', sql.NVarChar(4000), descricao)
        .input('anexo', sql.VarChar(400), anexoUrl)
        .input('anexoTipo', sql.VarChar(20), req.file ? tipoAnexo(req.file) : null)
        // LidaClienteEm já preenchido: quem escreveu não precisa "ler" a própria
        // mensagem — sem isto o revendedor abriria o chamado já com badge de 1.
        .query(`INSERT INTO dbo.SuporteMensagem
                  (ChamadoId, UsuarioId, Autor, Texto, AnexoUrl, AnexoTipo, LidaClienteEm)
                VALUES (@cid, @uid, 'cliente', @texto, @anexo, @anexoTipo, SYSUTCDATETIME())`);

      await tx.commit();

      const c = await buscarChamado(chamadoId, req.user);
      // Chamado novo é a primeira mensagem do revendedor: avisa o suporte na
      // caixa dele. Fora da transação de propósito — um aviso que falha não
      // pode desfazer um chamado que o revendedor já viu ser criado.
      await avisarMensagem(c, 'cliente', descricao, !!req.file, req.user);
      return res.status(201).json(toChamado(c));
    } catch (e) {
      try { await tx.rollback(); } catch { /* já desfeita */ }
      throw e;
    }
  } catch (e) {
    if (anexoUrl) apagarAnexo(anexoUrl);
    next(e);
  }
});

// POST /api/suporte/chamados/:id/mensagens — responde no chamado.
// multipart/form-data: texto (obrigatório se não houver anexo), anexo?
router.post('/suporte/chamados/:id/mensagens', requireAuth, uploadAnexo, async (req, res, next) => {
  const anexoUrl = req.file ? URL_BASE + req.file.filename : null;
  const recusar = (status, erro) => {
    if (anexoUrl) apagarAnexo(anexoUrl);
    return res.status(status).json({ erro });
  };

  try {
    const id = Number(req.params.id);
    if (!id) return recusar(400, 'ID inválido.');

    const c = await buscarChamado(id, req.user);
    if (!c) return recusar(404, 'Chamado não encontrado.');
    if (!podeReceberMensagem(c.Status)) {
      return recusar(409, 'Este chamado está fechado. Reabra-o ou abra um novo.');
    }

    const texto = String(req.body?.texto || '').trim().slice(0, 4000);
    if (!texto && !req.file) return recusar(400, 'Escreva a mensagem (ou anexe um arquivo).');

    const lado = ladosDa(req.user);
    const novoStatus = statusAposResposta(c.Status, lado.eu);

    await query(
      `INSERT INTO dbo.SuporteMensagem
         (ChamadoId, UsuarioId, Autor, Texto, AnexoUrl, AnexoTipo, ${lado.colunaLida})
       VALUES (@cid, @uid, @autor, @texto, @anexo, @anexoTipo, SYSUTCDATETIME())`,
      {
        cid: id, uid: req.user.id, autor: lado.eu,
        texto: texto || null, anexo: anexoUrl,
        anexoTipo: req.file ? tipoAnexo(req.file) : null
      }
    );

    // Responder tira o chamado de qualquer estado terminal: o atendente vira o
    // dono da vez (AtendenteId) e a data de fechamento deixa de valer.
    await query(
      `UPDATE dbo.SuporteChamado
          SET Status = @status,
              AtualizadoEm = SYSUTCDATETIME(),
              FechadoEm = NULL,
              AtendenteId = CASE WHEN @ehAdmin = 1 THEN @uid ELSE AtendenteId END
        WHERE ChamadoId = @cid`,
      { cid: id, status: novoStatus, ehAdmin: lado.eu === 'admin' ? 1 : 0, uid: req.user.id }
    );

    await avisarMensagem(c, lado.eu, texto, !!req.file, req.user);

    const atualizado = await buscarChamado(id, req.user);
    res.status(201).json(toChamado(atualizado));
  } catch (e) {
    if (anexoUrl) apagarAnexo(anexoUrl);
    next(e);
  }
});

// PATCH /api/suporte/chamados/:id  { status }
//
// O admin move o chamado para qualquer estado. O revendedor só encerra
// ('Fechado') ou reabre ('Aberto') — assumir/aguardar é decisão de quem atende.
router.patch('/suporte/chamados/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    const c = await buscarChamado(id, req.user);
    if (!c) return res.status(404).json({ erro: 'Chamado não encontrado.' });

    const status = String(req.body?.status || '').trim();
    if (!statusValido(status)) return res.status(400).json({ erro: 'Status inválido.' });

    const lado = ladosDa(req.user);
    const ehAdmin = lado.eu === 'admin';
    if (!ehAdmin && !clientePodeMudarStatus(status)) {
      return res.status(403).json({ erro: 'Você pode encerrar ou reabrir o chamado; o restante é do suporte.' });
    }
    if (c.Status === status) return res.json({ sucesso: true, status });

    await query(
      `UPDATE dbo.SuporteChamado
          SET Status = @status,
              AtualizadoEm = SYSUTCDATETIME(),
              FechadoEm = CASE WHEN @status IN ('Fechado', 'Resolvido')
                               THEN SYSUTCDATETIME() ELSE NULL END,
              AtendenteId = CASE WHEN @ehAdmin = 1 THEN @uid ELSE AtendenteId END
        WHERE ChamadoId = @cid`,
      { cid: id, status, ehAdmin: ehAdmin ? 1 : 0, uid: req.user.id }
    );

    // A troca de status entra na conversa como mensagem do 'sistema' — assim o
    // outro lado vê o que aconteceu no fio, e não só um rótulo que mudou
    // sozinho. Já nasce lida para QUEM MUDOU (foi ele quem fez), e não lida
    // para o outro lado, que é quem precisa ser avisado.
    await query(
      `INSERT INTO dbo.SuporteMensagem (ChamadoId, UsuarioId, Autor, Texto, ${lado.colunaLida})
       VALUES (@cid, @uid, 'sistema', @texto, SYSUTCDATETIME())`,
      {
        cid: id, uid: req.user.id,
        texto: 'Status alterado de "' + c.Status + '" para "' + status + '".'
      }
    );

    res.json({ sucesso: true, status });
  } catch (e) { next(e); }
});

export default router;
