USE FullgasB2B;
GO

-- 048 - Listas de preco do Tiny: ListaPreco (espelho; Ativa = 0 se sumir do Tiny),
-- Empresa.ListaPrecoId (NULL = preco cheio) e Pedido.ListaPrecoId/ListaPrecoPercentual (da hora da compra).
-- Idempotente. ASCII.
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
