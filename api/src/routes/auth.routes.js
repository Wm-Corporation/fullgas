// ---- Rotas de autenticação ----
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, getPool, sql } from '../db.js';
import { signToken, parsePermissoes, abrirSessao, fecharSessao, requireAuth, invalidarCacheSessao } from '../auth.js';
import { erroEndereco, limparIe, erroSenha, erroCnpj, formatarCnpj, soDigitosCnpj } from '../validacao.js';
import { vincularContatoTiny } from '../tiny-contatos.js';
import { enviarEmail, emailRecuperacaoSenha, appUrl } from '../mail.js';
import { verificarCaptcha, captchaSiteKey } from '../captcha.js';
import { auditar, ACOES } from '../auditoria.js';
import { limiteLogin, limiteSenha, limiteCadastro, limiteVerificacaoSenha } from '../middlewares/rate-limit.js';

const router = Router();

// Validade do link de recuperação e intervalo mínimo entre pedidos.
const RESET_MINUTOS = 60;
const RESET_ESPERA_MS = 60 * 1000;
const ultimoPedidoReset = new Map();   // email -> timestamp

// GET /api/auth/captcha/config — site key pública para o widget.
router.get('/captcha/config', (_req, res) => {
  res.json({ siteKey: captchaSiteKey() });
});

// POST /api/auth/login  { email, senha, captcha? }
router.post('/login', limiteLogin, async (req, res, next) => {
  try {
    const { email, senha, captcha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });

    // Captcha antes do banco (poupa consulta e bcrypt).
    const cap = await verificarCaptcha(captcha, req.ip);
    if (!cap.ok) return res.status(400).json({ erro: cap.erro });

    const rows = await query(
      `SELECT u.UsuarioId, u.Nome, u.Email, u.SenhaHash, u.Papel, u.Status,
              u.EmpresaId, u.Gestor, u.Permissoes, u.TokenVersion, e.RazaoSocial AS Empresa
         FROM dbo.Usuario u
         JOIN dbo.Empresa e ON e.EmpresaId = u.EmpresaId
        WHERE u.Email = @email`,
      { email }
    );
    const u = rows[0];
    if (!u) return res.status(401).json({ erro: 'Credenciais inválidas.' });

    // Senha antes do status, para não revelar se a conta existe.
    // SenhaHash é VARBINARY: guarda os bytes da string do bcrypt.
    const hashStr = u.SenhaHash ? Buffer.from(u.SenhaHash).toString('utf8') : '';
    const ok = hashStr && await bcrypt.compare(senha, hashStr);
    if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas.' });

    // Senha correta: agora sim pode saber por que não entra.
    if (u.Status === 'pendente')
      return res.status(403).json({ erro: 'Cadastro aguardando aprovação do administrador.' });
    if (u.Status === 'bloqueado')
      return res.status(403).json({ erro: 'Usuário bloqueado. Procure o administrador.' });

    // A sessão sai só pelo cookie, nunca no corpo.
    abrirSessao(res, signToken(u));
    res.json({
      usuario: {
        id: u.UsuarioId, nome: u.Nome, email: u.Email,
        papel: u.Papel, empresa: u.Empresa, empresaId: u.EmpresaId,
        gestor: !!u.Gestor,
        permissoes: parsePermissoes(u.Permissoes)   // null = acesso total
      }
    });
  } catch (e) { next(e); }
});

