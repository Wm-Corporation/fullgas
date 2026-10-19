-- FULLGAS B2B - Schema (SQL Server): banco, tabelas, chaves, constraints e indices. Sem dados.
-- Mantenha os GO entre os lotes.

-- Obrigatorio: indice filtrado exige QUOTED_IDENTIFIER ON (o sqlcmd entra com OFF).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- ---- 0) Banco de dados ----
IF DB_ID(N'FullgasB2B') IS NULL
    CREATE DATABASE FullgasB2B;
GO

USE FullgasB2B;
GO

/* Remoção em ordem reversa de dependência (permite reexecutar o script) */
IF OBJECT_ID(N'dbo.RastreioEntrega','U')  IS NOT NULL DROP TABLE dbo.RastreioEntrega;
IF OBJECT_ID(N'dbo.EntregaPedido','U')    IS NOT NULL DROP TABLE dbo.EntregaPedido;
IF OBJECT_ID(N'dbo.PedidoFatura','U')     IS NOT NULL DROP TABLE dbo.PedidoFatura;
IF OBJECT_ID(N'dbo.PedidoItem','U')       IS NOT NULL DROP TABLE dbo.PedidoItem;
IF OBJECT_ID(N'dbo.PecaSecao','U')        IS NOT NULL DROP TABLE dbo.PecaSecao;
IF OBJECT_ID(N'dbo.SecaoModelo','U')      IS NOT NULL DROP TABLE dbo.SecaoModelo;
IF OBJECT_ID(N'dbo.Notificacao','U')      IS NOT NULL DROP TABLE dbo.Notificacao;
IF OBJECT_ID(N'dbo.LogBusca','U')         IS NOT NULL DROP TABLE dbo.LogBusca;
IF OBJECT_ID(N'dbo.Reivindicacao','U')    IS NOT NULL DROP TABLE dbo.Reivindicacao;
IF OBJECT_ID(N'dbo.Fatura','U')           IS NOT NULL DROP TABLE dbo.Fatura;
IF OBJECT_ID(N'dbo.Entrega','U')          IS NOT NULL DROP TABLE dbo.Entrega;
IF OBJECT_ID(N'dbo.Pedido','U')           IS NOT NULL DROP TABLE dbo.Pedido;
IF OBJECT_ID(N'dbo.Veiculo','U')          IS NOT NULL DROP TABLE dbo.Veiculo;
IF OBJECT_ID(N'dbo.ModeloMoto','U')       IS NOT NULL DROP TABLE dbo.ModeloMoto;
IF OBJECT_ID(N'dbo.Produto','U')          IS NOT NULL DROP TABLE dbo.Produto;
IF OBJECT_ID(N'dbo.Categoria','U')        IS NOT NULL DROP TABLE dbo.Categoria;
IF OBJECT_ID(N'dbo.Endereco','U')         IS NOT NULL DROP TABLE dbo.Endereco;
IF OBJECT_ID(N'dbo.Usuario','U')          IS NOT NULL DROP TABLE dbo.Usuario;
IF OBJECT_ID(N'dbo.Empresa','U')          IS NOT NULL DROP TABLE dbo.Empresa;
GO

-- ---- 1) Empresas e usuarios ----

/* Uma concessionária/revenda. Os usuários pertencem a uma empresa. */
CREATE TABLE dbo.Empresa (
    EmpresaId       INT             IDENTITY(1,1) NOT NULL,
    RazaoSocial     NVARCHAR(160)   NOT NULL,
    NomeFantasia    NVARCHAR(160)   NULL,
    Cnpj            VARCHAR(18)     NULL,
    Pais            NVARCHAR(60)    NOT NULL CONSTRAINT DF_Empresa_Pais DEFAULT (N'Brasil'),
    Email           NVARCHAR(160)   NULL,
    Telefone        VARCHAR(30)     NULL,
    Ativo           BIT             NOT NULL CONSTRAINT DF_Empresa_Ativo DEFAULT (1),
    CriadoEm        DATETIME2(0)    NOT NULL CONSTRAINT DF_Empresa_CriadoEm DEFAULT (SYSUTCDATETIME()),
    AtualizadoEm    DATETIME2(0)    NULL,
    CONSTRAINT PK_Empresa PRIMARY KEY (EmpresaId)
);
GO

