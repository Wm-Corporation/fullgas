// ---- Usuários (painel admin) ----
//   GET    /usuarios       lista (com empresa, CNPJ e endereço)
//   POST   /usuarios       cria ADMINISTRADOR
//   PATCH  /usuarios/:id   aprova / bloqueia / muda papel
//   DELETE /usuarios/:id   remove
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin, signToken, parsePermissoes, abrirSessao, invalidarCacheSessao } from '../auth.js';
import { auditar, ACOES } from '../auditoria.js';
import { erroSenha } from '../validacao.js';
import { sqlNaFabrica } from '../fabrica.js';
import { resolverListaEscolhida, rotuloLista } from '../lista-preco.js';

const router = Router();

// Linha do banco → formato do front.
function toUsuario(r) {
  return {
    id: r.UsuarioId,
    nome: r.Nome,
    email: r.Email,
    papel: r.Papel,
    status: r.Status,
    gestor: !!r.Gestor,       // false = conta interna (sub-dealer)
    empresa: r.Empresa || '',
    empresaId: r.EmpresaId,
    fabrica: !!r.Fabrica,     // ver fabrica.js
    cnpj: r.Cnpj || '',
    inscricaoEstadual: r.InscricaoEstadual || '',
    telefone: r.Telefone || '',
    tinyContatoId: r.TinyContatoId || null,   // contato do Tiny atrelado ao CNPJ
    // Lista de preço da empresa; null = preço cheio. origem: 'tiny' | 'manual'.
    listaPreco: r.ListaPrecoId ? {
      id: r.ListaPrecoId, descricao: r.ListaDescricao,
      percentual: Number(r.ListaPercentual), ativa: !!r.ListaAtiva,
      origem: r.ListaPrecoOrigem || 'manual'
    } : null,
    criadoEm: r.CriadoEm,
    endereco: r.Logradouro ? {
      logradouro: r.Logradouro, numero: r.Numero || '', complemento: r.Complemento || '',
      bairro: r.Bairro || '', cidade: r.Cidade || '', uf: r.Uf || '', cep: r.Cep || ''
    } : null
  };
}

const SELECT_USUARIO =
  `SELECT u.UsuarioId, u.Nome, u.Email, u.Papel, u.Status, u.Gestor, u.CriadoEm, u.EmpresaId,
          e.RazaoSocial AS Empresa, e.Cnpj, e.InscricaoEstadual, e.Telefone, e.TinyContatoId,
          ${sqlNaFabrica('u.EmpresaId')} AS Fabrica,
          e.ListaPrecoId, e.ListaPrecoOrigem, lp.Descricao AS ListaDescricao, lp.Percentual AS ListaPercentual, lp.Ativa AS ListaAtiva,
          en.Logradouro, en.Numero, en.Complemento, en.Bairro, en.Cidade, en.Uf, en.Cep
     FROM dbo.Usuario u
     JOIN dbo.Empresa e ON e.EmpresaId = u.EmpresaId
     LEFT JOIN dbo.ListaPreco lp ON lp.ListaPrecoId = e.ListaPrecoId
     OUTER APPLY (
       SELECT TOP 1 d.Logradouro, d.Numero, d.Complemento, d.Bairro, d.Cidade, d.Uf, d.Cep
         FROM dbo.Endereco d
        WHERE d.EmpresaId = e.EmpresaId
        ORDER BY d.Principal DESC, d.EnderecoId ASC
     ) en`;

// GET /api/usuarios — lista com empresa e endereço principal (pendentes primeiro).
router.get('/usuarios', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await query(
      SELECT_USUARIO +
      ' ORDER BY CASE WHEN u.Status = \'pendente\' THEN 0 ELSE 1 END, u.CriadoEm DESC'
    );
    res.json(rows.map(toUsuario));
  } catch (e) { next(e); }
});

