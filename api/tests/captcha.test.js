// Anti-robô nas bordas: sem configuração, sem token e com o provedor fora do ar.
import { describe, it, expect, vi, afterEach } from 'vitest';

async function carregar(site, secret) {
  const antes = [process.env.TURNSTILE_SITE_KEY, process.env.TURNSTILE_SECRET_KEY];
  process.env.TURNSTILE_SITE_KEY = site || '';
  process.env.TURNSTILE_SECRET_KEY = secret || '';
  const mod = await import('../src/captcha.js?v=' + (site || 'vazio') + (secret || ''));
  process.env.TURNSTILE_SITE_KEY = antes[0];
  process.env.TURNSTILE_SECRET_KEY = antes[1];
  return mod;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('sem configuracao', () => {
  it('captchaConfigurado() e falso quando falta qualquer uma das chaves', async () => {
    expect((await carregar('', '')).captchaConfigurado()).toBe(false);
    expect((await carregar('site1', '')).captchaConfigurado()).toBe(false);
    expect((await carregar('', 'secret1')).captchaConfigurado()).toBe(false);
  });

  it('LIBERA sem nem falar com o provedor', async () => {
    // Desenvolvimento local e testes nao podem depender de conta na Cloudflare.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const c = await carregar('', '');
    expect(await c.verificarCaptcha(undefined)).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('configurado', () => {
  const SITE = 'site-abc', SECRET = 'secret-abc';

  it('recusa quando o token nao veio', async () => {
    const c = await carregar(SITE, SECRET);
    const r = await c.verificarCaptcha('');
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/robô/i);
  });

  it('aceita quando o provedor confirma', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => ({ success: true }) });
    const c = await carregar(SITE, SECRET);
    expect(await c.verificarCaptcha('token-bom')).toEqual({ ok: true });
  });

  it('recusa token ja usado ou expirado', async () => {
    // Token já usado: pede para marcar a caixa de novo.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] })
    });
    const c = await carregar(SITE, SECRET);
    const r = await c.verificarCaptcha('token-queimado');
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/de novo/i);
  });

  it('LIBERA quando o provedor esta fora do ar', async () => {
    // Provedor fora do ar libera (a senha ainda é exigida).
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('rede fora'));
    const c = await carregar(SITE, SECRET);
    expect(await c.verificarCaptcha('token-qualquer')).toEqual({ ok: true });
  });

  it('manda a secret e o token no corpo, e nunca na URL', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => ({ success: true }) });
    const c = await carregar(SITE, SECRET);
    await c.verificarCaptcha('token-bom', '203.0.113.9');
    const [url, opts] = spy.mock.calls[0];
    expect(String(url)).not.toContain(SECRET);
    const corpo = opts.body.toString();
    expect(corpo).toContain('secret=' + SECRET);
    expect(corpo).toContain('response=token-bom');
    expect(corpo).toContain('remoteip=203.0.113.9');
  });
});
