USE FullgasB2B;
GO

-- 028 - Status "Processando" vira "Em separacao" (acentos com NCHAR, arquivo ASCII). Idempotente.
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

-- "Processando" segue aceito como legado.
DECLARE @sql NVARCHAR(MAX) = N'ALTER TABLE dbo.Pedido ADD CONSTRAINT CK_Pedido_Status ' +
  N'CHECK (Status IN (N''Pendente'', N''Aprovado'', N''Processando'', N''Parcial'', N''Enviado'', N''Entregue'', N''Cancelado'', N''' + @sep + N'''))';
EXEC sp_executesql @sql;

COMMIT;
GO
