// Limites de requisição por IP. Dependem do trust proxy (app.js) e do realip no Nginx.
// Contagem em memória: vale enquanto a API for uma instância só.
import rateLimit from 'express-rate-limit';

// Resposta no formato de erro padrão da API.
function bloqueio(mensagem) {
  return (_req, res) => res.status(429).json({ erro: mensagem });
}

const COMUM = {
  standardHeaders: 'draft-7',   // RateLimit-* padronizados
  legacyHeaders: false          // sem os X-RateLimit-* antigos
};

// Login: só tentativas que FALHAM contam.
export const limiteLogin = rateLimit({
  ...COMUM,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  handler: bloqueio('Muitas tentativas de login. Tente de novo em 15 minutos.')
});

// Recuperação de senha: toda requisição conta (cada uma dispara um e-mail).
export const limiteSenha = rateLimit({
  ...COMUM,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  handler: bloqueio('Muitos pedidos de recuperação de senha. Tente de novo daqui a uma hora.')
});

// Abertura de chamado: limite folgado (a concessionária toda sai pelo mesmo IP).
export const limiteChamado = rateLimit({
  ...COMUM,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  handler: bloqueio('Muitos chamados abertos deste endereço na última hora. Responda em um chamado já aberto ou tente de novo mais tarde.')
});

// Cadastro: cria empresa + usuário e ainda chama o Tiny. Poucos por hora.
export const limiteCadastro = rateLimit({
  ...COMUM,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  handler: bloqueio('Muitos cadastros a partir deste endereço. Tente de novo daqui a uma hora.')
});

// Uso do link de recuperação (/senha/verificar e /senha/redefinir).
export const limiteVerificacaoSenha = rateLimit({
  ...COMUM,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  handler: bloqueio('Muitas tentativas. Aguarde alguns minutos e tente de novo.')
});

// Limite geral da API. O teto é alto por causa do /api/pulso (a cada 10 s por aba aberta).
// Ao mudar o intervalo do ao-vivo.js, refaça a conta.
export const limiteGlobal = rateLimit({
  ...COMUM,
  windowMs: 5 * 60 * 1000,
  limit: 3000,
  handler: bloqueio('Muitas requisições deste endereço. Aguarde um instante e tente de novo.')
});
