USE FullgasB2B;
GO

-- 046 - Empresa.TinyContatoAlterado: 1 = edicao ainda nao enviada ao Tiny (o cron reenvia em vez de sobrescrever).
-- Idempotente. ASCII.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Empresa', 'TinyContatoAlterado') IS NULL
BEGIN
    ALTER TABLE dbo.Empresa ADD TinyContatoAlterado BIT NOT NULL
        CONSTRAINT DF_Empresa_TinyContatoAlterado DEFAULT (0);
    PRINT '046: Empresa.TinyContatoAlterado criada.';
END
ELSE
    PRINT '046: Empresa.TinyContatoAlterado ja existe.';
GO

SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' empresas com edicao pendente de envio ao Tiny'
  FROM dbo.Empresa WHERE TinyContatoAlterado = 1;
GO
