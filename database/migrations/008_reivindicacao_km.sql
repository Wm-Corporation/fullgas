-- 008 - Quilometragem na reivindicacao. Idempotente.

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Reivindicacao', 'Quilometragem') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD Quilometragem INT NULL;   -- km de uso da moto
GO

PRINT N'Migração 008 concluída.';
GO