-- CNPJ unico, aceitando varios NULL (indice filtrado).
CREATE UNIQUE INDEX UQ_Empresa_Cnpj ON dbo.Empresa (Cnpj) WHERE Cnpj IS NOT NULL;
GO

/* Endereços por empresa (entrega / cobrança). Uma empresa tem vários. */
CREATE TABLE dbo.Endereco (
    EnderecoId      INT             IDENTITY(1,1) NOT NULL,
    EmpresaId       INT             NOT NULL,
    Tipo            VARCHAR(12)     NOT NULL,   -- 'Entrega' | 'Cobranca'
    Logradouro      NVARCHAR(180)   NOT NULL,
    Numero          NVARCHAR(20)    NULL,
    Complemento     NVARCHAR(80)    NULL,
    Bairro          NVARCHAR(80)    NULL,
    Cidade          NVARCHAR(80)    NOT NULL,
    Uf              CHAR(2)         NULL,
    Cep             VARCHAR(9)      NULL,
    Pais            NVARCHAR(60)    NOT NULL CONSTRAINT DF_Endereco_Pais DEFAULT (N'Brasil'),
    Principal       BIT             NOT NULL CONSTRAINT DF_Endereco_Principal DEFAULT (0),
    CONSTRAINT PK_Endereco PRIMARY KEY (EnderecoId),
    CONSTRAINT FK_Endereco_Empresa FOREIGN KEY (EmpresaId)
        REFERENCES dbo.Empresa (EmpresaId) ON DELETE CASCADE,
    CONSTRAINT CK_Endereco_Tipo CHECK (Tipo IN ('Entrega','Cobranca'))
);
GO

/* Usuários do portal. Papel define acesso; Status controla aprovação/bloqueio. */
CREATE TABLE dbo.Usuario (
    UsuarioId       INT             IDENTITY(1,1) NOT NULL,
    EmpresaId       INT             NOT NULL,
    Nome            NVARCHAR(120)   NOT NULL,
    Email           NVARCHAR(160)   NOT NULL,
    SenhaHash       VARBINARY(256)  NULL,    -- hash bcrypt, nunca texto puro
    Papel           VARCHAR(10)     NOT NULL CONSTRAINT DF_Usuario_Papel  DEFAULT ('cliente'),
    Status          VARCHAR(12)     NOT NULL CONSTRAINT DF_Usuario_Status DEFAULT ('pendente'),
    UltimoAcessoEm  DATETIME2(0)    NULL,
    CriadoEm        DATETIME2(0)    NOT NULL CONSTRAINT DF_Usuario_CriadoEm DEFAULT (SYSUTCDATETIME()),
    AtualizadoEm    DATETIME2(0)    NULL,
    CONSTRAINT PK_Usuario PRIMARY KEY (UsuarioId),
    CONSTRAINT UQ_Usuario_Email UNIQUE (Email),
    CONSTRAINT FK_Usuario_Empresa FOREIGN KEY (EmpresaId)
        REFERENCES dbo.Empresa (EmpresaId),
    CONSTRAINT CK_Usuario_Papel  CHECK (Papel  IN ('admin','cliente')),
    CONSTRAINT CK_Usuario_Status CHECK (Status IN ('pendente','aprovado','bloqueado'))
);
GO

-- ---- 2) Catalogo: categorias e produtos ----

CREATE TABLE dbo.Categoria (
    CategoriaId     INT             IDENTITY(1,1) NOT NULL,
    Codigo          VARCHAR(40)     NOT NULL,   -- 'pecas', 'tecnicos', ... (slug do app)
    Nome            NVARCHAR(120)   NOT NULL,
    Icone           VARCHAR(40)     NULL,
    Ordem           INT             NOT NULL CONSTRAINT DF_Categoria_Ordem DEFAULT (0),
    Ativo           BIT             NOT NULL CONSTRAINT DF_Categoria_Ativo DEFAULT (1),
    CONSTRAINT PK_Categoria PRIMARY KEY (CategoriaId),
    CONSTRAINT UQ_Categoria_Codigo UNIQUE (Codigo)
);
GO

