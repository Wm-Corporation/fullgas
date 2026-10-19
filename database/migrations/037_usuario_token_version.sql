-- 037 - Usuario.TokenVersion: incrementar derruba todas as sessoes do usuario (claim `tv`, ver api/src/auth.js).
-- DEFAULT 0: ninguem e deslogado pela migration. Idempotente.

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Usuario', 'TokenVersion') IS NULL
BEGIN
    ALTER TABLE dbo.Usuario
        ADD TokenVersion INT NOT NULL
            CONSTRAINT DF_Usuario_TokenVersion DEFAULT (0);
    PRINT N'037: coluna Usuario.TokenVersion criada.';
END
ELSE
    PRINT N'037: Usuario.TokenVersion ja existe — nada a fazer.';
GO
