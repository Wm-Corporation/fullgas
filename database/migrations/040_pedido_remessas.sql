USE FullgasB2B;
GO

-- ============================================================
-- 040 - Remessas: o pedido passa a ser exportado ao Tiny NO ENVIO.
--
-- Antes: o pedido ia inteiro ao Tiny na APROVACAO (ao sair de 'Pendente'),
-- e escolher a quantidade enviada de cada peca nao exportava nada.
-- Agora: o admin decide o que vai nesta remessa e confirma; so entao as
-- pecas daquela remessa viram um pedido no Tiny. Envio parcial deixa o
-- pedido em 'Parcial' e a fatura segue em aberto.
--
-- O que muda no banco:
--   1. Pedido.Status aceita 'Parcial'.
--   2. TinyPedidoExport.Escopo aceita 'remessa'.
--   3. PedidoItem.QuantidadeExportada: quanto de cada item JA foi para o
--      Tiny. A remessa exporta a diferenca para QuantidadeEnviada.
--
-- Pedidos ANTIGOS ja exportados na regra velha nao podem ir de novo (o
-- estoque do Tiny baixaria duas vezes): por isso o preenchimento do passo 4
-- marca os itens deles como ja exportados.
--
-- Idempotente (pode rodar em todo deploy). ASCII puro: "Em separacao" (com
-- cedilha e til) e montado com NCHAR, como na migration 028 - o sqlcmd do
-- deploy nao le UTF-8.
--
-- ATENCAO ao formato: cada passo fica em SEU PROPRIO LOTE (GO). O SQL Server
-- compila o lote inteiro antes de executar, entao usar a coluna nova no mesmo
-- lote do ALTER TABLE daria "Invalid column name" - e o deploy NAO para em
-- erro de SQL, o que esconderia a falha.
-- ============================================================
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
  N'CHECK (Status IN (N''Pendente'', N''Processando'', N''Parcial'', N''Enviado'', ' +
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
-- Lote proprio: a coluna do passo 3 so pode ser usada depois que o lote dela
-- termina. Roda sempre; o resultado e o mesmo em toda execucao (atribuicao
-- deterministica sobre dados que nao mudam), entao repetir nao estraga nada.

-- 4a. Pedidos com exportacao 'normal' (regra antiga): o Tiny ja recebeu TODAS
-- as pecas em estoque desses pedidos. Marcar impede que uma remessa futura
-- mande a mesma peca de novo. Exportacao 'cancelado' nao conta - nada chegou la.
UPDATE pi
   SET pi.QuantidadeExportada = pi.Quantidade
  FROM dbo.PedidoItem pi
 WHERE pi.EmBackorder = 0
   AND pi.QuantidadeExportada <> pi.Quantidade
   AND EXISTS (SELECT 1 FROM dbo.TinyPedidoExport e
                WHERE e.PedidoId = pi.PedidoId
                  AND e.Escopo = 'normal' AND e.Status <> 'cancelado');
PRINT '040 [4/4]: itens de pedidos ja exportados marcados (regra antiga preservada).';

-- 4b. Pre-venda continua com fluxo proprio (escopo 'backorder', sufixo -PV):
-- o que ja foi liberado ja foi ao Tiny.
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
