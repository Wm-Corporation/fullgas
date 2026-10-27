-- 052 - Fatura de pedido cancelado fica 'Anulada'.
-- Corrige faturas que ficaram 'Emitida' com todos os pedidos dela cancelados (somavam no
-- "Total faturado" da concessionaria). A API ja mostra essas como Anulada; isto acerta o registro.
-- Idempotente. ASCII.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

UPDATE f SET f.Status = 'Anulada'
  FROM dbo.Fatura f
 WHERE f.Status = 'Emitida'
   AND EXISTS (SELECT 1 FROM dbo.PedidoFatura pf WHERE pf.FaturaId = f.FaturaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.PedidoFatura pf
                     JOIN dbo.Pedido p ON p.PedidoId = pf.PedidoId
                    WHERE pf.FaturaId = f.FaturaId AND p.Status <> N'Cancelado');
PRINT '052: faturas de pedido cancelado anuladas: ' + CAST(@@ROWCOUNT AS VARCHAR(12));
GO
