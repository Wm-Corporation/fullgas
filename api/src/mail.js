// Envio de e-mail (SMTP). Sem SMTP_HOST, modo dev: nada sai pela rede.
import nodemailer from 'nodemailer';
import 'dotenv/config';

let transporte = null;

export function mailConfigurado() {
  return !!process.env.SMTP_HOST;
}

// Endereço público do site (base dos links do e-mail). Usa APP_URL;
// sem ela, só aceita a origem da requisição se for nossa (CORS_ORIGIN ou rede local).
export function appUrl(req) {
  const conf = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (conf) return conf;
  return origemConfiavel(req) || 'http://localhost:5500';
}

function origemConfiavel(req) {
  const bruta = req?.headers?.origin || '';
  if (!bruta) return null;
  let u;
  try { u = new URL(bruta); } catch { return null; }

  const permitidas = (process.env.CORS_ORIGIN || '')
    .split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (permitidas.includes(u.origin)) return u.origin;

  // Rede local: localhost, 127.x e as faixas privadas (192.168, 10.x, 172.16-31).
  const h = u.hostname;
  const local = h === 'localhost' || h === '127.0.0.1' ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  return local ? u.origin : null;
}

function obterTransporte() {
  if (transporte) return transporte;
  const porta = Number(process.env.SMTP_PORT || 587);
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    // 465 é TLS implícito; 587/25 sobem para TLS via STARTTLS.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : porta === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined
  });
  return transporte;
}

// Envia um e-mail: { enviado }. Só lança em erro real de SMTP.
export async function enviarEmail({ para, assunto, texto, html }) {
  if (!mailConfigurado()) {
    // Dev: mostra o e-mail no console. Produção: nunca (o corpo leva o link com token).
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `E-MAIL NÃO ENVIADO para ${para} ("${assunto}"): SMTP não configurado. ` +
        'Defina SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS no .env do servidor.'
      );
    } else {
      console.warn(
        '\n──────── E-MAIL NÃO ENVIADO (SMTP não configurado) ────────\n' +
        `Para:    ${para}\nAssunto: ${assunto}\n\n${texto}\n` +
        '───────────────────────────────────────────────────────────\n' +
        'Defina SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS no api/.env para enviar de verdade.\n'
      );
    }
    return { enviado: false };
  }
  await obterTransporte().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: para, subject: assunto, text: texto, html
  });
  return { enviado: true };
}

// Corpo do e-mail de recuperação de senha. `minutos` = validade do link.
export function emailRecuperacaoSenha(nome, link, minutos) {
  const texto =
    `Olá, ${nome}.\n\n` +
    'Recebemos um pedido para redefinir a senha da sua conta no portal Fullgas B2B.\n\n' +
    `Abra este link para escolher uma nova senha (válido por ${minutos} minutos):\n${link}\n\n` +
    'Se não foi você quem pediu, ignore esta mensagem — sua senha continua a mesma.\n\n' +
    'Fullgas B2B';
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1c1c;line-height:1.5;">' +
    `<p>Olá, <b>${escHtml(nome)}</b>.</p>` +
    '<p>Recebemos um pedido para redefinir a senha da sua conta no portal <b>Fullgas B2B</b>.</p>' +
    `<p><a href="${escHtml(link)}" style="display:inline-block;background:#E5B100;color:#1c1c1c;` +
    'font-weight:700;text-decoration:none;padding:12px 22px;border-radius:4px;">Criar nova senha</a></p>' +
    `<p style="font-size:12px;color:#666;">O link vale por ${minutos} minutos. ` +
    `Se o botão não funcionar, copie e cole no navegador:<br>${escHtml(link)}</p>` +
    '<p style="font-size:12px;color:#666;">Se não foi você quem pediu, ignore esta mensagem — ' +
    'sua senha continua a mesma.</p></div>';
  return { texto, html };
}

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
