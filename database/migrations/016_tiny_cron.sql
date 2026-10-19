-- 016 - Tiny: evento 'webhook' vira 'cron' no TinySyncLog. Idempotente.

USE FullgasB2B;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = N'CK_TinySyncLog_Evento'
              AND parent_object_id = OBJECT_ID(N'dbo.TinySyncLog'))
    ALTER TABLE dbo.TinySyncLog DROP CONSTRAINT CK_TinySyncLog_Evento;
GO

ALTER TABLE dbo.TinySyncLog ADD CONSTRAINT CK_TinySyncLog_Evento
    CHECK (Evento IN ('cron', 'importacao', 'lote'));
GO

PRINT N'Migração 016 concluída.';
GO
