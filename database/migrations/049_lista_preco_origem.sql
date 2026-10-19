USE FullgasB2B;
GO

-- 049 - Empresa.ListaPrecoOrigem: 'tiny' (do contato) | 'manual' (escolhida no painel) | NULL (sem lista).
-- Listas escolhidas desde a 048 viram 'manual'. Idempotente. ASCII.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Empresa', 'ListaPrecoOrigem') IS NULL
BEGIN
    ALTER TABLE dbo.Empresa ADD ListaPrecoOrigem VARCHAR(10) NULL
        CONSTRAINT CK_Empresa_ListaPrecoOrigem CHECK (ListaPrecoOrigem IN ('tiny', 'manual'));
    PRINT '049: Empresa.ListaPrecoOrigem criada.';
END
ELSE
    PRINT '049: Empresa.ListaPrecoOrigem ja existe.';
GO

UPDATE dbo.Empresa SET ListaPrecoOrigem = 'manual'
 WHERE ListaPrecoId IS NOT NULL AND ListaPrecoOrigem IS NULL;
GO

SELECT ISNULL(ListaPrecoOrigem, 'sem lista') AS Origem, COUNT(*) AS Empresas
  FROM dbo.Empresa
 GROUP BY ListaPrecoOrigem;
GO
