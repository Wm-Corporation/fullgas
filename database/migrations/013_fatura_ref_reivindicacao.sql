-- 013 - Numero da reivindicacao na nota de credito. Idempotente.

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Fatura', 'ReferenciaReivindicacao') IS NULL
    ALTER TABLE dbo.Fatura ADD ReferenciaReivindicacao VARCHAR(20) NULL;
GO

PRINT N'Migração 013 concluída.';
GO
