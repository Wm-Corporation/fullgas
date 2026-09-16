/* ============================================================================
   039 — ModeloMoto.Marca e ModeloMoto.Modalidade: arvore do Parts Finder
         montada a partir dos campos
   ----------------------------------------------------------------------------
   Ate aqui a "arvore de selecao" era um texto livre (ModeloMoto.Arvore) que o
   admin digitava a mao, e que nao acompanhava as edicoes do modelo. A partir
   de agora ela e' MONTADA pela API, na hora, com cinco niveis:

       Marca > Modalidade > Categoria > Nome > Ano
       Fullgas > Off-road > Enduro > FG 125 > 2025

   Categoria, Nome e Ano ja existiam. Faltavam os dois primeiros niveis, que
   esta migration cria. Cilindrada e tipo de motor continuam no modelo, mas
   nao entram na arvore.

   NOT NULL com DEFAULT: o proprio ALTER preenche os modelos ja cadastrados com
   'Fullgas' e 'Off-road' — hoje a unica marca e a unica modalidade. O admin
   troca pelo painel quando precisar.

   ModeloMoto.Arvore NAO e' apagada: deixa de ser lida e gravada, mas o texto
   antigo fica no banco caso alguem queira consultar.

   Os textos abaixo ficam sem acento de proposito: o deploy.sh roda o sqlcmd
   sem -f 65001, e acento em literal sairia corrompido.

   Idempotente: o deploy.sh roda todas as migrations a cada publicacao.
   ============================================================================ */

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.ModeloMoto', 'Marca') IS NULL
BEGIN
    ALTER TABLE dbo.ModeloMoto
        ADD Marca NVARCHAR(60) NOT NULL
            CONSTRAINT DF_ModeloMoto_Marca DEFAULT (N'Fullgas');
    PRINT N'039: coluna ModeloMoto.Marca criada.';
END
ELSE
    PRINT N'039: ModeloMoto.Marca ja existe - nada a fazer.';
GO

IF COL_LENGTH('dbo.ModeloMoto', 'Modalidade') IS NULL
BEGIN
    ALTER TABLE dbo.ModeloMoto
        ADD Modalidade NVARCHAR(60) NOT NULL
            CONSTRAINT DF_ModeloMoto_Modalidade DEFAULT (N'Off-road');
    PRINT N'039: coluna ModeloMoto.Modalidade criada.';
END
ELSE
    PRINT N'039: ModeloMoto.Modalidade ja existe - nada a fazer.';
GO
