USE FullgasB2B;
GO

-- ============================================================
-- 048 - Listas de preco do Tiny por cliente (02/10/2026).
--
-- O B2B passa a receber mais de um tipo de revendedor. No Tiny, cada tipo
-- e uma "lista de precos" com um % geral (negativo = desconto, positivo =
-- acrescimo). Ao aprovar um cadastro, o admin escolhe a lista da empresa;
-- a loja, o Localizador e o pedido passam a usar o preco da lista.
--
--   dbo.ListaPreco        espelho das listas do Tiny (id do Tiny como PK).
--                         Atualizado pelo cron e pelo botao do painel. Lista
--                         que some do Tiny fica com Ativa = 0 (nao e apagada:
--                         empresas e pedidos antigos continuam apontando).
--   Empresa.ListaPrecoId  lista da empresa. NULL = preco cheio (como era
--                         antes desta migration: nenhum cliente muda de
--                         preco ao aplica-la).
--   Pedido.ListaPrecoId / Pedido.ListaPrecoPercentual
--                         a lista e o % que valiam NA HORA da compra. O
--                         pedido vai ao Tiny so na aprovacao; se a empresa
--                         trocar de lista no meio, o pedido continua com a
--                         lista com que foi precificado.
--
-- Idempotente (roda em todo deploy). ASCII puro.
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('dbo.ListaPreco', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ListaPreco (
        ListaPrecoId    INT             NOT NULL,   -- id da lista no Tiny
        Descricao       NVARCHAR(60)    NOT NULL,
        Percentual      DECIMAL(7,2)    NOT NULL,   -- -20.00 = 20% de desconto
        Ativa           BIT             NOT NULL CONSTRAINT DF_ListaPreco_Ativa DEFAULT (1),
        AtualizadoEm    DATETIME2(0)    NOT NULL CONSTRAINT DF_ListaPreco_AtualizadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ListaPreco PRIMARY KEY (ListaPrecoId),
        CONSTRAINT CK_ListaPreco_Percentual CHECK (Percentual > -100 AND Percentual <= 1000)
    );
    PRINT '048: dbo.ListaPreco criada.';
END
ELSE
    PRINT '048: dbo.ListaPreco ja existe.';
GO

IF COL_LENGTH('dbo.Empresa', 'ListaPrecoId') IS NULL
BEGIN
    ALTER TABLE dbo.Empresa ADD ListaPrecoId INT NULL
        CONSTRAINT FK_Empresa_ListaPreco REFERENCES dbo.ListaPreco (ListaPrecoId);
    PRINT '048: Empresa.ListaPrecoId criada.';
END
ELSE
    PRINT '048: Empresa.ListaPrecoId ja existe.';
GO

IF COL_LENGTH('dbo.Pedido', 'ListaPrecoId') IS NULL
BEGIN
    ALTER TABLE dbo.Pedido ADD
        ListaPrecoId         INT          NULL,
        ListaPrecoPercentual DECIMAL(7,2) NULL;
    PRINT '048: Pedido.ListaPrecoId e Pedido.ListaPrecoPercentual criadas.';
END
ELSE
    PRINT '048: Pedido.ListaPrecoId ja existe.';
GO

SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' listas de preco no espelho do Tiny'
  FROM dbo.ListaPreco;
SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' empresas com lista de preco'
  FROM dbo.Empresa WHERE ListaPrecoId IS NOT NULL;
GO
