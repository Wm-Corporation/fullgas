// ============================================================
// Listas de preço (painel admin) — ver src/lista-preco.js
//   - GET  /listas-preco              espelho local das listas do Tiny
//   - POST /listas-preco/sincronizar  traz as listas do Tiny agora
//   - PUT  /empresas/:id/lista-preco  troca a lista de uma empresa
//                                     { listaPrecoId: number | null }
// A escolha NA APROVAÇÃO do cadastro vai junto no PATCH /usuarios/:id.
// Só administradores.
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { auditar, ACOES } from '../auditoria.js';
import {
  listarListas, sincronizarListasPreco, resolverListaEscolhida, listaDaEmpresa, rotuloLista
} from '../lista-preco.js';

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
      return res.status(400).json({ erro: 'Escolha a lista de preço (ou preço cheio).' });

    const emp = (await query('SELECT RazaoSocial FROM dbo.Empresa WHERE EmpresaId = @eid', { eid: empresaId }))[0];
    if (!emp) return res.status(404).json({ erro: 'Empresa não encontrada.' });

    const { lista, erro } = await resolverListaEscolhida(req.body.listaPrecoId);
    if (erro) return res.status(400).json({ erro });

    const antes = await listaDaEmpresa(empresaId);
    if ((antes?.id ?? null) === (lista?.id ?? null))
      return res.json({ ok: true, lista, semMudanca: true });

    await query(
      'UPDATE dbo.Empresa SET ListaPrecoId = @lid, AtualizadoEm = SYSUTCDATETIME() WHERE EmpresaId = @eid',
      { eid: empresaId, lid: lista?.id ?? null });
    auditar({
      req, acao: ACOES.LISTA_PRECO_ALTERADA, alvoEmpresaId: empresaId,
      detalhe: { empresa: emp.RazaoSocial, de: rotuloLista(antes), para: rotuloLista(lista) }
    });
    res.json({ ok: true, lista });
  } catch (e) { next(e); }
});

export default router;