// POST /api/auth/register
//   { nome, empresa, email, senha, cnpj, inscricaoEstadual?, telefone,
//     endereco: { cep, logradouro, numero, complemento, bairro, cidade, uf } }
// Depois do commit, o CNPJ é vinculado (ou criado) como contato no Tiny.
router.post('/register', limiteCadastro, async (req, res, next) => {
  try {
    const { nome, empresa, email, senha, telefone } = req.body;
    const end = req.body.endereco || {};
    if (!nome || !empresa || !email || !senha)
      return res.status(400).json({ erro: 'Preencha nome, empresa, e-mail e senha.' });

    // Anti-robô, como no login.
    const cap = await verificarCaptcha(req.body?.captcha, req.ip);
    if (!cap.ok) return res.status(400).json({ erro: cap.erro });
    const errSenha = erroSenha(senha, { email, nome });
    if (errSenha) return res.status(400).json({ erro: errSenha });
    const errCnpj = erroCnpj(req.body.cnpj);
    if (errCnpj) return res.status(400).json({ erro: errCnpj });
    const cnpj = formatarCnpj(req.body.cnpj);   // formato único no banco
    const errEnd = erroEndereco(end);
    if (errEnd) return res.status(400).json({ erro: errEnd });
    const ie = limparIe(req.body.inscricaoEstadual);

    // Padronização: nome do usuário e razão social entram sempre em MAIÚSCULAS.
    const nomeUp = String(nome).trim().toUpperCase();
    const empresaUp = String(empresa).trim().toUpperCase();

    const existe = await query('SELECT 1 FROM dbo.Usuario WHERE Email = @email', { email });
    if (existe.length) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

    const hash = await bcrypt.hash(senha, 10);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    let empresaId;
    try {
      await tx.begin();

      // Empresa pelo CNPJ (só dígitos); se não existir, cria.
      // Empresa que já tem usuário não aceita cadastro público: o acesso vem pelo gestor.
      let empRow = (await new sql.Request(tx)
        .input('dig', sql.VarChar(14), soDigitosCnpj(cnpj))
        .query(`SELECT e.EmpresaId,
                       (SELECT COUNT(*) FROM dbo.Usuario u WHERE u.EmpresaId = e.EmpresaId) AS Usuarios
                  FROM dbo.Empresa e
                 WHERE REPLACE(REPLACE(REPLACE(e.Cnpj, '.', ''), '/', ''), '-', '') = @dig`)).recordset[0];
      if (empRow && empRow.Usuarios > 0) {
        await tx.rollback();
        return res.status(409).json({
          erro: 'Esta empresa já tem cadastro no portal. Peça ao gestor da sua concessionária para ' +
            'criar o seu acesso (Minha conta → Subdealers) ou fale com a Fullgas.'
        });
      }

      if (empRow) {
        empresaId = empRow.EmpresaId;
        // TinyContatoPendente: agenda o vínculo com o Tiny se ainda não há um.
        await new sql.Request(tx)
          .input('id', sql.Int, empresaId)
          .input('cnpj', sql.VarChar(18), cnpj)
          .input('ie', sql.VarChar(20), ie)
          .input('email', sql.NVarChar(160), email)
          .input('tel', sql.VarChar(30), telefone || null)
          .query(`UPDATE dbo.Empresa
                     SET Cnpj = COALESCE(Cnpj, @cnpj),
                         InscricaoEstadual = COALESCE(InscricaoEstadual, @ie),
                         Email = COALESCE(Email, @email),
                         Telefone = COALESCE(Telefone, @tel),
                         TinyContatoPendente = CASE WHEN TinyContatoId IS NULL THEN 1 ELSE TinyContatoPendente END,
                         AtualizadoEm = SYSUTCDATETIME()
                   WHERE EmpresaId = @id`);
      } else {
        empresaId = (await new sql.Request(tx)
          .input('r', sql.NVarChar(160), empresaUp)
          .input('cnpj', sql.VarChar(18), cnpj)
          .input('ie', sql.VarChar(20), ie)
          .input('email', sql.NVarChar(160), email)
          .input('tel', sql.VarChar(30), telefone || null)
          .query(`INSERT INTO dbo.Empresa (RazaoSocial, Cnpj, InscricaoEstadual, Email, Telefone, TinyContatoPendente)
                  OUTPUT INSERTED.EmpresaId VALUES (@r, @cnpj, @ie, @email, @tel, 1)`)).recordset[0].EmpresaId;
      }

      // Endereço principal (só grava se a empresa ainda não tiver nenhum).
      const temEnd = (await new sql.Request(tx)
        .input('id', sql.Int, empresaId)
        .query('SELECT 1 FROM dbo.Endereco WHERE EmpresaId = @id')).recordset.length;
      if (!temEnd) {
        await new sql.Request(tx)
          .input('id', sql.Int, empresaId)
          .input('log', sql.NVarChar(180), end.logradouro)
          .input('num', sql.NVarChar(20), end.numero)
          .input('comp', sql.NVarChar(80), end.complemento || null)
          .input('bairro', sql.NVarChar(80), end.bairro)
          .input('cidade', sql.NVarChar(80), end.cidade)
          .input('uf', sql.Char(2), String(end.uf).toUpperCase().slice(0, 2))
          .input('cep', sql.VarChar(9), end.cep)
          .query(`INSERT INTO dbo.Endereco
                    (EmpresaId, Tipo, Logradouro, Numero, Complemento, Bairro, Cidade, Uf, Cep, Principal)
                  VALUES (@id, 'Entrega', @log, @num, @comp, @bairro, @cidade, @uf, @cep, 1)`);
      }

      // Quem se cadastra é o GESTOR da empresa. Hash gravado como bytes (VARBINARY).
      await new sql.Request(tx)
        .input('empresaId', sql.Int, empresaId)
        .input('nome', sql.NVarChar(120), nomeUp)
        .input('email', sql.NVarChar(160), email)
        .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
        .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor)
                VALUES (@empresaId, @nome, @email, @hash, 'cliente', 'pendente', 1)`);

      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    // Vincula ao Tiny sem esperar; se falhar, o cron tenta de novo.
    vincularContatoTiny(empresaId).catch(() => { });

    res.status(201).json({ ok: true, msg: 'Cadastro enviado. Aguarde aprovação do administrador.' });
  } catch (e) { next(e); }
});

// ---- Recuperação de senha ----
// esqueci: gera token (guarda só o hash) e manda por e-mail · verificar: link ainda vale? · redefinir: troca e queima o token.

// Guardamos o SHA-256 do token — quem lê o banco não reconstrói o link.
function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

// "lucas@gmail.com" -> "lu***@gmail.com". Só aparece para quem já tem o token.
function mascararEmail(e) {
  const [u, d] = String(e).split('@');
  if (!d) return '***';
  return (u.length <= 2 ? u[0] + '***' : u.slice(0, 2) + '***') + '@' + d;
}

// Token válido (existe, não usado, não expirado) com os dados do usuário, ou null.
async function tokenValido(tokenCru) {
  if (!tokenCru || typeof tokenCru !== 'string') return null;
  const rows = await query(
    `SELECT r.SenhaResetId, r.UsuarioId, u.Nome, u.Email, u.Status
       FROM dbo.SenhaReset r
       JOIN dbo.Usuario u ON u.UsuarioId = r.UsuarioId
      WHERE r.TokenHash = @h AND r.UsadoEm IS NULL AND r.ExpiraEm > SYSUTCDATETIME()`,
    { h: hashToken(tokenCru) }
  );
  return rows[0] || null;
}

// POST /api/auth/senha/esqueci  { email }
// Avisa quando o e-mail não tem cadastro (decisão do dono do portal).
router.post('/senha/esqueci', limiteSenha, async (req, res, next) => {
  const enviado = {
    ok: true,
    msg: 'Enviamos as instruções para o seu e-mail. Confira também o spam.'
  };
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      return res.status(400).json({ erro: 'Informe um e-mail válido.' });

    const u = (await query(
      'SELECT UsuarioId, Nome, Email, Status FROM dbo.Usuario WHERE Email = @email', { email }
    ))[0];
    if (!u) return res.status(404).json({ erro: 'Esse e-mail não possui cadastro.' });
    if (u.Status === 'pendente')
      return res.status(403).json({ erro: 'Cadastro aguardando aprovação do administrador.' });
    if (u.Status === 'bloqueado')
      return res.status(403).json({ erro: 'Usuário bloqueado. Procure o administrador.' });

    // Intervalo mínimo entre pedidos do mesmo e-mail.
    const agora = Date.now();
    if (agora - (ultimoPedidoReset.get(email) || 0) < RESET_ESPERA_MS)
      return res.status(429).json({ erro: 'Já enviamos um link agora há pouco. Espere um minuto e confira sua caixa de entrada.' });
    ultimoPedidoReset.set(email, agora);

    const tokenCru = crypto.randomBytes(32).toString('hex');
    // Um pedido novo invalida os anteriores: só o último link funciona.
    await query('UPDATE dbo.SenhaReset SET UsadoEm = SYSUTCDATETIME() WHERE UsuarioId = @uid AND UsadoEm IS NULL',
      { uid: u.UsuarioId });
    await query(
      `INSERT INTO dbo.SenhaReset (UsuarioId, TokenHash, ExpiraEm)
       VALUES (@uid, @h, DATEADD(minute, @min, SYSUTCDATETIME()))`,
      { uid: u.UsuarioId, h: hashToken(tokenCru), min: RESET_MINUTOS }
    );

    // Sem APP_URL, o link usa a origem de onde o portal foi aberto.
    const link = `${appUrl(req)}/redefinir?token=${tokenCru}`;
    const corpo = emailRecuperacaoSenha(u.Nome, link, RESET_MINUTOS);
    try {
      await enviarEmail({
        para: u.Email, assunto: 'Fullgas B2B — redefinição de senha',
        texto: corpo.texto, html: corpo.html
      });
    } catch (e) {
    // Falha de SMTP é informada ao cliente.
      console.error('ERRO ao enviar e-mail de recuperação:', e.message);
      ultimoPedidoReset.delete(email);   // deixa tentar de novo na hora
      return res.status(502).json({ erro: 'Não conseguimos enviar o e-mail agora. Tente de novo em instantes.' });
    }
    res.json(enviado);
  } catch (e) { next(e); }
});

// POST /api/auth/senha/verificar  { token } -> { ok, email mascarado, nome }
router.post('/senha/verificar', limiteVerificacaoSenha, async (req, res, next) => {
  try {
    const r = await tokenValido(req.body?.token);
    if (!r) return res.status(400).json({ erro: 'Link inválido ou expirado. Peça um novo.' });
    res.json({ ok: true, nome: r.Nome, email: mascararEmail(r.Email) });
  } catch (e) { next(e); }
});

// POST /api/auth/senha/trocar  { atual, nova }  (logado)
// Exige a senha atual, derruba as outras sessões e mantém esta. Não vale em identidade assumida.
router.post('/senha/trocar', requireAuth, limiteVerificacaoSenha, async (req, res, next) => {
  try {
    if (req.user.imp)
      return res.status(403).json({ erro: 'Em identidade assumida não é possível trocar a senha do cliente.' });
    const atual = String(req.body?.atual || '');
    const nova = String(req.body?.nova || '');
    if (!atual || !nova) return res.status(400).json({ erro: 'Informe a senha atual e a nova.' });

    const u = (await query(
      `SELECT u.UsuarioId, u.Nome, u.Email, u.SenhaHash, u.Papel, u.Status, u.EmpresaId,
              u.Gestor, u.Permissoes, u.TokenVersion
         FROM dbo.Usuario u WHERE u.UsuarioId = @id`, { id: req.user.id }))[0];
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const hashStr = u.SenhaHash ? Buffer.from(u.SenhaHash).toString('utf8') : '';
    if (!hashStr || !(await bcrypt.compare(atual, hashStr)))
      return res.status(400).json({ erro: 'Senha atual incorreta.' });
    if (atual === nova) return res.status(400).json({ erro: 'A nova senha precisa ser diferente da atual.' });
    const errSenha = erroSenha(nova, { email: u.Email, nome: u.Nome });
    if (errSenha) return res.status(400).json({ erro: errSenha });

    const hash = await bcrypt.hash(nova, 10);
    await query(
      `UPDATE dbo.Usuario
          SET SenhaHash = @hash, TokenVersion = TokenVersion + 1, AtualizadoEm = SYSUTCDATETIME()
        WHERE UsuarioId = @id`,
      { hash: Buffer.from(hash, 'utf8'), id: u.UsuarioId });
    invalidarCacheSessao(u.UsuarioId);
    // Reemite a sessão DESTA aba com a versão nova; as demais caem.
    abrirSessao(res, signToken({ ...u, TokenVersion: (u.TokenVersion ?? 0) + 1 }));
    res.json({ ok: true, msg: 'Senha alterada. As outras sessões abertas com a senha antiga foram encerradas.' });
  } catch (e) { next(e); }
});

// POST /api/auth/senha/redefinir  { token, senha }
router.post('/senha/redefinir', limiteVerificacaoSenha, async (req, res, next) => {
  try {
    const senha = String(req.body?.senha || '');

    // Token antes da senha: a validação da senha precisa saber de quem é a conta.
    const r = await tokenValido(req.body?.token);
    if (!r) return res.status(400).json({ erro: 'Link inválido ou expirado. Peça um novo.' });

    const errSenha = erroSenha(senha, { email: r.Email, nome: r.Nome });
    if (errSenha) return res.status(400).json({ erro: errSenha });
    if (r.Status === 'bloqueado')
      return res.status(403).json({ erro: 'Usuário bloqueado. Procure o administrador.' });

    // SenhaHash é VARBINARY: gravamos os bytes da string do bcrypt (como no login).
    const hash = await bcrypt.hash(senha, 10);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await new sql.Request(tx)
        .input('uid', sql.Int, r.UsuarioId)
        .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
        // TokenVersion + 1 derruba todas as sessões do usuário (migration 037).
        .query(`UPDATE dbo.Usuario
                   SET SenhaHash = @hash,
                       TokenVersion = TokenVersion + 1,
                       AtualizadoEm = SYSUTCDATETIME()
                 WHERE UsuarioId = @uid`);
      // Queima ESTE token e qualquer outro pendente do mesmo usuário.
      await new sql.Request(tx)
        .input('uid', sql.Int, r.UsuarioId)
        .query('UPDATE dbo.SenhaReset SET UsadoEm = SYSUTCDATETIME() WHERE UsuarioId = @uid AND UsadoEm IS NULL');
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* já desfeita */ }
      throw e;
    }

    // Revogação imediata, sem esperar o cache da sessão.
    invalidarCacheSessao(r.UsuarioId);

    res.json({ ok: true, msg: 'Senha alterada! Faça login com a nova senha.' });
  } catch (e) { next(e); }
});

// ---- Sessão: sair, consultar e voltar de identidade assumida ----

// POST /api/auth/logout — sem requireAuth: precisa funcionar com token vencido.
router.post('/logout', (_req, res) => {
  fecharSessao(res);
  res.json({ ok: true });
});

// GET /api/auth/sessao — perfil relido do banco.
router.get('/sessao', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.UsuarioId, u.Nome, u.Email, u.Papel, u.Status, u.EmpresaId,
              u.Gestor, u.Permissoes, u.TokenVersion, e.RazaoSocial AS Empresa
         FROM dbo.Usuario u
         JOIN dbo.Empresa e ON e.EmpresaId = u.EmpresaId
        WHERE u.UsuarioId = @id`,
      { id: req.user.id }
    );
    const u = rows[0];
    // Conta apagada ou bloqueada depois do login: encerra na hora.
    if (!u || u.Status !== 'aprovado') {
      fecharSessao(res);
      return res.status(401).json({ erro: 'Sessão encerrada. Faça login de novo.' });
    }
    res.json({
      usuario: {
        id: u.UsuarioId, nome: u.Nome, email: u.Email,
        papel: u.Papel, empresa: u.Empresa, empresaId: u.EmpresaId,
        gestor: !!u.Gestor, permissoes: parsePermissoes(u.Permissoes)
      },
      exp: req.user.exp,
      imp: req.user.imp || null   // id do admin que assumiu esta identidade
    });
  } catch (e) { next(e); }
});

