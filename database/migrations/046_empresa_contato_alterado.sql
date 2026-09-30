USE FullgasB2B;
GO

-- ============================================================
-- 046 - Edicao de cadastro ainda nao entregue ao Tiny
--       (Empresa.TinyContatoAlterado).
--
-- Achado de 30/09/2026: a concessionaria editou o endereco em "Minha
-- conta", a tela disse "salvo", o envio ao Tiny falhou - e o cron, que
-- tambem traz o contato do Tiny para o portal, sobrescreveu a edicao com o
-- dado velho de la em menos de 30 minutos. Ninguem ficou sabendo.
--
-- Com esta coluna: a edicao marca 1; o envio que der certo volta a 0.
-- Enquanto estiver 1, o cron TENTA ENVIAR DE NOVO em vez de trazer o
-- cadastro do Tiny por cima.
--
-- Idempotente (roda em todo deploy). ASCII puro.
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Empresa', 'TinyContatoAlterado') IS NULL
BEGIN
    ALTER TABLE dbo.Empresa ADD TinyContatoAlterado BIT NOT NULL
        CONSTRAINT DF_Empresa_TinyContatoAlterado DEFAULT (0);
    PRINT '046: Empresa.TinyContatoAlterado criada.';
END
ELSE
    PRINT '046: Empresa.TinyContatoAlterado ja existe.';
GO

SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' empresas com edicao pendente de envio ao Tiny'
  FROM dbo.Empresa WHERE TinyContatoAlterado = 1;
GO