// POST /api/usuarios — cria ADMINISTRADOR: { nome, email, senha }.
// Nasce aprovado, na empresa de quem cria, com senha mínima de 8.
const SENHA_MINIMA_ADMIN = 8;
router.post('/usuarios', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');

    if (!nome || !email || !senha)
      return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ erro: 'E-mail inválido.' });
    const errSenha = erroSenha(senha, { email, nome, min: SENHA_MINIMA_ADMIN });
    if (errSenha) return res.status(400).json({ erro: errSenha });

    const existe = await query('SELECT 1 FROM dbo.Usuario WHERE Email = @email', { email });
    if (existe.length) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

    // Hash gravado como bytes (VARBINARY).
    const hash = await bcrypt.hash(senha, 10);
    const ins = await (await getPool()).request()
      .input('eid', sql.Int, req.user.empresaId)
      .input('nome', sql.NVarChar(120), nome.toUpperCase())
      .input('email', sql.NVarChar(160), email)
      .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
      .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor, Permissoes)
              OUTPUT INSERTED.UsuarioId
              VALUES (@eid, @nome, @email, @hash, 'admin', 'aprovado', 1, NULL)`);

    const id = ins.recordset[0].UsuarioId;
    auditar({
      req, acao: ACOES.ADMIN_CRIADO,
      alvoId: id, alvoEmail: email, alvoEmpresaId: req.user.empresaId,
      detalhe: { nome: nome.toUpperCase() }
    });
    // Sem e-mail no log (fica na trilha de auditoria).
    console.log(`+ Administrador criado: #${id} por admin #${req.user.id}.`);

    const rows = await query(SELECT_USUARIO + ' WHERE u.UsuarioId = @id', { id });
    res.status(201).json(toUsuario(rows[0]));
  } catch (e) {
    if (/UQ_Usuario_Email/i.test(e.message))
      return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });
    next(e);
  }
});

