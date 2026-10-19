// Modelo de moto: código = nome + ano; árvore = Marca › Modalidade › Categoria › Nome › Ano.
// Espelhado em frontend/js/admin.js (slugModelo) só para a prévia.

export const MARCA_PADRAO = 'Fullgas';
export const MODALIDADE_PADRAO = 'Off-road';

// A coluna ModeloMoto.Codigo é VARCHAR(40); o "-2025" do fim ocupa 5.
const CODIGO_MAX = 40;

// "FG 125" + 2025 → "fg125-2025". '' se o nome não tiver letra ou número.
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

// Níveis da árvore, sem os vazios.
export function arvoreModelo(m) {
  return [m?.marca, m?.modalidade, m?.categoria, m?.nome, m?.ano]
    .map(v => (v === null || v === undefined) ? '' : String(v).trim())
    .filter(Boolean);
}
