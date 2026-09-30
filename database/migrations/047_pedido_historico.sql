USE FullgasB2B;
GO

-- ============================================================
-- 047 - Historico do pedido (dbo.PedidoHistorico).
--
-- Decisao de 30/09/2026: as garantias ficam associadas aos pedidos, e o dono
-- precisa ver tudo o que aconteceu com cada pedido num lugar so - compra,
-- aprovacao e ida ao Tiny, cada envio, entrega, cancelamento, avisos do Tiny
-- e cada passo das reivindicacoes. Mesmo molde do historico do chassi
-- (VeiculoHistorico, migration 033).
--
-- Idempotente (roda em todo deploy). ASCII puro: textos com acento sao
-- montados com NCHAR (o sqlcmd do deploy nao le UTF-8).
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('dbo.PedidoHistorico', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PedidoHistorico (
        HistoricoId  INT            IDENTITY(1,1) NOT NULL,
        PedidoId     INT            NOT NULL,
        Tipo         VARCHAR(20)    NOT NULL,
        Titulo       NVARCHAR(200)  NOT NULL,
        Detalhe      NVARCHAR(1000) NULL,
        UsuarioId    INT            NULL,
        UsuarioNome  NVARCHAR(160)  NULL,
        Referencia   VARCHAR(40)    NULL,
        DataEvento   DATETIME2(0)   NOT NULL
            CONSTRAINT DF_PedidoHistorico_Data DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_PedidoHistorico PRIMARY KEY (HistoricoId),
        CONSTRAINT FK_PedidoHistorico_Pedido FOREIGN KEY (PedidoId) REFERENCES dbo.Pedido (PedidoId),
        CONSTRAINT CK_PedidoHistorico_Tipo CHECK (Tipo IN
            ('criado', 'aprovado', 'tiny', 'envio', 'entregue', 'cancelado', 'garantia', 'aviso'))
    );
    CREATE INDEX IX_PedidoHistorico_Pedido ON dbo.PedidoHistorico (PedidoId, DataEvento);
    PRINT '047 [1/2]: dbo.PedidoHistorico criada.';
END
ELSE
    PRINT '047 [1/2]: dbo.PedidoHistorico ja existe.';
GO

/* ---- 2. Historico retroativo (so na primeira vez: tabela vazia) ---------- */
-- O que da para reconstruir do banco: a compra, a ida ao Tiny, o cancelamento
-- e as reivindicacoes. Envios antigos nao tem data registrada e ficam de fora.
IF NOT EXISTS (SELECT 1 FROM dbo.PedidoHistorico)
BEGIN
    DECLARE @reiv NVARCHAR(20) = N'Reivindica' + NCHAR(231) + NCHAR(227) + N'o';   -- Reivindicacao

    INSERT INTO dbo.PedidoHistorico (PedidoId, Tipo, Titulo, Detalhe, UsuarioNome, DataEvento)
    SELECT p.PedidoId, 'criado',
           CASE WHEN p.Tipo = 'garantia' THEN N'Pedido de garantia gerado' ELSE N'Pedido criado' END,
           N'Total R$ ' + CONVERT(NVARCHAR(30), p.Total), u.Email, p.DataPedido
      FROM dbo.Pedido p JOIN dbo.Usuario u ON u.UsuarioId = p.UsuarioId;

    INSERT INTO dbo.PedidoHistorico (PedidoId, Tipo, Titulo, Referencia, DataEvento)
    SELECT e.PedidoId, 'tiny', N'Enviado ao Tiny (n' + NCHAR(186) + N' ' + e.TinyNumero + N')',
           e.TinyNumero, COALESCE(e.ExportadoEm, e.CriadoEm)
      FROM dbo.TinyPedidoExport e WHERE e.TinyNumero IS NOT NULL;

    INSERT INTO dbo.PedidoHistorico (PedidoId, Tipo, Titulo, DataEvento)
    SELECT p.PedidoId, 'cancelado', N'Pedido cancelado', COALESCE(p.AtualizadoEm, p.DataPedido)
      FROM dbo.Pedido p WHERE p.Status = N'Cancelado';

    INSERT INTO dbo.PedidoHistorico (PedidoId, Tipo, Titulo, Referencia, DataEvento)
    SELECT r.PedidoId, 'garantia', @reiv + N' ' + r.Numero + N' aberta (' + r.Status + N')',
           r.Numero, r.DataAbertura
      FROM dbo.Reivindicacao r WHERE r.PedidoId IS NOT NULL;

    PRINT '047 [2/2]: historico retroativo gravado.';
END
ELSE
    PRINT '047 [2/2]: historico ja tinha registros - retroativo pulado.';
GO

SELECT CONVERT(VARCHAR(20), COUNT(*)) + ' eventos no historico de pedidos'
  FROM dbo.PedidoHistorico;
GO
