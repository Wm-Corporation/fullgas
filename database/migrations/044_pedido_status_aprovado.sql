USE FullgasB2B;
GO

-- ============================================================
-- 044 - "Em separacao" vira "Aprovado", e aprovar = ir ao Tiny.
--
-- Decisao de 30/09/2026: aprovar o pedido no B2B significa que o estoque
-- pode ser descontado no Tiny tambem. Na aprovacao o pedido vai ao Tiny
-- ja 'aprovado' (baixa o estoque la). O nome do status passa a ser o mesmo
-- do Tiny, para o estoquista acompanhar o B2B sem traduzir.
--
-- As remessas (040) continuam existindo como controle interno de envio
-- (Parcial/Enviado), mas nao exportam mais nada. As linhas antigas de
-- escopo 'remessa' continuam sendo lidas.
--
-- Idempotente (roda em todo deploy). ASCII puro: "Em separacao" (com
-- cedilha e til) e montado com NCHAR, como nas migrations 028 e 040.
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
GO

/* ---- 1. CHECK aceita 'Aprovado' ----------------------------------------- */
-- 'Processando' e "Em separacao" seguem aceitos como legado: um deploy que
-- rode a 028/040 antes desta nao pode falhar por causa de linha antiga.
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
-- Pedidos ativos com pecas que ainda nao foram ao Tiny (regra das remessas).
-- Esperado em 30/09/2026: 0 (todos os pedidos de producao estao cancelados).
-- Se aparecer algum, ele precisa ir ao Tiny pelo painel (ver 044 no PR).
SELECT CONVERT(VARCHAR(20), COUNT(DISTINCT p.PedidoId)) +
       ' pedidos aprovados/parciais/enviados com pecas fora do Tiny (esperado: 0)'
  FROM dbo.Pedido p
  JOIN dbo.PedidoItem pi ON pi.PedidoId = p.PedidoId
 WHERE p.Status NOT IN (N'Pendente', N'Cancelado')
   AND pi.EmBackorder = 0 AND pi.Quantidade > pi.QuantidadeExportada;
GO
