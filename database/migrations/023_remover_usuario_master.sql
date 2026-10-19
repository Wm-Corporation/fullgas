USE FullgasB2B;
GO

-- 023 - Remove o usuario MASTER, o trigger e a coluna. Idempotente.
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID('dbo.TR_Usuario_ProtegeMaster', 'TR') IS NOT NULL
  DROP TRIGGER dbo.TR_Usuario_ProtegeMaster;
GO

DELETE FROM dbo.Usuario WHERE Email = 'master@fullgas.com.br';
GO

IF COL_LENGTH('dbo.Usuario', 'Master') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Usuario_Master')
    ALTER TABLE dbo.Usuario DROP CONSTRAINT DF_Usuario_Master;
  ALTER TABLE dbo.Usuario DROP COLUMN Master;
END
GO

PRINT '023 aplicada: usuário master, trigger e coluna removidos';
