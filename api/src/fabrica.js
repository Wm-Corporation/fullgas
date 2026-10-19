// Fábrica: empresa que tem administrador. Não recebe chassi; chassi sem empresa está na Fábrica.

export const FABRICA = 'Fábrica';

// SQL verdadeiro quando a empresa de `col` é a Fábrica.
// `col` precisa ter apelido ("e.EmpresaId"), senão toda empresa vira Fábrica.
export function sqlEhFabrica(col) {
  if (!/^\w+\.\w+$/.test(col)) throw new Error('sqlEhFabrica: use a coluna com apelido (ex.: e.EmpresaId).');
  return `EXISTS (SELECT 1 FROM dbo.Usuario fab_u
                   WHERE fab_u.EmpresaId = ${col} AND fab_u.Papel = 'admin')`;
}

// SQL (0/1): o dono em `col` está na Fábrica (sem empresa ou empresa da Fábrica).
export function sqlNaFabrica(col) {
  return `CAST(CASE WHEN ${col} IS NULL OR ${sqlEhFabrica(col)} THEN 1 ELSE 0 END AS BIT)`;
}
