USE FullgasB2B;
GO

-- Carga do Parts Finder: modelos e secoes, com os IDs originais. Sem PecaSecao.
-- As imagens nao estao aqui: copie api/uploads/finder/ para o servidor. Idempotente.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

SET IDENTITY_INSERT dbo.ModeloMoto ON;
IF NOT EXISTS (SELECT 1 FROM dbo.ModeloMoto WHERE Codigo = 'fg125-2025')
  INSERT INTO dbo.ModeloMoto (ModeloId, Codigo, Nome, Ano, Etiqueta, Cilindrada, TipoMotor, Categoria, Ativo, Arvore, ImagemUrl, DocTecnicaUrl)
  VALUES (4, 'fg125-2025', N'MM 65', 2026, N'MM 65 2026', N'65', N'2 tempos', N'Enduro', 1, N'Fullgas > Offroad > Enduro > E1 > 2 tempos > MM 65 > MM 65 2026', NULL, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.ModeloMoto WHERE Codigo = 'fg300-2026')
  INSERT INTO dbo.ModeloMoto (ModeloId, Codigo, Nome, Ano, Etiqueta, Cilindrada, TipoMotor, Categoria, Ativo, Arvore, ImagemUrl, DocTecnicaUrl)
  VALUES (5, 'fg300-2026', N'FG 300', 2026, N'FG 300 2026', N'300', N'2 tempos', N'Enduro', 1, N'Fullgas > Offroad > Enduro > E3 > 2 tempos > FG 300 > FG 300 2026', N'/uploads/finder/1783097912896-5qtwnm5t.png', NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.ModeloMoto WHERE Codigo = 'fg450f-2025')
  INSERT INTO dbo.ModeloMoto (ModeloId, Codigo, Nome, Ano, Etiqueta, Cilindrada, TipoMotor, Categoria, Ativo, Arvore, ImagemUrl, DocTecnicaUrl)
  VALUES (6, 'fg450f-2025', N'FG 450F', 2025, N'FG 450F 2025', N'450F', N'4 tempos', N'MX', 1, N'Fullgas > Offroad > MX > 4 tempos > FG 450F > FG 450F 2025', NULL, NULL);
SET IDENTITY_INSERT dbo.ModeloMoto OFF;
GO

