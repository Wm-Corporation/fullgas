USE FullgasB2B;
GO

-- ============================================================
-- 042 - Veiculo ganha o campo Ano (ano daquela moto fisica).
--
-- Ate aqui o ano so existia no MODELO (dbo.ModeloMoto.Ano, ex.: "FG 125
-- 2025"). O ano do chassi passa a ser gravado por unidade: o mesmo modelo
-- pode ser montado em anos diferentes, e e' o ano do chassi que vale na nota,
-- no emplacamento e na contagem de garantia.
--
-- Preenchimento dos chassis antigos: o ano do modelo. Depois da limpeza da
-- migration 041 a tabela esta vazia, entao na pratica isso so age se algum
-- chassi for cadastrado entre uma migration e outra - mas sem ele o passo
-- seguinte (NOT NULL) falharia.
--
-- Idempotente: pode rodar em todo deploy.
--
-- ATENCAO ao formato: cada passo fica em SEU PROPRIO LOTE (GO). O SQL Server
-- compila o lote inteiro antes de executar, entao usar a coluna nova no mesmo
-- lote do ALTER TABLE daria "Invalid column name" - e o deploy NAO para em
-- erro de SQL, o que esconderia a falha. ASCII puro: o sqlcmd do deploy roda
-- sem -f 65001 e nao le UTF-8.
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- 1) A coluna nasce NULL: a tabela pode ter linhas, e NOT NULL sem valor
--    seria recusado.
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

-- 3) Agora que ninguem esta sem ano, a coluna vira obrigatoria - cadastro de
--    chassi sem ano deixa de ser possivel pelo banco, nao so pela tela.
IF EXISTS (SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('dbo.Veiculo') AND name = 'Ano' AND is_nullable = 1)
   AND NOT EXISTS (SELECT 1 FROM dbo.Veiculo WHERE Ano IS NULL)
    ALTER TABLE dbo.Veiculo ALTER COLUMN Ano SMALLINT NOT NULL;
GO

-- 4) Faixa de sanidade contra erro de digitacao (ex.: 202 ou 20255). O limite
--    apertado de verdade ("ate o ano que vem") fica na API, que sabe a data de
--    hoje; um CHECK com GETDATE() envelheceria dentro do banco.
IF OBJECT_ID('dbo.CK_Veiculo_Ano', 'C') IS NULL
    ALTER TABLE dbo.Veiculo ADD CONSTRAINT CK_Veiculo_Ano CHECK (Ano BETWEEN 1980 AND 2100);
GO

PRINT 'Migracao 042 concluida: dbo.Veiculo.Ano.';
GO
