-- 011 - Reenviada = 1 quando o revendedor reenvia uma reivindicacao devolvida. Idempotente.

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Reivindicacao', 'Reenviada') IS NULL
    ALTER TABLE dbo.Reivindicacao
        ADD Reenviada BIT NOT NULL CONSTRAINT DF_Reiv_Reenviada DEFAULT (0);
GO

PRINT N'Migração 011 concluída.';
GO
