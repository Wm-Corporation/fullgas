// Nome de cadastro: sem espaços nas pontas, em MAIÚSCULAS (mantém acentos).
export function padronizarNome(valor) {
  return String(valor ?? '').trim().toUpperCase();
}
