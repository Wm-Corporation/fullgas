USE FullgasB2B;
GO

-- 026 - Subcategorias: Categoria.ParentId (NULL = topo). Idempotente.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Categoria', 'ParentId') IS NULL
BEGIN
    ALTER TABLE dbo.Categoria ADD ParentId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Categoria_Parent')
BEGIN
    ALTER TABLE dbo.Categoria WITH CHECK
        ADD CONSTRAINT FK_Categoria_Parent FOREIGN KEY (ParentId)
        REFERENCES dbo.Categoria (CategoriaId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Categoria_Parent' AND object_id = OBJECT_ID('dbo.Categoria'))
BEGIN
    CREATE INDEX IX_Categoria_Parent ON dbo.Categoria (ParentId);
END
GO
