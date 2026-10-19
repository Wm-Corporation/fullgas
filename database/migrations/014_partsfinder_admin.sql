-- 014 - Parts Finder administravel: imagens, NumeroImagem, ordem, ativo e SecaoHotspot. Idempotente.

USE FullgasB2B;
GO

/* ---- 1) ModeloMoto: árvore do seletor, foto e documentação técnica -------- */
IF COL_LENGTH(N'dbo.ModeloMoto', N'Arvore') IS NULL
BEGIN
    ALTER TABLE dbo.ModeloMoto ADD Arvore NVARCHAR(400) NULL;
    PRINT N'ModeloMoto.Arvore criada.';
END
IF COL_LENGTH(N'dbo.ModeloMoto', N'ImagemUrl') IS NULL
BEGIN
    ALTER TABLE dbo.ModeloMoto ADD ImagemUrl NVARCHAR(400) NULL;
    PRINT N'ModeloMoto.ImagemUrl criada.';
END
IF COL_LENGTH(N'dbo.ModeloMoto', N'DocTecnicaUrl') IS NULL
BEGIN
    ALTER TABLE dbo.ModeloMoto ADD DocTecnicaUrl NVARCHAR(400) NULL;
    PRINT N'ModeloMoto.DocTecnicaUrl criada.';
END
GO

/* Backfill da árvore para os modelos semeados (só quando ainda NULL). */
UPDATE dbo.ModeloMoto SET Arvore = N'Fullgas > Offroad > Enduro > E1 > 2 tempos > FG 125 > FG 125 2025'
 WHERE Codigo = N'fg125-2025' AND Arvore IS NULL;
UPDATE dbo.ModeloMoto SET Arvore = N'Fullgas > Offroad > Enduro > E3 > 2 tempos > FG 300 > FG 300 2026'
 WHERE Codigo = N'fg300-2026' AND Arvore IS NULL;
UPDATE dbo.ModeloMoto SET Arvore = N'Fullgas > Offroad > MX > 4 tempos > FG 450F > FG 450F 2025'
 WHERE Codigo = N'fg450f-2025' AND Arvore IS NULL;
GO

/* ---- 2) Produto: miniatura da peça ---------------------------------------- */
IF COL_LENGTH(N'dbo.Produto', N'ImagemUrl') IS NULL
BEGIN
    ALTER TABLE dbo.Produto ADD ImagemUrl NVARCHAR(400) NULL;
    PRINT N'Produto.ImagemUrl criada.';
END
GO

/* ---- 3) SecaoModelo: imagem do diagrama explodido ------------------------- */
IF COL_LENGTH(N'dbo.SecaoModelo', N'ImagemUrl') IS NULL
BEGIN
    ALTER TABLE dbo.SecaoModelo ADD ImagemUrl NVARCHAR(400) NULL;
    PRINT N'SecaoModelo.ImagemUrl criada.';
END
GO

/* ---- 4) PecaSecao: campos do painel admin --------------------------------- */
IF COL_LENGTH(N'dbo.PecaSecao', N'NumeroImagem') IS NULL
BEGIN
    ALTER TABLE dbo.PecaSecao ADD NumeroImagem VARCHAR(12) NULL;
    PRINT N'PecaSecao.NumeroImagem criada.';
END
IF COL_LENGTH(N'dbo.PecaSecao', N'QuantidadePadrao') IS NULL
BEGIN
    ALTER TABLE dbo.PecaSecao ADD QuantidadePadrao INT NOT NULL
        CONSTRAINT DF_PecaSecao_QtdPadrao DEFAULT (0);
    PRINT N'PecaSecao.QuantidadePadrao criada.';
END
IF COL_LENGTH(N'dbo.PecaSecao', N'Ordem') IS NULL
BEGIN
    ALTER TABLE dbo.PecaSecao ADD Ordem INT NOT NULL
        CONSTRAINT DF_PecaSecao_Ordem DEFAULT (0);
    PRINT N'PecaSecao.Ordem criada.';
END
IF COL_LENGTH(N'dbo.PecaSecao', N'Ativo') IS NULL
BEGIN
    ALTER TABLE dbo.PecaSecao ADD Ativo BIT NOT NULL
        CONSTRAINT DF_PecaSecao_Ativo DEFAULT (1);
    PRINT N'PecaSecao.Ativo criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_PecaSecao_QtdPadrao')
    ALTER TABLE dbo.PecaSecao ADD CONSTRAINT CK_PecaSecao_QtdPadrao CHECK (QuantidadePadrao >= 0);
GO

/* Backfill: NumeroImagem espelha a Posicao antiga; Ordem segue a Posicao. */
UPDATE dbo.PecaSecao SET NumeroImagem = CAST(Posicao AS VARCHAR(12)) WHERE NumeroImagem IS NULL;
UPDATE dbo.PecaSecao SET Ordem = Posicao WHERE Ordem = 0;
GO

-- ---- 5) SecaoHotspot: areas clicaveis (pixels da imagem original; LinkNumero = NumeroImagem) ----
IF OBJECT_ID(N'dbo.SecaoHotspot', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SecaoHotspot (
        HotspotId       INT             IDENTITY(1,1) NOT NULL,
        SecaoId         INT             NOT NULL,
        PosX            INT             NOT NULL CONSTRAINT DF_Hotspot_PosX DEFAULT (0),
        PosY            INT             NOT NULL CONSTRAINT DF_Hotspot_PosY DEFAULT (0),
        Largura         INT             NOT NULL CONSTRAINT DF_Hotspot_Larg DEFAULT (32),
        Altura          INT             NOT NULL CONSTRAINT DF_Hotspot_Alt  DEFAULT (32),
        Texto           NVARCHAR(200)   NULL,
        LinkNumero      VARCHAR(12)     NULL,
        Ordem           INT             NOT NULL CONSTRAINT DF_Hotspot_Ordem DEFAULT (0),
        CriadoEm        DATETIME2(0)    NOT NULL CONSTRAINT DF_Hotspot_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_SecaoHotspot PRIMARY KEY (HotspotId),
        CONSTRAINT FK_Hotspot_Secao FOREIGN KEY (SecaoId)
            REFERENCES dbo.SecaoModelo (SecaoId) ON DELETE CASCADE,
        CONSTRAINT CK_Hotspot_Tamanho CHECK (Largura > 0 AND Altura > 0),
        CONSTRAINT CK_Hotspot_Posicao CHECK (PosX >= 0 AND PosY >= 0)
    );

    CREATE INDEX IX_SecaoHotspot_Secao ON dbo.SecaoHotspot (SecaoId);

    PRINT N'Tabela SecaoHotspot criada.';
END
ELSE
    PRINT N'Tabela SecaoHotspot já existe — nada a fazer.';
GO

PRINT N'Migração 014 concluída.';
GO
