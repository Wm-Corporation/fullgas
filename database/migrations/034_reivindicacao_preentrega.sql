-- 034 - Origem 'preentrega': defeito na inspecao de moto ainda nao vendida (regras na API). Idempotente.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE FullgasB2B;
GO

-- CHECK recriado com os tres valores.
IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = N'CK_Reiv_Origem' AND parent_object_id = OBJECT_ID(N'dbo.Reivindicacao'))
BEGIN
    ALTER TABLE dbo.Reivindicacao DROP CONSTRAINT CK_Reiv_Origem;
    PRINT N'CHECK CK_Reiv_Origem antigo removido.';
END
GO

ALTER TABLE dbo.Reivindicacao WITH CHECK
    ADD CONSTRAINT CK_Reiv_Origem CHECK (Origem IN ('veiculo', 'varejo', 'preentrega'));
GO

PRINT N'CHECK CK_Reiv_Origem recriado com preentrega.';
GO

PRINT N'Migração 034 concluída.';
GO
