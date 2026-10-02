// ============================================================
// Listas de preço (painel admin) — ver src/lista-preco.js
//   - GET  /listas-preco              espelho local das listas do Tiny
//   - POST /listas-preco/sincronizar  traz as listas do Tiny agora
//   - PUT  /empresas/:id/lista-preco  escolhe à mão a lista de uma empresa
//                                     cujo contato NÃO tem lista no Tiny
//                                     { listaPrecoId: number }
//   - POST /empresas/:id/lista-preco/tiny
//                                     relê o contato no Tiny agora e aplica
//                                     a lista que ele tiver lá
// A escolha NA APROVAÇÃO do cadastro vai junto no PATCH /usuarios/:id.
// Lista vinda do Tiny (origem 'tiny') não se troca aqui: muda-se no contato
// lá — senão o cron desfaria a troca na rodada seguinte.
// Só administradores.
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { auditar, ACOES } from '../auditoria.js';
import {
  listarListas, sincronizarListasPreco, resolverListaEscolhida, listaDaEmpresa, rotuloLista,
  aplicarListaDoTiny
} from '../lista-preco.js';
import { obterContato } from '../tiny.js';
import { vincularContatoTiny, clientesLigado } from '../tiny-contatos.js';

const router = Router();

router.get('/listas-preco', requireAuth, requireAdmin, async (_req, res, next) => {
  try { res.json(await listarListas()); }
  catch (e) { next(e); }
});

router.post('/listas-preco/sincronizar', requireAuth, requireAdmin, async (_req, res, next) => {
  let resumo;
  try { resumo = await sincronizarListasPreco(); }
  catch (e) {
    // Tiny fora do ar / token ausente: 502 com o motivo, e o painel segue
    // com as listas que já estavam no espelho.
    return res.status(502).json({ erro: 'Não foi possível ler as listas do Tiny: ' + e.message });
  }
  try { res.json({ resumo, listas: await listarListas() }); }
  catch (e) { next(e); }
});

router.put('/empresas/:id/lista-preco', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const empresaId = Number(req.params.id);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(400).json({ erro: 'Empresa inválida.' });
    if (!req.body || !('listaPrecoId' in req.body))
      return res.status(400).json({ erro: 'Escolha uma das listas de preço do Tiny.' });

    const emp = (await query('SELECT RazaoSocial FROM dbo.Empresa WHERE EmpresaId = @eid', { eid: empresaId }))[0];
    if (!emp) return res.status(404).json({ erro: 'Empresa não encontrada.' });

    const { lista, erro } = await resolverListaEscolhida(req.body.listaPrecoId);
    if (erro) return res.status(400).json({ erro });

    const antes = await listaDaEmpresa(empresaId);
    if (antes?.origem === 'tiny')
      return res.status(409).json({
        erro: 'A lista desta empresa vem do cadastro do contato no Tiny ("' + antes.descricao + '"). ' +
          'Para mudar, troque a lista no contato lá e clique em "Buscar no Tiny".'
      });
    if (antes?.id === lista.id)
      return res.json({ ok: true, lista, semMudanca: true });

    await query(
      `UPDATE dbo.Empresa SET ListaPrecoId = @lid, ListaPrecoOrigem = 'manual', AtualizadoEm = SYSUTCDATETIME()
        WHERE EmpresaId = @eid`,
      { eid: empresaId, lid: lista.id });
    auditar({
      req, acao: ACOES.LISTA_PRECO_ALTERADA, alvoEmpresaId: empresaId,
      detalhe: { empresa: emp.RazaoSocial, de: rotuloLista(antes), para: rotuloLista(lista) }
    });
    res.json({ ok: true, lista });
  } catch (e) { next(e); }
});

router.post('/empresas/:id/lista-preco/tiny', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const empresaId = Number(req.params.id);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(400).json({ erro: 'Empresa inválida.' });
    if (!clientesLigado())
      return res.status(409).json({ erro: 'A integração de clientes com o Tiny está desligada neste servidor.' });

    let emp = (await query('SELECT TinyContatoId FROM dbo.Empresa WHERE EmpresaId = @eid', { eid: empresaId }))[0];
    if (!emp) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    // Ainda sem contato vinculado (Tiny fora na hora do cadastro): tenta agora.
    // O vínculo com contato existente já aplica a lista dele.
    if (!emp.TinyContatoId) {
      await vincularContatoTiny(empresaId);
      emp = (await query('SELECT TinyContatoId FROM dbo.Empresa WHERE EmpresaId = @eid', { eid: empresaId }))[0];
      if (!emp?.TinyContatoId)
        return res.status(502).json({ erro: 'Não foi possível encontrar nem criar o contato desta empresa no Tiny.' });
    }

    // Traz as listas também: uma lista recém-criada no Tiny já aparece no seletor.
    try { await sincronizarListasPreco(); } catch { /* segue com o espelho atual */ }
    let resultado;
    try {
      const c = await obterContato(emp.TinyContatoId);
      resultado = await aplicarListaDoTiny(empresaId, c?.id_lista_preco, emp.TinyContatoId);
    } catch (e) {
      return res.status(502).json({ erro: 'Não foi possível ler o contato no Tiny: ' + e.message });
    }
    res.json({ ok: true, resultado, lista: await listaDaEmpresa(empresaId), listas: await listarListas() });
  } catch (e) { next(e); }
});

export default router;
