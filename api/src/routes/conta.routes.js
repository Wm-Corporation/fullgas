// ============================================================
// Rotas da conta do concessionário (painel "Minha conta")
//   - GET   /conta                     dados da empresa + contas internas
//   - PUT   /conta/empresa             gestor atualiza cadastro/endereço
//   - POST  /conta/subdealers          gestor cria conta interna
//   - PATCH /conta/subdealers/:id      gestor edita permissões/status/senha
//
// "Sub-dealer" = conta interna da concessionária (Gestor = 0), criada pela
// conta gestora, já aprovada, com acesso restringível por área do site
// (Permissoes = JSON array de áreas permitidas; NULL = acesso total).
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, getPool, sql } from '../db.js';
import { requireAuth, AREAS, parsePermissoes, invalidarCacheSessao } from '../auth.js';
import { erroEndereco, limparIe, erroSenha, erroCnpj, formatarCnpj, soDigitosCnpj } from '../validacao.js';
import { atualizarContatoTiny } from '../tiny-contatos.js';

const router = Router();

// Middleware local: só a conta GESTORA da empresa gerencia cadastro/internas.
function requireGestor(req, res, next) {
  if (req.user?.gestor || req.user?.papel === 'admin') return next();
  res.status(403).json({ erro: 'Apenas a conta gestora da concessionária pode fazer isso.' });
}

// GET /api/conta — visão da própria empresa: cadastro, endereço principal e
// (para o gestor) as contas internas. Sub-dealer também acessa (só leitura).
router.get('/conta', requireAuth, async (req, res, next) => {
  try {
    const emp = (await query(
      `SELECT e.EmpresaId, e.RazaoSocial, e.NomeFantasia, e.Cnpj, e.InscricaoEstadual, e.Email, e.Telefone
         FROM dbo.Empresa e WHERE e.EmpresaId = @eid`,
      { eid: req.user.empresaId }
    ))[0];
    if (!emp) return res.status(404).json({ erro: 'Empresa não encontrada.' });

    const end = (await query(
      `SELECT TOP 1 Logradouro, Numero, Complemento, Bairro, Cidade, Uf, Cep
         FROM dbo.Endereco WHERE EmpresaId = @eid
        ORDER BY Principal DESC, EnderecoId ASC`,
      { eid: req.user.empresaId }
    ))[0];

    const usuarios = await query(
      `SELECT UsuarioId, Nome, Email, Papel, Status, Gestor, Permissoes, CriadoEm
         FROM dbo.Usuario WHERE EmpresaId = @eid
        ORDER BY Gestor DESC, CriadoEm ASC`,
      { eid: req.user.empresaId }
    );

    res.json({
      empresa: {
        id: emp.EmpresaId, razaoSocial: emp.RazaoSocial, nomeFantasia: emp.NomeFantasia || '',
        cnpj: emp.Cnpj || '', inscricaoEstadual: emp.InscricaoEstadual || '',
        email: emp.Email || '', telefone: emp.Telefone || ''
      },
      endereco: end ? {
        logradouro: end.Logradouro, numero: end.Numero || '', complemento: end.Complemento || '',
        bairro: end.Bairro || '', cidade: end.Cidade, uf: end.Uf || '', cep: end.Cep || ''
      } : null,
      areas: AREAS,
      usuarios: usuarios.map(u => ({
        id: u.UsuarioId, nome: u.Nome, email: u.Email, papel: u.Papel, status: u.Status,
        gestor: !!u.Gestor, permissoes: parsePermissoes(u.Permissoes), criadoEm: u.CriadoEm
      }))
    });
  } catch (e) { next(e); }
});

