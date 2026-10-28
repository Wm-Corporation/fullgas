// ---- Faturas (Conta financeira) ----
// Só Tipo 'Fatura', com itens, pedidos, dados da empresa e do comprador para o PDF.
// Cobra só o que tinha estoque; as peças em black order vêm à parte, só para informar.
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
  // Fatura por remessa tem os próprios itens (FaturaItem); a antiga, cheia, usa os itens do pedido.
  const rows = await query(
    `SELECT pf.FaturaId, p.NumeroPedido,
            fi.Sku, fi.NomeProduto, fi.PrecoUnitario, fi.Quantidade, fi.Subtotal, fi.FaturaItemId AS Ordem
       FROM dbo.PedidoFatura pf
       JOIN dbo.Pedido p ON p.PedidoId = pf.PedidoId
       JOIN dbo.FaturaItem fi ON fi.FaturaId = pf.FaturaId
      WHERE pf.FaturaId IN (${marks.join(',')})
     UNION ALL
     SELECT pf.FaturaId, p.NumeroPedido,
            pi.Sku, pi.NomeProduto, pi.PrecoUnitario, pi.Quantidade, pi.Subtotal, pi.PedidoItemId AS Ordem
       FROM dbo.PedidoFatura pf
       JOIN dbo.PedidoItem pi ON pi.PedidoId = pf.PedidoId
       JOIN dbo.Pedido p ON p.PedidoId = pf.PedidoId
      WHERE pf.FaturaId IN (${marks.join(',')}) AND pi.Quantidade > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.FaturaItem x WHERE x.FaturaId = pf.FaturaId)
      ORDER BY FaturaId, Ordem`,
    params
  );
  for (const r of rows) {
    if (!map.has(r.FaturaId)) map.set(r.FaturaId, []);
    map.get(r.FaturaId).push(r);
  }
  return map;
}

// Pedido(s) de cada fatura: data, comprador e lista de preço. Map<FaturaId, linha[]>.
async function pedidosPorFatura(faturaIds) {
  const map = new Map();
  if (!faturaIds.length) return map;
  const params = {};
  const marks = faturaIds.map((id, i) => { params['f' + i] = id; return '@f' + i; });
  const rows = await query(
    `SELECT pf.FaturaId, p.NumeroPedido, p.DataPedido, p.ListaPrecoPercentual,
            lp.Descricao AS ListaNome, u.Nome AS CompradorNome, u.Email AS CompradorEmail
       FROM dbo.PedidoFatura pf
       JOIN dbo.Pedido p ON p.PedidoId = pf.PedidoId
       JOIN dbo.Usuario u ON u.UsuarioId = p.UsuarioId
       LEFT JOIN dbo.ListaPreco lp ON lp.ListaPrecoId = p.ListaPrecoId
      WHERE pf.FaturaId IN (${marks.join(',')})
      ORDER BY pf.FaturaId, p.PedidoId`,
    params
  );
  for (const r of rows) {
    if (!map.has(r.FaturaId)) map.set(r.FaturaId, []);
    map.get(r.FaturaId).push(r);
  }
  return map;
}

// Peças da compra que ficaram em black order (não cobradas nesta fatura). Map<FaturaId, linha[]>.
async function blackOrdersPorFatura(faturaIds) {
  const map = new Map();
  if (!faturaIds.length) return map;
  const params = {};
  const marks = faturaIds.map((id, i) => { params['f' + i] = id; return '@f' + i; });
  const rows = await query(
    `SELECT pf.FaturaId, bo.Sku, bo.NomeProduto, bo.Quantidade
       FROM dbo.PedidoFatura pf
       JOIN dbo.BlackOrder bo ON bo.PedidoId = pf.PedidoId
      WHERE pf.FaturaId IN (${marks.join(',')})
      ORDER BY pf.FaturaId, bo.BlackOrderId`,
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
            e.InscricaoEstadual, e.Telefone, e.Email,
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

// Fatura de pedido cancelado é Anulada, mesmo que o registro tenha ficado 'Emitida' (migration 052).
const STATUS_EFETIVO =
  `CASE WHEN f.Status = 'Emitida'
         AND EXISTS (SELECT 1 FROM dbo.PedidoFatura pf JOIN dbo.Pedido p ON p.PedidoId = pf.PedidoId
                      WHERE pf.FaturaId = f.FaturaId)
         AND NOT EXISTS (SELECT 1 FROM dbo.PedidoFatura pf JOIN dbo.Pedido p ON p.PedidoId = pf.PedidoId
                          WHERE pf.FaturaId = f.FaturaId AND p.Status <> N'Cancelado')
        THEN 'Anulada' ELSE f.Status END`;

// GET /api/faturas — cliente vê as da empresa; admin vê todas. Exige a área 'financeiro'.
router.get('/faturas', requireAuth, requireArea('financeiro'), async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const faturas = await query(
      `SELECT f.FaturaId, f.NumeroFatura, f.Tipo, f.DataEmissao, f.Valor, f.Moeda,
              ${STATUS_EFETIVO} AS Status, f.EmpresaId, f.ReferenciaReivindicacao
         FROM dbo.Fatura f
        WHERE f.Tipo = 'Fatura'
          AND (@eid IS NULL OR f.EmpresaId = @eid)
        ORDER BY f.DataEmissao DESC, f.FaturaId DESC`,
      { eid }
    );

    const ids = faturas.map(f => f.FaturaId);
    const [itens, empresas, pedidosFat, blackOrders] = await Promise.all([
      itensPorFatura(ids),
      empresasPorId([...new Set(faturas.map(f => f.EmpresaId))]),
      pedidosPorFatura(ids),
      blackOrdersPorFatura(ids)
    ]);

    res.json(faturas.map(f => {
      const linhas = itens.get(f.FaturaId) || [];
      const emp = empresas.get(f.EmpresaId) || {};
      const pedidos = [...new Set(linhas.map(l => l.NumeroPedido))];
      const ped = (pedidosFat.get(f.FaturaId) || [])[0] || null;
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
        fantasia: emp.NomeFantasia || '',
        ie: emp.InscricaoEstadual || '',
        telefone: emp.Telefone || '',
        email: emp.Email || '',
        pedidos,
        compra: ped ? {
          data: ped.DataPedido instanceof Date ? ped.DataPedido.toISOString() : ped.DataPedido,
          comprador: ped.CompradorNome || '',
          compradorEmail: ped.CompradorEmail || '',
          lista: ped.ListaNome || '',
          listaPercentual: ped.ListaPrecoPercentual == null ? null : Number(ped.ListaPrecoPercentual)
        } : null,
        blackOrders: (blackOrders.get(f.FaturaId) || []).map(b => ({
          sku: b.Sku, nome: b.NomeProduto, qtd: b.Quantidade
        })),
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
