USE FullgasB2B;
GO

-- 025 - Remove as 6 reivindicacoes de demonstracao e as 4 concessionarias fantasma (se vazias). Idempotente.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @demo TABLE (Numero VARCHAR(20) PRIMARY KEY);
INSERT INTO @demo (Numero) VALUES
  ('12094338'), ('12079465'), ('12079380'), ('12071122'), ('12065540'), ('12060071');

-- 1) Filhos + reivindicações demo.
DELETE ap
  FROM dbo.ReivindicacaoAnexo ap
  JOIN dbo.Reivindicacao r ON r.ReivindicacaoId = ap.ReivindicacaoId
 WHERE r.Numero IN (SELECT Numero FROM @demo);

DELETE pp
  FROM dbo.ReivindicacaoPeca pp
  JOIN dbo.Reivindicacao r ON r.ReivindicacaoId = pp.ReivindicacaoId
 WHERE r.Numero IN (SELECT Numero FROM @demo);

DELETE FROM dbo.Reivindicacao
 WHERE Numero IN (SELECT Numero FROM @demo);

-- 2) Concessionarias fantasma: so se nao sobrou vinculo.
DELETE e
  FROM dbo.Empresa e
 WHERE e.RazaoSocial IN (N'GOX POWERSPORTS', N'BK OFF ROAD', N'M4 RACING-PR', N'ART MOTO RACING')
   AND NOT EXISTS (SELECT 1 FROM dbo.Usuario u       WHERE u.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Pedido p        WHERE p.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Fatura f        WHERE f.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Entrega en      WHERE en.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Veiculo v       WHERE v.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Reivindicacao r WHERE r.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Notificacao n   WHERE n.EmpresaId = e.EmpresaId);

COMMIT;
GO