// PUT /api/conta/empresa — gestor atualiza telefone/e-mail e endereço
// principal (upsert). Razão social não muda por aqui (identidade da conta).
//
// CNPJ TRAVADO para o cliente (decisão de 30/09/2026): ele é a chave do
// vínculo com o Tiny, e trocá-lo fazia o portal se ligar a OUTRO contato de lá
// e sobrescrevê-lo. Só a Fullgas muda — o admin, entrando na conta pela
// alteração de identidade (req.user.imp) —, e mesmo assim com CNPJ válido.
router.put('/conta/empresa', requireAuth, requireGestor, async (req, res, next) => {
  try {
    const { telefone, email } = req.body;
    const end = req.body.endereco || {};
    const atual = (await query('SELECT Cnpj FROM dbo.Empresa WHERE EmpresaId = @eid',
      { eid: req.user.empresaId }))[0];
    if (!atual) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    let cnpj = atual.Cnpj;
    const pedido = req.body.cnpj;
    if (pedido != null && soDigitosCnpj(pedido) !== soDigitosCnpj(atual.Cnpj)) {
      const podeTrocar = req.user.papel === 'admin' || !!req.user.imp;
      if (!podeTrocar)
        return res.status(403).json({ erro: 'O CNPJ só pode ser alterado pela Fullgas. Abra um chamado no Suporte.' });
      const errCnpj = erroCnpj(pedido);
      if (errCnpj) return res.status(400).json({ erro: errCnpj });
      cnpj = formatarCnpj(pedido);
    }
    const errEnd = erroEndereco(end);
    if (errEnd) return res.status(400).json({ erro: errEnd });
    const ie = limparIe(req.body.inscricaoEstadual);

    // O e-mail do cadastro é TAMBÉM o e-mail de LOGIN de quem está editando
    // (o gestor): no cadastro os dois nascem iguais. Ao mudar aqui, o login
    // acompanha — senão o cadastro mostra o e-mail novo mas o acesso continua
    // pelo antigo. Exige formato válido quando preenchido.
    const emailTrim = (email || '').trim();
    if (emailTrim && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailTrim))
      return res.status(400).json({ erro: 'E-mail inválido.' });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      await new sql.Request(tx)
        .input('eid', sql.Int, req.user.empresaId)
        .input('cnpj', sql.VarChar(18), cnpj)
        .input('ie', sql.VarChar(20), ie)
        .input('email', sql.NVarChar(160), email || null)
        .input('tel', sql.VarChar(30), telefone || null)
        .query(`UPDATE dbo.Empresa
                   SET Cnpj = @cnpj, InscricaoEstadual = @ie, Email = @email, Telefone = @tel,
                       AtualizadoEm = SYSUTCDATETIME()
                 WHERE EmpresaId = @eid`);

      // Sincroniza o e-mail de LOGIN do próprio gestor com o do cadastro.
      // Só o usuário que edita muda (sub-dealers têm o seu próprio login).
      if (emailTrim) {
        const colide = (await new sql.Request(tx)
          .input('email', sql.NVarChar(160), emailTrim)
          .input('uid', sql.Int, req.user.id)
          .query('SELECT 1 FROM dbo.Usuario WHERE Email = @email AND UsuarioId <> @uid')).recordset.length;
        if (colide) {
          await tx.rollback();
          return res.status(409).json({ erro: 'Este e-mail já é usado por outra conta de acesso.' });
        }
        await new sql.Request(tx)
          .input('email', sql.NVarChar(160), emailTrim)
          .input('uid', sql.Int, req.user.id)
          .query('UPDATE dbo.Usuario SET Email = @email, AtualizadoEm = SYSUTCDATETIME() WHERE UsuarioId = @uid');
      }

      // Endereço principal: atualiza o existente ou cria o primeiro.
      const atual = (await new sql.Request(tx)
        .input('eid', sql.Int, req.user.empresaId)
        .query(`SELECT TOP 1 EnderecoId FROM dbo.Endereco WHERE EmpresaId = @eid
                 ORDER BY Principal DESC, EnderecoId ASC`)).recordset[0];

      const reqEnd = new sql.Request(tx)
        .input('eid', sql.Int, req.user.empresaId)
        .input('log', sql.NVarChar(180), end.logradouro)
        .input('num', sql.NVarChar(20), end.numero)
        .input('comp', sql.NVarChar(80), end.complemento || null)
        .input('bairro', sql.NVarChar(80), end.bairro)
        .input('cidade', sql.NVarChar(80), end.cidade)
        .input('uf', sql.Char(2), String(end.uf).toUpperCase().slice(0, 2))
        .input('cep', sql.VarChar(9), end.cep);
      if (atual) {
        await reqEnd.input('id', sql.Int, atual.EnderecoId)
          .query(`UPDATE dbo.Endereco
                     SET Logradouro = @log, Numero = @num, Complemento = @comp,
                         Bairro = @bairro, Cidade = @cidade, Uf = @uf, Cep = @cep, Principal = 1
                   WHERE EnderecoId = @id`);
      } else {
        await reqEnd.query(`INSERT INTO dbo.Endereco
            (EmpresaId, Tipo, Logradouro, Numero, Complemento, Bairro, Cidade, Uf, Cep, Principal)
          VALUES (@eid, 'Entrega', @log, @num, @comp, @bairro, @cidade, @uf, @cep, 1)`);
      }

      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    // Espelha a edição no contato do Tiny (contato.alterar). Fire-and-forget:
    // se o Tiny estiver fora, o cron reconcilia na próxima rodada — a resposta
    // ao usuário nunca trava por causa do Tiny.
    atualizarContatoTiny(req.user.empresaId).catch(() => { });

    // Devolve o e-mail (agora também de login) para o front atualizar a sessão.
    res.json({ ok: true, email: emailTrim || null });
  } catch (e) {
    // Índice único filtrado do CNPJ: outra empresa já usa esse número.
    if (/UQ_Empresa_Cnpj/i.test(e.message)) return res.status(409).json({ erro: 'Este CNPJ já pertence a outra empresa.' });
    next(e);
  }
});

