// ============================================================
// Modelo de moto do Parts Finder — código e árvore de seleção
// ------------------------------------------------------------
// Nenhum dos dois é digitado: os dois SAEM dos campos do modelo, e por isso
// acompanham qualquer edição.
//
//   código  = nome + ano  ("FG 125", 2025 → "fg125-2025")
//   árvore  = Marca › Modalidade › Categoria › Nome › Ano
//
// Cilindrada e tipo de motor continuam sendo atributos do modelo, mas não
// entram na árvore (decisão de 16/09/2026).
//
// Este arquivo é espelhado no front (frontend/js/admin.js, `slugModelo`) só
// para mostrar a prévia enquanto o admin digita. Quem decide é a API.
// ============================================================

export const MARCA_PADRAO = 'Fullgas';
export const MODALIDADE_PADRAO = 'Off-road';

// A coluna ModeloMoto.Codigo é VARCHAR(40); o "-2025" do fim ocupa 5.
const CODIGO_MAX = 40;

// "FG 125" + 2025 → "fg125-2025". Espaços somem (é o formato que os modelos
// já cadastrados usam: fg125-2025, fg450f-2025); acento vira letra simples;
// qualquer outro símbolo vira hífen. Devolve '' se o nome não tiver nenhuma
// letra ou número aproveitável.
export function slugModelo(nome, ano) {
  const base = String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return '';
  const sufixo = '-' + String(ano ?? '').trim();
  return base.slice(0, CODIGO_MAX - sufixo.length).replace(/-+$/, '') + sufixo;
}

// Níveis da árvore de seleção, na ordem em que o finder do cliente os mostra.
// Nível vazio fica de fora (um modelo antigo sem categoria não ganha um
// degrau em branco).
export function arvoreModelo(m) {
  return [m?.marca, m?.modalidade, m?.categoria, m?.nome, m?.ano]
    .map(v => (v === null || v === undefined) ? '' : String(v).trim())
    .filter(Boolean);
}