/* Produto = SKU. 'Sku' é o número do artigo (ex.: A590C161Y401000). */
CREATE TABLE dbo.Produto (
    ProdutoId       INT             IDENTITY(1,1) NOT NULL,
    Sku             VARCHAR(40)     NOT NULL,   -- "Article No."
    Nome            NVARCHAR(200)   NOT NULL,
    CategoriaId     INT             NOT NULL,
    Descricao       NVARCHAR(1000)  NULL,
    Preco           DECIMAL(12,2)   NOT NULL CONSTRAINT DF_Produto_Preco DEFAULT (0),
    Moeda           CHAR(3)         NOT NULL CONSTRAINT DF_Produto_Moeda DEFAULT ('BRL'),
    Estoque         INT             NOT NULL CONSTRAINT DF_Produto_Estoque DEFAULT (0),
    PrevisaoChegada VARCHAR(20)     NULL,       -- texto livre (ex.: '26/07/26') quando estoque = 0
    Ativo           BIT             NOT NULL CONSTRAINT DF_Produto_Ativo DEFAULT (1),
    CriadoEm        DATETIME2(0)    NOT NULL CONSTRAINT DF_Produto_CriadoEm DEFAULT (SYSUTCDATETIME()),
    AtualizadoEm    DATETIME2(0)    NULL,
    CONSTRAINT PK_Produto PRIMARY KEY (ProdutoId),
    CONSTRAINT UQ_Produto_Sku UNIQUE (Sku),
    CONSTRAINT FK_Produto_Categoria FOREIGN KEY (CategoriaId)
        REFERENCES dbo.Categoria (CategoriaId),
    CONSTRAINT CK_Produto_Preco   CHECK (Preco   >= 0),
    CONSTRAINT CK_Produto_Estoque CHECK (Estoque >= 0)
);
GO

-- ---- 3) Motos: modelos e veiculos (NIV) ----

/* Modelo (família + ano), ex.: FG 125 2025. */
CREATE TABLE dbo.ModeloMoto (
    ModeloId        INT             IDENTITY(1,1) NOT NULL,
    Codigo          VARCHAR(40)     NOT NULL,   -- 'fg125-2025' (slug do app)
    Nome            NVARCHAR(80)    NOT NULL,   -- 'FG 125'
    Ano             SMALLINT        NOT NULL,
    Etiqueta        NVARCHAR(120)   NULL,       -- label exibido no Parts Finder
    Cilindrada      NVARCHAR(20)    NULL,       -- '125', '300', '450F'
    TipoMotor       NVARCHAR(20)    NULL,       -- '2 tempos', '4 tempos'
    Categoria       NVARCHAR(40)    NULL,       -- 'Enduro', 'MX'
    Ativo           BIT             NOT NULL CONSTRAINT DF_ModeloMoto_Ativo DEFAULT (1),
    CONSTRAINT PK_ModeloMoto PRIMARY KEY (ModeloId),
    CONSTRAINT UQ_ModeloMoto_Codigo UNIQUE (Codigo)
);
GO

/* Veículo físico em estoque/vendido, identificado pelo NIV (chassi). */
CREATE TABLE dbo.Veiculo (
    VeiculoId       INT             IDENTITY(1,1) NOT NULL,
    Niv             VARCHAR(30)     NOT NULL,   -- número de identificação do veículo (chassi)
    ModeloId        INT             NOT NULL,
    EmpresaId       INT             NULL,       -- concessionária que detém o veículo
    Cor             NVARCHAR(40)    NULL,
    Status          VARCHAR(12)     NOT NULL CONSTRAINT DF_Veiculo_Status DEFAULT ('Disponível'),
    EntradaEstoque  DATETIME2(0)    NULL,
    VendaData       DATETIME2(0)    NULL,
    VendaCliente    NVARCHAR(160)   NULL,
    GarantiaAtivaEm DATETIME2(0)    NULL,
    NumeroMotor     VARCHAR(40)     NULL,
    CriadoEm        DATETIME2(0)    NOT NULL CONSTRAINT DF_Veiculo_CriadoEm DEFAULT (SYSUTCDATETIME()),
    AtualizadoEm    DATETIME2(0)    NULL,
    CONSTRAINT PK_Veiculo PRIMARY KEY (VeiculoId),
    CONSTRAINT UQ_Veiculo_Niv UNIQUE (Niv),
    CONSTRAINT FK_Veiculo_Modelo  FOREIGN KEY (ModeloId)  REFERENCES dbo.ModeloMoto (ModeloId),
    CONSTRAINT FK_Veiculo_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa (EmpresaId),
    CONSTRAINT CK_Veiculo_Status CHECK (Status IN ('Disponível','Vendido','Reservado'))
);
GO

