USE FullgasB2B;
GO

-- 043 - EntradaEstoque = quando entrou NESTA conta (a API reinicia a cada transferencia).
-- Corrige o gravado usando a ultima atribuicao/transferencia do historico. Idempotente.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
GO

UPDATE v
   SET v.EntradaEstoque = ult.DataEvento,
       v.AtualizadoEm   = SYSUTCDATETIME()
  FROM dbo.Veiculo v
 CROSS APPLY (
        SELECT TOP 1 h.DataEvento
          FROM dbo.VeiculoHistorico h
         WHERE h.VeiculoId = v.VeiculoId
           AND h.Tipo IN ('atribuicao', 'transferencia')
         ORDER BY h.DataEvento DESC, h.HistoricoId DESC
      ) ult
 -- So para frente; rodar de novo nao muda nada.
 WHERE v.EntradaEstoque IS NULL OR ult.DataEvento > v.EntradaEstoque;
GO

PRINT 'Migracao 043 concluida: EntradaEstoque alinhada a ultima mudanca de dono.';
GO
