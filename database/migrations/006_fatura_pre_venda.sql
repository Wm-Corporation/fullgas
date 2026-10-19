-- 006 - Fatura de pre-venda (revertida pela 007). Idempotente.
-- Rodar com: sqlcmd -S localhost -E -C -f 65001 -i database/migrations/006_fatura_pre_venda.sql
USE FullgasB2B;
GO

-- ---- Fatura.Tipo: permitir 'PreVenda' ----
IF OBJECT_ID('dbo.CK_Fatura_Tipo', 'C') IS NOT NULL
    ALTER TABLE dbo.Fatura DROP CONSTRAINT CK_Fatura_Tipo;
GO
ALTER TABLE dbo.Fatura ADD CONSTRAINT CK_Fatura_Tipo
    CHECK (Tipo IN ('Fatura', 'Nota de crédito', 'PreVenda'));
GO

-- ---- Fatura.Status: permitir 'Standby' e 'Ativa' ----
IF OBJECT_ID('dbo.CK_Fatura_Status', 'C') IS NOT NULL
    ALTER TABLE dbo.Fatura DROP CONSTRAINT CK_Fatura_Status;
GO
ALTER TABLE dbo.Fatura ADD CONSTRAINT CK_Fatura_Status
    CHECK (Status IN ('Emitida', 'Anulada', 'Standby', 'Ativa'));
GO

-- ---- Colunas novas em Fatura ----
IF COL_LENGTH('dbo.Fatura', 'Competencia') IS NULL
    ALTER TABLE dbo.Fatura ADD Competencia CHAR(7) NULL;  -- 'YYYY-MM' (só PreVenda)
GO
IF COL_LENGTH('dbo.Fatura', 'AtualizadoEm') IS NULL
    ALTER TABLE dbo.Fatura ADD AtualizadoEm DATETIME2 NULL;
GO

-- ---- Vínculo peça ↔ fatura de pré-venda ----
IF COL_LENGTH('dbo.PedidoItem', 'PreVendaFaturaId') IS NULL
    ALTER TABLE dbo.PedidoItem ADD PreVendaFaturaId INT NULL;
GO
IF OBJECT_ID('dbo.FK_PedidoItem_PreVendaFatura', 'F') IS NULL
    ALTER TABLE dbo.PedidoItem ADD CONSTRAINT FK_PedidoItem_PreVendaFatura
        FOREIGN KEY (PreVendaFaturaId) REFERENCES dbo.Fatura(FaturaId);
GO

-- ---- Indice filtrado (exige QUOTED_IDENTIFIER/ANSI_NULLS ON) ----
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_PedidoItem_PreVenda'
                 AND object_id = OBJECT_ID('dbo.PedidoItem'))
    CREATE INDEX IX_PedidoItem_PreVenda ON dbo.PedidoItem (ProdutoId)
        WHERE EmBackorder = 1 AND PreVendaFaturaId IS NOT NULL;
GO
