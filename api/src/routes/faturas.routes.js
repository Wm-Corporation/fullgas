// ---- Faturas (Conta financeira) ----
// Só Tipo 'Fatura', com itens, pedidos e dados da empresa para o PDF.
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireArea } from '../auth.js';

const router = Router();

// Itens de todas as faturas de uma vez (evita N+1): Map<FaturaId, item[]>.
async function itensPorFatura(faturaIds) {
  const map = new Map();
  if (!faturaIds.length) return map;
  const params = {};
  const marks = faturaIds.map((id, i) => { params['f' + i] = id; return '@f' + i; });
  const rows = await query(
    `SELECT pf.FaturaId, p.NumeroPedido,
            pi.Sku, pi.NomeProduto, pi.PrecoUnitario, pi.Quantidade, pi.Subtotal
       FROM dbo.PedidoFatura pf
       JOIN dbo.PedidoItem pi ON pi.PedidoId = pf.PedidoId
       JOIN dbo.Pedido p ON p.PedidoId = pf.PedidoId
      WHERE pf.FaturaId IN (${marks.join(',')})
      ORDER BY pf.FaturaId, pi.PedidoItemId`,
    params
  );
  for (const r of rows) {
    if (!map.has(r.FaturaId)) map.set(r.FaturaId, []);
    map.get(r.FaturaId).push(r);
  }
  return map;
}

// Dados do destinatário (empresa + endereço principal) por EmpresaId, em lote.
async function empresasPorId(empresaIds) {
  const map = new Map();
  if (!empresaIds.length) return map;
  const params = {};
  const marks = empresaIds.map((id, i) => { params['e' + i] = id; return '@e' + i; });
  const rows = await query(
    `SELECT e.EmpresaId, e.RazaoSocial, e.NomeFantasia, e.Cnpj, e.Pais,
            en.Logradouro, en.Numero, en.Complemento, en.Bairro,
            en.Cidade, en.Uf, en.Cep, en.Pais AS EnderecoPais
       FROM dbo.Empresa e
       OUTER APPLY (
         SELECT TOP 1 * FROM dbo.Endereco en
          WHERE en.EmpresaId = e.EmpresaId
          ORDER BY en.Principal DESC, en.EnderecoId ASC
       ) en
      WHERE e.EmpresaId IN (${marks.join(',')})`,
    params
  );
  for (const r of rows) map.set(r.EmpresaId, r);
  return map;
}

// GET /api/faturas — cliente vê as da empresa; admin vê todas. Exige a área 'financeiro'.
router.get('/faturas', requireAuth, requireArea('financeiro'), async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const faturas = await query(
      `SELECT f.FaturaId, f.NumeroFatura, f.Tipo, f.DataEmissao, f.Valor, f.Moeda,
              f.Status, f.EmpresaId, f.ReferenciaReivindicacao
         FROM dbo.Fatura f
        WHERE f.Tipo = 'Fatura'
          AND (@eid IS NULL OR f.EmpresaId = @eid)
        ORDER BY f.DataEmissao DESC, f.FaturaId DESC`,
      { eid }
    );

    const [itens, empresas] = await Promise.all([
      itensPorFatura(faturas.map(f => f.FaturaId)),
      empresasPorId([...new Set(faturas.map(f => f.EmpresaId))])
    ]);

    res.json(faturas.map(f => {
      const linhas = itens.get(f.FaturaId) || [];
      const emp = empresas.get(f.EmpresaId) || {};
      const pedidos = [...new Set(linhas.map(l => l.NumeroPedido))];
      return {
        id: f.NumeroFatura,
        numero: f.NumeroFatura,
        tipo: f.Tipo,
        data: f.DataEmissao instanceof Date ? f.DataEmissao.toISOString() : f.DataEmissao,
        valor: Number(f.Valor),
        moeda: f.Moeda,
        status: f.Status,
        referencia: f.ReferenciaReivindicacao || null,
        empresa: emp.RazaoSocial || '',
        empresaId: f.EmpresaId,
        cnpj: emp.Cnpj || '',
        pais: emp.Pais || '',
        pedidos,
        endereco: emp.Logradouro ? {
          logradouro: emp.Logradouro, numero: emp.Numero || '', complemento: emp.Complemento || '',
          bairro: emp.Bairro || '', cidade: emp.Cidade || '', uf: emp.Uf || '',
          cep: emp.Cep || '', pais: emp.EnderecoPais || emp.Pais || ''
        } : null,
        itens: linhas.map(l => ({
          sku: l.Sku, nome: l.NomeProduto || '', preco: Number(l.PrecoUnitario),
          qtd: l.Quantidade, subtotal: Number(l.Subtotal)
        }))
      };
    }));
  } catch (e) { next(e); }
});

export default router;
