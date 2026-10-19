-- 009 - Lista de pecas da reivindicacao (com quantidade). NumeroPeca fica so por compatibilidade. Idempotente.

USE FullgasB2B;
GO

IF OBJECT_ID(N'dbo.ReivindicacaoPeca', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReivindicacaoPeca (
        ReivindicacaoPecaId INT             IDENTITY(1,1) NOT NULL,
        ReivindicacaoId     INT             NOT NULL,
        Sku                 VARCHAR(40)     NOT NULL,          -- código da peça (catálogo)
        NomeProduto         NVARCHAR(200)   NULL,             -- snapshot do nome na criação
        Quantidade          INT             NOT NULL CONSTRAINT DF_ReivPeca_Qtd DEFAULT (1),
        CriadoEm            DATETIME2(0)    NOT NULL CONSTRAINT DF_ReivPeca_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ReivindicacaoPeca PRIMARY KEY (ReivindicacaoPecaId),
        CONSTRAINT CK_ReivPeca_Qtd CHECK (Quantidade >= 1),
        CONSTRAINT FK_ReivPeca_Reiv FOREIGN KEY (ReivindicacaoId)
            REFERENCES dbo.Reivindicacao (ReivindicacaoId) ON DELETE CASCADE
    );

    CREATE INDEX IX_ReivPeca_Reiv ON dbo.ReivindicacaoPeca (ReivindicacaoId);

    PRINT N'Tabela ReivindicacaoPeca criada.';
END
ELSE
    PRINT N'Tabela ReivindicacaoPeca já existe — nada a fazer.';
GO

PRINT N'Migração 009 concluída.';
GO
