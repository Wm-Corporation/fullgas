// ============================================================
// Aplicação Express — montagem de middlewares e rotas.
// ------------------------------------------------------------
// Este arquivo MONTA a aplicação e a exporta; quem abre a porta é o
// server.js. A separação existe por causa dos testes: o supertest precisa de
// um `app` que ele mesmo sobe numa porta efêmera, e enquanto isto vivia junto
// do app.listen() qualquer `import` do módulo tentava conectar no banco e
// segurar a porta 3000 — impossível testar rota sem subir a API inteira.
// ============================================================
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { carregarSessao, csrfProtect, revalidarSessao, configurarRevalidacao } from './auth.js';
import { query } from './db.js';
import { limiteGlobal } from './middlewares/rate-limit.js';
import authRoutes from './routes/auth.routes.js';
import usuariosRoutes from './routes/usuarios.routes.js';
import contaRoutes from './routes/conta.routes.js';
import produtosRoutes from './routes/produtos.routes.js';
import pedidosRoutes from './routes/pedidos.routes.js';
import veiculosRoutes from './routes/veiculos.routes.js';
import faturasRoutes from './routes/faturas.routes.js';
import preVendaRoutes from './routes/prevenda.routes.js';
import reivindicacoesRoutes from './routes/reivindicacoes.routes.js';
import notificacoesRoutes from './routes/notificacoes.routes.js';
import suporteRoutes from './routes/suporte.routes.js';
import pulsoRoutes from './routes/pulso.routes.js';
import finderRoutes from './routes/finder.routes.js';
import tinyRoutes from './routes/tiny.routes.js';
import arquivosRoutes from './routes/arquivos.routes.js';
import { PASTA_MINIATURAS } from './miniaturas.js';

const app = express();

// Atrás do Nginx: confia no X-Forwarded-For para enxergar o IP real do cliente.
// Sem isto o rate limit abaixo veria 127.0.0.1 para todo mundo e viraria um
// limite global — o primeiro a estourar bloquearia os demais.
app.set('trust proxy', 1);

// Headers de segurança (nosniff, X-Frame-Options, Referrer-Policy, HSTS...).
// O `nosniff` é o mais importante aqui: sem ele o navegador "adivinha" o tipo
// de um arquivo enviado pelo usuário e pode executar como HTML algo que foi
// salvo como imagem em /uploads.
/* ------------------------------------------------------------
   Content-Security-Policy
   ------------------------------------------------------------
   Antes esta camada tinha `contentSecurityPolicy: false`, delegando a política
   inteira ao Nginx. O raciocínio estava certo quanto ao conteúdo (a CSP padrão
   do helmet quebra o front, que gera centenas de `style=` via innerHTML), mas
   errado quanto ao alcance: a CSP do Nginx só existe no bloco `location /`.
   Ou seja, /api/ e /uploads/ nunca recebiam CSP — e QUALQUER ambiente sem
   aquele arquivo do Nginx (Render, a porta 3000 exposta direto, o dev local)
   servia o portal inteiro sem CSP nenhuma.

   Agora a política mora aqui, viaja junto com a aplicação e vale em todo
   ambiente. O Nginx continua repetindo a dele no `location /` como segunda
   camada; as duas são idênticas de propósito. Ao mudar uma, mude a outra —
   o mesmo valendo para o bloco `headers:` do render.yaml.

   O comentário longo que justifica cada diretiva (por que 'unsafe-inline' no
   style-src, por que blob:, por que os DOIS domínios de imagem do Tiny e por
   que o do S3 vai com o caminho do bucket) está em deploy/nginx/fullgas.conf.
   Vale ler antes de editar qualquer uma das listas abaixo.
   ------------------------------------------------------------ */
/* Em DESENVOLVIMENTO o front e a API quase nunca estão na mesma origem: o
   config.js do front aponta sempre para `http://<host>:3000/api`, mesmo quando
   a página veio do Live Server na :5500, do IP da rede local (para testar no
   celular) ou de outra porta qualquer. Com `connect-src 'self'` puro, TODA
   chamada de API seria bloqueada pela própria CSP e o portal não abriria
   localmente — sintoma que não existe em produção, onde o Nginx serve as duas
   coisas na mesma origem.

   Fora de produção, então, o connect-src passa a aceitar o esquema http:
   inteiro. Não dá para ser mais preciso: a gramática da CSP só admite curinga
   como rótulo de subdomínio (`*.exemplo.com`) e em porta — `http://192.168.*`
   é fonte INVÁLIDA, e o navegador a descarta com um aviso no console, o que
   deixaria o dev com uma política pela metade e sem entender por quê.

   O que se perde nisso é só o connect-src, e só na máquina do desenvolvedor.
   As diretivas que realmente pegam XSS — script-src, object-src, base-uri,
   frame-ancestors — continuam valendo iguais às de produção, que é o motivo de
   a CSP estar ligada aqui. Em produção a lista é exatamente a do Nginx. */
