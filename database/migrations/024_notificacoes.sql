USE FullgasB2B;
GO

-- 024 - Notificacoes do admin (Notificacao, EmpresaId NULL = todas) e leitura por usuario (NotificacaoLida).
-- A tabela antiga e preservada como NotificacaoLegado. Idempotente.
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID('dbo.Notificacao', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.Notificacao', 'CriadoEm') IS NULL
BEGIN
  -- Recria a NotificacaoLida contra a tabela nova. O SELECT vai em EXEC porque o lote
  -- e compilado inteiro e a tabela pode nao existir.
  IF OBJECT_ID('dbo.NotificacaoLida', 'U') IS NOT NULL
    EXEC('IF NOT EXISTS (SELECT 1 FROM dbo.NotificacaoLida) DROP TABLE dbo.NotificacaoLida;');
  EXEC sp_rename 'dbo.Notificacao', 'NotificacaoLegado';
END
GO

-- O rename nao renomeia constraints: renomeia aqui para nao conflitar.
IF OBJECT_ID('dbo.NotificacaoLegado', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.PK_Notificacao') IS NOT NULL
   AND OBJECT_ID('dbo.Notificacao', 'U') IS NULL
  EXEC sp_rename 'dbo.PK_Notificacao', 'PK_NotificacaoLegado', 'OBJECT';
GO

IF OBJECT_ID('dbo.Notificacao', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Notificacao (
    NotificacaoId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Notificacao PRIMARY KEY,
    EmpresaId     INT NULL CONSTRAINT FK_Notificacao_Empresa REFERENCES dbo.Empresa (EmpresaId),
    Titulo        NVARCHAR(160) NOT NULL,
    Texto         NVARCHAR(2000) NULL,
    Tipo          VARCHAR(10) NOT NULL CONSTRAINT DF_Notificacao_Tipo DEFAULT 'info',
    AnexoUrl      VARCHAR(400) NULL,
    AnexoTipo     VARCHAR(20) NULL,   -- 'imagem' | 'video' | 'arquivo'
    CriadoPor     INT NULL CONSTRAINT FK_Notificacao_Usuario REFERENCES dbo.Usuario (UsuarioId),
    CriadoEm      DATETIME2 NOT NULL CONSTRAINT DF_Notificacao_CriadoEm DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_Notificacao_Tipo CHECK (Tipo IN ('info', 'critica'))
  );
  CREATE INDEX IX_Notificacao_Empresa ON dbo.Notificacao (EmpresaId, CriadoEm DESC);
END
GO

IF OBJECT_ID('dbo.NotificacaoLida', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.NotificacaoLida (
    NotificacaoId INT NOT NULL CONSTRAINT FK_NotifLida_Notificacao
      REFERENCES dbo.Notificacao (NotificacaoId) ON DELETE CASCADE,
    UsuarioId     INT NOT NULL CONSTRAINT FK_NotifLida_Usuario REFERENCES dbo.Usuario (UsuarioId),
    LidaEm        DATETIME2 NOT NULL CONSTRAINT DF_NotifLida_LidaEm DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_NotificacaoLida PRIMARY KEY (NotificacaoId, UsuarioId)
  );
END
GO

PRINT '024 aplicada: Notificacao + NotificacaoLida';