-- ---- 4) Parts Finder: secoes por modelo ('chassi' ou 'engine') e pecas de cada secao ----

CREATE TABLE dbo.SecaoModelo (
    SecaoId         INT             IDENTITY(1,1) NOT NULL,
    ModeloId        INT             NOT NULL,
    Lado            VARCHAR(8)      NOT NULL,   -- 'chassi' | 'engine'
    Numero          VARCHAR(8)      NOT NULL,   -- '01', '02', ...
    Nome            NVARCHAR(120)   NOT NULL,
    Destaque        VARCHAR(20)     NULL,       -- destaque no diagrama (fork, frame, engine...)
    Ordem           INT             NOT NULL CONSTRAINT DF_SecaoModelo_Ordem DEFAULT (0),
    CONSTRAINT PK_SecaoModelo PRIMARY KEY (SecaoId),
    CONSTRAINT FK_SecaoModelo_Modelo FOREIGN KEY (ModeloId)
        REFERENCES dbo.ModeloMoto (ModeloId) ON DELETE CASCADE,
    CONSTRAINT CK_SecaoModelo_Lado CHECK (Lado IN ('chassi','engine'))
);
GO

CREATE TABLE dbo.PecaSecao (
    PecaSecaoId     INT             IDENTITY(1,1) NOT NULL,
    SecaoId         INT             NOT NULL,
    ProdutoId       INT             NOT NULL,
    Posicao         INT             NOT NULL,   -- número da posição no diagrama
    Quantidade      INT             NOT NULL CONSTRAINT DF_PecaSecao_Qtd DEFAULT (1),
    MinutosMaoObra  INT             NULL,       -- tempo estimado de serviço
    CONSTRAINT PK_PecaSecao PRIMARY KEY (PecaSecaoId),
    CONSTRAINT FK_PecaSecao_Secao   FOREIGN KEY (SecaoId)
        REFERENCES dbo.SecaoModelo (SecaoId) ON DELETE CASCADE,
    CONSTRAINT FK_PecaSecao_Produto FOREIGN KEY (ProdutoId)
        REFERENCES dbo.Produto (ProdutoId),
    CONSTRAINT CK_PecaSecao_Qtd CHECK (Quantidade > 0)
);
GO

-- ---- 5) Pedidos e itens ----

CREATE TABLE dbo.Pedido (
    PedidoId        INT             IDENTITY(1,1) NOT NULL,
    NumeroPedido    VARCHAR(20)     NOT NULL,   -- ex.: '0005041877'
    CodigoCx        VARCHAR(24)     NULL,       -- ex.: 'CX2606090004410'
    UsuarioId       INT             NOT NULL,
    EmpresaId       INT             NOT NULL,
    DataPedido      DATETIME2(0)    NOT NULL CONSTRAINT DF_Pedido_Data DEFAULT (SYSUTCDATETIME()),
    Status          VARCHAR(14)     NOT NULL CONSTRAINT DF_Pedido_Status DEFAULT ('Pendente'),
    Total           DECIMAL(12,2)   NOT NULL CONSTRAINT DF_Pedido_Total DEFAULT (0),
    Moeda           CHAR(3)         NOT NULL CONSTRAINT DF_Pedido_Moeda DEFAULT ('BRL'),
    CriadoEm        DATETIME2(0)    NOT NULL CONSTRAINT DF_Pedido_CriadoEm DEFAULT (SYSUTCDATETIME()),
    AtualizadoEm    DATETIME2(0)    NULL,
    CONSTRAINT PK_Pedido PRIMARY KEY (PedidoId),
    CONSTRAINT UQ_Pedido_Numero UNIQUE (NumeroPedido),
    CONSTRAINT FK_Pedido_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario (UsuarioId),
    CONSTRAINT FK_Pedido_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa (EmpresaId),
    CONSTRAINT CK_Pedido_Status CHECK (Status IN ('Pendente','Processando','Enviado','Entregue','Cancelado')),
    CONSTRAINT CK_Pedido_Total  CHECK (Total >= 0)
);
GO