const ehProducao = process.env.NODE_ENV === 'production';
const CONNECT_DEV = ehProducao ? [] : ['http:', 'https:'];

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
      frameSrc: ['https://challenges.cloudflare.com'],
      connectSrc: ["'self'", 'https://viacep.com.br', 'https://challenges.cloudflare.com', ...CONNECT_DEV],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://anexos.tiny.com.br', 'https://s3.amazonaws.com/tiny-anexos-us/'],
      mediaSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  // DENY, não o SAMEORIGIN padrão do helmet — é o que o Nginx já manda no
  // `location /`, e o portal não se embute em iframe nenhum. Deixar os dois
  // diferentes só cria a dúvida de qual vale.
  frameguard: { action: 'deny' },
  // As imagens de /uploads são carregadas pelo front, que em desenvolvimento
  // roda em outra porta (Live Server). O padrão `same-origin` as bloquearia.
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Origens permitidas via CORS_ORIGIN (lista separada por vírgula). Sem a var
// definida, liberamos APENAS origens locais / de rede privada, para o modo dev
// continuar funcionando sem configuração. Origem não permitida NÃO derruba a
// resposta: apenas não recebe os headers de CORS (o navegador bloqueia), em vez
// de virar 500.
//
// Por que não liberar tudo: `credentials: true` combinado com origem refletida
// significa que QUALQUER site da internet poderia chamar esta API com a sessão
// do usuário logado e ler a resposta. Hoje o token vai num header (o navegador
// não anexa sozinho), então o estrago seria limitado — mas quando a sessão
// passar a viajar em cookie isso vira bypass total de autenticação.
// O curinga '*' era aceito antes e liberava tudo. Não derrubamos a API por
// causa dele (isso tiraria o site do ar num deploy), mas ele deixa de liberar
// geral: cai no mesmo modo de quando a variável está vazia (só rede local).
// Produção não sente, porque lá o front e a API são a MESMA origem — e
// requisição de mesma origem nem passa pela checagem de CORS.
const corsBruto = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
const temCuringa = corsBruto.includes('*');
const allowedOrigins = corsBruto.filter(o => o !== '*');

if (temCuringa) {
  console.warn(
    "⚠ CORS_ORIGIN contém '*' — ignorado. Liberando apenas localhost e rede\n" +
    '  local. Para permitir uma origem externa (Live Server, ngrok, outro\n' +
    '  domínio), liste-a explicitamente: CORS_ORIGIN=https://seusite.com'
  );
}

// localhost, 127.0.0.1 e as três faixas privadas da RFC 1918.
const ehOrigemLocal = o =>
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(o);

app.use(cors({
  origin: function (origin, callback) {
    // Sem Origin = mesma origem, curl, app nativo. Não é caso de CORS.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (allowedOrigins.length === 0 && ehOrigemLocal(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
  // X-CSRF-Token não é um header "seguro" da lista do CORS: sem declará-lo
  // aqui, todo preflight de origem cruzada (ex.: Live Server na :5500) falha
  // assim que o front começar a enviá-lo.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'ngrok-skip-browser-warning']
}));

// Limite explícito do corpo JSON. O padrão do Express já é 100 kb, mas deixar
// escrito evita que uma mudança futura abra a porta para payload gigante.
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Arquivos enviados. O banco guarda a URL relativa (/uploads/...).
//
// ATENÇÃO: só as pastas de CATÁLOGO ficam no estático público — o conteúdo
// delas é o mesmo para todos os revendedores (foto de produto, de categoria e
// diagrama do finder). As pastas com material de cliente (reivindicacoes,
// notificacoes) NÃO entram aqui: saem por /api/arquivos/:tipo/:nome, que
// confere no banco se o arquivo é mesmo da empresa de quem pediu.
// Ver api/src/routes/arquivos.routes.js.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
for (const pasta of ['produtos', 'categorias', 'finder']) {
  app.use(`/uploads/${pasta}`, express.static(path.join(UPLOADS_DIR, pasta)));
}
// Miniaturas de produto (ver miniaturas.js): o nome é o hash da foto de
// origem, então o conteúdo de um endereço nunca muda — cache de 30 dias sem
// risco de imagem velha. Arquivo que não existe responde 404 seco aqui (sem
// cair no 500 do tratador de erros nem na página HTML de 404); o cabeçalho de
// cache só vai nas respostas de sucesso.
app.use('/uploads/miniaturas', express.static(PASTA_MINIATURAS, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
}));
app.use('/uploads/miniaturas', (_req, res) => res.status(404).end());

/* Log de requisições — sem a QUERY STRING.
   ------------------------------------------------------------
   Antes isto imprimia `req.url` inteira, com a query string junto. Parece
   inofensivo até olhar o que trafega por lá: `/api/finder/busca?vin=...`
   (número de chassi de veículo de cliente), `/api/finder/uso?descricao=...`,
   `/api/tiny/log?sku=...`. Tudo isso ia para o journald e ficava lá, legível
   para qualquer pessoa com acesso ao servidor, muito depois de a requisição
   ter sentido.

   `req.path` dá o mesmo valor de diagnóstico — qual rota foi chamada, com que
   método — sem carregar o dado. Quem precisa saber QUEM fez O QUÊ tem agora a
   trilha de auditoria (auditoria.js), que é consultável e tem dono.

   Nenhuma rota sensível usa query string para segredo: o token de recuperação
   de senha, por exemplo, viaja no CORPO do POST. Então não há o que redigir
   além disto. */
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