// PATCH /api/usuarios/:id — status e/ou papel.
// Aprovar cliente exige lista de preço: a do Tiny, ou `listaPrecoId` escolhida (origem 'manual').
const PAPEIS = ['admin', 'cliente'];
const STATUS = ['pendente', 'aprovado', 'bloqueado'];
router.patch('/usuarios/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    // Impede o admin de se auto-bloquear ou se rebaixar (evita ficar sem acesso).
    if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode alterar o próprio usuário.' });

    const { status, papel } = req.body;
    if (status && !STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
    if (papel && !PAPEIS.includes(papel)) return res.status(400).json({ erro: 'Papel inválido.' });
    if (!status && !papel) return res.status(400).json({ erro: 'Nada para atualizar.' });

    // Aprovação de cadastro de cliente: a lista de preço é obrigatória.
    let aprovacao = null;
    if (status === 'aprovado') {
      const atual = (await query(
        'SELECT Status, Papel, EmpresaId FROM dbo.Usuario WHERE UsuarioId = @id', { id }))[0];
      if (!atual) return res.status(404).json({ erro: 'Usuário não encontrado.' });
      const emp = (await query(
        'SELECT ListaPrecoId, ListaPrecoOrigem FROM dbo.Empresa WHERE EmpresaId = @eid', { eid: atual.EmpresaId }))[0] || {};
      atual.ListaPrecoId = emp.ListaPrecoId;
      const temListaDoTiny = emp.ListaPrecoId && emp.ListaPrecoOrigem === 'tiny';
      if (atual.Status === 'pendente' && atual.Papel === 'cliente' && papel !== 'admin' && !temListaDoTiny) {
        // Sem lista do Tiny: escolha obrigatória, salvo se a empresa já tem uma manual.
        if (req.body.listaPrecoId != null || !atual.ListaPrecoId) {
          const { lista, erro } = await resolverListaEscolhida(req.body.listaPrecoId);
          if (erro) return res.status(400).json({
            erro: 'O contato desta empresa não tem lista de preço no Tiny. ' + erro
          });
          aprovacao = { empresaId: atual.EmpresaId, lista };
        }
      }
    }

    const request = (await getPool()).request().input('id', sql.Int, id);
    const sets = [];
    if (status) { sets.push('Status = @status'); request.input('status', sql.VarChar(12), status); }
    if (papel) { sets.push('Papel = @papel'); request.input('papel', sql.VarChar(10), papel); }

    // Bloqueio ou mudança de papel derruba as sessões na hora (migration 037).
    if (status === 'bloqueado' || papel) sets.push('TokenVersion = TokenVersion + 1');
    sets.push('AtualizadoEm = SYSUTCDATETIME()');

    let texto = `UPDATE dbo.Usuario SET ${sets.join(', ')} WHERE UsuarioId = @id;`;
    if (aprovacao) {
      // Um único lote em transação: ou aprova COM a lista, ou nada muda.
      request.input('eid', sql.Int, aprovacao.empresaId);
      request.input('lid', sql.Int, aprovacao.lista.id);
      texto = `SET XACT_ABORT ON; BEGIN TRAN;
               UPDATE dbo.Empresa SET ListaPrecoId = @lid, ListaPrecoOrigem = 'manual', AtualizadoEm = SYSUTCDATETIME()
                WHERE EmpresaId = @eid;
               ${texto}
               COMMIT;`;
    }
    const r = await request.query(texto);
    if (!r.rowsAffected[r.rowsAffected.length - 1]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    invalidarCacheSessao(id);

    // Mudanças de privilégio vão para a trilha.
    if (papel) auditar({ req, acao: ACOES.PAPEL_ALTERADO, alvoId: id, detalhe: { papel } });
    if (status) auditar({ req, acao: ACOES.STATUS_ALTERADO, alvoId: id, detalhe: { status } });
    if (aprovacao) auditar({
      req, acao: ACOES.LISTA_PRECO_ALTERADA, alvoId: id, alvoEmpresaId: aprovacao.empresaId,
      detalhe: { na: 'aprovacao', para: rotuloLista(aprovacao.lista) }
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/usuarios/:id — remove. Não exclui a si mesmo; com histórico, a FK barra (bloqueie).
router.delete('/usuarios/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode excluir o próprio usuário.' });

    const alvo = (await query('SELECT Nome FROM dbo.Usuario WHERE UsuarioId = @id', { id }))[0];
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    try {
      await query('DELETE FROM dbo.Usuario WHERE UsuarioId = @id', { id });
    } catch (e) {
      // FK: o usuário tem pedidos/reivindicações/etc. — histórico não se apaga.
      if (/REFERENCE constraint|conflicted with the REFERENCE|instrução DELETE conflitou/i.test(e.message))
        return res.status(409).json({
          erro: 'Este usuário tem histórico (pedidos, reivindicações...) e não pode ser excluído — bloqueie o acesso dele.'
        });
      throw e;
    }
    // Derruba a sessão já, sem esperar o cache.
    invalidarCacheSessao(id);
    // Nome no detalhe, porque o usuário deixou de existir.
    auditar({ req, acao: ACOES.USUARIO_EXCLUIDO, alvoId: id, detalhe: { nome: alvo.Nome } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/usuarios/:id/identidade — admin entra na conta do cliente ("Entrar na conta").
// Token marcado com `imp`, validade de 1 h. Não vale para si mesmo nem para outro admin.
router.post('/usuarios/:id/identidade', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    if (id === req.user.id) return res.status(400).json({ erro: 'Você já está na sua própria conta.' });
    // Sem identidade encadeada (o `imp` guarda um id só).
    if (req.user.imp)
      return res.status(400).json({ erro: 'Você já está em outra identidade. Volte para a sua conta primeiro.' });

    const alvo = (await query(
      `SELECT u.UsuarioId, u.Nome, u.Email, u.Papel, u.Status, u.EmpresaId, u.Gestor, u.Permissoes,
              u.TokenVersion, e.RazaoSocial AS Empresa
         FROM dbo.Usuario u
         JOIN dbo.Empresa e ON e.EmpresaId = u.EmpresaId
        WHERE u.UsuarioId = @id`, { id }))[0];
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (alvo.Papel === 'admin')
      return res.status(400).json({ erro: 'Não é possível assumir a identidade de outro administrador.' });

    // Trilha: liga as ações seguintes a este admin.
    auditar({
      req, acao: ACOES.IMPERSONAR_INICIO,
      alvoId: alvo.UsuarioId, alvoEmail: alvo.Email, alvoEmpresaId: alvo.EmpresaId,
      detalhe: { empresa: alvo.Empresa, papelAlvo: alvo.Papel, statusAlvo: alvo.Status }
    });
    console.log(`↪ Identidade assumida: admin #${req.user.id} → #${alvo.UsuarioId} (empresa "${alvo.Empresa}").`);

    // Troca os cookies; a volta é pelo claim `imp` (POST /api/auth/identidade/voltar).
    abrirSessao(res, signToken(alvo, { imp: req.user.id, expiresIn: '1h' }));

    res.json({
      // Para o front desenhar a tarja de aviso já na primeira tela.
      imp: req.user.id,
      usuario: {
        id: alvo.UsuarioId, nome: alvo.Nome, email: alvo.Email,
        papel: alvo.Papel, empresa: alvo.Empresa, empresaId: alvo.EmpresaId,
        gestor: !!alvo.Gestor,
        permissoes: parsePermissoes(alvo.Permissoes),   // null = acesso total
        status: alvo.Status
      }
    });
  } catch (e) { next(e); }
});

export default router;