/* Snapshot do item no momento da compra (nome/preço gravados para histórico). */
CREATE TABLE dbo.PedidoItem (
    PedidoItemId    INT             IDENTITY(1,1) NOT NULL,
    PedidoId        INT             NOT NULL,
    ProdutoId       INT             NULL,       -- pode virar NULL se o produto for excluído
    Sku             VARCHAR(40)     NOT NULL,   -- snapshot do artigo
    NomeProduto     NVARCHAR(200)   NOT NULL,   -- snapshot do nome
    PrecoUnitario   DECIMAL(12,2)   NOT NULL,
    Quantidade      INT             NOT NULL,
    Subtotal        AS (PrecoUnitario * Quantidade) PERSISTED,  -- coluna calculada
    CONSTRAINT PK_PedidoItem PRIMARY KEY (PedidoItemId),
    CONSTRAINT FK_PedidoItem_Pedido  FOREIGN KEY (PedidoId)
        REFERENCES dbo.Pedido (PedidoId) ON DELETE CASCADE,
    CONSTRAINT FK_PedidoItem_Produto FOREIGN KEY (ProdutoId)
        REFERENCES dbo.Produto (ProdutoId),
    CONSTRAINT CK_PedidoItem_Qtd   CHECK (Quantidade > 0),
    CONSTRAINT CK_PedidoItem_Preco CHECK (PrecoUnitario >= 0)
);
GO

-- ---- 6) Faturas e entregas ----

CREATE TABLE dbo.Fatura (
    FaturaId        INT             IDENTITY(1,1) NOT NULL,
    NumeroFatura    VARCHAR(24)     NOT NULL,
    Tipo            VARCHAR(16)     NOT NULL CONSTRAINT DF_Fatura_Tipo DEFAULT ('Fatura'), -- 'Fatura' | 'Nota de crédito'
    EmpresaId       INT             NULL,
    DataEmissao     DATETIME2(0)    NOT NULL CONSTRAINT DF_Fatura_Data DEFAULT (SYSUTCDATETIME()),
    Valor           DECIMAL(12,2)   NOT NULL,   -- negativo para nota de crédito
    Moeda           NVARCHAR(20)    NOT NULL CONSTRAINT DF_Fatura_Moeda DEFAULT (N'Real (R$)'),
    CONSTRAINT PK_Fatura PRIMARY KEY (FaturaId),
    CONSTRAINT UQ_Fatura_Numero UNIQUE (NumeroFatura),
    CONSTRAINT FK_Fatura_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa (EmpresaId),
    CONSTRAINT CK_Fatura_Tipo CHECK (Tipo IN ('Fatura','Nota de crédito'))
);
GO

CREATE TABLE dbo.Entrega (
    EntregaId       INT             IDENTITY(1,1) NOT NULL,
    NumeroEntrega   VARCHAR(20)     NOT NULL,
    EmpresaId       INT             NULL,
    DataEntrega     DATETIME2(0)    NOT NULL CONSTRAINT DF_Entrega_Data DEFAULT (SYSUTCDATETIME()),
    FaturaId        INT             NULL,       -- fatura associada (opcional)
    CONSTRAINT PK_Entrega PRIMARY KEY (EntregaId),
    CONSTRAINT UQ_Entrega_Numero UNIQUE (NumeroEntrega),
    CONSTRAINT FK_Entrega_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa (EmpresaId),
    CONSTRAINT FK_Entrega_Fatura  FOREIGN KEY (FaturaId)  REFERENCES dbo.Fatura (FaturaId)
);
GO

