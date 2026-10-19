// ---- Autenticação (JWT em cookie) ----
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import 'dotenv/config';

// Sem valor padrão de propósito: sem JWT_SECRET a API não sobe.
const SECRET = process.env.JWT_SECRET || '';
if (SECRET.length < 32) {
  console.error(
    'JWT_SECRET ausente ou curto demais (mínimo de 32 caracteres).\n' +
    'Defina no .env antes de subir a API. Para gerar uma chave nova:\n' +
    "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
  );
  process.exit(1);
}
const EXPIRES = process.env.JWT_EXPIRES || '8h';

// Áreas que podem ser restringidas por conta interna (o front usa as mesmas chaves).
export const AREAS = ['loja', 'finder', 'pedidos', 'financeiro', 'reivindicacoes', 'estoque', 'acoes'];

// Usuario.Permissoes (JSON) → array, ou null = acesso total. Valor ilegível vira null.
export function parsePermissoes(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(a => AREAS.includes(a)) : null;
  } catch { return null; }
}

// Gera o token. `extra` acrescenta claims (ex.: `imp` = admin que assumiu a identidade).
export function signToken(usuario, extra) {
  const { expiresIn, ...claims } = extra || {};
  return jwt.sign(
    {
      id: usuario.UsuarioId,
      email: usuario.Email,
      papel: usuario.Papel,
      empresaId: usuario.EmpresaId,
      gestor: !!usuario.Gestor,
      perm: parsePermissoes(usuario.Permissoes),  // null = acesso total
      // Versão da sessão (migration 037). Token antigo sem o claim conta como 0.
      tv: usuario.TokenVersion ?? 0,
      ...claims,
      // Segredo anti-CSRF. Fica depois do spread para `extra` não conseguir trocá-lo.
      csrf: crypto.randomBytes(16).toString('hex')
    },
    SECRET,
    { expiresIn: expiresIn || EXPIRES }
  );
}

// ---- Cookies de sessão ----
// fg_sess (httpOnly) = o JWT · fg_csrf = cópia do claim csrf · fg_exp = validade, para o front.
export const COOKIE_SESS = 'fg_sess';
export const COOKIE_CSRF = 'fg_csrf';
export const COOKIE_EXP = 'fg_exp';

// Secure só em produção: sob HTTP o navegador descarta o cookie.
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' ||
                      process.env.NODE_ENV === 'production';

// SameSite=Lax: Strict derrubaria a sessão ao entrar por link de e-mail.
function baseCookie(maxAgeMs) {
  return { sameSite: 'lax', secure: COOKIE_SECURE, path: '/', maxAge: maxAgeMs };
}

// Quanto tempo o fg_exp continua no navegador DEPOIS de o JWT vencer.
const SOBREVIDA_EXP_MS = 7 * 24 * 60 * 60 * 1000;    // 7 dias

// Grava os três cookies. O fg_exp vive mais que o token para o front perceber a sessão vencida.
export function abrirSessao(res, token) {
  const p = jwt.decode(token) || {};
  const restanteMs = Math.max(0, (p.exp - Math.floor(Date.now() / 1000)) * 1000);
  const base = baseCookie(restanteMs);
  res.cookie(COOKIE_SESS, token, { ...base, httpOnly: true });
  res.cookie(COOKIE_CSRF, p.csrf || '', { ...base, httpOnly: false });
  res.cookie(COOKIE_EXP, String(p.exp || ''),
    { ...baseCookie(restanteMs + SOBREVIDA_EXP_MS), httpOnly: false });
}

// Apaga os três. Os atributos precisam ser iguais aos do res.cookie, senão o navegador ignora.
export function fecharSessao(res) {
  const o = { path: '/', sameSite: 'lax', secure: COOKIE_SECURE };
  res.clearCookie(COOKIE_SESS, { ...o, httpOnly: true });
  res.clearCookie(COOKIE_CSRF, o);
  res.clearCookie(COOKIE_EXP, o);
}

// ---- Carregamento da sessão (middleware global) ----
// Só preenche req.user a partir do cookie; quem barra é o requireAuth.
export function carregarSessao(req, _res, next) {
  const token = req.cookies?.[COOKIE_SESS] || null;
  if (token) {
    try {
      req.user = jwt.verify(token, SECRET);
    } catch {
      req.tokenInvalido = true;
    }
  }
  next();
}

// ---- Revalidação da sessão no banco (middleware global) ----
// Derruba sessão de usuário bloqueado/excluído ou com TokenVersion trocado,
// e atualiza papel e permissões. Resultado em cache por alguns segundos.
const CACHE_SESSAO_MS = 15 * 1000;
const cacheSessao = new Map();   // usuarioId -> { dados, expira }

