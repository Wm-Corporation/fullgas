USE FullgasB2B;
GO

-- 022 - Usuario MASTER protegido contra exclusao (removido pela 023). Idempotente.
SET QUOTED_IDENTIFIER ON;

IF COL_LENGTH('dbo.Usuario', 'Master') IS NULL
  ALTER TABLE dbo.Usuario ADD Master BIT NOT NULL
    CONSTRAINT DF_Usuario_Master DEFAULT 0;
GO

-- Trigger: qualquer DELETE que inclua um usuário Master é revertido inteiro.
CREATE OR ALTER TRIGGER dbo.TR_Usuario_ProtegeMaster
ON dbo.Usuario
AFTER DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted WHERE Master = 1)
  BEGIN
    ROLLBACK TRANSACTION;
    THROW 50001, 'O usuário master não pode ser excluído.', 1;
  END
END;
GO

-- Cria o master na matriz, se ela existir (banco novo nao tem).
IF EXISTS (SELECT 1 FROM dbo.Empresa WHERE RazaoSocial = 'FULLGAS MOTOS')
AND NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE Email = 'master@fullgas.com.br')
  INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor, Master)
  VALUES (
    (SELECT EmpresaId FROM dbo.Empresa WHERE RazaoSocial = 'FULLGAS MOTOS'),
    N'Master Fullgas',
    'master@fullgas.com.br',
    CONVERT(VARBINARY(256), '$2a$10$tA5yUqEaKKMXLXMyVlV7GO./WGSQY.wcuW7.y4b9TrnrZaGN2LCfC'),
    'admin', 'aprovado', 1, 1
  );
ELSE
  UPDATE dbo.Usuario SET Master = 1, Papel = 'admin', Status = 'aprovado'
   WHERE Email = 'master@fullgas.com.br';
GO

PRINT '022 aplicada: Usuario.Master + trigger de proteção + master@fullgas.com.br';
