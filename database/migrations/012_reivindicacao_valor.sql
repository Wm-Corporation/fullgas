-- 012 - Valor da garantia (soma preco x quantidade das pecas). Idempotente.

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Reivindicacao', 'ValorGarantia') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD ValorGarantia DECIMAL(12, 2) NULL;
GO

PRINT N'Migração 012 concluída.';
GO
