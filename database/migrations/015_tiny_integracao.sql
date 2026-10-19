-- 015 - Integracao Tiny: TinyId/TinyAtivo no Produto e tabela TinySyncLog. Idempotente.

USE FullgasB2B;
GO

-- Indice filtrado exige QUOTED_IDENTIFIER ON.
SET QUOTED_IDENTIFIER ON;
GO

/* ---- 1) Produto: campos de origem Tiny ------------------------------------ */
IF COL_LENGTH(N'dbo.Produto', N'TinyId') IS NULL
BEGIN
    ALTER TABLE dbo.Produto ADD TinyId VARCHAR(40) NULL;
    PRINT N'Produto.TinyId criada.';
END
IF COL_LENGTH(N'dbo.Produto', N'TinyAtivo') IS NULL
BEGIN
    ALTER TABLE dbo.Produto ADD TinyAtivo BIT NOT NULL
        CONSTRAINT DF_Produto_TinyAtivo DEFAULT (0);
    PRINT N'Produto.TinyAtivo criada.';
END
IF COL_LENGTH(N'dbo.Produto', N'TinySincronizadoEm') IS NULL
BEGIN
    ALTER TABLE dbo.Produto ADD TinySincronizadoEm DATETIME2(0) NULL;
    PRINT N'Produto.TinySincronizadoEm criada.';
END
GO

-- Um produto do Tiny so pode estar vinculado a um produto local (NULL nao conta).
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'UX_Produto_TinyId' AND object_id = OBJECT_ID(N'dbo.Produto'))
BEGIN
    CREATE UNIQUE INDEX UX_Produto_TinyId ON dbo.Produto (TinyId) WHERE TinyId IS NOT NULL;
    PRINT N'Índice UX_Produto_TinyId criado.';
END
GO

/* ---- 2) TinySyncLog: histórico de sincronizações --------------------------- */
IF OBJECT_ID(N'dbo.TinySyncLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TinySyncLog (
        LogId       INT           IDENTITY(1,1) NOT NULL,
        TinyId      VARCHAR(40)   NULL,
        Sku         VARCHAR(40)   NULL,
        Evento      VARCHAR(20)   NOT NULL,  -- 'webhook' | 'importacao' | 'lote'
        Status      VARCHAR(10)   NOT NULL,  -- 'ok' | 'erro' | 'ignorado'
        Mensagem    NVARCHAR(500) NULL,
        CriadoEm    DATETIME2(0)  NOT NULL
            CONSTRAINT DF_TinySyncLog_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_TinySyncLog PRIMARY KEY (LogId),
        CONSTRAINT CK_TinySyncLog_Evento CHECK (Evento IN ('webhook', 'importacao', 'lote')),
        CONSTRAINT CK_TinySyncLog_Status CHECK (Status IN ('ok', 'erro', 'ignorado'))
    );

    CREATE INDEX IX_TinySyncLog_TinyId ON dbo.TinySyncLog (TinyId);
    CREATE INDEX IX_TinySyncLog_Data   ON dbo.TinySyncLog (CriadoEm DESC);

    PRINT N'Tabela TinySyncLog criada.';
END
ELSE
    PRINT N'Tabela TinySyncLog já existe — nada a fazer.';
GO

PRINT N'Migração 015 concluída.';
GO
