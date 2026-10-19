-- 036 - Notificacoes do suporte: Publico ('cliente' | 'admin'), Origem ('admin' | 'suporte') e ChamadoId.
-- Os DEFAULTs descrevem as linhas existentes. Idempotente.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Notificacao', 'Publico') IS NULL
BEGIN
    ALTER TABLE dbo.Notificacao ADD Publico VARCHAR(10) NOT NULL
        CONSTRAINT DF_Notificacao_Publico DEFAULT 'cliente';
    PRINT 'Coluna Notificacao.Publico criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_Notificacao_Publico'
                  AND parent_object_id = OBJECT_ID('dbo.Notificacao'))
    ALTER TABLE dbo.Notificacao WITH CHECK
        ADD CONSTRAINT CK_Notificacao_Publico CHECK (Publico IN ('cliente', 'admin'));
GO

IF COL_LENGTH('dbo.Notificacao', 'Origem') IS NULL
BEGIN
    ALTER TABLE dbo.Notificacao ADD Origem VARCHAR(10) NOT NULL
        CONSTRAINT DF_Notificacao_Origem DEFAULT 'admin';
    PRINT 'Coluna Notificacao.Origem criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_Notificacao_Origem'
                  AND parent_object_id = OBJECT_ID('dbo.Notificacao'))
    ALTER TABLE dbo.Notificacao WITH CHECK
        ADD CONSTRAINT CK_Notificacao_Origem CHECK (Origem IN ('admin', 'suporte'));
GO

-- ChamadoId so se a 035 ja rodou. CASCADE: apagar o chamado apaga seus avisos.
IF OBJECT_ID('dbo.SuporteChamado', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.Notificacao', 'ChamadoId') IS NULL
BEGIN
    ALTER TABLE dbo.Notificacao ADD ChamadoId INT NULL
        CONSTRAINT FK_Notificacao_Chamado REFERENCES dbo.SuporteChamado (ChamadoId)
        ON DELETE CASCADE;
    PRINT 'Coluna Notificacao.ChamadoId criada.';
END
GO

-- Indice da caixa de cada lado.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'IX_Notificacao_Publico'
                  AND object_id = OBJECT_ID('dbo.Notificacao'))
    CREATE INDEX IX_Notificacao_Publico ON dbo.Notificacao (Publico, CriadoEm DESC);
GO

PRINT 'Migracao 036 concluida: Notificacao ganhou Publico, Origem e ChamadoId.';
GO
