-- 039 - ModeloMoto.Marca e Modalidade: arvore Marca > Modalidade > Categoria > Nome > Ano montada pela API.
-- Arvore antiga fica no banco, sem uso. Textos sem acento (sqlcmd sem UTF-8). Idempotente.

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.ModeloMoto', 'Marca') IS NULL
BEGIN
    ALTER TABLE dbo.ModeloMoto
        ADD Marca NVARCHAR(60) NOT NULL
            CONSTRAINT DF_ModeloMoto_Marca DEFAULT (N'Fullgas');
    PRINT N'039: coluna ModeloMoto.Marca criada.';
END
ELSE
    PRINT N'039: ModeloMoto.Marca ja existe - nada a fazer.';
GO

IF COL_LENGTH('dbo.ModeloMoto', 'Modalidade') IS NULL
BEGIN
    ALTER TABLE dbo.ModeloMoto
        ADD Modalidade NVARCHAR(60) NOT NULL
            CONSTRAINT DF_ModeloMoto_Modalidade DEFAULT (N'Off-road');
    PRINT N'039: coluna ModeloMoto.Modalidade criada.';
END
ELSE
    PRINT N'039: ModeloMoto.Modalidade ja existe - nada a fazer.';
GO
