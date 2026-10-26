// Aplicação Express: middlewares e rotas. Quem abre a porta é o server.js (separado para os testes).
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
import blackOrdersRoutes from './routes/blackorders.routes.js';
import reivindicacoesRoutes from './routes/reivindicacoes.routes.js';
import notificacoesRoutes from './routes/notificacoes.routes.js';
import suporteRoutes from './routes/suporte.routes.js';
import pulsoRoutes from './routes/pulso.routes.js';
import finderRoutes from './routes/finder.routes.js';
import tinyRoutes from './routes/tiny.routes.js';
import listasPrecoRoutes from './routes/listas-preco.routes.js';
import arquivosRoutes from './routes/arquivos.routes.js';
import { PASTA_MINIATURAS } from './miniaturas.js';

const app = express();

// Atrás do Nginx: usa o X-Forwarded-For para ver o IP real (senão o rate limit vira global).
app.set('trust proxy', 1);

// Headers de segurança. O nosniff impede o navegador de executar como HTML um upload de /uploads.
// ---- Content-Security-Policy ----
// Igual à do Nginx (deploy/nginx/fullgas.conf) e à do render.yaml: mudou uma, mude as outras.
// O porquê de cada diretiva está comentado no fullgas.conf.
// Em dev o front e a API ficam em origens diferentes, então o connect-src aceita http: fora de produção.
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
  // DENY, igual ao Nginx: o portal não é embutido em iframe.
  frameguard: { action: 'deny' },
  // Em dev o front roda em outra porta e precisa carregar as imagens de /uploads.
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// ---- CORS ----
// Origens em CORS_ORIGIN (separadas por vírgula). Sem a variável, ou com '*', só rede local.
// Origem recusada não dá erro: só fica sem os headers de CORS.
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
  // X-CSRF-Token precisa estar declarado, senão o preflight de origem cruzada falha.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'ngrok-skip-browser-warning']
}));

// Limite explícito do corpo JSON.
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---- Arquivos enviados ----
// Só as pastas de CATÁLOGO são públicas. Material de cliente sai por /api/arquivos (confere o dono).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
for (const pasta of ['produtos', 'categorias', 'finder']) {
  app.use(`/uploads/${pasta}`, express.static(path.join(UPLOADS_DIR, pasta)));
}
// Miniaturas: o nome é o hash da foto, então o cache longo é seguro. Arquivo inexistente = 404 seco.
app.use('/uploads/miniaturas', express.static(PASTA_MINIATURAS, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
}));
app.use('/uploads/miniaturas', (_req, res) => res.status(404).end());
// Arquivo de catálogo inexistente: 404 seco (não a página HTML de 404).
app.use('/uploads', (_req, res) => res.status(404).end());

// Log de requisições SEM a query string (ela pode levar chassi, descrição de uso etc.).
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Nada de /api pode ir para cache: as respostas levam Set-Cookie de sessão.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Limite geral de requisições da API. Fica depois de /uploads para imagem não gastar a cota.
app.use('/api', limiteGlobal);

// Sessão (preenche req.user, nunca barra) e CSRF, antes de qualquer rota.
app.use(carregarSessao);

// O auth.js recebe a consulta de fora para poder ser testado sem banco.
configurarRevalidacao(async (usuarioId) => {
  const rows = await query(
    `SELECT Papel, Status, Gestor, Permissoes, TokenVersion
       FROM dbo.Usuario WHERE UsuarioId = @id`,
    { id: usuarioId }
  );
  return rows[0] || null;
});

// Confere no banco se a sessão ainda vale. Ordem: depois do carregarSessao, antes do csrfProtect.
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
app.use('/api', blackOrdersRoutes);
app.use('/api', reivindicacoesRoutes);
app.use('/api', notificacoesRoutes);
app.use('/api', suporteRoutes);
app.use('/api', pulsoRoutes);
app.use('/api', finderRoutes);
app.use('/api', tinyRoutes);
app.use('/api', listasPrecoRoutes);
app.use('/api', arquivosRoutes);

// Front estático com URLs limpas (/portal → portal.html). Em produção quem serve é o Nginx.
const FRONT_DIR = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(FRONT_DIR, { extensions: ['html'] }));

// 404: JSON para a API, HTML para páginas.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada.' });
  res.status(404).sendFile(path.join(FRONT_DIR, 'index.html'));
});

// Tratador central de erros
app.use((err, _req, res, _next) => {
  // AppError (marca `publica`) pode ir ao cliente; qualquer outro erro vira 500 genérico.
  if (err && err.publica) {
    return res.status(err.status || 400).json({ erro: err.message });
  }
  // Corpo acima do limite do express.json(): erro do cliente (413), não 500.
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Conteúdo grande demais.' });
  }
  console.error('ERRO:', err.message);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

export default app;
