// Erros de aplicação: status HTTP e mensagem segura ao cliente.

export class AppError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.name = 'AppError';
    this.status = status;
    this.publica = true;   // pode ir ao cliente
  }
}

export const erroValidacao = (msg) => new AppError(400, msg);
export const naoEncontrado = (msg = 'Recurso não encontrado.') => new AppError(404, msg);
export const conflito = (msg) => new AppError(409, msg);
