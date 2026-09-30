USE FullgasB2B;
GO

-- ============================================================
-- 045 - Quem registrou a venda do chassi (Veiculo.VendaEmpresaId).
--
-- Achado de 30/09/2026: ao transferir uma moto JA VENDIDA para outra
-- concessionaria, a nova passava a ver os dados pessoais do comprador
-- (nome, CPF, e-mail, telefone, endereco). Com esta coluna a API mostra
-- esses dados so para a concessionaria que registrou a venda (e o admin).
--
-- Idempotente (roda em todo deploy). ASCII puro.
-- ============================================================
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

-- Lote proprio: a coluna so pode ser usada depois que o lote dela termina.
-- Vendas antigas: a melhor informacao que existe e a concessionaria atual
-- (em 30/09/2026 nenhum chassi tinha venda registrada).
UPDATE dbo.Veiculo
   SET VendaEmpresaId = EmpresaId
 WHERE VendaData IS NOT NULL AND VendaEmpresaId IS NULL;
PRINT '045 [2/2]: vendas antigas preenchidas.';
GO

SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' chassis vendidos sem VendaEmpresaId (esperado: 0)'
  FROM dbo.Veiculo WHERE VendaData IS NOT NULL AND VendaEmpresaId IS NULL;
GO
