// ============================================================
// Ponto de entrada da API Fullgas — abre a porta e sobe o cron.
// ------------------------------------------------------------
// A MONTAGEM da aplicação (middlewares, rotas, tratador de erros) mora em
// app.js. Aqui fica só o que tem efeito no mundo: conectar no banco, escutar
// numa porta e ligar a sincronização agendada com o Tiny.
//
// Por que separado: o supertest precisa importar a aplicação sem que ela
// abra porta nem exija banco. Enquanto tudo era um arquivo só, testar
// qualquer rota significava subir a API de verdade.
// ============================================================
import 'dotenv/config';
import app from './app.js';
import { getPool } from './db.js';
import { iniciarSincronizacaoAgendada } from './tiny-cron.js';
import { prepararMiniaturas } from './miniaturas.js';

const PORT = Number(process.env.PORT || 3000);

// Aviso alto sobre a falha mais silenciosa que existe neste projeto.
// Os cookies de sessão só saem marcados como Secure quando NODE_ENV=production
// ou COOKIE_SECURE=1. Se a unidade do systemd em produção não define nenhum
// dos dois, tudo continua FUNCIONANDO — o portal abre, o login entra — e o
// cookie de sessão simplesmente trafega sem a marca que impede o navegador de
// mandá-lo por HTTP. Não há erro, não há log, não há sintoma. Por isso a
// checagem grita aqui, no arranque.
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
    // 0.0.0.0 = escuta em todas as interfaces: localhost, 127.0.0.1 e o IP da
    // rede local (acesso de outro dispositivo). Não fixe um IP aqui.
    app.listen(PORT, '0.0.0.0', () =>
      console.log(`✓ API ouvindo na porta ${PORT} (localhost e rede local)`)
    );
    // Sincronização automática com o Tiny (node-cron, intervalo em minutos
    // via TINY_SYNC_INTERVALO_MIN) — só depois do banco estar de pé.
    iniciarSincronizacaoAgendada();
    // Miniaturas que faltam (produtos novos, primeira vez após o deploy).
    prepararMiniaturas();
  })
  .catch(() => {
    console.error('A API não subiu porque não conectou no banco. Confira o arquivo .env.');
    process.exit(1);
  });
