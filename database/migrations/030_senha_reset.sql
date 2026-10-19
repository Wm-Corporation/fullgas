USE FullgasB2B;
GO

-- 030 - Recuperacao de senha: guarda so o hash SHA-256 do token. Idempotente.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('dbo.SenhaReset', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SenhaReset (
        SenhaResetId INT IDENTITY(1,1) NOT NULL,
        UsuarioId    INT NOT NULL,
        TokenHash    CHAR(64) NOT NULL,          -- SHA-256 do token, em hex
        ExpiraEm     DATETIME2 NOT NULL,
        UsadoEm      DATETIME2 NULL,
        CriadoEm     DATETIME2 NOT NULL CONSTRAINT DF_SenhaReset_CriadoEm DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_SenhaReset PRIMARY KEY (SenhaResetId),
        CONSTRAINT FK_SenhaReset_Usuario FOREIGN KEY (UsuarioId)
            REFERENCES dbo.Usuario (UsuarioId) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_SenhaReset_TokenHash'
                 AND object_id = OBJECT_ID('dbo.SenhaReset'))
    CREATE UNIQUE INDEX UX_SenhaReset_TokenHash ON dbo.SenhaReset (TokenHash);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SenhaReset_Usuario'
                 AND object_id = OBJECT_ID('dbo.SenhaReset'))
    CREATE INDEX IX_SenhaReset_Usuario ON dbo.SenhaReset (UsuarioId, UsadoEm);
GO

-- A API roda como fullgas_app: precisa ler/gravar aqui.
IF DATABASE_PRINCIPAL_ID('fullgas_app') IS NOT NULL
    GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.SenhaReset TO fullgas_app;
GO
