USE FullgasB2B;
GO

-- ============================================================
-- 049 - De onde veio a lista de preco da empresa (02/10/2026).
--
-- Regra nova do usuario: no cadastro, o portal busca o contato no Tiny pelo
-- CNPJ e usa a lista de precos que o contato JA tem la (contato.obter ->
-- id_lista_preco). O cron mantem isso em dia. Sem lista no Tiny, a empresa
-- fica marcada em vermelho no painel ate um responsavel escolher, a mao, uma
-- das listas que ja existem no Tiny (nao se cria lista nova).
--
--   Empresa.ListaPrecoOrigem
--     'tiny'   = veio do contato no Tiny. O Tiny manda: o painel nao troca
--                (o cron desfaria); muda-se no cadastro do contato la.
--     'manual' = escolhida no painel porque o contato nao tem lista no Tiny.
--     NULL     = sem lista (preco cheio) -> marca vermelha no painel.
--
-- As listas escolhidas no painel desde a 048 (ontem) viram 'manual'.
-- Idempotente (roda em todo deploy). ASCII puro.
-- ============================================================
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
