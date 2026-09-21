USE FullgasB2B;
GO

-- ============================================================
-- 041 - Limpa TODOS os chassis (dbo.Veiculo) ja cadastrados.
--
-- Pedido do dono (18/09/2026): zerar a base de chassis para recomecar o
-- cadastro do zero, agora com o campo Ano (migration 042).
--
-- O que sai junto, e por que:
--   - VeiculoHistorico: a FK e' ON DELETE CASCADE (migration 033), some
--     sozinho com o chassi. A linha do tempo de um chassi que nao existe
--     mais nao teria a quem pertencer.
--   - Reivindicacao presa a um chassi (VeiculoId NOT NULL): apagada junto,
--     por decisao do dono. Seus anexos (001) e pecas (009) sao ON DELETE
--     CASCADE e saem juntos. A FK Reiv->Veiculo e' NO ACTION: sem apagar a
--     reivindicacao, o DELETE do chassi seria RECUSADO pelo banco.
--   - Reivindicacao SEM chassi (VeiculoId NULL) NAO e' tocada.
--
-- ATENCAO - ESTA MIGRATION NAO E' IDEMPOTENTE NO SENTIDO USUAL.
-- O laco do deploy.sh roda TODAS as migrations em TODO deploy. Um DELETE
-- solto aqui apagaria, a cada deploy, os chassis cadastrados depois desta
-- limpeza - o dono perderia o trabalho sem nenhum aviso. Por isso a limpeza
-- roda UMA UNICA VEZ, protegida pela tabela de controle dbo.MigracaoExecutada:
-- na primeira vez ela limpa e assina; nos deploys seguintes ela nao faz nada.
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
GO

-- Tabela de controle: o registro de quais migrations DE UMA VEZ SO ja rodaram.
-- (As migrations idempotentes normais nao precisam dela.)
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
