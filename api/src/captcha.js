// Verificação anti-robô (Cloudflare Turnstile). Sem as chaves configuradas, é pulada.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Site key é pública (vai no HTML); secret key é secreta.
const SITE_KEY = (process.env.TURNSTILE_SITE_KEY || '').trim();
const SECRET_KEY = (process.env.TURNSTILE_SECRET_KEY || '').trim();

export function captchaConfigurado() { return !!(SITE_KEY && SECRET_KEY); }
export function captchaSiteKey() { return SITE_KEY; }

// Verifica o token: { ok: true } ou { ok: false, erro }.
// Token inválido é recusado; Cloudflare fora do ar libera (a senha ainda é exigida).
export async function verificarCaptcha(token, ip) {
  if (!captchaConfigurado()) return { ok: true };
  if (!token || typeof token !== 'string')
    return { ok: false, erro: 'Confirme que você não é um robô.' };

  let dados;
  try {
    const corpo = new URLSearchParams({ secret: SECRET_KEY, response: token });
    if (ip) corpo.set('remoteip', ip);
    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
      signal: AbortSignal.timeout(5000)   // o login não pode ficar pendurado
    });
    dados = await r.json();
  } catch (e) {
    console.warn('⚠ Verificação anti-robô indisponível, liberando:', e.message);
    return { ok: true };
  }

  if (dados && dados.success === true) return { ok: true };

  // Códigos: developers.cloudflare.com/turnstile/get-started/server-side-validation
  console.warn('⚠ Anti-robô recusou:', (dados && dados['error-codes']) || 'sem detalhe');
  return { ok: false, erro: 'Verificação de segurança expirada. Marque a caixa de novo.' };
}
