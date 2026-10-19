USE FullgasB2B;
GO

-- 041 - Apaga TODOS os chassis (pedido do dono, 18/09/2026), com historico e reivindicacoes presas a eles.
-- NAO e idempotente: roda UMA vez, controlada por dbo.MigracaoExecutada (o deploy roda todas as migrations).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
GO

-- Controle das migrations que rodam uma vez so.
IF OBJECT_ID('dbo.MigracaoExecutada', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MigracaoExecutada (
        Nome        VARCHAR(80)  NOT NULL,
        ExecutadaEm DATETIME2(0) NOT NULL
            CONSTRAINT DF_MigracaoExecutada_Em DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_MigracaoExecutada PRIMARY KEY (Nome)
    );
END;
GO

-- A limpeza em si - so na primeira passada.
IF NOT EXISTS (SELECT 1 FROM dbo.MigracaoExecutada WHERE Nome = '041_limpar_chassis')
BEGIN
    BEGIN TRAN;

    DECLARE @chassis INT = (SELECT COUNT(*) FROM dbo.Veiculo);
    DECLARE @reivs   INT = (SELECT COUNT(*) FROM dbo.Reivindicacao WHERE VeiculoId IS NOT NULL);

    -- 1) Reivindicacoes presas a um chassi (anexos e pecas saem em cascata).
    DELETE FROM dbo.Reivindicacao WHERE VeiculoId IS NOT NULL;

    -- 2) Os chassis (o historico de cada um sai em cascata).
    DELETE FROM dbo.Veiculo;

    -- 3) Assina, para nenhum deploy futuro repetir a limpeza.
    INSERT INTO dbo.MigracaoExecutada (Nome) VALUES ('041_limpar_chassis');

    COMMIT;

    PRINT 'Migracao 041: chassis apagados = ' + CAST(@chassis AS VARCHAR(12))
        + ' | reivindicacoes ligadas a chassi apagadas = ' + CAST(@reivs AS VARCHAR(12));
END
ELSE
BEGIN
    PRINT 'Migracao 041: limpeza ja foi feita antes - nada a fazer.';
END;
GO
