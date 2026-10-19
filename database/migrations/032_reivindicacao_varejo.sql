-- 032 - Reivindicacao de varejo: Origem ('veiculo' | 'varejo'), PedidoId e PedidoItem.GarantiaNumero. Idempotente.

USE FullgasB2B;
GO

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* Origem: discrimina garantia de veículo x varejo. Rows antigas => 'veiculo'. */
IF COL_LENGTH(N'dbo.Reivindicacao', N'Origem') IS NULL
BEGIN
    ALTER TABLE dbo.Reivindicacao ADD Origem VARCHAR(10) NOT NULL
        CONSTRAINT DF_Reiv_Origem DEFAULT ('veiculo');
    PRINT N'Reivindicacao.Origem criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'CK_Reiv_Origem' AND parent_object_id = OBJECT_ID(N'dbo.Reivindicacao'))
BEGIN
    ALTER TABLE dbo.Reivindicacao ADD CONSTRAINT CK_Reiv_Origem
        CHECK (Origem IN ('veiculo', 'varejo'));
    PRINT N'CHECK CK_Reiv_Origem criado.';
END
GO

/* PedidoId: o pedido que contém a peça reclamada (só no varejo). */
IF COL_LENGTH(N'dbo.Reivindicacao', N'PedidoId') IS NULL
BEGIN
    ALTER TABLE dbo.Reivindicacao ADD PedidoId INT NULL;
    PRINT N'Reivindicacao.PedidoId criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Reiv_Pedido')
BEGIN
    ALTER TABLE dbo.Reivindicacao WITH CHECK
        ADD CONSTRAINT FK_Reiv_Pedido FOREIGN KEY (PedidoId)
        REFERENCES dbo.Pedido (PedidoId);
    PRINT N'FK_Reiv_Pedido criada.';
END
GO

/* Índice filtrado: achar rápido as reivindicações de um pedido (varejo). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Reiv_Pedido'
                 AND object_id = OBJECT_ID(N'dbo.Reivindicacao'))
    CREATE INDEX IX_Reiv_Pedido ON dbo.Reivindicacao (PedidoId) WHERE PedidoId IS NOT NULL;
GO

/* Registro no pedido: nº da reivindicação de varejo aprovada por item. */
IF COL_LENGTH(N'dbo.PedidoItem', N'GarantiaNumero') IS NULL
BEGIN
    ALTER TABLE dbo.PedidoItem ADD GarantiaNumero VARCHAR(20) NULL;
    PRINT N'PedidoItem.GarantiaNumero criada.';
END
GO

PRINT N'Migração 032 concluída.';
GO
