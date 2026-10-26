-- 050 - Black order: o que faltou no estoque no checkout vira fila por peca.
-- Nao gera fatura nem vai ao Tiny. A fila reserva o saldo que chega do Tiny (ordem de chegada);
-- o cliente e avisado e compra pelo carrinho da black order (vira pedido normal com fatura).
-- Idempotente. Texto em ASCII (o deploy roda o sqlcmd sem UTF-8). Sem indice filtrado
-- (o sqlcmd do deploy roda sem QUOTED_IDENTIFIER).
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.BlackOrder', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BlackOrder (
        BlackOrderId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_BlackOrder PRIMARY KEY,
        -- Numero da compra de origem. PedidoId fica NULL quando nada da compra tinha estoque.
        NumeroPedido          VARCHAR(20)   NOT NULL,
        PedidoId              INT           NULL CONSTRAINT FK_BlackOrder_Pedido REFERENCES dbo.Pedido (PedidoId),
        EmpresaId             INT           NOT NULL CONSTRAINT FK_BlackOrder_Empresa REFERENCES dbo.Empresa (EmpresaId),
        UsuarioId             INT           NOT NULL CONSTRAINT FK_BlackOrder_Usuario REFERENCES dbo.Usuario (UsuarioId),
        ProdutoId             INT           NOT NULL CONSTRAINT FK_BlackOrder_Produto REFERENCES dbo.Produto (ProdutoId),
        Sku                   VARCHAR(40)   NOT NULL,
        NomeProduto           NVARCHAR(200) NOT NULL,
        Quantidade            INT           NOT NULL,
        -- Reservada: ja chegou e esta separada para o cliente comprar.
        QuantidadeReservada   INT           NOT NULL CONSTRAINT DF_BlackOrder_Reservada DEFAULT (0),
        QuantidadeAtendida    INT           NOT NULL CONSTRAINT DF_BlackOrder_Atendida DEFAULT (0),
        QuantidadeDescartada  INT           NOT NULL CONSTRAINT DF_BlackOrder_Descartada DEFAULT (0),
        Status                VARCHAR(12)   NOT NULL CONSTRAINT DF_BlackOrder_Status DEFAULT ('Fila'),
        -- Atualizados a mao pelo admin (envio da Europa).
        SituacaoEnvio         NVARCHAR(60)  NULL,
        PrevisaoChegada       VARCHAR(20)   NULL,
        Observacao            NVARCHAR(500) NULL,
        AvisadoEm             DATETIME2(0)  NULL,
        CriadoEm              DATETIME2(0)  NOT NULL CONSTRAINT DF_BlackOrder_CriadoEm DEFAULT (SYSUTCDATETIME()),
        AtualizadoEm          DATETIME2(0)  NOT NULL CONSTRAINT DF_BlackOrder_AtualizadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT CK_BlackOrder_Quantidade CHECK (Quantidade > 0),
        CONSTRAINT CK_BlackOrder_Status CHECK (Status IN ('Fila', 'Disponivel', 'Atendida', 'Cancelada')),
        CONSTRAINT CK_BlackOrder_Saldo CHECK (
            QuantidadeReservada >= 0 AND QuantidadeAtendida >= 0 AND QuantidadeDescartada >= 0 AND
            QuantidadeReservada + QuantidadeAtendida + QuantidadeDescartada <= Quantidade)
    );
    CREATE INDEX IX_BlackOrder_Produto ON dbo.BlackOrder (ProdutoId, Status, BlackOrderId);
    CREATE INDEX IX_BlackOrder_Empresa ON dbo.BlackOrder (EmpresaId, CriadoEm);
    CREATE INDEX IX_BlackOrder_Pedido ON dbo.BlackOrder (PedidoId);
    PRINT '050: tabela BlackOrder criada.';
END
ELSE
    PRINT '050: BlackOrder ja existe - nada a fazer.';
GO

-- Compras feitas pelo carrinho da black order: qual pedido atendeu quanto.
IF OBJECT_ID('dbo.BlackOrderAtendimento', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BlackOrderAtendimento (
        BlackOrderId INT NOT NULL CONSTRAINT FK_BOAtend_BlackOrder REFERENCES dbo.BlackOrder (BlackOrderId),
        PedidoId     INT NOT NULL CONSTRAINT FK_BOAtend_Pedido REFERENCES dbo.Pedido (PedidoId),
        Quantidade   INT NOT NULL CONSTRAINT CK_BOAtend_Quantidade CHECK (Quantidade > 0),
        CriadoEm     DATETIME2(0) NOT NULL CONSTRAINT DF_BOAtend_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_BlackOrderAtendimento PRIMARY KEY (BlackOrderId, PedidoId)
    );
    CREATE INDEX IX_BOAtend_Pedido ON dbo.BlackOrderAtendimento (PedidoId);
    PRINT '050: tabela BlackOrderAtendimento criada.';
END
ELSE
    PRINT '050: BlackOrderAtendimento ja existe - nada a fazer.';
GO

-- Notificacao: link para a tela certa (o carrinho da black order) e a origem 'blackorder'.
IF COL_LENGTH('dbo.Notificacao', 'Link') IS NULL
BEGIN
    ALTER TABLE dbo.Notificacao ADD Link VARCHAR(200) NULL;
    PRINT '050: coluna Notificacao.Link criada.';
END
ELSE
    PRINT '050: Notificacao.Link ja existe - nada a fazer.';
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = 'CK_Notificacao_Origem'
              AND parent_object_id = OBJECT_ID('dbo.Notificacao')
              AND definition NOT LIKE '%blackorder%')
BEGIN
    ALTER TABLE dbo.Notificacao DROP CONSTRAINT CK_Notificacao_Origem;
    PRINT '050: CK_Notificacao_Origem antiga removida.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_Notificacao_Origem'
                  AND parent_object_id = OBJECT_ID('dbo.Notificacao'))
BEGIN
    ALTER TABLE dbo.Notificacao WITH CHECK
        ADD CONSTRAINT CK_Notificacao_Origem CHECK (Origem IN ('admin', 'suporte', 'blackorder'));
    PRINT '050: CK_Notificacao_Origem aceita blackorder.';
END
GO

-- Conferencia (o deploy nao para em erro de SQL): as duas tabelas e a coluna existem?
SELECT CASE WHEN OBJECT_ID('dbo.BlackOrder', 'U') IS NOT NULL
             AND OBJECT_ID('dbo.BlackOrderAtendimento', 'U') IS NOT NULL
             AND COL_LENGTH('dbo.Notificacao', 'Link') IS NOT NULL
            THEN '050 OK' ELSE '050 INCOMPLETA - conferir' END AS Conferencia050;
GO