/* ============================================================
   NADA DE /api PODE SER GUARDADO EM CACHE
   ------------------------------------------------------------
   É a regra mais importante desta lista, e a razão é específica: as respostas
   de autenticação carregam Set-Cookie. Se QUALQUER camada entre a API e o
   navegador guardar uma cópia — Nginx com proxy_cache, uma regra "Cache
   Everything" na Cloudflare, um proxy corporativo na rede do cliente —, o
   cookie de sessão de um usuário é entregue ao próximo que pedir a mesma URL.
   A sessão troca de dono sem que ninguém perceba.

   Isto fica AQUI, e não só na configuração do Nginx, porque assim a garantia
   viaja junto com a aplicação: vale em qualquer ambiente, com qualquer proxy
   na frente, e não depende de alguém lembrar de replicar uma diretiva ao
   mexer na infraestrutura. O Nginx repete a regra como segunda camada.
   ============================================================ */
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Piso de requisições para TODA a API. Os limites apertados continuam nas
// rotas que os merecem (login, cadastro, recuperação de senha, abertura de
// chamado); este aqui é a rede embaixo — vale para a rota que ninguém lembrou
// de proteger e para varredura automatizada. O teto é folgado de propósito:
// ver o comentário em middlewares/rate-limit.js.
//
// Fica DEPOIS do estático de /uploads de propósito: imagem de catálogo não
// deve consumir a cota (uma tela da loja carrega dezenas delas de uma vez).
app.use('/api', limiteGlobal);

// Sessão e CSRF, antes de qualquer rota. carregarSessao só preenche req.user
// (nunca barra); csrfProtect exige o header X-CSRF-Token nas escritas feitas
// com sessão em cookie. Rotas públicas passam direto — ver auth.js.
app.use(carregarSessao);

/* O auth.js não importa o db.js: se importasse, testar a camada de sessão
   exigiria um SQL Server de pé. Em vez disso ele recebe a consulta de fora —
   aqui, onde a aplicação inteira já é montada. */
configurarRevalidacao(async (usuarioId) => {
  const rows = await query(
    `SELECT Papel, Status, Gestor, Permissoes, TokenVersion
       FROM dbo.Usuario WHERE UsuarioId = @id`,
    { id: usuarioId }
  );
  return rows[0] || null;
});

// Confere no BANCO se a sessão ainda vale (usuário bloqueado/excluído, papel
// rebaixado, senha trocada, "sair de todos os dispositivos"). Precisa vir
// DEPOIS do carregarSessao — que é quem preenche req.user — e ANTES do
// csrfProtect, porque o csrfProtect decide o que fazer a partir de req.user.
app.use(revalidarSessao);

app.use(csrfProtect);

// Healthcheck — útil pra testar se a API subiu.
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api', usuariosRoutes);
app.use('/api', contaRoutes);
app.use('/api', produtosRoutes);
app.use('/api', pedidosRoutes);
app.use('/api', veiculosRoutes);
app.use('/api', faturasRoutes);
app.use('/api', preVendaRoutes);
app.use('/api', reivindicacoesRoutes);
app.use('/api', notificacoesRoutes);
app.use('/api', suporteRoutes);
app.use('/api', pulsoRoutes);
app.use('/api', finderRoutes);
app.use('/api', tinyRoutes);
app.use('/api', arquivosRoutes);

// Frontend estático com URLs LIMPAS (esconder o .html).
// `extensions: ['html']` faz /portal servir portal.html, /loja → loja.html,
// etc.; a raiz "/" serve index.html. Em produção quem serve o front é o Nginx
// (mesmo comportamento via try_files) — aqui é para o dev abrir tudo na mesma
// origem da API (http://localhost:3000) sem depender de outro servidor.
const FRONT_DIR = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(FRONT_DIR, { extensions: ['html'] }));

// 404 — só cai aqui o que não é arquivo do front nem rota conhecida. Rotas de
// API (JSON) e navegação de página (HTML) recebem o formato adequado.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada.' });
  res.status(404).sendFile(path.join(FRONT_DIR, 'index.html'));
});

// Tratador central de erros
app.use((err, _req, res, _next) => {
  // Erro de aplicação (AppError, marca `publica`): status e mensagem podem ir
  // ao cliente. Qualquer outro erro vira 500 genérico — nada de vazar detalhe.
  if (err && err.publica) {
    return res.status(err.status || 400).json({ erro: err.message });
  }
  // Corpo maior que o limite do express.json(): é erro do cliente, não nosso.
  // Sem este caso o body-parser cairia no 500 genérico abaixo e o front
  // mostraria "erro interno" para um upload grande demais.
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Conteúdo grande demais.' });
  }
  console.error('ERRO:', err.message);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

export default app;
