// Garantia do veículo: 90 dias a partir da venda. Varejo não tem prazo.
export const GARANTIA_DIAS = 90;

// Último instante da garantia, ou null se ela nunca foi ativada.
export function fimDaGarantia(ativaEm) {
  if (!ativaEm) return null;
  const inicio = new Date(ativaEm).getTime();
  if (Number.isNaN(inicio)) return null;
  return new Date(inicio + GARANTIA_DIAS * 24 * 60 * 60 * 1000);
}
