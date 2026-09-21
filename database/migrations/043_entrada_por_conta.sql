USE FullgasB2B;
GO

-- ============================================================
-- 043 - EntradaEstoque passa a ser "entrou NESTA conta", nao "entrou no
--       sistema".
--
-- Como era: a coluna era gravada uma unica vez, no cadastro do chassi, e
-- nenhuma transferencia a tocava. Uma moto que chegou na concessionaria
-- ontem aparecia no estoque dela "desde" o dia em que a Fabrica cadastrou o
-- chassi - as vezes meses antes. A conta que recebeu nunca soube desde
-- quando a moto e' dela.
--
-- Como fica: toda atribuicao/transferencia (inclusive a devolucao a Fabrica)
-- reinicia a data. Quem olha o proprio estoque le "desde quando esta comigo".
-- A mudanca de gravacao esta na API (veiculos.routes.js); esta migration
-- corrige o que JA estava gravado.
--
-- A entrada no SISTEMA nao se perde: continua em dbo.Veiculo.CriadoEm e no
-- evento 'cadastro' do historico do chassi.
--
-- Conserto: o historico (dbo.VeiculoHistorico, migration 033) guarda cada
-- mudanca de dono desde 2026. Para cada chassi pegamos a ULTIMA mudanca -
-- 'atribuicao' (saiu da Fabrica) ou 'transferencia' (trocou de
-- concessionaria, ou voltou para a Fabrica) - e usamos a data dela.
-- Chassi que nunca mudou de dono nao tem o que corrigir: segue na Fabrica
-- desde o cadastro, que e' a resposta certa.
--
-- Idempotente: pode rodar em todo deploy. Roda sobre uma base ja limpa pela
-- 041 (nenhuma linha), e continua correta se um dia for aplicada numa base
-- com dados - por isso nao foi juntada a limpeza.
-- ============================================================
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
 -- So para frente: a entrada no estoque atual nunca e' anterior a mudanca de
 -- dono que a criou. O ">" tambem deixa a migration convergir - rodar de novo
 -- nao mexe em nada.
 WHERE v.EntradaEstoque IS NULL OR ult.DataEvento > v.EntradaEstoque;
GO

PRINT 'Migracao 043 concluida: EntradaEstoque alinhada a ultima mudanca de dono.';
GO