// POST /api/auth/identidade/voltar — devolve o admin à própria conta (claim `imp`), revalidado no banco.
router.post('/identidade/voltar', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.imp) {
      return res.status(400).json({ erro: 'Você não está em outra identidade.' });
    }
    // TokenVersion obrigatório, senão a nova sessão cai na próxima requisição.
    const rows = await query(
      `SELECT u.UsuarioId, u.Nome, u.Email, u.Papel, u.Status, u.EmpresaId,
              u.Gestor, u.Permissoes, u.TokenVersion, e.RazaoSocial AS Empresa
         FROM dbo.Usuario u
         JOIN dbo.Empresa e ON e.EmpresaId = u.EmpresaId
        WHERE u.UsuarioId = @id`,
      { id: req.user.imp }
    );
    const adm = rows[0];
    if (!adm || adm.Papel !== 'admin' || adm.Status !== 'aprovado') {
      fecharSessao(res);
      return res.status(403).json({
        erro: 'Sua conta de administrador não está mais ativa. Faça login de novo.'
      });
    }
    // Fecha a janela aberta pelo impersonar_inicio. req.user ainda é o alvo; o autor sai do `imp`.
    auditar({
      req, acao: ACOES.IMPERSONAR_FIM,
      alvoId: req.user.id, alvoEmpresaId: req.user.empresaId
    });
    abrirSessao(res, signToken(adm));
    console.log(`↩ Identidade devolvida: admin #${adm.UsuarioId}`);
    res.json({
      usuario: {
        id: adm.UsuarioId, nome: adm.Nome, email: adm.Email,
        papel: adm.Papel, empresa: adm.Empresa, empresaId: adm.EmpresaId,
        gestor: !!adm.Gestor, permissoes: parsePermissoes(adm.Permissoes)
      }
    });
  } catch (e) { next(e); }
});

export default router;