/* Junção N:N — uma entrega pode cobrir vários pedidos e vice-versa. */
CREATE TABLE dbo.EntregaPedido (
    EntregaId       INT             NOT NULL,
    PedidoId        INT             NOT NULL,
    CONSTRAINT PK_EntregaPedido PRIMARY KEY (EntregaId, PedidoId),
    CONSTRAINT FK_EntregaPedido_Entrega FOREIGN KEY (EntregaId)
        REFERENCES dbo.Entrega (EntregaId) ON DELETE CASCADE,
    CONSTRAINT FK_EntregaPedido_Pedido  FOREIGN KEY (PedidoId)
        REFERENCES dbo.Pedido (PedidoId)
);
GO

/* Códigos de rastreio de uma entrega (lista). */
CREATE TABLE dbo.RastreioEntrega (
    RastreioId      INT             IDENTITY(1,1) NOT NULL,
    EntregaId       INT             NOT NULL,
    Codigo          VARCHAR(40)     NOT NULL,
    Transportadora  NVARCHAR(80)    NULL,
    CONSTRAINT PK_RastreioEntrega PRIMARY KEY (RastreioId),
    CONSTRAINT FK_RastreioEntrega_Entrega FOREIGN KEY (EntregaId)
        REFERENCES dbo.Entrega (EntregaId) ON DELETE CASCADE
);
GO

/* Junção N:N opcional — relaciona pedidos e faturas diretamente. */
CREATE TABLE dbo.PedidoFatura (
    PedidoId        INT             NOT NULL,
    FaturaId        INT             NOT NULL,
    CONSTRAINT PK_PedidoFatura PRIMARY KEY (PedidoId, FaturaId),
    CONSTRAINT FK_PedidoFatura_Pedido FOREIGN KEY (PedidoId)
        REFERENCES dbo.Pedido (PedidoId) ON DELETE CASCADE,
    CONSTRAINT FK_PedidoFatura_Fatura FOREIGN KEY (FaturaId)
        REFERENCES dbo.Fatura (FaturaId)
);
GO

-- ---- 7) Garantia / reivindicacoes ----

CREATE TABLE dbo.Reivindicacao (
    ReivindicacaoId INT             IDENTITY(1,1) NOT NULL,
    Numero          VARCHAR(20)     NOT NULL,   -- ex.: '12094338'
    EmpresaId       INT             NULL,       -- criadora da reivindicação
    UsuarioId       INT             NULL,
    VeiculoId       INT             NULL,       -- veículo pelo NIV
    Tipo            VARCHAR(16)     NOT NULL,   -- 'IT' | 'Manufacturer' | 'Implícito'
    Status          VARCHAR(14)     NOT NULL CONSTRAINT DF_Reiv_Status DEFAULT ('Em processo'),
    Pais            NVARCHAR(60)    NOT NULL CONSTRAINT DF_Reiv_Pais DEFAULT (N'Brasil'),
    PreAutorizacao  BIT             NOT NULL CONSTRAINT DF_Reiv_PreAuth DEFAULT (0),
    Devolvido       BIT             NOT NULL CONSTRAINT DF_Reiv_SentBack DEFAULT (0),
    Descricao       NVARCHAR(1000)  NULL,
    DataAbertura    DATETIME2(0)    NOT NULL CONSTRAINT DF_Reiv_Data DEFAULT (SYSUTCDATETIME()),
    AtualizadoEm    DATETIME2(0)    NULL,
    CONSTRAINT PK_Reivindicacao PRIMARY KEY (ReivindicacaoId),
    CONSTRAINT UQ_Reivindicacao_Numero UNIQUE (Numero),
    CONSTRAINT FK_Reiv_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa (EmpresaId),
    CONSTRAINT FK_Reiv_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario (UsuarioId),
    CONSTRAINT FK_Reiv_Veiculo FOREIGN KEY (VeiculoId) REFERENCES dbo.Veiculo (VeiculoId),
    CONSTRAINT CK_Reiv_Tipo   CHECK (Tipo   IN ('IT','Manufacturer','Implícito')),
    CONSTRAINT CK_Reiv_Status CHECK (Status IN ('Em processo','Esboço','Aprovada','Recusada'))
);
GO

