USE FullgasB2B;
GO

-- 021 - InscricaoEstadual e vinculo com o contato do Tiny (TinyContatoId, TinyContatoPendente). Idempotente.
SET QUOTED_IDENTIFIER ON;

IF COL_LENGTH('dbo.Empresa', 'InscricaoEstadual') IS NULL
  ALTER TABLE dbo.Empresa ADD InscricaoEstadual VARCHAR(20) NULL;

IF COL_LENGTH('dbo.Empresa', 'TinyContatoId') IS NULL
  ALTER TABLE dbo.Empresa ADD TinyContatoId VARCHAR(40) NULL;

IF COL_LENGTH('dbo.Empresa', 'TinyContatoPendente') IS NULL
  ALTER TABLE dbo.Empresa ADD TinyContatoPendente BIT NOT NULL
    CONSTRAINT DF_Empresa_TinyContatoPendente DEFAULT 0;
GO

-- TinySyncLog passa a aceitar o evento 'contato'.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TinySyncLog_Evento')
  ALTER TABLE dbo.TinySyncLog DROP CONSTRAINT CK_TinySyncLog_Evento;
ALTER TABLE dbo.TinySyncLog ADD CONSTRAINT CK_TinySyncLog_Evento
  CHECK (Evento IN ('lote', 'importacao', 'cron', 'contato'));
GO

PRINT '021 aplicada: Empresa.InscricaoEstadual / TinyContatoId / TinyContatoPendente';
