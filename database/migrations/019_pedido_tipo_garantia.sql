-- 019 - Pedido.Tipo ('venda' | 'garantia'): garantia aprovada vira pedido a R$ 0, sem fatura. Idempotente.

USE FullgasB2B;
GO

SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.Pedido', N'Tipo') IS NULL
BEGIN
    ALTER TABLE dbo.Pedido ADD Tipo VARCHAR(10) NOT NULL
        CONSTRAINT DF_Pedido_Tipo DEFAULT ('venda');
    PRINT N'Pedido.Tipo criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'CK_Pedido_Tipo' AND parent_object_id = OBJECT_ID(N'dbo.Pedido'))
BEGIN
    ALTER TABLE dbo.Pedido ADD CONSTRAINT CK_Pedido_Tipo
        CHECK (Tipo IN ('venda', 'garantia'));
    PRINT N'CHECK CK_Pedido_Tipo criado.';
END
GO

PRINT N'Migração 019 concluída.';
GO
