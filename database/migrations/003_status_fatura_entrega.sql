-- 003 - Status em Fatura e Entrega ('Anulada' quando o pedido e cancelado). Idempotente.
USE FullgasB2B;
GO

/* Fatura.Status — 'Emitida' (padrão) | 'Anulada' */
IF COL_LENGTH('dbo.Fatura', 'Status') IS NULL
    ALTER TABLE dbo.Fatura ADD Status VARCHAR(16) NOT NULL
        CONSTRAINT DF_Fatura_Status DEFAULT 'Emitida';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Fatura_Status')
    ALTER TABLE dbo.Fatura ADD CONSTRAINT CK_Fatura_Status
        CHECK (Status IN ('Emitida', 'Anulada'));
GO

/* Entrega.Status — 'Emitida' (padrão) | 'Anulada' */
IF COL_LENGTH('dbo.Entrega', 'Status') IS NULL
    ALTER TABLE dbo.Entrega ADD Status VARCHAR(16) NOT NULL
        CONSTRAINT DF_Entrega_Status DEFAULT 'Emitida';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Entrega_Status')
    ALTER TABLE dbo.Entrega ADD CONSTRAINT CK_Entrega_Status
        CHECK (Status IN ('Emitida', 'Anulada'));
GO
