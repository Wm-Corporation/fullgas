// ---- Rastreador de pré-venda (logística, sem valores) ----
// Peças em pré-venda ainda não enviadas: 'Aguardando' (sem estoque) ou 'Disponivel'.
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAreaAny } from '../auth.js';

const router = Router();

// GET /api/prevenda — cliente vê as suas; admin vê todas. Aparece na tela Financeiro.
router.get('/prevenda', requireAuth, requireAreaAny(['financeiro', 'pedidos']), async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const rows = await query(
      `SELECT pi.PedidoItemId, pi.Sku, pi.NomeProduto, pi.Quantidade, pi.QuantidadeEnviada,
              p.NumeroPedido, p.DataPedido, p.EmpresaId, e.RazaoSocial AS Empresa,
              pr.Estoque AS EstoqueAtual, pr.PrevisaoChegada
         FROM dbo.PedidoItem pi
         JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
         JOIN dbo.Empresa e ON e.EmpresaId = p.EmpresaId
         LEFT JOIN dbo.Produto pr ON pr.ProdutoId = pi.ProdutoId
        WHERE pi.EmBackorder = 1 AND pi.Quantidade > pi.QuantidadeEnviada
          AND p.Status <> 'Cancelado'
          AND (@eid IS NULL OR p.EmpresaId = @eid)
        ORDER BY e.RazaoSocial, p.NumeroPedido, pi.PedidoItemId`,
      { eid }
    );
    res.json(rows.map(r => ({
      itemId: r.PedidoItemId,
      artigo: r.Sku,
      nome: r.NomeProduto,
      qtd: r.Quantidade,
      qtdEnviada: r.QuantidadeEnviada,
      pendente: r.Quantidade - r.QuantidadeEnviada,
      pedido: r.NumeroPedido,
      data: r.DataPedido instanceof Date ? r.DataPedido.toISOString() : (r.DataPedido || null),
      empresa: r.Empresa,
      empresaId: r.EmpresaId,
      estoque: r.EstoqueAtual == null ? 0 : r.EstoqueAtual,
      previsao: r.PrevisaoChegada || null,
      // Disponível só quando o estoque cobre o que falta.
      status: (r.EstoqueAtual || 0) >= (r.Quantidade - r.QuantidadeEnviada) ? 'Disponivel' : 'Aguardando'
    })));
  } catch (e) { next(e); }
});

export default router;