SET IDENTITY_INSERT dbo.SecaoModelo ON;
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 48)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (48, 4, 'chassi', '06', N'ADESIVOS', 'fork', 5, N'/uploads/finder/1783954399507-oqb7h4gz.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 49)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (49, 4, 'chassi', '04', N'CHASSI', 'bar', 3, N'/uploads/finder/1783954591030-h0s51zhb.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 50)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (50, 4, 'chassi', '01', N'COMPOSIÇÃO DA PARTE DIANTEIRA', 'frame', 0, N'/uploads/finder/1783954816349-o72jt3x0.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 51)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (51, 4, 'chassi', '05', N'PLÁSTICOS', 'shock', 4, N'/uploads/finder/1783954882776-p6fkutxu.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 52)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (52, 4, 'chassi', '02', N'SISTEMA DE FREIO DIANTEIRO', 'swing', 1, N'/uploads/finder/1783960059070-a2fadvrq.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 53)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (53, 4, 'chassi', '03', N'SISTEMA DE FREIO TRASEIRO', 'exhaust', 2, N'/uploads/finder/1783960172047-xmfs23e3.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 54)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (54, 4, 'chassi', '08', N'TRANSMISSÃO', 'tank', 7, N'/uploads/finder/1783960308045-rocqnpln.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 55)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (55, 4, 'chassi', '07', N'TREM TRASEIRO', 'plastics', 6, N'/uploads/finder/1783960536060-38cnznbr.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 56)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (56, 4, 'chassi', '09', N'RODAS', 'wheels', 8, N'/uploads/finder/1783954933652-nyh2t28w.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 59)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (59, 4, 'engine', '01', N'CILINDRO, PISTÃO', 'engine', 0, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 60)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (60, 4, 'engine', '02', N'EMBREAGEM', 'engine', 1, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 61)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (61, 4, 'engine', '03', N'IGNIÇÃO', 'engine', 2, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 62)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (62, 4, 'engine', '04', N'FILTRO DE AR, ADMISSÃO', 'tank', 3, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 63)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (63, 4, 'engine', '05', N'KIT REPARO DO MOTOR', 'engine', 4, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 64)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (64, 5, 'chassi', '06', N'GARFO DIANTEIRO, MESA SUPERIOR', 'fork', 5, N'/uploads/finder/1783538075229-e6rhto4r.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 65)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (65, 5, 'chassi', '01', N'COMPOSIÇÃO DA PARTE DIANTEIRA', 'bar', 0, N'/uploads/finder/1784049304085-siz78ss4.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 66)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (66, 5, 'chassi', '02', N'SISTEMA DE FREIO DIANTEIRO', 'frame', 1, N'/uploads/finder/1784049389362-y0gac1ow.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 67)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (67, 5, 'chassi', '03', N'SISTEMA DE FREIO TRASEIRO', 'shock', 2, N'/uploads/finder/1784049939062-m3d3janj.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 68)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (68, 5, 'chassi', '04', N'CHASSI', 'swing', 3, N'/uploads/finder/1784049981796-zo2db70b.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 69)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (69, 5, 'chassi', '05', N'PLÁSTICOS', 'exhaust', 4, N'/uploads/finder/1784050002550-7q8fx4rz.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 70)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (70, 5, 'chassi', '07', N'TREM TRASEIRO', 'tank', 6, N'/uploads/finder/1784050016307-fpj5vyjv.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 72)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (72, 5, 'chassi', '08', N'TRANSMISSÃO', 'wheels', 7, N'/uploads/finder/1784050035146-1ot8wfz5.png');
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 81)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (81, 6, 'chassi', '01', N'GARFO DIANTEIRO, MESA SUPERIOR', 'fork', 0, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 82)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (82, 6, 'chassi', '02', N'GUIDÃO, COMANDOS', 'bar', 1, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 83)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (83, 6, 'chassi', '03', N'QUADRO', 'frame', 2, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 84)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (84, 6, 'chassi', '04', N'AMORTECEDOR', 'shock', 3, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 85)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (85, 6, 'chassi', '04', N'BALANÇA', 'swing', 4, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 86)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (86, 6, 'chassi', '05', N'SISTEMA DE ESCAPE', 'exhaust', 5, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 87)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (87, 6, 'chassi', '06', N'TANQUE, ASSENTO', 'tank', 6, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 88)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (88, 6, 'chassi', '07', N'PLÁSTICOS, ADESIVOS', 'plastics', 7, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 89)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (89, 6, 'chassi', '08', N'RODAS, TRANSMISSÃO FINAL', 'wheels', 8, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 90)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (90, 6, 'chassi', '09', N'FREIO DIANTEIRO', 'brakeF', 9, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 91)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (91, 6, 'chassi', '10', N'FREIO TRASEIRO', 'brakeR', 10, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 92)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (92, 6, 'engine', '01', N'LUBRIFICAÇÃO', 'engine', 0, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 93)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (93, 6, 'engine', '02', N'EMBREAGEM', 'engine', 1, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 94)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (94, 6, 'engine', '03', N'FILTRO DE AR, ADMISSÃO', 'tank', 2, NULL);
IF NOT EXISTS (SELECT 1 FROM dbo.SecaoModelo WHERE SecaoId = 96)
  INSERT INTO dbo.SecaoModelo (SecaoId, ModeloId, Lado, Numero, Nome, Destaque, Ordem, ImagemUrl)
  VALUES (96, 5, 'chassi', '09', N'RODAS', NULL, 8, N'/uploads/finder/1784050094156-n77ya0ej.png');
SET IDENTITY_INSERT dbo.SecaoModelo OFF;
GO

PRINT 'Parts Finder carregado: 3 modelos, 37 secoes.';
GO