// POST /api/conta/subdealers — gestor cria conta interna PENDENTE.
// { nome, email, senha, permissoes: ['loja', ...] } (lista vazia = nenhum
// acesso além do portal básico; omitida/null = acesso total).
// A conta nasce 'pendente': como qualquer concessionário, só entra depois que
// o administrador Fullgas aprova (aparece na fila de /api/usuarios). O gestor
// não aprova a própria conta interna — só o admin (ver o PATCH abaixo).
router.post('/conta/subdealers', requireAuth, requireGestor, async (req, res, next) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
    const errSenha = erroSenha(senha, { email, nome });
    if (errSenha) return res.status(400).json({ erro: errSenha });

    const existe = await query('SELECT 1 FROM dbo.Usuario WHERE Email = @email', { email });
    if (existe.length) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

    const perm = Array.isArray(req.body.permissoes)
      ? JSON.stringify(req.body.permissoes.filter(a => AREAS.includes(a)))
      : null;

    const hash = await bcrypt.hash(senha, 10);
    const ins = await (await getPool()).request()
      .input('eid', sql.Int, req.user.empresaId)
      .input('nome', sql.NVarChar(120), String(nome).trim().toUpperCase())
      .input('email', sql.NVarChar(160), email)
      .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
      .input('perm', sql.VarChar(400), perm)
      .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor, Permissoes)
              OUTPUT INSERTED.UsuarioId
              VALUES (@eid, @nome, @email, @hash, 'cliente', 'pendente', 0, @perm)`);

    res.status(201).json({
      ok: true, id: ins.recordset[0].UsuarioId,
      msg: 'Conta interna criada. Aguarde a aprovação do administrador para o acesso liberar.'
    });
  } catch (e) { next(e); }
});

// PATCH /api/conta/subdealers/:id — gestor edita permissões, bloqueia/
// desbloqueia ou redefine a senha de uma conta interna DA SUA empresa.
router.patch('/conta/subdealers/:id', requireAuth, requireGestor, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    // Só contas internas (Gestor = 0) da própria empresa.
    const alvo = (await query(
      'SELECT UsuarioId, Status, Email, Nome FROM dbo.Usuario WHERE UsuarioId = @id AND EmpresaId = @eid AND Gestor = 0',
      { id, eid: req.user.empresaId }
    ))[0];
    if (!alvo) return res.status(404).json({ erro: 'Conta interna não encontrada.' });

    const { permissoes, status, senha } = req.body;
    if (status && !['aprovado', 'bloqueado'].includes(status))
      return res.status(400).json({ erro: 'Status inválido.' });
    // O gestor bloqueia/desbloqueia, mas NÃO aprova: uma conta ainda 'pendente'
    // só o administrador Fullgas libera. Assim a aprovação da conta interna
    // passa pela mesma porta que a de qualquer concessionário.
    if (status === 'aprovado' && alvo.Status === 'pendente')
      return res.status(403).json({ erro: 'A liberação de contas pendentes é feita pelo administrador Fullgas.' });
    if (senha !== undefined) {
      // `alvo` já veio do banco na checagem de propriedade acima — é dele que
      // saem o e-mail e o nome para recusar senha que repete o cadastro.
      const errSenha = erroSenha(senha, { email: alvo.Email, nome: alvo.Nome });
      if (errSenha) return res.status(400).json({ erro: errSenha });
    }

    const request = (await getPool()).request().input('id', sql.Int, id);
    const sets = [];
    if (permissoes !== undefined) {
      const perm = Array.isArray(permissoes)
        ? JSON.stringify(permissoes.filter(a => AREAS.includes(a)))
        : null; // null = acesso total
      sets.push('Permissoes = @perm'); request.input('perm', sql.VarChar(400), perm);
    }
    if (status) { sets.push('Status = @st'); request.input('st', sql.VarChar(12), status); }
    if (senha !== undefined) {
      const hash = await bcrypt.hash(String(senha), 10);
      sets.push('SenhaHash = @hash'); request.input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'));
      // Trocar a senha de uma conta interna derruba as sessões dela. É o que
      // o gestor espera ao resetar a senha de um funcionário que saiu.
      sets.push('TokenVersion = TokenVersion + 1');
    }
    // Bloquear também expulsa na hora, em vez de valer só no próximo login.
    if (status === 'bloqueado') sets.push('TokenVersion = TokenVersion + 1');
    if (!sets.length) return res.status(400).json({ erro: 'Nada para atualizar.' });
    sets.push('AtualizadoEm = SYSUTCDATETIME()');

    await request.query(`UPDATE dbo.Usuario SET ${sets.join(', ')} WHERE UsuarioId = @id`);
    // Permissões novas (e revogação, quando houve) valem já na próxima
    // requisição, sem esperar o TTL do cache de sessão.
    invalidarCacheSessao(id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/conta/subdealers/:id — gestor exclui uma conta interna DA SUA
// empresa. Só contas internas (Gestor = 0); nunca a própria conta gestora nem
// a de outra empresa. Se a conta já tem histórico (pedidos/reivindicações), a
// FK barra a exclusão — nesse caso oriente a bloquear pelo PATCH de status.
router.delete('/conta/subdealers/:id', requireAuth, requireGestor, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode excluir a própria conta.' });

    // Restringe à própria empresa e a contas internas (não gestoras).
    const alvo = (await query(
      'SELECT UsuarioId FROM dbo.Usuario WHERE UsuarioId = @id AND EmpresaId = @eid AND Gestor = 0',
      { id, eid: req.user.empresaId }
    ))[0];
    if (!alvo) return res.status(404).json({ erro: 'Conta interna não encontrada.' });

    try {
      await query('DELETE FROM dbo.Usuario WHERE UsuarioId = @id', { id });
    } catch (e) {
      // FK: a conta tem pedidos/reivindicações — histórico não se apaga.
      if (/REFERENCE constraint|conflicted with the REFERENCE|instrução DELETE conflitou/i.test(e.message))
        return res.status(409).json({
          erro: 'Esta conta tem histórico (pedidos, reivindicações...) e não pode ser excluída — bloqueie o acesso dela.'
        });
      throw e;
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
