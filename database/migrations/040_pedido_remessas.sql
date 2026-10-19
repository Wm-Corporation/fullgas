USE FullgasB2B;
GO

-- 040 - Remessas: pedido vai ao Tiny no envio. Status 'Parcial', escopo 'remessa' e PedidoItem.QuantidadeExportada.
-- Itens ja exportados na regra antiga sao marcados para nao ir de novo.
-- Cada passo em seu proprio lote (GO): coluna nova no mesmo lote do ALTER falha, e o deploy nao para em erro.
-- Idempotente. ASCII (NCHAR para acentos).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
GO

/* ---- 1. Pedido.Status aceita 'Parcial' ---------------------------------- */
DECLARE @sep NVARCHAR(20) = N'Em separa' + NCHAR(231) + NCHAR(227) + N'o';  -- "Em separacao"

IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = 'CK_Pedido_Status' AND parent_object_id = OBJECT_ID('dbo.Pedido'))
    ALTER TABLE dbo.Pedido DROP CONSTRAINT CK_Pedido_Status;

-- 'Processando' segue aceito como legado (ver migration 028).
DECLARE @sql NVARCHAR(MAX) = N'ALTER TABLE dbo.Pedido ADD CONSTRAINT CK_Pedido_Status ' +
  N'CHECK (Status IN (N''Pendente'', N''Aprovado'', N''Processando'', N''Parcial'', N''Enviado'', ' +
  N'N''Entregue'', N''Cancelado'', N''' + @sep + N'''))';
EXEC sp_executesql @sql;
PRINT '040 [1/4]: Pedido.Status aceita Parcial.';
GO

/* ---- 2. TinyPedidoExport.Escopo aceita 'remessa' ------------------------ */
IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = 'CK_TinyPedidoExport_Escopo' AND parent_object_id = OBJECT_ID('dbo.TinyPedidoExport'))
    ALTER TABLE dbo.TinyPedidoExport DROP CONSTRAINT CK_TinyPedidoExport_Escopo;

ALTER TABLE dbo.TinyPedidoExport ADD CONSTRAINT CK_TinyPedidoExport_Escopo
    CHECK (Escopo IN ('normal', 'backorder', 'remessa'));
PRINT '040 [2/4]: TinyPedidoExport.Escopo aceita remessa.';
GO

/* ---- 3. PedidoItem.QuantidadeExportada ---------------------------------- */
IF COL_LENGTH('dbo.PedidoItem', 'QuantidadeExportada') IS NULL
BEGIN
    ALTER TABLE dbo.PedidoItem ADD QuantidadeExportada INT NOT NULL
        CONSTRAINT DF_PedidoItem_QuantidadeExportada DEFAULT (0);
    PRINT '040 [3/4]: PedidoItem.QuantidadeExportada criada.';
END
ELSE
    PRINT '040 [3/4]: PedidoItem.QuantidadeExportada ja existe.';
GO

/* ---- 4. Quem JA foi ao Tiny -------------------------------------------- */
-- Lote proprio (usa a coluna do passo 3). Repetir da o mesmo resultado.

-- 4a. Exportacao 'normal' ja levou todas as pecas em estoque (cancelada nao conta).
UPDATE pi
   SET pi.QuantidadeExportada = pi.Quantidade
  FROM dbo.PedidoItem pi
 WHERE pi.EmBackorder = 0
   AND pi.QuantidadeExportada <> pi.Quantidade
   AND EXISTS (SELECT 1 FROM dbo.TinyPedidoExport e
                WHERE e.PedidoId = pi.PedidoId
                  AND e.Escopo = 'normal' AND e.Status <> 'cancelado');
PRINT '040 [4/4]: itens de pedidos ja exportados marcados (regra antiga preservada).';

-- 4b. Pre-venda liberada ja foi ao Tiny.
UPDATE pi
   SET pi.QuantidadeExportada = pi.QuantidadeEnviada
  FROM dbo.PedidoItem pi
 WHERE pi.EmBackorder = 1
   AND pi.QuantidadeEnviada > 0
   AND pi.QuantidadeExportada < pi.QuantidadeEnviada;
PRINT '040 [4/4]: itens de pre-venda ja liberados marcados.';
GO

/* ---- Conferencia (o deploy nao para em erro de SQL) --------------------- */
SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' itens marcados como ja exportados (esperado: os de pedidos antigos)'
  FROM dbo.PedidoItem WHERE QuantidadeExportada > 0;
SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' pedidos em Parcial'
  FROM dbo.Pedido WHERE Status = N'Parcial';
GO
