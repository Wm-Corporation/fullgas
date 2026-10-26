-- 051 - Fatura na remessa e peca nao encontrada.
-- Pedido.FaturaNaRemessa = 1 (pedidos novos): sem fatura no checkout; cada "Confirmar envio"
-- que vai ao Tiny gera a fatura so das pecas daquela remessa (FaturaItem). Pedidos antigos (0)
-- seguem com a fatura cheia que ja tem.
-- PedidoItem: quantidade nao encontrada + motivo; a quantidade do item pode chegar a 0.
-- Idempotente. ASCII. QUOTED_IDENTIFIER ON: PedidoItem tem indice filtrado.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.Pedido', 'FaturaNaRemessa') IS NULL
BEGIN
    ALTER TABLE dbo.Pedido ADD FaturaNaRemessa BIT NOT NULL
        CONSTRAINT DF_Pedido_FaturaNaRemessa DEFAULT (0);
    PRINT '051: coluna Pedido.FaturaNaRemessa criada (pedidos antigos = 0).';
END
ELSE
    PRINT '051: Pedido.FaturaNaRemessa ja existe - nada a fazer.';
GO

IF COL_LENGTH('dbo.PedidoItem', 'QuantidadeNaoEncontrada') IS NULL
BEGIN
    ALTER TABLE dbo.PedidoItem ADD QuantidadeNaoEncontrada INT NOT NULL
        CONSTRAINT DF_PedidoItem_NaoEncontrada DEFAULT (0);
    PRINT '051: coluna PedidoItem.QuantidadeNaoEncontrada criada.';
END
GO

IF COL_LENGTH('dbo.PedidoItem', 'MotivoNaoEncontrada') IS NULL
BEGIN
    ALTER TABLE dbo.PedidoItem ADD MotivoNaoEncontrada NVARCHAR(200) NULL;
    PRINT '051: coluna PedidoItem.MotivoNaoEncontrada criada.';
END
GO

-- Item todo nao encontrado fica com Quantidade 0 (a linha continua, com o motivo).
IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = 'CK_PedidoItem_Qtd' AND parent_object_id = OBJECT_ID('dbo.PedidoItem')
              AND definition LIKE '%>(0)%')
BEGIN
    ALTER TABLE dbo.PedidoItem DROP CONSTRAINT CK_PedidoItem_Qtd;
    PRINT '051: CK_PedidoItem_Qtd antiga (> 0) removida.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_PedidoItem_Qtd' AND parent_object_id = OBJECT_ID('dbo.PedidoItem'))
BEGIN
    ALTER TABLE dbo.PedidoItem WITH CHECK ADD CONSTRAINT CK_PedidoItem_Qtd CHECK (Quantidade >= 0);
    PRINT '051: CK_PedidoItem_Qtd aceita 0.';
END
GO

-- Itens de cada fatura (a fatura por remessa cobra so o que saiu naquela remessa).
IF OBJECT_ID('dbo.FaturaItem', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.FaturaItem (
        FaturaItemId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FaturaItem PRIMARY KEY,
        FaturaId       INT NOT NULL CONSTRAINT FK_FaturaItem_Fatura REFERENCES dbo.Fatura (FaturaId),
        Sku            VARCHAR(40)   NOT NULL,
        NomeProduto    NVARCHAR(200) NOT NULL,
        PrecoUnitario  DECIMAL(12,2) NOT NULL,
        Quantidade     INT           NOT NULL CONSTRAINT CK_FaturaItem_Qtd CHECK (Quantidade > 0),
        Subtotal       AS (PrecoUnitario * Quantidade) PERSISTED
    );
    CREATE INDEX IX_FaturaItem_Fatura ON dbo.FaturaItem (FaturaId);
    PRINT '051: tabela FaturaItem criada.';
END
ELSE
    PRINT '051: FaturaItem ja existe - nada a fazer.';
GO

SELECT CASE WHEN COL_LENGTH('dbo.Pedido', 'FaturaNaRemessa') IS NOT NULL
             AND COL_LENGTH('dbo.PedidoItem', 'QuantidadeNaoEncontrada') IS NOT NULL
             AND COL_LENGTH('dbo.PedidoItem', 'MotivoNaoEncontrada') IS NOT NULL
             AND OBJECT_ID('dbo.FaturaItem', 'U') IS NOT NULL
             AND EXISTS (SELECT 1 FROM sys.check_constraints
                          WHERE name = 'CK_PedidoItem_Qtd' AND definition LIKE '%>=(0)%')
            THEN '051 OK' ELSE '051 INCOMPLETA - conferir' END AS Conferencia051;
GO
