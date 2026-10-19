-- 018 - Exportacao de pedidos ao Tiny: tabela TinyPedidoExport.
-- Escopo 'normal' | 'backorder'; status 'pendente' -> 'enviado' | 'erro' | 'cancelado'. Idempotente.

USE FullgasB2B;
GO

-- Indice filtrado exige QUOTED_IDENTIFIER ON.
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.TinyPedidoExport', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TinyPedidoExport (
        ExportId      INT            IDENTITY(1,1) NOT NULL,
        PedidoId      INT            NOT NULL,
        Escopo        VARCHAR(10)    NOT NULL,  -- 'normal' | 'backorder'
        Status        VARCHAR(10)    NOT NULL
            CONSTRAINT DF_TinyPedidoExport_Status DEFAULT ('pendente'),
        TinyPedidoId  VARCHAR(40)    NULL,      -- id do pedido no Tiny (pós-inclusão)
        TinyNumero    VARCHAR(20)    NULL,      -- número do pedido no Tiny
        ItensJson     NVARCHAR(MAX)  NULL,      -- snapshot dos itens (só backorder)
        Tentativas    INT            NOT NULL
            CONSTRAINT DF_TinyPedidoExport_Tentativas DEFAULT (0),
        UltimoErro    NVARCHAR(500)  NULL,
        CriadoEm      DATETIME2(0)   NOT NULL
            CONSTRAINT DF_TinyPedidoExport_CriadoEm DEFAULT (SYSUTCDATETIME()),
        ExportadoEm   DATETIME2(0)   NULL,
        CONSTRAINT PK_TinyPedidoExport PRIMARY KEY (ExportId),
        CONSTRAINT FK_TinyPedidoExport_Pedido FOREIGN KEY (PedidoId)
            REFERENCES dbo.Pedido (PedidoId),
        CONSTRAINT CK_TinyPedidoExport_Escopo CHECK (Escopo IN ('normal', 'backorder')),
        CONSTRAINT CK_TinyPedidoExport_Status CHECK (Status IN ('pendente', 'enviado', 'erro', 'cancelado'))
    );

    CREATE INDEX IX_TinyPedidoExport_Status ON dbo.TinyPedidoExport (Status)
        INCLUDE (PedidoId, Escopo);
    CREATE INDEX IX_TinyPedidoExport_Pedido ON dbo.TinyPedidoExport (PedidoId);

    PRINT N'Tabela TinyPedidoExport criada.';
END
ELSE
    PRINT N'Tabela TinyPedidoExport já existe — nada a fazer.';
GO

-- Uma exportacao 'normal' por pedido; 'backorder' pode repetir.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'UX_TinyPedidoExport_Normal'
                  AND object_id = OBJECT_ID(N'dbo.TinyPedidoExport'))
BEGIN
    CREATE UNIQUE INDEX UX_TinyPedidoExport_Normal
        ON dbo.TinyPedidoExport (PedidoId) WHERE Escopo = 'normal';
    PRINT N'Índice UX_TinyPedidoExport_Normal criado.';
END
GO

PRINT N'Migração 018 concluída.';
GO
