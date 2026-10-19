USE FullgasB2B;
GO

-- 042 - Veiculo.Ano (ano da unidade). Antigos recebem o ano do modelo.
-- Cada passo em seu proprio lote (GO). Idempotente. ASCII.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- 1) Nasce NULL (a tabela pode ter linhas).
IF COL_LENGTH('dbo.Veiculo', 'Ano') IS NULL
    ALTER TABLE dbo.Veiculo ADD Ano SMALLINT NULL;
GO

-- 2) Chassi antigo herda o ano do proprio modelo.
UPDATE v
   SET v.Ano = m.Ano
  FROM dbo.Veiculo v
  JOIN dbo.ModeloMoto m ON m.ModeloId = v.ModeloId
 WHERE v.Ano IS NULL;
GO

-- 3) Vira obrigatoria.
IF EXISTS (SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('dbo.Veiculo') AND name = 'Ano' AND is_nullable = 1)
   AND NOT EXISTS (SELECT 1 FROM dbo.Veiculo WHERE Ano IS NULL)
    ALTER TABLE dbo.Veiculo ALTER COLUMN Ano SMALLINT NOT NULL;
GO

-- 4) Faixa larga contra digitacao; o limite real fica na API.
IF OBJECT_ID('dbo.CK_Veiculo_Ano', 'C') IS NULL
    ALTER TABLE dbo.Veiculo ADD CONSTRAINT CK_Veiculo_Ano CHECK (Ano BETWEEN 1980 AND 2100);
GO

PRINT 'Migracao 042 concluida: dbo.Veiculo.Ano.';
GO
