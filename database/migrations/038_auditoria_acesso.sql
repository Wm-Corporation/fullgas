-- 038 - AuditoriaAcesso: trilha das acoes privilegiadas (ex.: admin na conta do cliente).
-- Sem FK (sobrevive a exclusao do usuario); DetalheJson livre. Idempotente.

USE FullgasB2B;
GO

IF OBJECT_ID('dbo.AuditoriaAcesso', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditoriaAcesso (
        AuditoriaId    INT             IDENTITY(1,1) NOT NULL,
        -- Quem AGIU. Null so' em evento de origem nao autenticada.
        AdminId        INT             NULL,
        AdminEmail     NVARCHAR(160)   NULL,   -- copia: sobrevive a exclusao
        -- Sobre QUEM. Idem.
        AlvoUsuarioId  INT             NULL,
        AlvoEmail      NVARCHAR(160)   NULL,
        AlvoEmpresaId  INT             NULL,
        -- O QUE. Vocabulario fechado no codigo (api/src/auditoria.js).
        Acao           VARCHAR(40)     NOT NULL,
        DetalheJson    NVARCHAR(MAX)   NULL,
        Ip             VARCHAR(64)     NULL,
        CriadoEm       DATETIME2(0)    NOT NULL
                       CONSTRAINT DF_AuditoriaAcesso_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_AuditoriaAcesso PRIMARY KEY (AuditoriaId)
    );

    CREATE INDEX IX_AuditoriaAcesso_CriadoEm ON dbo.AuditoriaAcesso (CriadoEm DESC);
    CREATE INDEX IX_AuditoriaAcesso_Admin    ON dbo.AuditoriaAcesso (AdminId, CriadoEm DESC);
    CREATE INDEX IX_AuditoriaAcesso_Alvo     ON dbo.AuditoriaAcesso (AlvoUsuarioId, CriadoEm DESC);

    PRINT N'038: tabela dbo.AuditoriaAcesso criada.';
END
ELSE
    PRINT N'038: dbo.AuditoriaAcesso ja existe — nada a fazer.';
GO
