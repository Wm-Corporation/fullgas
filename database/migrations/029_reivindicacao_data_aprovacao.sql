USE FullgasB2B;
GO

-- 029 - Data de aprovacao da reivindicacao (antigas usam AtualizadoEm). Idempotente.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Reivindicacao', 'DataAprovacao') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD DataAprovacao DATETIME2 NULL;
GO

UPDATE dbo.Reivindicacao
   SET DataAprovacao = ISNULL(AtualizadoEm, DataAbertura)
 WHERE Status = N'Aprovada' AND DataAprovacao IS NULL;
GO
