// Prazo da garantia do VEÍCULO: 90 dias a partir de Veiculo.GarantiaAtivaEm
// (ativada na venda). Vencido — ou nunca ativada — o chassi não aceita novas
// reivindicações. O varejo (garantia por pedido) NÃO tem prazo.
//
// Mora aqui, e não dentro da rota de reivindicações, porque a ficha do veículo
// (veiculos.routes.js) também mostra o período — início e fim — e as duas
// telas precisam contar o mesmo prazo.
export const GARANTIA_DIAS = 90;

// Último instante da garantia, ou null se ela nunca foi ativada.
export function fimDaGarantia(ativaEm) {
  if (!ativaEm) return null;
  const inicio = new Date(ativaEm).getTime();
  if (Number.isNaN(inicio)) return null;
  return new Date(inicio + GARANTIA_DIAS * 24 * 60 * 60 * 1000);
}
