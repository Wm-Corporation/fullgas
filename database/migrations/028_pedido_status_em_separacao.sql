USE FullgasB2B;
GO

-- ============================================================
-- 028 — Renomeia o status de pedido "Processando" para "Em separação".
-- Troca o valor no CHECK constraint e migra as linhas existentes.
-- Idempotente.
--
-- NOTA DE ENCODING: o texto acentuado "Em separação" é montado com NCHAR()
-- (ç = 231, ã = 227) em vez de literal, para que este arquivo seja 100% ASCII
-- e NÃO dependa de como o sqlcmd lê o encoding do arquivo (rodar via
-- `sqlcmd < arquivo` lê como codepage do console e corromperia acentos).
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
GO

DECLARE @sep NVARCHAR(20) = N'Em separa' + NCHAR(231) + NCHAR(227) + N'o';  -- "Em separação"

BEGIN TRAN;

-- Migra linhas existentes que ainda usem o nome antigo.
UPDATE dbo.Pedido SET Status = @sep WHERE Status = N'Processando';

IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = 'CK_Pedido_Status' AND parent_object_id = OBJECT_ID('dbo.Pedido'))
    ALTER TABLE dbo.Pedido DROP CONSTRAINT CK_Pedido_Status;

-- "Processando" continua ACEITO como valor legado: durante a transição, uma
-- API antiga (ainda não reiniciada) pode gravá-lo. O código novo só usa
-- "Em separação"; o legado some sozinho conforme os pedidos avançam.
DECLARE @sql NVARCHAR(MAX) = N'ALTER TABLE dbo.Pedido ADD CONSTRAINT CK_Pedido_Status ' +
  N'CHECK (Status IN (N''Pendente'', N''Aprovado'', N''Processando'', N''Parcial'', N''Enviado'', N''Entregue'', N''Cancelado'', N''' + @sep + N'''))';
EXEC sp_executesql @sql;

COMMIT;
GO
