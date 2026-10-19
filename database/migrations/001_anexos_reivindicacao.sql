-- 001 - Anexos de reivindicacao (fotos e documentos). Seguro em banco com dados.

USE FullgasB2B;
GO

/* Cria a tabela só se ainda não existir (idempotente: pode rodar 2x sem erro). */
IF OBJECT_ID(N'dbo.ReivindicacaoAnexo', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReivindicacaoAnexo (
        AnexoId         INT             IDENTITY(1,1) NOT NULL,
        ReivindicacaoId INT             NOT NULL,
        NomeArquivo     NVARCHAR(260)   NOT NULL,   -- nome original enviado
        TipoConteudo    VARCHAR(100)    NULL,       -- ex.: 'image/jpeg'
        TamanhoBytes    INT             NULL,
        -- So a URL; o arquivo fica fora do banco.
        Url             NVARCHAR(1000)  NOT NULL,
        EnviadoPor      INT             NULL,       -- usuário que anexou
        CriadoEm        DATETIME2(0)    NOT NULL CONSTRAINT DF_ReivAnexo_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ReivindicacaoAnexo PRIMARY KEY (AnexoId),
        CONSTRAINT FK_ReivAnexo_Reiv FOREIGN KEY (ReivindicacaoId)
            REFERENCES dbo.Reivindicacao (ReivindicacaoId) ON DELETE CASCADE,
        CONSTRAINT FK_ReivAnexo_Usuario FOREIGN KEY (EnviadoPor)
            REFERENCES dbo.Usuario (UsuarioId)
    );

    CREATE INDEX IX_ReivAnexo_Reiv ON dbo.ReivindicacaoAnexo (ReivindicacaoId);

    PRINT N'Tabela ReivindicacaoAnexo criada.';
END
ELSE
    PRINT N'Tabela ReivindicacaoAnexo já existe — nada a fazer.';
GO

-- Campos extras da reivindicacao (so se ainda nao existirem).
IF COL_LENGTH('dbo.Reivindicacao', 'NumeroPeca') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD NumeroPeca VARCHAR(40) NULL;     -- SKU relacionado ao defeito
GO
IF COL_LENGTH('dbo.Reivindicacao', 'DataDefeito') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD DataDefeito DATE NULL;           -- quando o problema ocorreu
GO
IF COL_LENGTH('dbo.Reivindicacao', 'Horimetro') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD Horimetro INT NULL;              -- horas de uso da moto
GO

PRINT N'Migração 001 concluída.';
GO
