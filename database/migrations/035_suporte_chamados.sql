-- 035 - Suporte Tecnico: SuporteChamado e SuporteMensagem.
-- Categorias ficam em api/src/utils/suporte.js; numero "CH-000123" vem do ChamadoId. Literais ASCII. Idempotente.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE FullgasB2B;
GO

IF OBJECT_ID('dbo.SuporteChamado', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SuporteChamado (
        ChamadoId    INT IDENTITY(1,1) NOT NULL
                     CONSTRAINT PK_SuporteChamado PRIMARY KEY,
        -- Empresa dona e usuario que abriu.
        EmpresaId    INT NOT NULL
                     CONSTRAINT FK_SupChamado_Empresa REFERENCES dbo.Empresa (EmpresaId),
        UsuarioId    INT NOT NULL
                     CONSTRAINT FK_SupChamado_Usuario REFERENCES dbo.Usuario (UsuarioId),
        -- Codigo da categoria (sem CHECK: a lista muda com o portal).
        Categoria    VARCHAR(30) NOT NULL,
        Assunto      NVARCHAR(160) NOT NULL,
        Prioridade   VARCHAR(10) NOT NULL
                     CONSTRAINT DF_SupChamado_Prioridade DEFAULT 'normal',
        Status       VARCHAR(24) NOT NULL
                     CONSTRAINT DF_SupChamado_Status DEFAULT 'Aberto',
        -- Administrador que respondeu por último (quem está atendendo).
        AtendenteId  INT NULL
                     CONSTRAINT FK_SupChamado_Atendente REFERENCES dbo.Usuario (UsuarioId),
        CriadoEm     DATETIME2 NOT NULL
                     CONSTRAINT DF_SupChamado_CriadoEm DEFAULT SYSUTCDATETIME(),
        -- Ultima movimentacao (ordena as listas).
        AtualizadoEm DATETIME2 NOT NULL
                     CONSTRAINT DF_SupChamado_AtualizadoEm DEFAULT SYSUTCDATETIME(),
        FechadoEm    DATETIME2 NULL,
        CONSTRAINT CK_SupChamado_Prioridade CHECK (Prioridade IN ('baixa', 'normal', 'alta')),
        CONSTRAINT CK_SupChamado_Status CHECK (Status IN
            ('Aberto', 'Em atendimento', 'Aguardando cliente', 'Resolvido', 'Fechado'))
    );
    -- A lista do revendedor (a sua concessionária, mais recente primeiro).
    CREATE INDEX IX_SupChamado_Empresa ON dbo.SuporteChamado (EmpresaId, AtualizadoEm DESC);
    -- A fila do atendente (por status, mais recente primeiro).
    CREATE INDEX IX_SupChamado_Status ON dbo.SuporteChamado (Status, AtualizadoEm DESC);
    PRINT 'Tabela dbo.SuporteChamado criada.';
END
GO

IF OBJECT_ID('dbo.SuporteMensagem', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SuporteMensagem (
        MensagemId    INT IDENTITY(1,1) NOT NULL
                      CONSTRAINT PK_SuporteMensagem PRIMARY KEY,
        ChamadoId     INT NOT NULL
                      CONSTRAINT FK_SupMsg_Chamado REFERENCES dbo.SuporteChamado (ChamadoId)
                      ON DELETE CASCADE,
        -- NULL só para autor 'sistema' (registro automático de mudança de status).
        UsuarioId     INT NULL
                      CONSTRAINT FK_SupMsg_Usuario REFERENCES dbo.Usuario (UsuarioId),
        Autor         VARCHAR(10) NOT NULL,
        Texto         NVARCHAR(4000) NULL,
        AnexoUrl      VARCHAR(400) NULL,
        AnexoTipo     VARCHAR(20) NULL,   -- 'imagem' | 'video' | 'arquivo'
        CriadoEm      DATETIME2 NOT NULL
                      CONSTRAINT DF_SupMsg_CriadoEm DEFAULT SYSUTCDATETIME(),
        -- Leitura por lado (cliente / suporte), nao por usuario.
        LidaClienteEm DATETIME2 NULL,
        LidaAdminEm   DATETIME2 NULL,
        CONSTRAINT CK_SupMsg_Autor CHECK (Autor IN ('cliente', 'admin', 'sistema'))
    );
    CREATE INDEX IX_SupMsg_Chamado ON dbo.SuporteMensagem (ChamadoId, CriadoEm);
    PRINT 'Tabela dbo.SuporteMensagem criada.';
END
GO

PRINT 'Migracao 035 concluida: SuporteChamado + SuporteMensagem.';
GO