-- ---- 8) Notificacoes e log de buscas ----

CREATE TABLE dbo.Notificacao (
    NotificacaoId   INT             IDENTITY(1,1) NOT NULL,
    EmpresaId       INT             NULL,       -- NULL = global (todos os revendedores)
    UsuarioId       INT             NULL,       -- NULL = vale para a empresa toda
    Tipo            VARCHAR(10)     NOT NULL CONSTRAINT DF_Notif_Tipo DEFAULT ('info'), -- 'critica' | 'info'
    Titulo          NVARCHAR(160)   NOT NULL,
    Texto           NVARCHAR(1000)  NULL,
    Lida            BIT             NOT NULL CONSTRAINT DF_Notif_Lida DEFAULT (0),
    DataEnvio       DATETIME2(0)    NOT NULL CONSTRAINT DF_Notif_Data DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_Notificacao PRIMARY KEY (NotificacaoId),
    CONSTRAINT FK_Notif_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa (EmpresaId),
    CONSTRAINT FK_Notif_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario (UsuarioId),
    CONSTRAINT CK_Notif_Tipo CHECK (Tipo IN ('critica','info'))
);
GO

CREATE TABLE dbo.LogBusca (
    LogBuscaId      BIGINT          IDENTITY(1,1) NOT NULL,
    UsuarioId       INT             NULL,
    EmpresaId       INT             NULL,
    Termo           NVARCHAR(200)   NOT NULL,
    QtdResultados   INT             NOT NULL CONSTRAINT DF_LogBusca_Qtd DEFAULT (0),
    DataBusca       DATETIME2(0)    NOT NULL CONSTRAINT DF_LogBusca_Data DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_LogBusca PRIMARY KEY (LogBuscaId),
    CONSTRAINT FK_LogBusca_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario (UsuarioId),
    CONSTRAINT FK_LogBusca_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa (EmpresaId)
);
GO

-- ---- 9) Indices de apoio ----
CREATE INDEX IX_Usuario_Empresa        ON dbo.Usuario (EmpresaId);
CREATE INDEX IX_Usuario_Status         ON dbo.Usuario (Status);
CREATE INDEX IX_Produto_Categoria      ON dbo.Produto (CategoriaId);
CREATE INDEX IX_Veiculo_Modelo         ON dbo.Veiculo (ModeloId);
CREATE INDEX IX_Veiculo_Empresa        ON dbo.Veiculo (EmpresaId);
CREATE INDEX IX_Veiculo_Status         ON dbo.Veiculo (Status);
CREATE INDEX IX_Secao_Modelo_Lado      ON dbo.SecaoModelo (ModeloId, Lado);
CREATE INDEX IX_PecaSecao_Secao        ON dbo.PecaSecao (SecaoId);
CREATE INDEX IX_PecaSecao_Produto      ON dbo.PecaSecao (ProdutoId);
CREATE INDEX IX_Pedido_Empresa         ON dbo.Pedido (EmpresaId);
CREATE INDEX IX_Pedido_Usuario         ON dbo.Pedido (UsuarioId);
CREATE INDEX IX_Pedido_Status          ON dbo.Pedido (Status);
CREATE INDEX IX_Pedido_Data            ON dbo.Pedido (DataPedido);
CREATE INDEX IX_PedidoItem_Pedido      ON dbo.PedidoItem (PedidoId);
CREATE INDEX IX_PedidoItem_Produto     ON dbo.PedidoItem (ProdutoId);
CREATE INDEX IX_Fatura_Empresa         ON dbo.Fatura (EmpresaId);
CREATE INDEX IX_Reiv_Empresa           ON dbo.Reivindicacao (EmpresaId);
CREATE INDEX IX_Reiv_Status            ON dbo.Reivindicacao (Status);
CREATE INDEX IX_Notif_Empresa_Lida     ON dbo.Notificacao (EmpresaId, Lida);
CREATE INDEX IX_LogBusca_Data          ON dbo.LogBusca (DataBusca);
GO

PRINT N'Schema FullgasB2B criado com sucesso.';
GO
