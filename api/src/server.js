// Ponto de entrada da API: conecta no banco, abre a porta e liga o cron do Tiny.
import 'dotenv/config';
import app from './app.js';
import { getPool } from './db.js';
import { iniciarSincronizacaoAgendada } from './tiny-cron.js';
import { prepararMiniaturas } from './miniaturas.js';

const PORT = Number(process.env.PORT || 3000);

// Sem NODE_ENV=production nem COOKIE_SECURE=1, o cookie de sessão sai sem Secure. Avisa alto.
if (process.env.NODE_ENV !== 'production' && process.env.COOKIE_SECURE !== '1') {
  console.warn(
    '⚠ Cookies de sessão SEM a marca Secure (NODE_ENV != production e\n' +
    '  COOKIE_SECURE != 1). Correto em desenvolvimento sob http://.\n' +
    '  Se esta mensagem apareceu em PRODUÇÃO, corrija antes de seguir:\n' +
    '  a sessão está trafegando sem a proteção contra envio em texto claro.'
  );
}

// Tenta conectar no banco antes de abrir a porta (falha cedo se o DB estiver fora).
getPool()
  .then(() => {
    // 0.0.0.0 = todas as interfaces.
    app.listen(PORT, '0.0.0.0', () =>
      console.log(`✓ API ouvindo na porta ${PORT} (localhost e rede local)`)
    );
    // Sync automático com o Tiny (TINY_SYNC_INTERVALO_MIN), depois do banco.
    iniciarSincronizacaoAgendada();
    // Miniaturas que faltam (produtos novos, primeira vez após o deploy).
    prepararMiniaturas();
  })
  .catch(() => {
    console.error('A API não subiu porque não conectou no banco. Confira o arquivo .env.');
    process.exit(1);
  });
