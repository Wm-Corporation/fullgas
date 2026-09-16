// ============================================================
// Fábrica — a casa de onde as motos saem
// ------------------------------------------------------------
// Toda conta precisa de uma empresa (Usuario.EmpresaId é NOT NULL), então as
// contas de administrador também ficam penduradas numa: a matriz, ou a empresa
// com que a pessoa se cadastrou antes de ser promovida. O efeito colateral era
// essa empresa aparecer como mais uma "concessionária" — na lista de destino
// dos chassis e nos rótulos do histórico.
//
// A regra: EMPRESA QUE TEM ADMINISTRADOR É A FÁBRICA. Ela não recebe chassi
// como concessionária, e um chassi sem concessionária (EmpresaId NULL) está na
// Fábrica. A regra é calculada na hora, não gravada: promover alguém a admin já
// vale na requisição seguinte, e nenhum dado precisa ser migrado.
// ============================================================

export const FABRICA = 'Fábrica';

// Trecho SQL verdadeiro quando a empresa da coluna `col` é a Fábrica.
// `col` é sempre um nome de coluna escrito no código, nunca entrada do usuário.
//
// `col` PRECISA vir com o apelido da tabela ("e.EmpresaId", nunca
// "EmpresaId"): dentro da subconsulta, um EmpresaId solto é resolvido como a
// coluna do próprio Usuario, a comparação vira sempre verdadeira e TODA
// empresa passaria a ser a Fábrica. Por isso a checagem abaixo.
export function sqlEhFabrica(col) {
  if (!/^\w+\.\w+$/.test(col)) throw new Error('sqlEhFabrica: use a coluna com apelido (ex.: e.EmpresaId).');
  return `EXISTS (SELECT 1 FROM dbo.Usuario fab_u
                   WHERE fab_u.EmpresaId = ${col} AND fab_u.Papel = 'admin')`;
}

// Trecho SQL (0/1) que diz se o dono gravado em `col` significa "na Fábrica":
// sem empresa, ou com a empresa da Fábrica.
export function sqlNaFabrica(col) {
  return `CAST(CASE WHEN ${col} IS NULL OR ${sqlEhFabrica(col)} THEN 1 ELSE 0 END AS BIT)`;
}
