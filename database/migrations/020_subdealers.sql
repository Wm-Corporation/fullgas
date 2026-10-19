USE FullgasB2B;
GO

-- 020 - Sub-dealers: Usuario.Gestor e Usuario.Permissoes (JSON de areas; NULL = acesso total). Idempotente.
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.Usuario', 'Gestor') IS NULL
BEGIN
    ALTER TABLE dbo.Usuario ADD
        Gestor     BIT          NOT NULL CONSTRAINT DF_Usuario_Gestor DEFAULT (0),
        Permissoes VARCHAR(400) NULL;
END
GO

/* Contas pré-existentes são as principais das suas empresas. */
IF NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE Gestor = 1)
    UPDATE dbo.Usuario SET Gestor = 1;
GO
