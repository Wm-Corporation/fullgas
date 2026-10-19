USE FullgasB2B;
GO

-- 031 - Foto da categoria (URL relativa; NULL = icone padrao). Idempotente.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Categoria', 'Imagem') IS NULL
BEGIN
    ALTER TABLE dbo.Categoria ADD Imagem VARCHAR(255) NULL;
END
GO
