USE FullgasB2B;
GO

-- 045 - Veiculo.VendaEmpresaId: dados do comprador so para quem registrou a venda. Idempotente. ASCII.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Veiculo', 'VendaEmpresaId') IS NULL
BEGIN
    ALTER TABLE dbo.Veiculo ADD VendaEmpresaId INT NULL;
    PRINT '045 [1/2]: Veiculo.VendaEmpresaId criada.';
END
ELSE
    PRINT '045 [1/2]: Veiculo.VendaEmpresaId ja existe.';
GO

-- Lote proprio. Vendas antigas: a concessionaria atual.
UPDATE dbo.Veiculo
   SET VendaEmpresaId = EmpresaId
 WHERE VendaData IS NOT NULL AND VendaEmpresaId IS NULL;
PRINT '045 [2/2]: vendas antigas preenchidas.';
GO

SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' chassis vendidos sem VendaEmpresaId (esperado: 0)'
  FROM dbo.Veiculo WHERE VendaData IS NOT NULL AND VendaEmpresaId IS NULL;
GO