// Consulta ao banco injetada de fora (app.js), para testar sem SQL Server.
let consultarUsuario = null;
export function configurarRevalidacao(fn) { consultarUsuario = fn; }

// Limpa o cache de um usuário logo após mudar o TokenVersion.
export function invalidarCacheSessao(usuarioId) {
  cacheSessao.delete(Number(usuarioId));
}

export async function revalidarSessao(req, res, next) {
  // Sem sessão não há o que revalidar. Rota pública segue direto.
  if (!req.user || !consultarUsuario) return next();

  try {
    const id = req.user.id;
    const agora = Date.now();
    let linha = cacheSessao.get(id);
    if (!linha || linha.expira < agora) {
      const dados = await consultarUsuario(id);
      linha = { dados, expira: agora + CACHE_SESSAO_MS };
      cacheSessao.set(id, linha);
    }
    const u = linha.dados;

    // Sessão morre: usuário sumiu, não está aprovado ou TokenVersion mudou.
    const morreu = !u || u.Status !== 'aprovado' || (u.TokenVersion ?? 0) !== (req.user.tv ?? 0);
    if (morreu) {
      fecharSessao(res);
      req.user = null;
      req.tokenInvalido = true;
      return next();
    }

    // Estado atual do banco por cima do que o token dizia.
    req.user.papel = u.Papel;
    req.user.gestor = !!u.Gestor;
    req.user.perm = parsePermissoes(u.Permissoes);
    next();
  } catch (e) {
    // Banco fora do ar: segue com o token em vez de deslogar todo mundo.
    console.error('⚠ Revalidação de sessão falhou, seguindo com o token:', e.message);
    next();
  }
}

// Middleware: exige sessão. O trabalho pesado já foi feito por carregarSessao.
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      erro: req.tokenInvalido ? 'Token inválido ou expirado.' : 'Token ausente.'
    });
  }
  next();
}

// ---- Proteção CSRF ----
// O header X-CSRF-Token é comparado com o claim csrf do JWT assinado (não com o cookie).
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Login e logout ficam fora do CSRF, para ninguém ficar trancado se o cookie fg_csrf sumir.
const ROTAS_SEM_CSRF = new Set([
  '/api/auth/login', '/api/auth/register', '/api/auth/logout',
  '/api/auth/senha/esqueci', '/api/auth/senha/verificar', '/api/auth/senha/redefinir'
]);

export function csrfProtect(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();
  if (ROTAS_SEM_CSRF.has(req.path)) return next();
  // Sem sessão não há o que proteger.
  if (!req.user) return next();

  // Compara em bytes: timingSafeEqual lança se os tamanhos forem diferentes.
  const enviado = Buffer.from(String(req.headers['x-csrf-token'] || ''), 'utf8');
  const esperado = Buffer.from(String(req.user?.csrf || ''), 'utf8');
  const ok = esperado.length > 0 &&
             enviado.length === esperado.length &&
             crypto.timingSafeEqual(enviado, esperado);

  if (ok) return next();
  res.status(403).json({ erro: 'Sessão desatualizada. Recarregue a página e tente de novo.' });
}

// Middleware: exige que o usuário autenticado seja admin.
export function requireAdmin(req, res, next) {
  if (req.user?.papel !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
  }
  next();
}

// ---- Permissão por área (contas internas / sub-dealers) ----
// Admin, gestor e conta sem lista de permissões passam direto.
// `u.papel` garante que requisição sem usuário não seja tratada como acesso total.
function temAcessoTotal(u) {
  if (!u || !u.papel) return false;
  return u.papel === 'admin' || u.gestor || !Array.isArray(u.perm);
}

const ERRO_AREA = 'Sua conta não tem acesso a esta área. Fale com o gestor da concessionária.';

// Middleware: bloqueia contas internas (sub-dealers) sem acesso à área.
export function requireArea(area) {
  return (req, res, next) => {
    const u = req.user;
    if (temAcessoTotal(u) || (Array.isArray(u?.perm) && u.perm.includes(area))) return next();
    res.status(403).json({ erro: ERRO_AREA });
  };
}

// Igual ao requireArea, mas basta UMA das áreas.
export function requireAreaAny(areas) {
  return (req, res, next) => {
    const u = req.user;
    if (temAcessoTotal(u) || (Array.isArray(u?.perm) && areas.some(a => u.perm.includes(a)))) return next();
    res.status(403).json({ erro: ERRO_AREA });
  };
}
