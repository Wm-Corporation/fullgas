-- 002 - Sequencias de numeracao (pedido, fatura, entrega, rastreio), iniciando acima dos seeds.
-- Idempotente.

USE FullgasB2B;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_NumeroPedido' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE SEQUENCE dbo.Seq_NumeroPedido  AS INT    START WITH 41878      INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_NumeroFatura' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE SEQUENCE dbo.Seq_NumeroFatura  AS BIGINT START WITH 1726017669 INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_NumeroEntrega' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE SEQUENCE dbo.Seq_NumeroEntrega AS INT    START WITH 50731003    INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_RastreioEntrega' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE SEQUENCE dbo.Seq_RastreioEntrega AS INT  START WITH 521200      INCREMENT BY 1;
GO

-- NEXT VALUE FOR exige UPDATE na sequencia para o fullgas_app (se ja existir).
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'fullgas_app')
BEGIN
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroPedido    TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroFatura    TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroEntrega   TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_RastreioEntrega TO fullgas_app;
    PRINT N'Permissão de uso das sequências concedida a fullgas_app.';
END
GO

PRINT N'Migração 002 concluída (sequências de numeração criadas).';
GO
