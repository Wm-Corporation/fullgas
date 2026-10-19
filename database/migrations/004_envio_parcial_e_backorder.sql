-- 004 - Envio parcial e pre-venda em PedidoItem (QuantidadeEnviada, EmBackorder). Idempotente.
USE FullgasB2B;
GO

-- Coluna computada e indices filtrados exigem estas opcoes.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* QuantidadeEnviada — soma do que já saiu para entrega (0..Quantidade) */
IF COL_LENGTH('dbo.PedidoItem', 'QuantidadeEnviada') IS NULL
    ALTER TABLE dbo.PedidoItem ADD QuantidadeEnviada INT NOT NULL
        CONSTRAINT DF_PedidoItem_QtdEnviada DEFAULT (0);
GO

/* EmBackorder — 1 = item entrou em pré-venda (sem estoque na hora do pedido) */
IF COL_LENGTH('dbo.PedidoItem', 'EmBackorder') IS NULL
    ALTER TABLE dbo.PedidoItem ADD EmBackorder BIT NOT NULL
        CONSTRAINT DF_PedidoItem_Backorder DEFAULT (0);
GO

-- (Indice filtrado nao aceita comparar duas colunas; o IX_PedidoItem_Pedido basta.)

/* Índice para achar rápido itens em pré-venda de um pedido */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PedidoItem_Backorder')
    CREATE INDEX IX_PedidoItem_Backorder
        ON dbo.PedidoItem (PedidoId)
        WHERE EmBackorder = 1;
GO
