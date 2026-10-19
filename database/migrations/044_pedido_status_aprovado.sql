USE FullgasB2B;
GO

-- 044 - "Em separacao" vira "Aprovado". Idempotente. ASCII (NCHAR para acentos).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
GO

/* ---- 1. CHECK aceita 'Aprovado' ----------------------------------------- */
-- 'Processando' e "Em separacao" seguem aceitos como legado.
DECLARE @sep NVARCHAR(20) = N'Em separa' + NCHAR(231) + NCHAR(227) + N'o';

IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = 'CK_Pedido_Status' AND parent_object_id = OBJECT_ID('dbo.Pedido'))
    ALTER TABLE dbo.Pedido DROP CONSTRAINT CK_Pedido_Status;

DECLARE @sql NVARCHAR(MAX) = N'ALTER TABLE dbo.Pedido ADD CONSTRAINT CK_Pedido_Status ' +
  N'CHECK (Status IN (N''Pendente'', N''Aprovado'', N''Processando'', N''Parcial'', ' +
  N'N''Enviado'', N''Entregue'', N''Cancelado'', N''' + @sep + N'''))';
EXEC sp_executesql @sql;
PRINT '044 [1/2]: Pedido.Status aceita Aprovado.';
GO

/* ---- 2. Pedidos em "Em separacao" passam a "Aprovado" -------------------- */
DECLARE @sep NVARCHAR(20) = N'Em separa' + NCHAR(231) + NCHAR(227) + N'o';
UPDATE dbo.Pedido SET Status = N'Aprovado' WHERE Status IN (@sep, N'Processando');
PRINT '044 [2/2]: pedidos em separacao renomeados para Aprovado.';
GO

/* ---- Conferencia (o deploy nao para em erro de SQL) --------------------- */
SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' pedidos em Aprovado'
  FROM dbo.Pedido WHERE Status = N'Aprovado';
-- Pedidos com pecas aguardando remessa (acima de 0 e normal).
SELECT CONVERT(VARCHAR(20), COUNT(DISTINCT p.PedidoId)) +
       ' pedidos aprovados/parciais com pecas aguardando remessa ao Tiny'
  FROM dbo.Pedido p
  JOIN dbo.PedidoItem pi ON pi.PedidoId = p.PedidoId
 WHERE p.Status NOT IN (N'Pendente', N'Cancelado')
   AND pi.EmBackorder = 0 AND pi.Quantidade > pi.QuantidadeExportada;
GO
