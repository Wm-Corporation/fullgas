-- 005 - Dados do comprador na venda do veiculo (CPF, e-mail, telefone, endereco). Idempotente.
USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Veiculo', 'ClienteCpf') IS NULL
    ALTER TABLE dbo.Veiculo ADD ClienteCpf VARCHAR(14) NULL;
GO

IF COL_LENGTH('dbo.Veiculo', 'ClienteEmail') IS NULL
    ALTER TABLE dbo.Veiculo ADD ClienteEmail NVARCHAR(160) NULL;
GO

IF COL_LENGTH('dbo.Veiculo', 'ClienteTelefone') IS NULL
    ALTER TABLE dbo.Veiculo ADD ClienteTelefone VARCHAR(30) NULL;
GO

IF COL_LENGTH('dbo.Veiculo', 'ClienteEndereco') IS NULL
    ALTER TABLE dbo.Veiculo ADD ClienteEndereco NVARCHAR(300) NULL;
GO
