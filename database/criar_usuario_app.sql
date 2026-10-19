-- Cria o login dedicado da API (nunca usar 'sa'). Rode uma vez como administrador.
-- Troque 'SENHA_FORTE_AQUI' por uma senha forte.

-- 1) Login no nível do servidor
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'fullgas_app')
BEGIN
    CREATE LOGIN fullgas_app
        WITH PASSWORD = N'SENHA_FORTE_AQUI',
             CHECK_POLICY = ON;
END
GO

-- 2) Usuário dentro do banco FullgasB2B
USE FullgasB2B;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'fullgas_app')
BEGIN
    CREATE USER fullgas_app FOR LOGIN fullgas_app;
END
GO

-- 3) Permissões de leitura e escrita nos dados (sem poder alterar o schema)
ALTER ROLE db_datareader ADD MEMBER fullgas_app;
ALTER ROLE db_datawriter ADD MEMBER fullgas_app;
GO

-- 4) NEXT VALUE FOR exige UPDATE na sequencia (rode as migrations antes).
IF EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_NumeroPedido' AND schema_id = SCHEMA_ID(N'dbo'))
BEGIN
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroPedido    TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroFatura    TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroEntrega   TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_RastreioEntrega TO fullgas_app;
END
GO

PRINT N'Usuário fullgas_app criado. Use estas credenciais no .env (DB_USER / DB_PASSWORD).';
GO

-- A API usa autenticacao SQL: habilite o modo misto (Properties > Security) e o TCP/IP na porta 1433.
